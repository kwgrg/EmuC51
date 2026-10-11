import { readFileSync } from "node:fs";
import type { SdccDebugData } from "../../src/core/sdcc-debug";
export const sdccFixture = (stem = "main", directory = "sdcc-counter"): SdccDebugData => {
  const read = (name: string) => readFileSync(`tests/fixtures/${directory}/${name}`, "utf8");
  return { manifest: JSON.parse(read("emuc51-sdcc.json")), source: read(`${stem}.c`), ihx: read(`${stem}.ihx`), cdb: read(`${stem}.cdb`) };
};
