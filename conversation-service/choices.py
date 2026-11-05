"""Bounded terminal choice preview and allow-listed navigation; no arbitrary input."""
import hashlib
import re
import time
from replies import ReplyError, api_request
from tab_lifecycle import identity
import claude

CHOICE = re.compile(r'queued follow.up inputs|(?:alt|⌥).*↑.*answer|question \d+\s*(?:/|of)\s*\d+|enter (?:to )?(?:submit|select|confirm)|esc to cancel', re.I)

DIALOG = re.compile(r'enter (?:to )?(?:submit|select|confirm|send|continue)|question \d+\s*(?:/|of)\s*\d+|esc to cancel', re.I)
CLAUDE_OPTION = re.compile(r'^\s*(?:(❯)\s*)?(\d+)\.\s+(.+)$', re.M)


def claude_approval(text):
    headings = list(re.finditer(r'^\s*Do you want to proceed\?\s*$', text, re.M))
    if not headings:
        return None
    heading = headings[-1]
    before = text[:heading.start()]
    starts = list(re.finditer(r'^\s*(?:Bash command|Read file|Write file|Edit file|MCP tool|Permission request)\s*$', before, re.M))
    # Include the actual command, which precedes "This command requires approval".
    # Otherwise two different commands with identical Yes/No options could collide.
    start = starts[-1].start() if starts else max(0, heading.start() - 2000)
    prompt = text[start:].strip()
    matches = list(CLAUDE_OPTION.finditer(prompt))
    if not 2 <= len(matches) <= 10 or [int(m[2]) for m in matches] != list(range(1, len(matches) + 1)):
        return None
    if sum(bool(m[1]) for m in matches) != 1 or not re.search(r'This command requires approval|Esc to cancel', prompt, re.I):
        return None
    options = []
    for i, match in enumerate(matches):
        label = [match[3].strip()]
        end = matches[i + 1].start() if i + 1 < len(matches) else len(prompt)
        for line in prompt[match.end():end].splitlines()[1:]:
            if not line.strip() or re.search(r'Esc to cancel|Tab to amend', line, re.I):
                break
            label.append(line.strip())
        options.append({'number': int(match[2]), 'label': ' '.join(label), 'selected': bool(match[1])})
    stable = re.sub(r'(?m)^(\s*)❯\s*(\d+\.)', r'\1  \2', prompt)
    # Normalize indentation too; moving the arrow changes that prefix's width.
    stable = '\n'.join(line.lstrip() for line in stable.splitlines())
    return prompt, options, prompt[:matches[0].start()].strip(), stable

def prompt_state(text):
    # Ignore the changing transcript/timer above a queued question. A frame token
    # should change when the question or selection changes, not on every tick.
    queues = list(re.finditer(r'^.*Queued follow.up inputs.*$', text, re.I | re.M))
    if queues:
        text = text[queues[-1].start():].strip()
    opened = bool(DIALOG.search(text))
    free_text = opened and bool(re.search(r'^\s*Type your answer\s*$', text, re.I | re.M))
    return text, opened, free_text


def choice_screen(info, text):
    return bool((info or {}).get('agent_status') == 'blocked' or CHOICE.search(text))

def inspect_choice(pane, request=api_request):
    info = request('pane.process_info', {'pane_id': pane})['process_info']
    candidates = []
    for process in info.get('foreground_processes', []):
        agent = process.get('name')
        if agent not in ('codex', 'claude'):
            continue
        try:
            proc = identity(process['pid'], pane) if agent == 'codex' else identity(process['pid'], pane, agent)
            if agent == 'claude' and not claude.match_session(proc['profile'], str(process['pid']), proc['start'], proc['cwd']):
                continue
            candidates.append((process, proc))
        except (ReplyError, OSError, ValueError, KeyError):
            continue
    if len(candidates) != 1:
        return {'active': False}
    process, proc = candidates[0]
    agent = process['name']
    pane_info = request('pane.get', {'pane_id': pane})['pane']
    # Detection reads the live screen independently of the shared scroll position.
    read = request('pane.read', {'pane_id': pane, 'source': 'detection', 'lines': 80, 'format': 'text', 'strip_ansi': True})['read']
    # Approval/questions sit at the bottom; long output above must not crop them.
    text = read['text'][-12000:].strip()
    if agent == 'claude':
        approval = claude_approval(text)
        if not approval:
            return {'active': False}
        text, options, context, stable = approval
        token = f"{process['pid']}:{proc['start']}"
        frame = hashlib.sha256((token + '\n' + text).encode()).hexdigest()
        question = hashlib.sha256((token + '\n' + stable).encode()).hexdigest()
        return {'active': True, 'provider': 'claude', 'token': token, 'frame': frame,
                'question': question, 'text': text, 'context': context, 'options': options,
                'isOpen': True, 'canNavigate': True, 'canAnswer': False}
    if not choice_screen(pane_info, text):
        return {'active': False}
    text, opened, free_text = prompt_state(text)
    token = f"{process['pid']}:{proc['start']}"
    frame = hashlib.sha256((token + '\n' + text).encode()).hexdigest()
    return {'active': True, 'provider': 'codex', 'token': token, 'frame': frame, 'text': text, 'canNavigate': opened and not free_text, 'isOpen': opened, 'canAnswer': free_text}

