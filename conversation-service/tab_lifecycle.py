"""Gracefully quit/resume explicitly supported foreground agent TUIs, never process groups."""
import os
import hashlib
from pathlib import Path
import re
import select
import shlex
import pwd
import time
from replies import ReplyError, SESSION


def identity(pid, pane, agent="codex"):
    if agent not in ("codex", "claude"):
        raise ReplyError(409, "This agent does not support quit/resume yet.")
    proc = Path('/proc') / str(pid)
    if proc.stat().st_uid != os.getuid() or (proc / 'comm').read_text().strip() != agent:
        raise ReplyError(409, 'The foreground agent process changed. Nothing was stopped.')
    fields = (proc / 'stat').read_text().rsplit(')', 1)[1].split()
    if len(fields) < 20 or not int(fields[4]) or int(fields[5]) <= 0 or fields[2] != fields[5]:
        raise ReplyError(409, 'The agent is no longer in the foreground. Nothing was stopped.')
    env = {}
    for entry in (proc / 'environ').read_bytes().split(b'\0'):
        key, _, value = entry.partition(b'=')
        if key in (b'HERDR_PANE_ID', b'HERDR_SESSION', b'CODEX_HOME', b'CLAUDE_CONFIG_DIR', b'PATH'):
            env[key.decode()] = value.decode()
    bound_pane = env.get('HERDR_PANE_ID')
    if agent == 'claude' and bound_pane != pane:
        from daemon_mapping import foreground_claude_pane
        if isinstance(bound_pane, str) and re.fullmatch(r'[A-Za-z0-9:._-]{1,100}', bound_pane):
            bound_pane = foreground_claude_pane(bound_pane, pid, fields[19], SESSION)
    if bound_pane != pane or env.get('HERDR_SESSION', 'default') != SESSION:
        raise ReplyError(409, 'Cannot verify which tab owns the agent. Nothing was stopped.')
    args = (proc / 'cmdline').read_bytes().split(b'\0')
    if (agent == 'codex' and any(v in args for v in (b'app-server', b'exec', b'--managed-daemon')) or
            agent == 'claude' and any(v in args for v in (b'-p', b'--print', b'--bg', b'--background'))):
        raise ReplyError(409, 'This is not an interactive agent session. Nothing was stopped.')
    if agent == 'codex':
        profile = env.get('CODEX_HOME', str(Path.home() / '.codex'))
        allowed = [Path.home() / '.codex', Path.home() / 'work/danus/runtime/codex-home',
                   Path.home() / 'work/danus-mine/runtime/codex-home']
    else:
        profile = env.get('CLAUDE_CONFIG_DIR', str(Path.home() / '.claude'))
        allowed = [Path.home() / '.claude']
    if profile not in [str(p) for p in allowed]:
        raise ReplyError(409, 'This agent profile is not supported for quitting from Passel.')
    executable = os.readlink(proc / 'exe')
    extra = {}
    if agent == 'claude':
        # A native install can update its public symlink while an older binary
        # is still running. Keep a private, version-bound alias named "claude";
        # that name is also needed for Herdr process detection after exec.
        if not re.fullmatch(r'claude(?:\.exe)?|[0-9]+\.[0-9]+\.[0-9]+(?:[-.][A-Za-z0-9.-]+)?', Path(executable).name):
            raise ReplyError(409, 'This Claude runtime is not supported for resuming yet. Use Archive only.')
        extra = {'profile_explicit': 'CLAUDE_CONFIG_DIR' in env, 'launcher': str(claude_launcher_path(executable))}
    return {'start': fields[19], 'group': int(fields[2]), 'pane': pane,
            'executable': executable, 'cwd': os.readlink(proc / 'cwd'), 'profile': profile, **extra}


def claude_launcher_path(executable):
    key = hashlib.sha256(executable.encode()).hexdigest()[:24]
    base = Path(os.environ.get('PASSEL_STATE_DIR', Path.home() / 'containers/herdr-web'))
    return base / 'conversation-state/launchers' / key / 'claude'


def prepare_claude_launcher(saved):
    launcher = claude_launcher_path(saved['executable'])
    if str(launcher) != saved['launcher']:
        raise ReplyError(409, 'Invalid saved Claude launcher.')
    root = launcher.parent.parent
    for directory in (root.parent, root):
        directory.mkdir(mode=0o700, exist_ok=True)
        if directory.is_symlink() or directory.stat().st_uid != os.getuid():
            raise ReplyError(409, 'Unsafe agent launcher directory.')
    if not launcher.parent.exists() and sum(1 for _ in root.iterdir()) >= 128:
        raise ReplyError(409, 'Agent launcher storage is full. Use Archive only.')
    launcher.parent.mkdir(mode=0o700, exist_ok=True)
    if launcher.parent.is_symlink() or launcher.parent.stat().st_uid != os.getuid():
        raise ReplyError(409, 'Unsafe agent launcher directory.')
    try:
        launcher.symlink_to(saved['executable'])
    except FileExistsError:
        pass
    if not launcher.is_symlink() or os.readlink(launcher) != saved['executable'] or not launcher.is_file():
        raise ReplyError(409, 'The saved Claude executable is no longer available.')


