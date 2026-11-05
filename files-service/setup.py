"""Explicit, allow-listed source checkouts and per-server terminal preferences."""
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
from threading import Lock

PROJECTS = {'danus': 'https://github.com/frenzymath/Danus.git',
            'pharos': 'https://github.com/frenzymath/Pharos.git'}


class SetupError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


class Setup:
    def __init__(self, home=None, state=None):
        self.home = Path.home() if home is None else Path(home)
        self.work = self.home / 'work'
        self.state = Path(state or os.environ.get('PASSEL_STATE_DIR', self.home / 'containers/herdr-web'))
        self.settings = self.state / 'terminal-startup.json'
        self.install_lock = Lock()

    def git(self, *args, timeout=10):
        environment = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
        environment.update(GIT_TERMINAL_PROMPT='0', GIT_CONFIG_GLOBAL=os.devnull,
                           GIT_CONFIG_SYSTEM=os.devnull, GIT_LFS_SKIP_SMUDGE='1')
        try:
            command = ['git', '-c', 'core.hooksPath=' + os.devnull,
                       '-c', 'protocol.file.allow=never', '-c', 'protocol.ext.allow=never', *args]
            process = subprocess.Popen(command, env=environment, stdout=subprocess.PIPE,
                                       stderr=subprocess.PIPE, text=True, start_new_session=True)
            try:
                stdout, stderr = process.communicate(timeout=timeout)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.communicate()
                raise
            return subprocess.CompletedProcess(command, process.returncode, stdout, stderr)
        except FileNotFoundError:
            raise SetupError(503, 'Git is required on this server to check and clone projects.') from None
        except subprocess.TimeoutExpired:
            raise SetupError(504, 'Git timed out. Check the server internet connection, then check the project again.') from None

    def project(self, name):
        if not isinstance(name, str) or name not in PROJECTS:
            raise SetupError(400, 'Choose Danus or Pharos.')
        target = self.work / name
        result = {'id': name, 'path': '~/work/' + name, 'status': 'missing'}
        if self.work.is_symlink() or target.is_symlink():
            return {**result, 'status': 'existing', 'message': 'The folder is a symbolic link; it has been left unchanged.'}
        if not target.exists() or target.is_dir() and not any(target.iterdir()):
            return result
        if target.is_dir():
            try:
                root = self.git('-C', str(target), 'rev-parse', '--show-toplevel')
            except SetupError as error:
                return {**result, 'status': 'existing', 'message': error.message}
            if root.returncode == 0 and root.stdout.strip() == str(target.resolve()):
                remote = self.git('-C', str(target), 'config', '--get', 'remote.origin.url')
                allowed = {PROJECTS[name], PROJECTS[name].removesuffix('.git'),
                           'git@github.com:frenzymath/' + name.title() + '.git'}
                if remote.returncode == 0 and remote.stdout.strip() in allowed:
                    return {**result, 'status': 'installed'}
        return {**result, 'status': 'existing', 'message': 'This folder already contains files. They have been left unchanged.'}

    def startup_path(self):
        if not self.settings.exists():
            return '~/work'
        if self.settings.is_symlink() or self.settings.stat().st_size > 4096:
            raise SetupError(409, 'Terminal settings need to be checked on the server.')
        try:
            value = json.loads(self.settings.read_text())['startup_path']
            if not isinstance(value, str):
                raise ValueError()
            return value
        except (ValueError, KeyError, TypeError):
            raise SetupError(409, 'Terminal settings need to be checked on the server.') from None

    def status(self):
        return {'projects': [self.project(name) for name in PROJECTS], 'startup_path': self.startup_path()}

    def set_startup_path(self, value):
        if (not isinstance(value, str) or not value.strip() or len(value.encode()) > 1024
                or any(ord(c) < 32 for c in value)):
            raise SetupError(400, 'Enter an absolute directory or a path beginning with ~/.')
        value = value.strip()
        path = self.home / value[2:] if value.startswith('~/') else self.home if value == '~' else Path(value)
        if not path.is_absolute() or '..' in path.parts:
            raise SetupError(400, 'Enter an absolute directory or a path beginning with ~/.')
        if value == '~/work':
            path.mkdir(parents=True, exist_ok=True, mode=0o700)
        if not path.is_dir():
            raise SetupError(400, 'That directory does not exist on this server.')
        self.state.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd, temporary = tempfile.mkstemp(prefix='.terminal-startup-', dir=self.state)
        try:
            with os.fdopen(fd, 'w') as stream:
                json.dump({'startup_path': value}, stream)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.settings)
        finally:
            Path(temporary).unlink(missing_ok=True)
        return {'startup_path': value}

    def install(self, name):
        if not isinstance(name, str) or name not in PROJECTS:
            raise SetupError(400, 'Choose Danus or Pharos.')
        if not self.install_lock.acquire(blocking=False):
            raise SetupError(409, 'A project is being cloned. Check again shortly.')
        temporary = None
        try:
            current = self.project(name)
            if current['status'] == 'installed':
                return current
            if current['status'] != 'missing':
                raise SetupError(409, current['message'])
            self.work.mkdir(parents=True, exist_ok=True, mode=0o700)
            temporary = Path(tempfile.mkdtemp(prefix='.passel-clone-', dir=self.work))
            result = self.git('clone', '--quiet', '--depth', '1', '--single-branch', '--no-recurse-submodules',
                              '--template=', '--', PROJECTS[name], str(temporary), timeout=120)
            if result.returncode:
                raise SetupError(502, 'The repository could not be cloned. Check GitHub access and the server internet connection.')
            target = self.work / name
            if target.is_symlink():
                raise SetupError(409, 'The project folder changed while cloning. It has been left unchanged.')
            if target.exists():
                try:
                    target.rmdir()  # Only an unchanged, empty destination can be replaced.
                except OSError:
                    raise SetupError(409, 'The project folder now contains files. They have been left unchanged.') from None
            temporary.rename(target)
            temporary = None
            return self.project(name)
        finally:
            if temporary is not None:
                shutil.rmtree(temporary)
            self.install_lock.release()