def choice_request(body, request=api_request):
    action = body.get('action')
    keys = {'open': 'Alt+Up', 'up': 'Up', 'down': 'Down', 'select': 'Enter', 'cancel': 'Escape', 'main': 'Alt+Down'}
    expected = {'operation', 'pane', 'action'} | (set() if action == 'inspect' else {'token', 'frame'}) | ({'text'} if action == 'answer' else set()) | ({'number'} if action == 'choose' else set())
    if set(body) != expected or action not in ('inspect', 'answer', 'choose', *keys) or not isinstance(body.get('pane'), str) or not re.fullmatch(r'[A-Za-z0-9:._-]{1,100}', body['pane']):
        raise ReplyError(400, 'Invalid choice control.')
    if action == 'answer':
        text = body.get('text')
        if (not isinstance(text, str) or not text.strip() or len(text.encode()) > 16000
                or any(ord(c) < 32 and c not in '\n\t' or ord(c) == 127 for c in text)):
            raise ReplyError(400, 'Write an answer of at most 16,000 bytes without control characters.')
    state = inspect_choice(body['pane'], request)
    if action == 'inspect':
        return state
    if not state.get('active') or state['token'] != body['token'] or (action in ('select', 'answer', 'choose') and state['frame'] != body['frame']):
        raise ReplyError(409, 'The choice prompt changed. Review it before choosing again.')
    if state.get('provider') == 'claude' and action in ('open', 'answer', 'main'):
        raise ReplyError(409, 'Use the visible Claude approval options.')
    if action == 'choose':
        options = state.get('options', [])
        number = body['number']
        if state.get('provider') != 'claude' or not isinstance(number, int) or isinstance(number, bool) or not 1 <= number <= len(options):
            raise ReplyError(400, 'Invalid approval option.')
        selected = next((i for i, option in enumerate(options) if option['selected']), None)
        if selected is None:
            raise ReplyError(409, 'Review the approval prompt in Terminal.')
        steps = number - 1 - selected
        if steps:
            request('pane.send_input', {'pane_id': body['pane'], 'keys': ['Down' if steps > 0 else 'Up'] * abs(steps)})
            time.sleep(.12)
        current = inspect_choice(body['pane'], request)
        if (not current.get('active') or current.get('token') != state['token']
                or current.get('question') != state.get('question')
                or not any(option['number'] == number and option['selected'] for option in current.get('options', []))):
            raise ReplyError(409, 'The approval prompt changed. Nothing was confirmed. Review it before choosing again.')
        request('pane.send_input', {'pane_id': body['pane'], 'keys': ['Enter']})
        time.sleep(.12)
        return inspect_choice(body['pane'], request)
    if action == 'answer' and not state.get('canAnswer'):
        raise ReplyError(409, 'The question is no longer an empty answer field. Review it in Terminal.')
    if action == 'main' and not state.get('isOpen'):
        raise ReplyError(409, 'The question is no longer open.')
    if action not in ('open', 'answer', 'main') and not state.get('canNavigate'):
        raise ReplyError(409, 'Open the choice prompt before using its navigation controls.')
    if action == 'answer':
        request('pane.send_input', {'pane_id': body['pane'], 'text': body['text'], 'keys': ['Enter']})
    elif action != 'open' or not state.get('isOpen'):
        request('pane.send_input', {'pane_id': body['pane'], 'keys': [keys[action]]})
    time.sleep(.12)
    return inspect_choice(body['pane'], request)