def quit_session(pane, discover, request):
    processes = request('pane.process_info', {'pane_id': pane})['process_info']
    candidates = [p for p in processes.get('foreground_processes', []) if p.get('name') in ('codex', 'claude')]
    if len(candidates) != 1:
        raise ReplyError(409, 'Quit and archive requires exactly one supported foreground agent session in this tab.')
    pid = candidates[0]['pid']
    if not isinstance(pid, int) or pid <= 1:
        raise ReplyError(409, 'Invalid foreground process.')
    agent = candidates[0]['name']
    check_identity = lambda: identity(pid, pane) if agent == 'codex' else identity(pid, pane, agent)
    before = check_identity()
    if agent == 'claude':
        prepare_claude_launcher(before)
    command = '/quit' if agent == 'codex' else '/exit'
    current = discover().get(pane)
    resume = {**before, 'agent': agent, 'session': None}
    if current and current[0] and re.fullmatch(r'[a-fA-F0-9-]{36}', current[1]):
        resume = {**before, 'agent': agent, 'session': current[1]}
    # Track the original process lifetime while asking the TUI to quit normally.
    # Never send SIGTERM/SIGKILL or signal a process group.
    if not hasattr(os, 'pidfd_open'):
        raise ReplyError(409, 'Safe exit tracking is unavailable on this host. Use Archive only.')
    fd = os.pidfd_open(pid)
    try:
        now = request('pane.process_info', {'pane_id': pane})['process_info']
        if (check_identity() != before or now.get('foreground_process_group_id') != before['group'] or
                not any(p.get('pid') == pid and p.get('name') == agent for p in now.get('foreground_processes', []))):
            raise ReplyError(409, 'The foreground session changed. Nothing was stopped.')
        def still_running():
            if select.select([fd], [], [], 0)[0]:
                return False
            try:
                unchanged = check_identity() == before
            except (OSError, ReplyError):
                if select.select([fd], [], [], 0)[0]:
                    return False
                raise
            if not unchanged:
                raise ReplyError(409, 'The foreground session changed. Check Terminal.')
            return True

        # Never use Ctrl-C to clear input: it can start a delayed graceful exit
        # and let subsequent text land in the shell. These keys only edit text.
        # Complex/multiline drafts fail the exact composer check below.
        if not still_running():
            return resume
        editing_keys = ['Escape', 'Ctrl+u', 'Ctrl+k'] if agent == 'codex' else ['Ctrl+u', 'Ctrl+k']
        request('pane.send_input', {'pane_id': pane, 'keys': editing_keys})
        if not still_running():
            return resume
        request('pane.send_input', {'pane_id': pane, 'text': command})
        deadline = time.monotonic() + 1.5
        while True:
            if not still_running():
                return resume
            if quit_composer_ready(terminal_text(pane, request, "visible" if agent == "claude" else "recent_unwrapped"), agent):
                break
            if time.monotonic() >= deadline:
                if not still_running():
                    return resume
                raise ReplyError(409, f'Could not confirm {command} is the only agent input. Enter was not sent. Close any dialogs and clear the draft in Terminal before trying again.')
            time.sleep(.05)
        if not still_running():
            return resume
        request('pane.send_input', {'pane_id': pane, 'keys': ['Enter']})
        if not select.select([fd], [], [], 4)[0]:
            raise ReplyError(409, f'The session has not exited after {command}. The tab was not archived. Check Terminal.')
    finally:
        os.close(fd)
    return resume


def terminal_text(pane, request, source="recent_unwrapped"):
    return request('pane.read', {'pane_id': pane, 'source': source,
                                'lines': 80, 'format': 'text', 'strip_ansi': True})['read']['text']


def quit_composer_ready(text, agent="codex"):
    marker, command = ("›", "/quit") if agent == "codex" else ("❯", "/exit")
    lines = text.replace('\u00a0', ' ').splitlines()
    starts = [i for i, line in enumerate(lines) if line.lstrip().startswith(marker + ' ')]
    if not starts:
        return False
    i = starts[-1]
    # The last prompt is the composer, not the slash menu or transcript. Any
    # nonblank continuation line means a leftover multiline draft: do not Enter.
    following = lines[i + 1].strip() if i + 1 < len(lines) else ''
    boundary = not following or agent == 'claude' and all(c in '─━╌' for c in following)
    return lines[i].strip() == marker + ' ' + command and boundary


def wait_for_text(pane, request, predicate, error):
    deadline = time.monotonic() + 1.5
    while time.monotonic() < deadline:
        if predicate(terminal_text(pane, request)):
            return
        time.sleep(.05)
    raise ReplyError(409, error)


