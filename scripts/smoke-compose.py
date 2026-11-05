#!/usr/bin/env python3
"""Exercise an explicitly disposable Compose project without provider requests."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import struct
import subprocess
import time
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen
import uuid


def terminal_roundtrip(address, host, origin, terminal, marker, expected_cwd=None):
    key = base64.b64encode(os.urandom(16)).decode()
    # Keep the marker and synthetic working directory on one terminal row.
    path = '/ws/terminal?' + urlencode({'terminal_id': terminal, 'cols': 200, 'rows': 30})
    with socket.create_connection(address, timeout=10) as connection:
        connection.settimeout(10)
        connection.sendall((f'GET {path} HTTP/1.1\r\nHost: {host}\r\nOrigin: {origin}\r\n'
                            f'Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n'
                            'Sec-WebSocket-Version: 13\r\n\r\n').encode())
        stream = connection.makefile('rb')
        assert b' 101 ' in stream.readline(), 'Terminal WebSocket did not upgrade'
        headers = {}
        while (line := stream.readline().strip()):
            name, value = line.decode().split(':', 1)
            headers[name.lower()] = value.strip()
        expected = base64.b64encode(hashlib.sha1((key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
        assert headers.get('sec-websocket-accept') == expected

        def send(opcode, data):
            assert len(data) < 126
            mask = os.urandom(4)
            connection.sendall(bytes([0x80 | opcode, 0x80 | len(data)]) + mask
                               + bytes(value ^ mask[i % 4] for i, value in enumerate(data)))

        # The expected output is not present as one string in the echoed command.
        send(2, f"printf 'passel-%s-%s:%s\\n' compose {marker} \"$PWD\"\r".encode())
        output = bytearray()
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            header = stream.read(2)
            assert len(header) == 2, 'Terminal closed before round trip'
            opcode, length = header[0] & 15, header[1] & 127
            assert not header[1] & 128, 'Unexpected masked server frame'
            if length == 126: length = struct.unpack('!H', stream.read(2))[0]
            elif length == 127: length = struct.unpack('!Q', stream.read(8))[0]
            assert length <= 2 * 1024 * 1024
            data = stream.read(length)
            if opcode == 9: send(10, data)
            elif opcode == 8: raise AssertionError('Terminal closed before round trip')
            elif opcode in (0, 1, 2): output.extend(data)
            expected = f'passel-compose-{marker}' + (f':{expected_cwd}' if expected_cwd else '')
            if expected.encode() in output:
                send(8, b'')
                return
        raise AssertionError('Terminal command produced no matching output')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', required=True, help='A disposable project named passel-smoke or passel-smoke-*')
    parser.add_argument('--install-clis', action='store_true', help='Test official CLI install/update downloads without signing in')
    args = parser.parse_args()
    if not re.fullmatch(r'passel-smoke(?:-[a-z0-9-]+)?', args.project):
        parser.error('Use a disposable passel-smoke project, never a research instance')
    root = Path(__file__).resolve().parent.parent
    compose = ['docker', 'compose', '-f', str(root / 'compose.yaml'),
               '-f', str(root / 'docker/compose.test.yaml'), '-p', args.project]
    port = int(os.environ.get('PASSEL_PORT', '8787'))
    origin = os.environ.get('PASSEL_ORIGIN', f'http://127.0.0.1:{port}')
    host = urlsplit(origin).netloc
    base = f'http://127.0.0.1:{port}'
    marker = uuid.uuid4().hex
    folder = 'passel-smoke-' + marker
    upload = folder + '.md'

    def request(path, body=None, method=None, headers=None, expected=200, timeout=20):
        values = {'Host': host, 'Origin': origin, **(headers or {})}
        try:
            response = urlopen(Request(base + path, data=body, method=method, headers=values), timeout=timeout)
        except HTTPError as error:
            response = error
        with response:
            data = response.read()
            valid = (expected,) if isinstance(expected, int) else expected
            assert response.status in valid, f'{path}: expected {expected}, got {response.status}'
            return data, response.headers

    def command(method, params):
        data, _ = request('/api/command', json.dumps({'method': method, 'params': params}).encode(),
                          headers={'Content-Type': 'application/json'})
        return json.loads(data)

    def runtime(script, *values):
        subprocess.run([*compose, 'exec', '-T', 'passel', 'python3', '-c', script, *values], check=True)

    # Verify the host-facing boundary without reading any real secret value.
    for service in ['passel']:
        container = subprocess.check_output([*compose, 'ps', '-q', service], text=True).strip()
        info = json.loads(subprocess.check_output(['docker', 'inspect', container], text=True))[0]
        assert info['Config']['User'] == '1000:1000', service
        published = info['HostConfig'].get('PortBindings') or {}
        assert set(published) == {'8080/tcp'}, service
        for bindings in published.values():
            assert all(item['HostIp'] == '127.0.0.1' for item in bindings), service
        mounts = {m['Destination']: m for m in info['Mounts']}
        assert mounts['/home/passel']['Type'] == 'volume'
    runtime("import subprocess;assert subprocess.check_output(['npm','prefix','-g'],text=True).strip()=='/home/passel/.local'")
    runtime("from pathlib import Path;import os;"
            "state=Path(os.environ['PASSEL_STATE_DIR']);"
            "assert state==Path.home()/'containers/passel' and state.is_dir();"
            "legacy=Path.home()/'containers/herdr-web';"
            "assert not legacy.exists() and not legacy.is_symlink()")

    workspace = None
    try:
        request('/')
        request('/api/capabilities')
        snapshot, _ = request('/api/snapshot')
        initial = json.loads(snapshot)['panes']
        assert len(initial) == 1, 'Fresh startup should create one initial shell'
        assert initial[0]['cwd'] == '/home/passel/work', 'Initial shell did not start in ~/work'
        terminal_roundtrip(('127.0.0.1', port), host, origin, initial[0]['terminal_id'], marker + '0',
                           '/home/passel/work')
        request('/api/project-files/roots')
        setup, _ = request('/api/project-files/setup')
        assert json.loads(setup)['startup_path'] == '~/work'
        assert all(p['status'] == 'missing' for p in json.loads(setup)['projects'])
        clis, _ = request('/api/project-files/setup/clis')
        assert all(not cli['installed'] for cli in json.loads(clis)['clis'])
        request('/api/project-files/setup/clis', json.dumps({'cli': 'codex', 'action': 'install'}).encode(), 'POST',
                {'Content-Type': 'application/json'}, expected=403)
        cli_versions = {}
        if args.install_clis:
            for name in ('claude', 'codex', 'agy'):
                for action in ('install', 'update'):
                    result, _ = request('/api/project-files/setup/clis',
                        json.dumps({'cli': name, 'action': action}).encode(), 'POST',
                        {'Content-Type': 'application/json', 'X-Herdr-Setup': '1'}, timeout=300)
                    cli = json.loads(result)
                    assert cli['installed'] and cli['version'], f'{name} {action} did not verify its version'
                    cli_versions[name] = cli['version']
                    print(f'CLI {name} {action} passed: {cli["version"]}', flush=True)
        request('/api/project-files/setup', json.dumps({'startup_path': '~/work'}).encode(), 'POST',
                {'Content-Type': 'application/json'}, expected=403)
        request('/api/project-files/roots', headers={'Origin': 'https://foreign.example'}, expected=403)
        request('/', headers={'Host': 'foreign.example'}, expected=421)
        request('/api/project-files/upload?name=' + upload, b'not accepted', 'POST',
                {'Content-Type': 'application/octet-stream'}, expected=403)

        runtime("from pathlib import Path;import sys;p=Path.home()/'work'/sys.argv[1];p.mkdir();"
                "(p/'fact.md').write_text('# Sample fact\\nA synthetic statement.\\n');"
                "(p/'proof.pdf').write_bytes(b'%PDF-1.4\\n1 0 obj<</Type/Catalog>>endobj\\n%%EOF\\n')", folder)
        runtime("from pathlib import Path;import sys;"
                "p=Path.home()/'work/danus/runtime';p.mkdir(exist_ok=True);"
                "(p/sys.argv[1]).write_text('synthetic private marker')", folder)
        request('/api/project-files/content?' + urlencode({'root': 'work', 'path': 'danus/runtime/' + folder}),
                expected=(400, 403, 404))
        for workflow in ('danus', 'pharos'):
            listing, _ = request('/api/project-files/list?' + urlencode({
                'root': 'work', 'path': workflow + '/runtime/projects'}))
            assert json.loads(listing)['entries'] == [], 'Fresh workflow should be empty'
        # Real image configuration must find projects created after service start.
        runtime("from pathlib import Path;import sys;"
                "\nfor workflow in ('danus','pharos'):\n"
                " p=Path.home()/'work'/workflow/'runtime/projects'/sys.argv[1];"
                "(p/'fact_graph/facts').mkdir(parents=True);(p/'papers').mkdir();"
                "(p/'fact_graph/facts/fact.md').write_text('# Workflow fact\\n');"
                "(p/'papers/proof.pdf').write_bytes(b'%PDF-1.4\\n%%EOF\\n')", folder)
        for workflow in ('danus', 'pharos'):
            project = workflow + '/runtime/projects/' + folder
            fact = project + '/fact_graph/facts/fact.md'
            body, _ = request('/api/project-files/content?' + urlencode({'root': 'work', 'path': fact}))
            assert body == b'# Workflow fact\n'
            body, headers = request('/api/project-files/content?' + urlencode({
                'root': 'work', 'path': project + '/papers/proof.pdf'}))
            assert body.startswith(b'%PDF-') and headers['Content-Type'] == 'application/pdf'
            found, _ = request('/api/project-files/search?' + urlencode({'root': 'work', 'q': 'fact.md'}))
            assert fact in {entry['path'] for entry in json.loads(found)['entries']}

        # Exercise launcher preparation as the real non-root runtime user,
        # without installing or contacting a provider CLI.
        runtime("from pathlib import Path;import os,sys;"
                "sys.path.insert(0,'/opt/passel/conversation-service');"
                "from tab_lifecycle import claude_launcher_path,prepare_claude_launcher;"
                "binary=Path.home()/'work'/sys.argv[1]/'claude-fixture';"
                "binary.write_text('#!/bin/sh\\nexit 0\\n');binary.chmod(0o700);"
                "launcher=claude_launcher_path(str(binary));"
                "prepare_claude_launcher({'executable':str(binary),'launcher':str(launcher)});"
                "assert launcher.is_relative_to(Path(os.environ['PASSEL_STATE_DIR'])/'conversation-state/launchers');"
                "assert launcher.is_symlink() and launcher.samefile(binary)", folder)
        listing, _ = request('/api/project-files/list?' + urlencode({'root': 'work', 'path': folder}))
        assert {'fact.md', 'proof.pdf'} <= {p['name'] for p in json.loads(listing)['entries']}
        body, _ = request('/api/project-files/content?' + urlencode({'root': 'work', 'path': folder + '/fact.md'}))
        assert b'Sample fact' in body
        body, headers = request('/api/project-files/content?' + urlencode({'root': 'work', 'path': folder + '/proof.pdf'}))
        assert body.startswith(b'%PDF-') and headers['Content-Type'] == 'application/pdf'
        body, _ = request('/api/project-files/content?' + urlencode({'root': 'work', 'path': folder + '/proof.pdf'}),
                          headers={'Range': 'bytes=0-7'}, expected=206)
        assert body == b'%PDF-1.4'

        request('/api/project-files/upload?name=' + upload, b'# Uploaded sample\n', 'POST',
                {'Content-Type': 'application/octet-stream', 'X-Herdr-Upload': '1'}, expected=201)
        runtime("from pathlib import Path;import sys;assert (Path.home()/'work/uploads'/sys.argv[1]).read_text()=='# Uploaded sample\\n'", upload)
        notice, _ = request('/notices/THIRD_PARTY_NOTICES.txt')
        assert b'Nerd Fonts' in notice and b'KaTeX fonts' in notice and b'LIBERATION FONT SOFTWARE' in notice
        source, _ = request('/pdf-assets/source/liberation-fonts-1.07.4.tar.gz')
        assert hashlib.sha256(source).hexdigest() == 'ad98b7498dc2992f7f0868f79b65ce4a720a3acdb63ab3f1f1cb6881117a5406'

        created = command('workspace.create', {'label': folder, 'focus': True})
        workspace = created['workspace']['workspace_id']
        terminal_roundtrip(('127.0.0.1', port), host, origin, created['root_pane']['terminal_id'], marker,
                           '/home/passel/work')
        runtime("from pathlib import Path;import os,signal;os.kill(int(Path('/tmp/nginx.pid').read_text()),signal.SIGTERM)")
        for attempt in range(30):
            try:
                request('/api/capabilities')
                break
            except (AssertionError, OSError):
                if attempt == 29: raise
                time.sleep(1)
        recovered = json.loads(subprocess.check_output(['docker', 'inspect', container], text=True))[0]
        assert recovered['State']['Pid'] == info['State']['Pid'], 'Auxiliary failure restarted the research container'
        terminal_roundtrip(('127.0.0.1', port), host, origin, created['root_pane']['terminal_id'], marker + 'b')
        request('/api/project-files/setup', json.dumps({'startup_path': '~/work/' + folder}).encode(), 'POST',
                {'Content-Type': 'application/json', 'X-Herdr-Setup': '1'})
        terminal_roundtrip(('127.0.0.1', port), host, origin, created['root_pane']['terminal_id'], marker + 'c',
                           '/home/passel/work')
        command('workspace.close', {'workspace_id': workspace})
        workspace = None
        custom = command('workspace.create', {'label': folder, 'focus': True})
        workspace = custom['workspace']['workspace_id']
        terminal_roundtrip(('127.0.0.1', port), host, origin, custom['root_pane']['terminal_id'], marker + 'd',
                           '/home/passel/work/' + folder)
        command('workspace.close', {'workspace_id': workspace})
        workspace = None
        request('/api/project-files/setup', json.dumps({'startup_path': '~/work'}).encode(), 'POST',
                {'Content-Type': 'application/json', 'X-Herdr-Setup': '1'})

        # Simulate upgrading an old volume only after all test processes stop.
        # The one-off command bypasses startup and does not publish any ports.
        subprocess.run([*compose, 'stop', 'passel'], check=True)
        subprocess.run([*compose, 'run', '--rm', '--no-deps', '--pull', 'never', '-T',
                        '--entrypoint', 'python3', 'passel', '-c',
                        "from pathlib import Path;import os;"
                        "state=Path(os.environ['PASSEL_STATE_DIR']);"
                        "state.rename(Path.home()/'containers/herdr-web')"], check=True)
        subprocess.run([*compose, 'up', '-d', '--pull', 'never', '--force-recreate',
                        '--wait', '--wait-timeout', '120', 'passel'], check=True)
        for attempt in range(30):
            try:
                body, _ = request('/api/project-files/content?' + urlencode({'root': 'work', 'path': folder + '/fact.md'}))
                assert b'Sample fact' in body
                break
            except (AssertionError, OSError):
                if attempt == 29: raise
                time.sleep(1)
        runtime("from pathlib import Path;import os,sys;"
                "sys.path.insert(0,'/opt/passel/conversation-service');"
                "from tab_lifecycle import claude_launcher_path;"
                "binary=Path.home()/'work'/sys.argv[1]/'claude-fixture';"
                "state=Path(os.environ['PASSEL_STATE_DIR']);"
                "legacy=Path.home()/'containers/herdr-web';"
                "assert state.is_dir() and not state.is_symlink();"
                "assert legacy.is_symlink() and legacy.samefile(state);"
                "launcher=claude_launcher_path(str(binary));"
                "assert launcher.samefile(binary);"
                "assert (legacy/launcher.relative_to(state)).samefile(binary)", folder)
        if cli_versions:
            saved, _ = request('/api/project-files/setup/clis')
            assert {cli['id']: cli['version'] for cli in json.loads(saved)['clis']} == cli_versions
        print('Compose smoke passed: terminal, workflow files/PDF delivery, writable resume launchers, uploads, origins, path restrictions, persistence, state migration and notices.')
    finally:
        if workspace:
            command('workspace.close', {'workspace_id': workspace})
        runtime("from pathlib import Path;import os,shutil,sys;shutil.rmtree(Path.home()/'work'/sys.argv[1],ignore_errors=True);"
                "(Path.home()/'work/uploads'/sys.argv[2]).unlink(missing_ok=True);"
                "[(Path.home()/'work'/p/'runtime'/sys.argv[1]).unlink(missing_ok=True) for p in ['danus','pharos']];"
                "[shutil.rmtree(Path.home()/'work'/p/'runtime/projects'/sys.argv[1],ignore_errors=True) for p in ['danus','pharos']];"
                "sys.path.insert(0,'/opt/passel/conversation-service');"
                "from tab_lifecycle import claude_launcher_path;"
                "launcher=claude_launcher_path(str(Path.home()/'work'/sys.argv[1]/'claude-fixture'));"
                "\nif launcher.is_relative_to(Path(os.environ['PASSEL_STATE_DIR'])/'conversation-state/launchers'):"
                " shutil.rmtree(launcher.parent,ignore_errors=True)", folder, upload)


if __name__ == '__main__':
    main()
