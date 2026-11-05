#!/usr/bin/env python3
"""Collect actual dependency licence files, pinned by npm/Cargo lockfiles.

Generation needs installed web dependencies and network access for uncached
Cargo archives. Checking the committed inventory is offline. No Git, credentials
or local absolute paths are written into the inventory.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile
import tempfile
import time
import tomllib
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent.parent
NOTICE_NAME = re.compile(r'^(?:licen[sc]e|unlicense|copying|notice|copyright|authors)(?:[._-]|$)', re.I)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def download(url, checksum, cache):
    cache.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = cache.stat()
    if cache.is_symlink() or info.st_uid != os.getuid() or info.st_mode & 0o022:
        raise ValueError('The dependency cache must be a private, owned directory')
    target = cache / checksum
    if target.is_file() and not target.is_symlink():
        data = target.read_bytes()
        if digest(data) == checksum:
            return data
    for attempt in range(3):
        try:
            with urlopen(url, timeout=45) as response:
                data = response.read(64 * 1024 * 1024)
            if digest(data) != checksum:
                raise ValueError('Downloaded dependency checksum mismatch')
            fd, name = tempfile.mkstemp(prefix='.download-', dir=cache)
            try:
                with os.fdopen(fd, 'wb') as stream:
                    stream.write(data)
                os.replace(name, target)
            finally:
                Path(name).unlink(missing_ok=True)
            return data
        except OSError:
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def licence_files(directory):
    found = {}
    for path in sorted(directory.rglob('*')):
        relative = path.relative_to(directory)
        if ('node_modules' in relative.parts or len(relative.parts) > 3
                or not path.is_file() or path.is_symlink()):
            continue
        if NOTICE_NAME.match(path.name) or any(p.lower() in ('licenses', 'licences') for p in relative.parts[:-1]):
            data = path.read_bytes()
            if len(data) > 1_000_000:
                raise ValueError(f'Unreviewed notice size: {relative}')
            found[str(relative)] = data.decode('utf-8', errors='replace')
    return found


def npm_packages(root, supplements):
    locked = json.loads((root / 'web/package-lock.json').read_text())['packages']
    result = subprocess.check_output(
        ['npm', 'ls', '--all', '--omit=dev', '--parseable'], cwd=root / 'web', text=True)
    packages = []
    seen = set()
    for line in result.splitlines()[1:]:
        directory = Path(line)
        package = json.loads((directory / 'package.json').read_text())
        name, version = package['name'], package['version']
        relative = str(directory.relative_to(root / 'web'))
        if locked.get(relative, {}).get('version') != version:
            raise ValueError(f'Installed npm package differs from lockfile: {name}')
        # PDF.js's optional Node canvas is not copied into browser assets.
        if name.startswith('@napi-rs/canvas'):
            continue
        if (name, version) in seen:
            continue
        seen.add((name, version))
        notices = licence_files(directory)
        for entry in supplements['npm_overrides'].get(f'{name}@{version}', []):
            notices[entry] = (root / entry).read_text()
        if not notices:
            raise ValueError(f'Missing npm licence notice: {name}@{version}')
        repository = package.get('repository', {})
        source = repository if isinstance(repository, str) else repository.get('url', '')
        packages.append({'name': name, 'version': version, 'ecosystem': 'npm',
                         'license': package.get('license', 'UNKNOWN'),
                         'source': source, 'notices': notices})
    return packages


def cargo_packages(roots, cache, included=None):
    supplemental_file = ROOT / 'third-party/supplemental.json'
    supplements = json.loads(supplemental_file.read_text()) if supplemental_file.exists() else {}
    selected = {}
    local = []
    for root in roots:
        lock = tomllib.loads((root / 'Cargo.lock').read_text())
        for package in lock['package']:
            if package.get('source', '').startswith('registry+'):
                key = (package['name'], package['version'])
                if included is None or key in included:
                    selected[key] = package
            elif 'source' in package:
                raise ValueError('Git Cargo dependencies need an explicit notice review')
        # Repository-owned local crates retain their notices separately. For a
        # separately built upstream runtime, include its root and patched crates.
        if root != ROOT / 'bridge' and root != ROOT / 'vendor/herdr-compat':
            for manifest in [root / 'Cargo.toml', *sorted((root / 'vendor').glob('*/Cargo.toml'))]:
                package = tomllib.loads(manifest.read_text()).get('package', {})
                notices = licence_files(manifest.parent)
                if not notices:
                    raise ValueError(f'Missing local Cargo notices: {package.get("name")}')
                local.append({'name': package['name'], 'version': package['version'],
                              'ecosystem': 'cargo', 'license': package.get('license', 'UNKNOWN'),
                              'source': package.get('repository', ''), 'notices': notices})

    def collect(package):
        name, version, checksum = package['name'], package['version'], package['checksum']
        url = f'https://static.crates.io/crates/{name}/{name}-{version}.crate'
        data = download(url, checksum, cache)
        notices = {}
        with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
            manifest = tomllib.loads(archive.extractfile(f'{name}-{version}/Cargo.toml').read().decode())['package']
            for entry in archive:
                path = PurePosixPath(entry.name)
                if entry.isfile() and (NOTICE_NAME.match(path.name) or any(
                        p.lower() in ('licenses', 'licences') for p in path.parts[1:-1])):
                    if entry.size > 1_000_000:
                        raise ValueError(f'Unreviewed notice size: {name}/{path.name}')
                    relative = str(PurePosixPath(*path.parts[1:]))
                    notices[relative] = archive.extractfile(entry).read().decode('utf-8', errors='replace')
        for entry in supplements.get('cargo_overrides', {}).get(f'{name}@{version}', []):
            notices[entry] = (ROOT / entry).read_text()
        if not notices:
            raise ValueError(f'Missing Cargo licence notice: {name}@{version}')
        return {'name': name, 'version': version, 'ecosystem': 'cargo',
                'license': manifest.get('license', 'UNKNOWN'), 'source': url,
                'checksum': checksum, 'notices': notices}

    results, errors = [], []
    with ThreadPoolExecutor(max_workers=6) as workers:
        futures = [workers.submit(collect, p) for p in sorted(selected.values(), key=lambda p: (p['name'], p['version']))]
        for future in futures:
            try:
                results.append(future.result())
            except ValueError as error:
                errors.append(str(error))
    if errors:
        raise ValueError('; '.join(errors))
    return local + results


def input_files(root):
    return sorted([
        'web/package-lock.json', 'bridge/Cargo.lock', 'vendor/herdr-compat/Cargo.lock',
        'scripts/third-party-notices.py',
        'docker/Dockerfile',
        *[str(p.relative_to(root)) for p in (root / 'third-party').rglob('*')
          if p.is_file() and p.name not in ('inventory.json', 'README.md')],
        'web/public/fonts/JetBrainsMonoNerdFontMono-Regular.woff2',
        'web/public/fonts/OFL.txt',
    ])


def render(packages, runtime=False):
    scope = (
        'This inventory covers the pinned Herdr runtime, patched local crate and\n'
        'active Linux dependency graph selected by cargo metadata.\n'
        if runtime else
        'This is an inventory of production npm dependencies (excluding the Node-only\n'
        'canvas backend), Cargo lockfile packages across supported targets, and bundled\n'
        'fonts/data/WebAssembly. Some listed packages are not linked into every build.\n'
    )
    sections = [
        'Passel third-party notices\n==========================\n\n'
        'Generated by scripts/third-party-notices.py from the reviewed lockfiles.\n'
        + scope +
        'Each component keeps its own licence; this file does not relicense it.\n'
        'Passel and the local Herdr compatibility notices are supplied separately.\n'
        'See third-party/README.md for scope, font source and update instructions.\n'
    ]
    for package in sorted(packages, key=lambda p: (p['ecosystem'], p['name'], p['version'])):
        title = f'{package["ecosystem"]}: {package["name"]} {package["version"]}'
        sections.append('\n' + '=' * 78 + '\n' + title + '\n'
                        + f'Declared licence: {package["license"]}\nSource: {package["source"]}\n')
        for name, text in sorted(package['notices'].items()):
            sections.append(f'\n--- {name} ---\n{text.rstrip()}\n')
    return '\n'.join(sections)


def generate(root, cache):
    supplements = json.loads((root / 'third-party/supplemental.json').read_text())
    packages = npm_packages(root, supplements) + cargo_packages(
        [root / 'bridge', root / 'vendor/herdr-compat'], cache)
    for entry in supplements['components']:
        package = dict(entry)
        package['notices'] = {name: (root / name).read_text() for name in entry['notices']}
        packages.append(package)
    for package in packages:
        if package['license'] == 'UNKNOWN':
            raise ValueError(f'Unknown licence: {package["name"]}')
    text = render(packages)
    (root / 'THIRD_PARTY_NOTICES.txt').write_text(text)
    records = []
    for package in packages:
        record = {k: v for k, v in package.items() if k != 'notices'}
        record['notices'] = {name: digest(text.encode()) for name, text in package['notices'].items()}
        records.append(record)
    inventory = {'format': 1,
                 'inputs': {name: digest((root / name).read_bytes()) for name in input_files(root)},
                 'notice_sha256': digest(text.encode()),
                 'packages': sorted(records, key=lambda p: (p['ecosystem'], p['name'], p['version']))}
    (root / 'third-party/inventory.json').write_text(json.dumps(inventory, indent=2, sort_keys=True) + '\n')
    print(f'Generated notices for {len(packages)} components.')


def check(root):
    inventory = json.loads((root / 'third-party/inventory.json').read_text())
    actual = {name: digest((root / name).read_bytes()) for name in input_files(root)}
    if actual != inventory['inputs'] or digest((root / 'THIRD_PARTY_NOTICES.txt').read_bytes()) != inventory['notice_sha256']:
        raise ValueError('Third-party notices are stale; regenerate and review them')
    print(f'Third-party notices match {len(inventory["packages"])} reviewed components.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('generate', 'check', 'cargo'))
    parser.add_argument('--cache', type=Path, default=Path(tempfile.gettempdir()) / 'passel-third-party-cache')
    parser.add_argument('--cargo-source', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.command == 'check': check(ROOT)
    elif args.command == 'generate': generate(ROOT, args.cache)
    elif args.cargo_source and args.output:
        # Container runtime notices cover the graph actually built for the
        # compiler's host target, including active build dependencies.
        version = subprocess.check_output(['rustc', '-vV'], text=True)
        target = next(line.removeprefix('host: ') for line in version.splitlines() if line.startswith('host: '))
        metadata = json.loads(subprocess.check_output([
            'cargo', 'metadata', '--locked', '--format-version', '1',
            '--filter-platform', target, '--manifest-path', str(args.cargo_source / 'Cargo.toml')], text=True))
        nodes = {node['id']: node for node in metadata['resolve']['nodes']}
        reachable, pending = set(), [metadata['resolve']['root']]
        while pending:
            current = pending.pop()
            if current in reachable:
                continue
            reachable.add(current)
            pending.extend(dependency['pkg'] for dependency in nodes[current]['deps'])
        included = {(p['name'], p['version']) for p in metadata['packages'] if p['id'] in reachable}
        args.output.write_text(render(cargo_packages([args.cargo_source.resolve()], args.cache, included), runtime=True))
    else: parser.error('cargo requires --cargo-source and --output')


if __name__ == '__main__':
    main()