def shell_info(pane, request):
    info = request('pane.process_info', {'pane_id': pane})['process_info']
    foreground = info.get('foreground_processes', [])
    if len(foreground) != 1 or foreground[0].get('pid') != info.get('shell_pid') or foreground[0].get('name') not in ('bash', 'zsh', 'sh', 'fish'):
        raise ReplyError(409, 'The tab is not at an idle shell prompt. Open Terminal before resuming.')
    return foreground[0]


def empty_shell_prompt(text, shell, home=None, username=None, hostname=None):
    # Fail closed for custom/unrecognised prompts. Do not guess by looking for a
    # trailing "$": typed commands can contain that character too.
    home = str(Path.home()) if home is None else home
    username = pwd.getpwuid(os.getuid()).pw_name if username is None else username
    hostname = os.uname().nodename if hostname is None else hostname
    cwd = shell.get('cwd', '')
    if not cwd or any(c in cwd for c in '\r\n'):
        return None
    short = '~' + cwd[len(home):] if cwd == home or cwd.startswith(home + '/') else cwd
    prompts = {f'{username}@{host}:{directory}{suffix}' for host in (hostname, hostname.split('.')[0])
               for directory in (cwd, short) for suffix in ('$', '%', '>')}
    lines = text.rstrip().splitlines()
    return lines[-1].rstrip() if lines and lines[-1].rstrip() in prompts else None


def resume_session(saved, request):
    agent = saved.get("agent", "codex")
    if agent not in ("codex", "claude"):
        raise ReplyError(409, "This agent does not support resuming yet.")
    pane = saved['pane']
    shell = shell_info(pane, request)
    prompt = empty_shell_prompt(terminal_text(pane, request), shell)
    if not prompt:
        raise ReplyError(409, 'Resume requires an empty shell prompt. Clear any existing input in Terminal first; custom prompts may require manual resume.')
    executable, cwd = Path(saved['executable']), Path(saved['cwd'])
    if not executable.is_file() or not os.access(executable, os.X_OK) or not cwd.is_dir():
        raise ReplyError(409, 'The saved agent executable or directory is no longer available. Resume from Terminal.')
    launcher = Path(saved.get('launcher', str(executable)))
    if not launcher.is_file() or not os.path.samefile(launcher, executable):
        raise ReplyError(409, 'The saved agent launcher has changed. Resume from Terminal.')
    profile_key = 'CODEX_HOME' if agent == 'codex' else 'CLAUDE_CONFIG_DIR'
    if agent == 'claude' and saved.get('profile_explicit') is False:
        # An explicit default CLAUDE_CONFIG_DIR changes where Claude reads its
        # onboarding/settings file. Preserve an originally unset variable.
        argv = ['env', '-u', profile_key, str(launcher)]
    else:
        argv = ['env', profile_key + '=' + saved['profile'], str(launcher)]
    if saved.get('session'):
        argv.extend(['resume' if agent == 'codex' else '--resume', saved['session']])
    command = 'cd -- ' + shlex.quote(str(cwd)) + ' && ' + shlex.join(argv)
    if any(ord(c) < 32 or ord(c) == 127 for c in command):
        raise ReplyError(409, 'The saved launch configuration is not supported. Resume from Terminal.')
    # No Ctrl-U or other simulated shell key: a TUI killed by the old version may
    # have left Kitty keyboard mode active, encoding Ctrl-U as literal CSI text.
    if shell_info(pane, request) != shell or empty_shell_prompt(terminal_text(pane, request), shell) != prompt:
        raise ReplyError(409, 'Terminal input changed. Nothing was submitted; clear the prompt and try again.')
    request('pane.send_input', {'pane_id': pane, 'text': command})
    # Stage, read back, and only then Enter. Reject a prefix, suffix, continuation,
    # unexpected wrap or concurrent typing rather than executing a mixed command.
    wait_for_text(pane, request, lambda text: text.rstrip().splitlines()[-1:] == [prompt + ' ' + command],
                  'The terminal command line was not exactly the saved resume command. Nothing was submitted. Check Terminal.')
    if shell_info(pane, request) != shell:
        raise ReplyError(409, 'The foreground process changed. Nothing was submitted. Check Terminal.')
    request('pane.send_input', {'pane_id': pane, 'keys': ['Enter']})
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        info = request('pane.process_info', {'pane_id': pane})['process_info']
        candidates = [p for p in info.get('foreground_processes', []) if p.get('name') == agent]
        if len(candidates) == 1:
            running = identity(candidates[0]['pid'], pane) if agent == 'codex' else identity(candidates[0]['pid'], pane, agent)
            args = candidates[0].get('argv', [])
            session_matches = not saved.get('session') or args[1:] == ['resume' if agent == 'codex' else '--resume', saved['session']]
            profile_mode_matches = agent != 'claude' or running.get('profile_explicit') == saved.get('profile_explicit')
            if session_matches and profile_mode_matches and all(running[key] == saved[key] for key in ('executable', 'profile', 'cwd')):
                return
        time.sleep(.1)
    raise ReplyError(409, 'The session did not start. Saved resume details were kept; check Terminal before retrying.')
