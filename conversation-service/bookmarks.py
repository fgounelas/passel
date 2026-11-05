"""Durable per-instance bookmarks. Browser IDs never become filesystem paths."""
from transcript import open_transcript, transcript_info
import json
from contextlib import contextmanager
import os
from pathlib import Path
import re
import sqlite3
import stat
import time

from replies import ReplyError

MAX_PINS = 1000
MAX_CHARS = 10_000_000
PAGE = 100


class Bookmarks:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        if self.path.exists() and (self.path.is_symlink() or self.path.stat().st_uid != os.getuid()):
            raise ValueError('Unsafe bookmark database')
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS bookmarks (session TEXT NOT NULL, '
                       'message TEXT NOT NULL, body TEXT NOT NULL, chars INTEGER NOT NULL, '
                       'created INTEGER NOT NULL, PRIMARY KEY(session,message))')
        self.path.chmod(0o600)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=5)
        try:
            with db:
                yield db
        finally:
            db.close()

    def list(self, session, offset=0):
        with self.connect() as db:
            rows = db.execute('SELECT body FROM bookmarks WHERE session=? ORDER BY created DESC,message LIMIT ? OFFSET ?',
                              (session, PAGE + 1, offset)).fetchall()
            ids = [row[0] for row in db.execute('SELECT message FROM bookmarks WHERE session=?', (session,))]
        pins, chars = [], 0
        for row in rows[:PAGE]:
            pin = json.loads(row[0])
            if chars + len(pin['text']) > 500_000: break
            pins.append(pin)
            chars += len(pin['text'])
        return {'pins': pins, 'ids': ids, 'hasMore': len(rows) > len(pins),
                'nextOffset': offset + len(pins)}

    def add(self, session, message):
        value = {**message, 'session': session}
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute('SELECT 1 FROM bookmarks WHERE session=? AND message=?', (session, message['id'])).fetchone():
                return
            count, chars = db.execute('SELECT count(*),coalesce(sum(chars),0) FROM bookmarks').fetchone()
            if count >= MAX_PINS or chars + len(message['text']) > MAX_CHARS:
                raise ReplyError(409, 'Bookmark storage is full. Remove a bookmark before adding another.')
            db.execute('INSERT INTO bookmarks VALUES (?,?,?,?,?)',
                       (session, message['id'], json.dumps(value), len(message['text']), time.time_ns()))

    def remove(self, session, message):
        with self.connect() as db:
            db.execute('DELETE FROM bookmarks WHERE session=? AND message=?', (session, message))


def read_message(path, message_id):
    from collector import display_message, MAX_LINE
    with open_transcript(path) as f:
        info = transcript_info(f)
        offset = int(message_id)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or offset >= info.st_size:
            raise ReplyError(409, 'Message is no longer available.')
        if offset:
            f.seek(offset - 1)
            if f.read(1) != b'\n':
                raise ReplyError(400, 'Invalid message position.')
        line = f.readline(MAX_LINE + 1)
        if len(line) > MAX_LINE or not line.endswith(b'\n'):
            raise ReplyError(400, 'Invalid message record.')
        message = display_message(json.loads(line), offset)
        if not message:
            raise ReplyError(400, 'Only conversation questions and responses can be bookmarked.')
        return message


def bookmark_request(body, discover, store):
    action = body.get('action')
    required = {'operation', 'action', 'session'}
    if action == 'list': required.add('offset')
    elif action == 'add': required.update(('pane', 'message'))
    elif action == 'remove': required.add('message')
    else: raise ReplyError(400, 'Invalid bookmark action.')
    if set(body) != required or not isinstance(body['session'], str) or not re.fullmatch(r'[a-fA-F0-9-]{36}', body['session']):
        raise ReplyError(400, 'Invalid bookmark request.')
    session = body['session']
    if action == 'list':
        if type(body['offset']) is not int or not 0 <= body['offset'] <= MAX_PINS:
            raise ReplyError(400, 'Invalid bookmark offset.')
        return store.list(session, body['offset'])
    message = body['message']
    if not isinstance(message, str) or not re.fullmatch(r'0|[1-9][0-9]{0,14}', message):
        raise ReplyError(400, 'Invalid message.')
    if action == 'add':
        pane = body['pane']
        if not isinstance(pane, str) or not re.fullmatch(r'[A-Za-z0-9:._-]{1,100}', pane):
            raise ReplyError(400, 'Invalid pane.')
        current = discover().get(pane)
        if not current or current[1] != session or current[0] is None:
            raise ReplyError(409, 'The conversation changed. Refresh before bookmarking.')
        store.add(session, read_message(current[0], message))
    else:
        store.remove(session, message)
    return {'status': 'saved'}
