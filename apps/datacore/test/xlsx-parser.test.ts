import { describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";
import { parseXlsx } from "../src/connectors/parsers.js";

/** 用 deflate(method8) 构造最小 xlsx(zip)，验证 parseXlsx 的 ZIP 读取 + sheet/sharedStrings 解析。 */
function makeXlsx(entries: { name: string; content: string }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const nameB = Buffer.from(e.name, "utf8");
    const data = deflateRawSync(Buffer.from(e.content, "utf8"));
    const uncompLen = Buffer.byteLength(e.content, "utf8");
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); // version
    lh.writeUInt16LE(0, 6); // flags
    lh.writeUInt16LE(8, 8); // method=deflate
    lh.writeUInt32LE(0, 14); // crc (reader ignores)
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(uncompLen, 22);
    lh.writeUInt16LE(nameB.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(Buffer.concat([lh, nameB, data]));
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(0, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(uncompLen, 24);
    ch.writeUInt16LE(nameB.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([ch, nameB]));
    offset += lh.length + nameB.length + data.length;
  }
  const localBuf = Buffer.concat(locals);
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);
  return Buffer.concat([localBuf, centralBuf, eocd]);
}

describe("OntoFlow P2 · parseXlsx", () => {
  it("XL1: 解析 sharedStrings + sheet1（首行表头，数值/字符串）", () => {
    const shared = `<?xml version="1.0"?><sst><si><t>order_id</t></si><si><t>cust</t></si><si><t>amount</t></si><si><t>O1</t></si><si><t>星辰</t></si></sst>`;
    const sheet = `<?xml version="1.0"?><worksheet><sheetData>` +
      `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>` +
      `<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" t="s"><v>4</v></c><c r="C2"><v>123</v></c></row>` +
      `</sheetData></worksheet>`;
    const buf = makeXlsx([
      { name: "xl/sharedStrings.xml", content: shared },
      { name: "xl/worksheets/sheet1.xml", content: sheet },
    ]);
    const rows = parseXlsx(buf);
    expect(rows).toEqual([{ order_id: "O1", cust: "星辰", amount: 123 }]);
  });

  it("XL2: 非法 buffer 抛错", () => {
    expect(() => parseXlsx(Buffer.from("not a zip"))).toThrow();
  });
});
