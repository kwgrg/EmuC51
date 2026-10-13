#!/usr/bin/env python3
"""Refresh only first-party corresponding source and its digest; no SDK/network needed."""
import hashlib
import json
import pathlib
import subprocess

repo = pathlib.Path(__file__).resolve().parents[2]
out = repo / 'public/sdcc/4.5.0-r1'
paths = ['src', 'scripts', 'tests', 'index.html', 'README.md',
         'docs/BROWSER_SDCC.md', 'docs/SDCC_DIAGNOSTICS.md', 'docs/PROJECT_MANAGEMENT.md',
         'public/_headers', 'package.json', 'package-lock.json', 'tsconfig.json',
         'tsconfig.app.json', 'tsconfig.node.json', 'vite.config.ts', 'eslint.config.js',
         'playwright.config.ts']
archive = out / 'emuc51-port-source.tar.xz'
subprocess.run(['tar', '--sort=name', '--mtime=@0', '--owner=0', '--group=0',
                '--numeric-owner', '-cJf', str(archive), '-C', str(repo), *paths], check=True)
manifest = out / 'SHA256SUMS.json'
records = json.loads(manifest.read_text())
records[archive.name] = {'bytes': archive.stat().st_size,
                         'sha256': hashlib.sha256(archive.read_bytes()).hexdigest()}
manifest.write_text(json.dumps(records, indent=2) + '\n')
for name, record in records.items():
    data = (out / name).read_bytes()
    assert len(data) == record['bytes'] and hashlib.sha256(data).hexdigest() == record['sha256'], name
print('All distributed asset digests verified; port source refreshed.')
