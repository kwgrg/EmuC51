# Native SDCC 4.5 mixed fixture

The project contains two C translation units, one SDAS8051 module and a shared header. `emuc51-project.build.json` is an actual native compiler/assembler/linker result, not synthesized debug metadata. Rebuild with `SDCC_BIN=/path/to/sdcc node scripts/build-sdcc-project.mjs tests/fixtures/sdcc-mixed/project/project.json NEW_DIRECTORY` (Node >=22.18).

Verified: 8-bit DPL call/return, 16-bit DPL-low/DPH-high carry and return, C→ASM→C stack balance, assembly DATA-global access, two same-named file statics, identical C line numbers across files, a multi-line C call, and opcode-looking `.db` bytes excluded from assembly source breakpoints. After 1000 execution units: shared=10, word_result=0x1300, main shadow=10, compute shadow=3.

Native packages restored from the same official Debian SDCC 4.5.0+dfsg-1 compiler/libraries and SHA-256 recorded in [sdcc-counter](../sdcc-counter/README.md). The project source is project test code. Linked SDCC runtime notices remain in [SDCC-LIBRARIES-COPYRIGHT](../sdcc-counter/SDCC-LIBRARIES-COPYRIGHT). No native compiler binaries are committed. See [contract and limitations](../../../docs/MIXED_SDCC_PROJECT.md).
