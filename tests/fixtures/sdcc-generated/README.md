# Real SDCC string and initializer fixtures

Created for EmuC51 on 2026-10-12. Each `<name>.c` was copied to `main.c` in its own empty directory and compiled with the hash-verified Debian SDCC 4.5.0+dfsg-1 and libraries recorded in `scripts/sdcc-wasm/inputs.json`:

```sh
sdcc -mmcs51 --model-small --iram-size 128 --debug main.c -o main.ihx
```

The resulting `main.asm`, `main.ihx`, and `main.cdb` were copied unchanged to `<name>.asm`, `<name>.ihx`, and `<name>.cdb`. All debug filenames therefore remain `main.c`; tests compare complete IHX/CDB without rewriting records.

- `main`: ordinary string storage emits `.ascii` plus `.db` terminator.
- `values`: word, float and pointer initializers also emit `.byte`.
- `literals`: semicolon, quote, backslash, newline, and concatenated directive-looking string data must not be mistaken for assembler directives.

Sources are project-authored regression examples. Generated outputs include linked SDCC startup/runtime code; component notices and corresponding source are retained in `public/sdcc/4.5.0-r1/NOTICE.txt` and its source archives. The generated directive profile is audited against the fixed SDCC `src/SDCCglue.c` printChar/printChar16/printChar32 and initializer output, plus `src/SDCCasm.c` ASxxxx mappings. User-written SDAS restrictions remain unchanged.
