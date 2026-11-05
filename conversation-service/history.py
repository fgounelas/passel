"""Bounded, read-only paging of original session messages, independent of PTY history."""
from transcript import open_transcript, transcript_info
import json
import os
import stat
from collector import display_message, MAX_LINE, TAIL
from replies import ReplyError

PAGE = 40


def read_history(path, direction, cursor, query=None):
    with open_transcript(path) as f:
        info = transcript_info(f)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid():
            raise ReplyError(409, 'Conversation file is unavailable.')
        if direction not in ('before', 'after', 'start', 'search', 'prompt') or type(cursor) is not int or cursor < 0 or cursor > info.st_size:
            raise ReplyError(400, 'Invalid history position.')
        backwards = direction in ('before', 'prompt')
        if backwards:
            end = cursor
            start = max(0, end - TAIL)
            f.seek(start)
            if start:
                f.readline(MAX_LINE + 1)
                start = f.tell()
            budget = end
        else:
            start = cursor if direction in ('after', 'search') else 0
            f.seek(start)
            budget = min(info.st_size, start + TAIL)
        messages = []
        seen = 0
        chars = 0
        last_complete = start
        last_message_end = start
        while f.tell() < budget:
            offset = f.tell()
            line = f.readline(min(MAX_LINE + 1, budget - offset))
            if not line.endswith(b'\n'):
                if len(line) <= MAX_LINE:
                    break
                while f.tell() < budget and line and not line.endswith(b'\n'):
                    line = f.readline(min(MAX_LINE + 1, budget - f.tell()))
                last_complete = f.tell()
                continue
            last_complete = f.tell()
            try:
                message = display_message(json.loads(line), offset)
            except (ValueError, TypeError, AttributeError):
                continue
            if message and (direction != 'search' or query.casefold() in message['text'].casefold()) and (direction != 'prompt' or message['role'] == 'user'):
                seen += 1
                if not backwards and chars + len(message['text']) > 500_000:
                    last_complete = offset
                    break
                messages.append(message)
                last_message_end = f.tell()
                chars += len(message['text'])
                if not backwards and len(messages) >= PAGE:
                    break
                while len(messages) > PAGE or chars > 500_000:
                    chars -= len(messages.pop(0)['text'])
        if direction == 'prompt' and messages:
            # Find the nearest prompt without letting dense assistant output
            # shrink backwards progress to an overlapping forty-message page.
            return read_history(path, 'after', int(messages[-1]['id']))
        before = int(messages[0]['id']) if messages else start
        after = last_message_end if messages else max(start, last_complete)
        return {'messages': messages, 'before': before, 'after': after,
                'hasEarlier': start > 0 or (backwards and seen > len(messages)),
                'hasLater': last_complete < info.st_size,
                'nextCursor': last_complete, 'fileSize': info.st_size}


def history_request(body, discover):
    expected = {'operation', 'pane', 'session', 'direction', 'cursor'}
    if body.get('direction') == 'search':
        expected.add('query')
        if not isinstance(body.get('query'), str) or not 1 <= len(body['query'].strip()) <= 200:
            raise ReplyError(400, 'Search requires 1–200 characters.')
    if set(body) != expected:
        raise ReplyError(400, 'Invalid history request.')
    pane, session = body['pane'], body['session']
    if not isinstance(pane, str) or not isinstance(session, str):
        raise ReplyError(400, 'Invalid conversation.')
    current = discover().get(pane)
    if not current or current[1] != session or current[0] is None:
        raise ReplyError(409, 'The conversation changed. Return to latest messages.')
    return {'session': session, **read_history(current[0], body['direction'], body['cursor'], body.get('query'))}
