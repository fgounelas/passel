"""Explicit account reset control; never terminal input or automatic redemption."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import time
import uuid
from contextlib import closing
from replies import ReplyError, api_request

USAGE = None

def usage_module():
    global USAGE
    if USAGE is None:
        path = Path.home() / 'containers/herdr-web/usage-service/collector.py'
        info = path.lstat()
        if path.resolve() != path or info.st_uid != os.getuid() or not stat.S_ISREG(info.st_mode) or info.st_mode & 0o022:
            raise ValueError('Unsafe quota observer')
        spec = importlib.util.spec_from_file_location('passel_quota_collector', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        USAGE = module
    return USAGE

def reset_request(body, database, request=api_request, usage=None):
    if not isinstance(body, dict) or set(body) != {'operation', 'pane', 'accountKey', 'requestId', 'creditId', 'availableCount'}:
        raise ReplyError(400, 'Invalid reset request.')
    pane, key, nonce, credit, count = (body[k] for k in ('pane', 'accountKey', 'requestId', 'creditId', 'availableCount'))
    if not isinstance(pane, str) or not re.fullmatch(r'[A-Za-z0-9:._-]{1,100}', pane) or not isinstance(key, str) or not re.fullmatch(r'[a-f0-9]{64}', key):
        raise ReplyError(400, 'Invalid reset account.')
    try:
        valid_nonce = isinstance(nonce, str) and str(uuid.UUID(nonce)) == nonce and uuid.UUID(nonce).version == 4
    except ValueError:
        valid_nonce = False
    if (not valid_nonce or type(count) is not int or not 1 <= count <= 100000 or
            credit is not None and (not isinstance(credit, str) or not 0 < len(credit) <= 256 or any(ord(c) < 32 for c in credit))):
        raise ReplyError(400, 'Invalid reset selection.')
    usage = usage or usage_module()
    info = request('pane.process_info', {'pane_id': pane})['process_info']
    profiles = [p for process in info.get('foreground_processes', [])
                if (p := usage.process_profile(process, pane)) and p[0] == 'codex']
    if len(profiles) != 1:
        raise ReplyError(409, 'Open an attached Codex session and review its account before resetting.')
    home = profiles[0][1]
    database = Path(database)
    if database.is_symlink() or database.exists() and (database.stat().st_uid != os.getuid() or not stat.S_ISREG(database.stat().st_mode)):
        raise ValueError('Unsafe reset receipts')
    with closing(sqlite3.connect(database, timeout=2)) as db:
        database.chmod(0o600)
        db.execute('CREATE TABLE IF NOT EXISTS resets(nonce TEXT PRIMARY KEY,account TEXT,credit TEXT,count INTEGER,outcome TEXT,created REAL)')
        prior = db.execute('SELECT account,credit,count,outcome FROM resets WHERE nonce=?', (nonce,)).fetchone()
        if prior and prior[:3] != (key, credit, count):
            raise ReplyError(409, 'This reset attempt belongs to a different selection.')
        if prior and prior[3]:
            return {'outcome': 'alreadyRedeemed' if prior[3] == 'reset' else prior[3], 'quota': None}
        if not prior and db.execute('SELECT count(*) FROM resets WHERE outcome IS NULL').fetchone()[0] >= 1000:
            raise ReplyError(409, 'Too many unresolved reset attempts. Review usage on the provider before trying again.')
        client = usage.CodexReader(home, allow_reset=True)
        try:
            client.call('initialize', {'clientInfo': {'name': 'passel_explicit_quota_reset', 'version': '1.0.0'}})
            client.send({'method': 'initialized', 'params': {}})
            account = client.call('account/read', {'refreshToken': False}).get('account') or {}
            limits = client.call('account/rateLimits/read')
            extras = usage.codex_extras(limits, home)
            if account.get('type') != 'chatgpt' or extras['accountKey'] != key:
                raise ReplyError(409, 'The account changed. Refresh usage and review the account before resetting.')
            summary = extras['bankedResets']
            if not prior:
                if not summary or summary['availableCount'] != count:
                    raise ReplyError(409, 'The banked resets changed. Refresh usage before choosing again.')
                if credit is not None and not any(r['id'] == credit and r['status'] == 'available' and r['resetType'] == 'codexRateLimits'
                    and (not r['expiryKnown'] or r['expiresAt'] is None or r['expiresAt'] > time.time()) for r in summary['credits'] or []):
                    raise ReplyError(409, 'That reset is no longer available. Refresh usage.')
                db.execute('INSERT INTO resets VALUES(?,?,?,?,NULL,?)', (nonce, key, credit, count, time.time()))
                db.commit()  # Preserve the nonce before any provider mutation.
            outcome = client.call('account/rateLimitResetCredit/consume', {'idempotencyKey': nonce, **({'creditId': credit} if credit else {})}).get('outcome')
            if outcome not in ('reset', 'alreadyRedeemed', 'nothingToReset', 'noCredit'):
                raise ValueError('Unknown reset outcome')
            db.execute('UPDATE resets SET outcome=? WHERE nonce=?', (outcome, nonce)); db.commit()
            # Bound completed receipt history; unresolved attempts retain their keys.
            db.execute('DELETE FROM resets WHERE outcome IS NOT NULL AND nonce NOT IN (SELECT nonce FROM resets WHERE outcome IS NOT NULL ORDER BY created DESC LIMIT 1000)')
            db.commit()
            try:
                fresh = client.call('account/rateLimits/read')
                quota = {'provider': 'codex', 'account': str(account.get('email') or usage.PROFILES[home])[:160],
                    'profile': usage.PROFILES[home], 'windows': usage.codex_windows(fresh),
                    **usage.codex_extras(fresh, home), 'status': 'ok', 'observedAt': time.time()}
            except (OSError, ValueError, TimeoutError):
                quota = {'provider': 'codex', 'accountKey': key, 'windows': [], 'status': 'Quota refresh failed', 'observedAt': time.time()}
            usage.atomic_json(usage.CACHE / ('reset-result-' + hashlib.sha256(home.encode()).hexdigest() + '.json'), quota)
            return {'outcome': outcome, 'quota': quota}
        finally:
            client.close()
