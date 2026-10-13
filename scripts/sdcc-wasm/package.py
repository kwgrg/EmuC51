#!/usr/bin/env python3
"""Attach corresponding source and notices to a verified build. No deploy/network calls.
Usage: package.py BUILD_WORK_DIRECTORY BUILD_OUTPUT_DIRECTORY PUBLIC_OUTPUT_DIRECTORY
Run after build.py, and rerun after changes to the browser bridge.
"""
import hashlib, json, pathlib, shutil, subprocess, sys
work, built, out = [pathlib.Path(p).resolve() for p in sys.argv[1:]]
repo=pathlib.Path(__file__).resolve().parents[2]
out.mkdir(parents=True,exist_ok=True)
for name in ['sdcpp','sdcc','sdas8051','sdld','files']:
    data=(built/(name+'.js')).read_bytes()
    (out/(name+'.js')).write_bytes(b'/* SDCC browser port: copyright, licenses and corresponding source: ./NOTICE.txt */\n'+data)
def archive(name, root, paths):
    subprocess.run(['tar','--sort=name','--mtime=@0','--owner=0','--group=0','--numeric-owner','-cJf',str(out/name),'-C',str(root),*paths],check=True)
shutil.copy2(work/'sdcc_4.5.0+dfsg.orig.tar.xz',out)
archive('boost-headers-source.tar.xz',work/'host',['usr/include/boost','usr/share/doc/libboost1.83-dev/copyright'])
archive('emscripten-runtime-source.tar.xz',work/'emsdk/upstream/emscripten',['system/lib','system/include','src','LICENSE','AUTHORS','emscripten-version.txt'])
archive('emuc51-port-source.tar.xz',repo,['src','scripts','tests','index.html','README.md','docs/BROWSER_SDCC.md','docs/SDCC_DIAGNOSTICS.md','public/_headers','package.json','package-lock.json','tsconfig.json','tsconfig.app.json','tsconfig.node.json','vite.config.ts','eslint.config.js','playwright.config.ts'])
notices=out/'licenses';notices.mkdir(exist_ok=True)
for src,name in [(work/'host/usr/share/doc/sdcc/copyright','SDCC-DEBIAN-COPYRIGHT'),(work/'host/usr/share/doc/sdcc-libraries/copyright','SDCC-LIBRARIES-COPYRIGHT'),(work/'host/usr/share/doc/libboost1.83-dev/copyright','BOOST-COPYRIGHT'),(work/'source/doc/README.txt','SDCC-README'),(work/'source/COPYING','SDCC-COPYING'),(pathlib.Path('/usr/share/common-licenses/GPL-2'),'GPL-2.txt'),(pathlib.Path('/usr/share/common-licenses/GPL-3'),'GPL-3.txt')]:
    shutil.copy2(src,notices/name)
sdk=work/'emsdk/upstream/emscripten'
for src,name in [('LICENSE','EMSCRIPTEN-LICENSE'),('AUTHORS','EMSCRIPTEN-AUTHORS'),('system/lib/libc/musl/COPYRIGHT','MUSL-COPYRIGHT'),('system/lib/libcxx/LICENSE.TXT','LIBCXX-LICENSE'),('system/lib/libcxxabi/LICENSE.TXT','LIBCXXABI-LICENSE'),('system/lib/compiler-rt/LICENSE.TXT','COMPILER-RT-LICENSE')]:
    shutil.copy2(sdk/src,notices/name)
(out/'NOTICE.txt').write_text('''EmuC51 SDCC 4.5.0 browser port (2026-10-12)

These compiler tools are free software, provided WITHOUT ANY WARRANTY.
Original copyright notices are retained in the downloadable source and licenses/.
Modifications: explicit --c1-source debug identity, Emscripten target recognition,
const-correct libiberty psignal declaration, type-correct GCC frontend stubs
(assertions retained), process-free stage scheduling and packaging.
No runtime linking exception is claimed for the compiler distribution.

Components actually built/distributed:
- sdcc: SDCC 4.5.0 #15242, mcs51 only, GPL-2.0-or-later (src/SDCCmain.c
  and constituent file notices); Boost header templates: Boost Software License 1.0,
  with detailed historical notices in licenses/BOOST-COPYRIGHT and source headers.
- sdcpp: SDCC's GCC 12.1.0 C preprocessing frontend (cc1 -E -quiet),
  GPL-3.0-or-later, including libcpp; libiberty/libbacktrace have their own
  retained GPL/LGPL/BSD notices. No process-spawning cpp driver is distributed.
- sdas8051 and sdld: GPL-3.0-or-later; Alan R. Baldwin and contributors.
- files.js: fixed 8051.h/stdint.h and small-model mcs51, libsdcc, libint,
  liblong, libfloat libraries from Debian 4.5.0+dfsg-1. Runtime exceptions
  are file-specific; see licenses/SDCC-LIBRARIES-COPYRIGHT and device/lib source.
- Generated Emscripten glue: MIT or Illinois/NCSA; musl libc (MIT and
  constituent notices), dlmalloc (public domain notice in source), LLVM
  libc++/libc++abi/compiler-rt (Apache-2.0 WITH LLVM-exception and retained
  legacy notices). The SDK/compiler itself is not shipped to the browser.
- No non-free PIC components are included.

Corresponding source downloads, relative to this notice (same static site):
  sdcc_4.5.0+dfsg.orig.tar.xz -- complete fixed Debian DFSG upstream source
  boost-headers-source.tar.xz -- the actual Boost headers used in compilation
  emscripten-runtime-source.tar.xz -- runtime/glue sources with original notices
  emuc51-port-source.tar.xz -- patches, pinned inputs, build/package recipes and
    browser bridge source. scripts/sdcc-wasm/build.py documents host requirements.
  licenses/ -- license texts and copyright records
  SHA256SUMS.json -- byte sizes and SHA-256 of distributed assets/source/notices

Build from the port-source archive:
  python3 scripts/sdcc-wasm/build.py /tmp/NEW-build /tmp/NEW-output
All third-party source/package downloads are pinned in inputs.json. Emsdk 4.0.19
is pinned to commit 7b4e60e4bfcba326025e373024369eaa9904af55 and release
8b01e2ec3f33e6b94842096d7312ce4ef5f33f6c. Libraries are the hash-verified Debian
package, not locally substituted archives. The original source contains their
preferred form for modification and build recipes under device/lib.

The compiler files and modifications may be redistributed under their applicable
GPL terms above (GPL version 3 or later for the combined compiler distribution).
Keep all component notices and the corresponding source/build materials available.
This does not change the licenses of unrelated project files. User input/output
is not uploaded; generated firmware is subject to its own source/runtime terms.
''')
records={str(p.relative_to(out)):{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(out.rglob('*')) if p.is_file() and p.name!='SHA256SUMS.json'}
(out/'SHA256SUMS.json').write_text(json.dumps(records,indent=2)+'\n')
print(json.dumps({'toolBytes':sum(v['bytes'] for k,v in records.items() if k.endswith('.js')),'totalBytes':sum(v['bytes'] for v in records.values())},indent=2))
