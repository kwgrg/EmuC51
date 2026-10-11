# Real SDCC counter fixture

Created from `main.c` for this project on 2026-10-11. This source increments one internal RAM byte and writes P1 forever. The checked-in IHX, CDB and memory report are **actual compiler outputs**, not hand-assembled substitutes. Only trailing whitespace in the memory report was removed for repository formatting; IHX and CDB are byte-for-byte compiler output. The app now imports the four-file bundle for exact source-line debugging; this fixture does not provide a browser C compiler.

Compiler: Debian trixie `sdcc` / `sdcc-libraries` **4.5.0+dfsg-1**, SDCC **4.5.0 #15242 (Linux)**. Downloaded from the Debian official package pool, package hashes verified against Debian's package pages:

- [Compiler package](https://packages.debian.org/trixie/amd64/sdcc/download): `81dfc9e3d469b11c3465a6ebae7034679b845f4a7de4435afb3a2e974abc1ff3`
- [Libraries package](https://packages.debian.org/trixie/all/sdcc-libraries/download): `3693c67f573663d400d95a2bad8d41ba1047decb608f4ee61d9d2e2fa96046a7`

The cloud environment has no sudo; the packages were extracted with `dpkg-deb -x` into `/tmp/emuc51-sdcc/root`, without system installation or copying compiler binaries into the application. The compiler finds sibling tools, headers and libraries relative to its executable.

Actual command:

```sh
sdcc -mmcs51 --model-small --iram-size 128 --debug main.c -o main.ihx
```

`--iram-size 128` is essential for this classic 8051 target. The initial baseline without it generated startup code that cleared indirect IRAM address `0xff`; EmuC51 correctly rejected that access. Recompiling for 128 bytes fixed the target mismatch; the CPU was not weakened to accept 8052 RAM.

Reproduce using the same compiler version:

```sh
SDCC_BIN=/tmp/emuc51-sdcc/root/usr/bin/sdcc bash scripts/verify-sdcc.sh
SDCC_BIN=/path/to/sdcc node scripts/build-sdcc-bundle.mjs tests/fixtures/sdcc-counter/main.c /path/to/empty-output
npm test -- tests/core/sdcc-fixture.test.ts tests/core/sdcc-debug.test.ts
```

Expected SHA-256:

- `main.c`: `54552b46c01e6948c818b95aa8bd01f761054042f77007dadee3119a2529bf9c`
- `main.ihx`: `65976a018191173f99d4c34f4c84922bebad82e3899fb68db00e794fcd1a9ea7`
- `main.cdb`: `4fb8ee320ee2b1ab96206aa0543e39f476bce79409e5ec0b8fa37f6a631a74e0`

The HEX records are not ordered by address; the existing Intel HEX parser uses their declared addresses. CDB contains genuine line records for `main.c:6 → 0xAB`, `main.c:7 → 0xAD`, and counter at IRAM `0x08`. These addresses depend on this exact toolchain and build. Tests execute the startup and main loop; they do not infer source locations for unmapped runtime code.

`SDCC-LIBRARIES-COPYRIGHT` is the unmodified Debian library-package copyright/notice file. The linked MCS51 startup sources in this package include GPL linking exceptions. Compiler binaries and runtime library archives are not redistributed in the app. A future browser compiler distribution needs a separate audit of its actual components, corresponding source and build materials.
