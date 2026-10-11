#!/usr/bin/env bash
set -euo pipefail
# Development-only native compiler smoke check; this does not add browser C compilation.
repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
sdcc_bin=${SDCC_BIN:-sdcc}
out_dir=${1:-/tmp/emuc51-sdcc-rebuild}
mkdir -p -- "$out_dir"
"$sdcc_bin" --version
cp -- "$repo_dir/tests/fixtures/sdcc-counter/main.c" "$out_dir/main.c"
"$sdcc_bin" -mmcs51 --model-small --iram-size 128 --debug "$out_dir/main.c" -o "$out_dir/main.ihx"
sha256sum "$out_dir/main.c" "$out_dir/main.ihx" "$out_dir/main.cdb"
cmp -- "$repo_dir/tests/fixtures/sdcc-counter/main.ihx" "$out_dir/main.ihx"
echo 'Native SDCC output matches the checked-in IHX fixture.'
