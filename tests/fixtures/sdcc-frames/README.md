# Real SDCC function-frame fixture

Built with SDCC 4.5.0 #15242 (Linux), using the repository's fixed classic-8051 small-model debug profile:

```sh
SDCC_BIN=/path/to/sdcc node scripts/build-sdcc-bundle.mjs tests/fixtures/sdcc-frames/frames.c EMPTY_DIRECTORY
```

Includes a file-static leaf, a nested call, three levels of `__reentrant` recursion, and a Timer0 ISR. Tests execute actual compiler output; the ISR is triggered through IE/TCON, retaining the hardware vector as the tracked frame entry. No mocked CDB is used for positive execution tests. Negative metadata tests deliberately mutate copies of this CDB.

The original C source is project test code. Linked SDCC runtime licensing is documented in [SDCC-LIBRARIES-COPYRIGHT](../sdcc-counter/SDCC-LIBRARIES-COPYRIGHT).
