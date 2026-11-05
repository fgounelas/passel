"""Explicit installation of the three supported CLIs for the current user."""
from contextlib import nullcontext
import fcntl
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import tempfile
from threading import Lock
import time

from setup import SetupError


CLIS = {
    'claude': ('https://claude.ai/install.sh', '/bin/bash'),
    'codex': ('https://chatgpt.com/codex/install.sh', '/bin/sh'),
    'agy': ('https://antigravity.google/cli/install.sh', '/bin/bash'),
}
VERSION = re.compile(r'(?<![\w.])v?(\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)(?![\w.])')


class CliSetup:
    def __init__(self, home=None, state=None):
        self.home = Path.home() if home is None else Path(home)
        self.state = Path(state or os.environ.get('PASSEL_STATE_DIR', self.home / 'containers/herdr-web'))
        self.bin = self.home / '.local/bin'
        self.path = str(self.bin) + os.pathsep + os.environ.get('PATH', '/usr/local/bin:/usr/bin:/bin')
        self.metadata_lock = Lock()
        self.active = None
        self.errors = {}
        self.versions = {}

    def environment(self):
        # Installers need no account credentials or inherited shell startup hooks.
        environment = {key: value for key, value in os.environ.items() if key in (
            'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
            'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
            'SSL_CERT_FILE', 'SSL_CERT_DIR', 'CURL_CA_BUNDLE',
        )}
        environment.update(HOME=str(self.home), PATH=self.path, SHELL='/bin/bash',
                           XDG_CONFIG_HOME=str(self.home / '.config'),
                           XDG_CACHE_HOME=str(self.home / '.cache'),
                           XDG_DATA_HOME=str(self.home / '.local/share'),
                           CODEX_HOME=str(self.home / '.codex'),
                           CODEX_INSTALL_DIR=str(self.bin), CODEX_NON_INTERACTIVE='1',
                           CI='1', NO_COLOR='1', TERM='dumb', LANG='C.UTF-8')
        return environment

    def execute(self, command, timeout, log=None, lock_fd=None):
        with nullcontext(log) if log is not None else tempfile.TemporaryFile() as output:
            process = subprocess.Popen(command, cwd=self.home, env=self.environment(),
                                       stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT,
                                       start_new_session=True,
                                       pass_fds=() if lock_fd is None else (lock_fd,))
            try:
                process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait()
                raise SetupError(504, 'Setup timed out. Check the installation and server internet connection before retrying.') from None
            if log is None:
                output.seek(0)
                text = output.read(4096).decode('utf-8', errors='replace')
            else:
                text = ''
            return subprocess.CompletedProcess(command, process.returncode, text, '')

    def cli(self, name):
        executable = shutil.which(name, path=self.path)
        result = {'id': name, 'installed': executable is not None, 'version': None,
                  'operation': None, 'error': None}
        if executable is None:
            return result
        try:
            info = Path(executable).stat()
            signature = (str(Path(executable).resolve()), info.st_ino, info.st_size, info.st_mtime_ns)
            with self.metadata_lock:
                cached = self.versions.get(name)
            if cached and cached[0] == signature:
                return {**result, 'version': cached[1]}
            version = self.execute([executable, '--version'], timeout=5)
            match = VERSION.search(version.stdout) if version.returncode == 0 else None
            if match:
                with self.metadata_lock:
                    self.versions[name] = (signature, match[1])
                return {**result, 'version': match[1]}
        except (OSError, SetupError):
            pass
        return {**result, 'error': 'The CLI is present, but its version could not be checked.'}

    def status(self):
        with self.metadata_lock:
            active, errors = self.active, self.errors.copy()
        items = []
        for name in CLIS:
            item = ({**active['before'], 'operation': active['action']}
                    if active and active['id'] == name else self.cli(name))
            items.append({**item, 'error': errors.get(name) or item['error']})
        return {'clis': items}

    def change(self, name, action):
        if not isinstance(name, str) or name not in CLIS or action not in ('install', 'update'):
            raise SetupError(400, 'Choose a supported CLI and Install or Update.')
        self.state.mkdir(parents=True, exist_ok=True, mode=0o700)
        descriptor = os.open(self.state / '.cli-install.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise SetupError(409, 'Another CLI installation or update is running. Check again shortly.') from None
            before = self.cli(name)
            if action == 'install' and before['installed']:
                return before
            if action == 'update' and not before['installed']:
                raise SetupError(409, 'This CLI is not installed yet. Choose Install first.')
            with self.metadata_lock:
                self.active = {'id': name, 'action': action, 'before': before}
                self.errors.pop(name, None)
            try:
                directory = self.state / 'cli-installs'
                directory.mkdir(mode=0o700, exist_ok=True)
                log_fd = os.open(directory / (name + '.log'),
                                 os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
                os.fchmod(log_fd, 0o600)
                deadline = time.monotonic() + 280
                with os.fdopen(log_fd, 'wb') as log, tempfile.TemporaryDirectory(prefix='.download-', dir=directory) as temporary:
                    if name == 'agy' and action == 'update':
                        executable = shutil.which(name, path=self.path)
                        if executable is None:
                            raise SetupError(409, 'The CLI changed during setup. Check its installation before retrying.')
                        command = [executable, 'update']
                    else:
                        installer = Path(temporary) / 'install.sh'
                        curl = shutil.which('curl', path=self.path)
                        if curl is None:
                            raise SetupError(503, 'Curl is required on this server to install CLIs.')
                        url, shell = CLIS[name]
                        download = self.execute([curl, '--fail', '--silent', '--show-error', '--location',
                            '--proto', '=https', '--proto-redir', '=https', '--max-time', '30',
                            '--max-filesize', '1048576', '--output', str(installer), url],
                            timeout=35, log=log, lock_fd=descriptor)
                        if download.returncode:
                            raise SetupError(502, 'The official installer could not be downloaded. Check the server internet connection and retry.')
                        command = [shell, str(installer), *(['latest'] if name == 'claude' else [])]
                    installed = self.execute(command, timeout=max(1, deadline - time.monotonic()),
                                             log=log, lock_fd=descriptor)
                    if installed.returncode:
                        raise SetupError(502, 'The installer or updater failed. Check server connectivity, free space and the private setup log, then retry.')
                with self.metadata_lock:
                    self.versions.pop(name, None)
                result = self.cli(name)
                if not result['installed'] or result['version'] is None:
                    raise SetupError(502, 'Setup finished, but the CLI version could not be verified. Check it in Terminal before retrying.')
                return result
            except (OSError, SetupError) as caught:
                error = caught if isinstance(caught, SetupError) else SetupError(
                    502, 'CLI setup could not run. Check the server tools, permissions and free space.')
                with self.metadata_lock:
                    self.errors[name] = error.message
                raise error from None
            finally:
                with self.metadata_lock:
                    self.active = None
        finally:
            os.close(descriptor)
