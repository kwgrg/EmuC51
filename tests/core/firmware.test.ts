import { describe, expect, it } from "vitest";
import { MAX_HEX_FILE_SIZE, parseFirmware } from "../../src/core/firmware";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const record = (type: number, address = 0, data: number[] = []): string => {
  const values = [data.length, address >> 8, address & 0xff, type, ...data];
  values.push((-values.reduce((sum, value) => sum + value, 0)) & 0xff);
  return `:${values.map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
};
const eof = ":00000001FF";
const parseHex = (...lines: string[]): Uint8Array =>
  parseFirmware(encode(lines.join("\n")), "test.hex");

describe("固件文件解析", () => {
  it("完整保留二进制字节并返回独立副本", () => {
    const input = Uint8Array.from([0x3a, 0x74, 0x42, 0xa5, 0xff]);
    const parsed = parseFirmware(input, "TEST.BIN");
    expect(parsed).toEqual(input);
    input[0] = 0;
    expect(parsed[0]).toBe(0x3a);
  });

  it("允许恰好 64 KiB 的 BIN，拒绝越界及未知扩展名", () => {
    expect(parseFirmware(new Uint8Array(0x10000), "full.bin")).toHaveLength(0x10000);
    expect(() => parseFirmware(new Uint8Array(0x10001), "large.bin")).toThrow("64 KiB");
    expect(() => parseFirmware(new Uint8Array(1), "program.txt")).toThrow(".bin");
  });

  it("按照 CODE 地址加载乱序及稀疏 HEX 数据，保留 PC 0 前的空洞", () => {
    const program = parseHex(record(0, 0x10, [0x74, 0x42]), record(0, 0x03, [0x80, 0xfe]), eof);
    expect(program).toHaveLength(0x12);
    expect([...program.slice(0, 5)]).toEqual([0, 0, 0, 0x80, 0xfe]);
    expect([...program.slice(5, 0x10)]).toEqual(new Array(11).fill(0));
    expect([...program.slice(0x10)]).toEqual([0x74, 0x42]);
  });

  it("接受大小写 HEX/IHX、UTF-8 BOM、空白行和 CRLF", () => {
    const text = `\uFEFF\r\n ${record(0, 0, [0x02, 0x12, 0x34]).toLowerCase()} \r\n${eof}\r\n\r\n`;
    expect(parseFirmware(encode(text), "firmware.IHX")).toEqual(Uint8Array.from([0x02, 0x12, 0x34]));
    expect(parseFirmware(encode(eof), "empty.HEX")).toHaveLength(0);
  });

  it("支持段地址记录及扩展线性地址记录切换", () => {
    const program = parseHex(
      record(2, 0, [0x00, 0x10]),
      record(0, 3, [0xab]),
      record(4, 0, [0x00, 0x00]),
      record(0, 2, [0xcd]),
      eof,
    );
    expect(program).toHaveLength(0x104);
    expect(program[0x103]).toBe(0xab);
    expect(program[2]).toBe(0xcd);
  });

  it("允许地址 FFFF 的最后一个字节和最大 255 字节数据记录", () => {
    const values = Array.from({ length: 255 }, (_, index) => index);
    const program = parseHex(record(0, 0, values), record(2, 0, [0x0f, 0xff]), record(0, 0x0f, [0x22]), eof);
    expect(program).toHaveLength(0x10000);
    expect([...program.slice(0, 255)]).toEqual(values);
    expect(program[0xffff]).toBe(0x22);
  });

  it.each([
    ["无冒号", "00000001FF"],
    ["非法十六进制字符", ":00000001FG"],
    ["半个字节", ":00000001F"],
    ["不完整记录", ":00"],
    ["数据长度不匹配", ":01000001FF"],
    ["校验和损坏", ":0000000100"],
  ])("拒绝损坏记录：%s，并显示行号", (_, line) => {
    expect(() => parseHex("", line)).toThrow(/第 2 行/);
  });

  it("要求唯一 EOF 且不接受其后的记录或文本", () => {
    expect(() => parseHex(record(0, 0, [0]))).toThrow("缺少 EOF");
    expect(() => parseHex(eof, eof)).toThrow("EOF 记录之后");
    expect(() => parseHex(eof, "unexpected")).toThrow("EOF 记录之后");
    expect(() => parseHex(record(1, 1), eof)).toThrow("EOF 记录必须");
    expect(() => parseHex(record(1, 0, [0]), eof)).toThrow("EOF 记录必须");
  });

  it.each([2, 4])("校验 %s 型扩展地址记录的长度和地址", (type) => {
    expect(() => parseHex(record(type, 0, [0]), eof)).toThrow("两个数据字节");
    expect(() => parseHex(record(type, 1, [0, 0]), eof)).toThrow("地址 0000");
  });

  it("拒绝越界 CODE 数据和扩展地址，不允许截断或地址回绕", () => {
    expect(() => parseHex(record(0, 0xffff, [0, 1]), eof)).toThrow("64 KiB CODE");
    expect(() => parseHex(record(2, 0, [0x0f, 0xff]), record(0, 0x10, [1]), eof)).toThrow("64 KiB CODE");
    expect(() => parseHex(record(2, 0, [0x10, 0]), eof)).toThrow("扩展地址超出");
    expect(() => parseHex(record(4, 0, [0, 1]), eof)).toThrow("扩展地址超出");
  });

  it.each([0x74, 0x00])("拒绝相同或冲突的重叠数据（%s）", (value) => {
    expect(() => parseHex(record(0, 1, [0x74, 0x42]), record(0, 1, [value]), eof)).toThrow("0x0001 重复");
  });

  it("接受起始段地址和线性地址元数据，仍将代码放在原始 CODE 地址", () => {
    expect(parseHex(
      record(0, 0x10, [0x74, 0x42]),
      record(3, 0, [0x00, 0x01, 0x00, 0x00]),
      record(5, 0, [0x00, 0x00, 0xff, 0xff]),
      eof,
    )).toEqual(Uint8Array.from([...new Array(16).fill(0), 0x74, 0x42]));
  });

  it.each([3, 5])("校验 %s 型起始地址记录的长度、地址和 CODE 范围", (type) => {
    expect(() => parseHex(record(type, 0, [0, 0]), eof)).toThrow("四个数据字节");
    expect(() => parseHex(record(type, 1, [0, 0, 0, 0]), eof)).toThrow("地址 0000");
    const overflow = type === 3 ? [0x10, 0, 0, 0] : [0, 1, 0, 0];
    expect(() => parseHex(record(type, 0, overflow), eof)).toThrow("起始地址超出");
    expect(() => parseHex(record(type, 0, [0xff, 0xff, 0xff, 0xff]), eof)).toThrow("起始地址超出");
  });

  it.each([6, 0xff])("拒绝不支持的 %s 型记录", (type) => {
    expect(() => parseHex(record(type), eof)).toThrow("不支持记录类型");
  });

  it("限制 HEX 输入大小，并拒绝无效文本编码", () => {
    expect(() => parseFirmware(new Uint8Array(MAX_HEX_FILE_SIZE + 1), "large.hex")).toThrow("1 MiB");
    expect(() => parseFirmware(Uint8Array.from([0xff]), "invalid.hex")).toThrow("文本编码");
  });
});
