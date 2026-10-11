# SDCC integer storage evidence

Real SDCC 4.5.0 #15242 / mcs51 / small / 128-byte IRAM / debug output, generated with `scripts/build-sdcc-bundle.mjs`. The C source exercises signed char/int/long minima, maxima and -1, unsigned maxima and zero, and DATA/IDATA/XDATA/CODE storage. It also includes bool, enum, bit, long long, float, pointer, array and structure declarations.

Important format limitation: `enum_value` and an ordinary signed char both emit `{1}SC:S`. SDCC's `cdbTypeInfo` does not serialize `SPEC_ENUM`; the source frontend retains that flag, but the CDB writer discards it. Long long emits `{8}SI:S`, demonstrating why the size check must remain mandatory. Bool emits `{1}:S` (no recognized scalar type code).

The fixture does not authorize converting every SC/SI/SL declaration into a claimed C integer value. Its regression test preserves raw bytes and demonstrates the missing enum distinction. Any future C-type display needs additional trustworthy type evidence, or an explicitly different product contract describing storage reinterpretation rather than recovered C types.

The source is project test code. Linked runtime licensing: [SDCC-LIBRARIES-COPYRIGHT](../sdcc-counter/SDCC-LIBRARIES-COPYRIGHT).
