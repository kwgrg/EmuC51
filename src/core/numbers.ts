export const u8 = (value: number): number => value & 0xff;

export const u16 = (value: number): number => value & 0xffff;

export const sign8 = (value: number): number => {
  const byte = u8(value);
  return byte < 0x80 ? byte : byte - 0x100;
};

export const hex8 = (value: number): string =>
  u8(value).toString(16).toUpperCase().padStart(2, "0");

export const hex16 = (value: number): string =>
  u16(value).toString(16).toUpperCase().padStart(4, "0");

export const parity = (value: number): boolean => {
  let bits = u8(value);
  let odd = false;
  while (bits !== 0) {
    odd = !odd;
    bits &= bits - 1;
  }
  return odd;
};
