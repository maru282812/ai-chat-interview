import { deflateRawSync } from "node:zlib";

/**
 * 依存ゼロの最小 ZIP 書き出し（PKZIP 2.0 / deflate または store）。
 * 統計エクスポートの3点セット同梱に使う。ZIP64 は非対応（1エントリ4GB未満・65535エントリ未満が前提）。
 */

export interface ZipEntry {
  name: string;
  data: string | Buffer;
}

const CRC_TABLE = buildCrcTable();

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    // & 0xff で 0..255 に丸めるため CRC_TABLE(長さ256)の参照は必ず定義済み。
    const slot = CRC_TABLE[(crc ^ byte) & 0xff] as number;
    crc = slot ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** ローカル時刻を MS-DOS の日付・時刻形式（2秒精度）に変換する。 */
function dosDateTime(at: Date): { time: number; date: number } {
  const time = (at.getHours() << 11) | (at.getMinutes() << 5) | (Math.floor(at.getSeconds() / 2) & 0x1f);
  const date = ((at.getFullYear() - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate();
  return { time, date };
}

interface PreparedEntry {
  nameBytes: Buffer;
  body: Buffer;
  method: number;
  crc: number;
  rawSize: number;
  offset: number;
}

export function createZip(entries: ZipEntry[], now: Date = new Date()): Buffer {
  const { time, date } = dosDateTime(now);
  const chunks: Buffer[] = [];
  const prepared: PreparedEntry[] = [];
  let offset = 0;

  for (const entry of entries) {
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
    const deflated = deflateRawSync(raw, { level: 9 });
    // 圧縮で縮まないデータ（極小・既圧縮）は無圧縮 store にする。
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const nameBytes = Buffer.from(entry.name, "utf8");
    const crc = crc32(raw);

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(0x0800, 6); // flags: ファイル名 UTF-8
    header.writeUInt16LE(useDeflate ? 8 : 0, 8); // method
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    header.writeUInt16LE(0, 28); // extra field length

    chunks.push(header, nameBytes, body);
    prepared.push({ nameBytes, body, method: useDeflate ? 8 : 0, crc, rawSize: raw.length, offset });
    offset += header.length + nameBytes.length + body.length;
  }

  const centralStart = offset;
  for (const entry of prepared) {
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(entry.method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(entry.crc, 16);
    central.writeUInt32LE(entry.body.length, 20);
    central.writeUInt32LE(entry.rawSize, 24);
    central.writeUInt16LE(entry.nameBytes.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(entry.offset, 42);

    chunks.push(central, entry.nameBytes);
    offset += central.length + entry.nameBytes.length;
  }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with central directory
  eocd.writeUInt16LE(prepared.length, 8);
  eocd.writeUInt16LE(prepared.length, 10);
  eocd.writeUInt32LE(offset - centralStart, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20); // comment length
  chunks.push(eocd);

  return Buffer.concat(chunks);
}
