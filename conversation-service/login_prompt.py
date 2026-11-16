"""Read-only, transient Claude sign-in link detection. Never persist login data."""
import re
from urllib.parse import parse_qs, urlsplit

LOGIN_HEADING = re.compile(r"browser didn[’']t open\?", re.I)
URL_PART = re.compile(r"[A-Za-z0-9:/?\[\]@!$&'()*+,;=._~%#-]+")
LOGIN_ENDPOINTS = {
    ('claude.ai', '/oauth/authorize'),
    ('console.anthropic.com', '/oauth/authorize'),
    ('platform.claude.com', '/oauth/authorize'),
    ('claude.com', '/cai/oauth/authorize'),
}


def claude_login_url(text):
    lines = text[-12000:].splitlines()
    headings = [i for i, line in enumerate(lines) if LOGIN_HEADING.search(line)]
    if not headings:
        return None
    for start in range(headings[-1] + 1, min(len(lines), headings[-1] + 8)):
        first = lines[start].strip()
        if not first:
            continue
        if not first.startswith('https://'):
            continue
        parts = []
        for line in lines[start:start + 32]:
            value = line.strip()
            if not value or not URL_PART.fullmatch(value):
                break
            parts.append(value)
        url = ''.join(parts)
        if len(url) > 8192:
            return None
        try:
            parsed = urlsplit(url)
            query = parse_qs(parsed.query)
            if (parsed.scheme == 'https' and (parsed.hostname, parsed.path) in LOGIN_ENDPOINTS
                    and not parsed.username
                    and not parsed.password and parsed.port in (None, 443) and not parsed.fragment
                    and query.get('response_type') == ['code']
                    and all(query.get(key) for key in ('client_id', 'state', 'code_challenge'))):
                return url
        except ValueError:
            pass
        return None
    return None
