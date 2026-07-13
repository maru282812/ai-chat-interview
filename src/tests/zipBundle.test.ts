import assert from "node:assert/strict";
import { test } from "node:test";
import { inflateRawSync } from "node:zlib";
import { createZip } from "../lib/zip";

/** EOCD から中央ディレクトリを辿り、名前→内容に復元する簡易リーダ（テスト検証用）。 */
function readZip(zip: Buffer): Map<string, string> {
  const eocdOffset = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocdOffset > 0, "EOCD が見つからない");
  const entryCount = zip.readUInt16LE(eocdOffset + 10);
  let cursor = zip.readUInt32LE(eocdOffset + 16);

  const files = new Map<string, string>();
  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(zip.readUInt32LE(cursor), 0x02014b50, "中央ディレクトリの署名が不正");
    const method = zip.readUInt16LE(cursor + 10);
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const rawSize = zip.readUInt32LE(cursor + 24);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const name = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");

    assert.equal(zip.readUInt32LE(localOffset), 0x04034b50, "ローカルヘッダの署名が不正");
    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const bodyStart = localOffset + 30 + localNameLength + localExtraLength;
    const body = zip.subarray(bodyStart, bodyStart + compressedSize);
    const raw = method === 8 ? inflateRawSync(body) : body;

    assert.equal(raw.length, rawSize, `${name}: 展開後サイズが宣言と不一致`);
    files.set(name, raw.toString("utf8"));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

test("createZip: 複数エントリを往復復元できる", () => {
  const wide = `﻿respondent_key,q1\r\nabc,1\r\n`;
  const codebook = `﻿master_order,question_code\r\n1,Q1\r\n`;
  const files = readZip(createZip([
    { name: "respondents_wide.csv", data: wide },
    { name: "codebook.csv", data: codebook }
  ]));

  assert.deepEqual([...files.keys()], ["respondents_wide.csv", "codebook.csv"]);
  assert.equal(files.get("respondents_wide.csv"), wide);
  assert.equal(files.get("codebook.csv"), codebook);
});

test("createZip: UTF-8 BOM と CRLF・日本語・引用符を保つ", () => {
  const csv = `﻿question_text,note\r\n"改行\r\nを含む","引用""符"\r\n満足度,あ\r\n`;
  const files = readZip(createZip([{ name: "codebook.csv", data: csv }]));
  assert.equal(files.get("codebook.csv"), csv);
});

test("createZip: 圧縮が効かない極小データは store になるが内容は保たれる", () => {
  const zip = createZip([{ name: "a.csv", data: "x" }]);
  const files = readZip(zip);
  assert.equal(files.get("a.csv"), "x");
});

test("createZip: 大きめの反復データは deflate で縮む", () => {
  const csv = "respondent_key,q1\r\n" + "abcdefgh,1\r\n".repeat(5000);
  const zip = createZip([{ name: "respondents_wide.csv", data: csv }]);
  assert.ok(zip.length < Buffer.byteLength(csv) / 2, "deflate が効いていない");
  assert.equal(readZip(zip).get("respondents_wide.csv"), csv);
});
