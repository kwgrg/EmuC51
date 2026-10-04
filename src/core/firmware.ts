const CODE_SIZE = 0x10000;
export const MAX_HEX_FILE_SIZE = 1024 * 1024;

const hexError = (line: number, message: string): Error =>
  new Error(`Intel HEX 第 ${line} 行：${message}`);

const parseIntelHex = (bytes: Uint8Array): Uint8Array => {
  if (bytes.byteLength > MAX_HEX_FILE_SIZE) {
    throw new Error("Intel HEX 文件超过 1 MiB 上限");
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Intel HEX 文件必须是有效的文本编码");
  }

  const code = new Uint8Array(CODE_SIZE);
  const populated = new Uint8Array(CODE_SIZE);
  let baseAddress = 0;
  let imageLength = 0;
  let eof = false;

  const lines = text.split(/\r\n|\n|\r/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    const lineNumber = index + 1;
    if (line === "") continue;
    if (eof) throw hexError(lineNumber, "EOF 记录之后仍有内容");
    if (!/^:[0-9a-fA-F]+$/.test(line) || line.length % 2 !== 1) {
      throw hexError(lineNumber, "记录必须以冒号开头并包含完整的十六进制字节");
    }
    if (line.length < 11) throw hexError(lineNumber, "记录头或校验和不完整");

    const byteCount = Number.parseInt(line.slice(1, 3), 16);
    if (line.length !== 11 + byteCount * 2) {
      throw hexError(lineNumber, "数据长度与记录中的字节数不一致");
    }

    const record = new Uint8Array(5 + byteCount);
    let checksum = 0;
    for (let offset = 0; offset < record.length; offset += 1) {
      const value = Number.parseInt(line.slice(1 + offset * 2, 3 + offset * 2), 16);
      record[offset] = value;
      checksum = (checksum + value) & 0xff;
    }
    if (checksum !== 0) throw hexError(lineNumber, "校验和错误");

    const address = (record[1]! << 8) | record[2]!;
    const type = record[3]!;
    const data = record.subarray(4, 4 + byteCount);
    switch (type) {
      case 0x00: {
        const start = baseAddress + address;
        if (start >= CODE_SIZE || start + byteCount > CODE_SIZE) {
          throw hexError(lineNumber, "数据地址超出 8051 的 64 KiB CODE 空间");
        }
        for (let offset = 0; offset < byteCount; offset += 1) {
          const target = start + offset;
          if (populated[target]) {
            throw hexError(lineNumber, `数据地址 0x${target.toString(16).toUpperCase().padStart(4, "0")} 重复`);
          }
          code[target] = data[offset]!;
          populated[target] = 1;
        }
        if (byteCount > 0) imageLength = Math.max(imageLength, start + byteCount);
        break;
      }
      case 0x01:
        if (byteCount !== 0 || address !== 0) {
          throw hexError(lineNumber, "EOF 记录必须使用地址 0000 且没有数据");
        }
        eof = true;
        break;
      case 0x02:
      case 0x04:
        if (byteCount !== 2 || address !== 0) {
          throw hexError(lineNumber, "扩展地址记录必须使用地址 0000 且包含两个数据字节");
        }
        baseAddress = ((data[0]! << 8) | data[1]!) * (type === 0x02 ? 0x10 : 0x10000);
        if (baseAddress >= CODE_SIZE) {
          throw hexError(lineNumber, "扩展地址超出 8051 的 64 KiB CODE 空间");
        }
        break;
      case 0x03:
      case 0x05: {
        if (byteCount !== 4 || address !== 0) {
          throw hexError(lineNumber, "起始地址记录必须使用地址 0000 且包含四个数据字节");
        }
        const entryAddress = type === 0x03
          ? ((data[0]! << 8) | data[1]!) * 0x10 + ((data[2]! << 8) | data[3]!)
          : data.reduce((value, byte) => value * 0x100 + byte, 0);
        if (entryAddress >= CODE_SIZE) {
          throw hexError(lineNumber, "起始地址超出 8051 的 64 KiB CODE 空间");
        }
        // Intel HEX entry metadata never changes the hardware reset vector at PC 0.
        break;
      }
      default:
        throw hexError(lineNumber, `不支持记录类型 0x${type.toString(16).toUpperCase().padStart(2, "0")}`);
    }
  }
  if (!eof) throw new Error("Intel HEX 文件缺少 EOF 记录");
  return code.slice(0, imageLength);
};

/** Return the CODE image at its original addresses; reset always begins at PC 0. */
export const parseFirmware = (bytes: Uint8Array, filename: string): Uint8Array => {
  const extension = filename.toLowerCase().split(".").at(-1);
  if (extension === "hex" || extension === "ihx") return parseIntelHex(bytes);
  if (extension !== "bin") throw new Error("请选择 .bin、.hex 或 .ihx 固件文件");
  if (bytes.byteLength > CODE_SIZE) {
    throw new Error(`固件大小 ${bytes.byteLength} 字节，超过 64 KiB 上限`);
  }
  return bytes.slice();
};
