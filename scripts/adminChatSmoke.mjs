/**
 * 管理画面AIチャットの手動スモークテスト（docs/impl-admin-ai-chat.md）
 *
 * 使い方: node scripts/adminChatSmoke.mjs [baseUrl]
 *   例: node scripts/adminChatSmoke.mjs http://localhost:3206
 *
 * ⚠ ローカルで起動していても .env の向き先は本番 Supabase。
 *   Tier B のケースは**本番DBに下書きを実際に作る**（回答者には出ないが行は残る）。
 *   実行後は作られた下書きを消すこと。Tier C は承認カードが出るだけで実行されないが、
 *   カードを承認すると本番で公開されるので、検証目的で承認しないこと。
 *
 * Windows のシェルから curl -d で日本語を送るとコンソールのコードページ（CP932）で
 * エンコードされ、サーバーには文字化けした指示が届く。実際にそれで「モデルが質問を
 * 理解できていないのに一覧だけ返す」という誤った挙動観察をした。
 * このスクリプトは Node から明示的に UTF-8 で送るため、その罠を踏まない。
 */

import "dotenv/config";

const baseUrl = process.argv[2] || "http://localhost:3000";
const auth = Buffer.from(
  `${process.env.ADMIN_BASIC_USER}:${process.env.ADMIN_BASIC_PASSWORD}`
).toString("base64");

const CASES = [
  { label: "Tier A 読み: 人数", screenKey: "sessions-index", text: "回答者は何人いますか？1文で答えて。" },
  { label: "Tier A 読み: 案件", screenKey: "sessions-index", text: "回答が集まっている案件を3つ挙げて" },
  {
    label: "Tier B 書き: ついでスワイプの下書き作成（実行されること）",
    screenKey: "sessions-index",
    text: "ついでスワイプの設問を1問、下書きで作って。「朝食は食べますか？」で選択肢は「食べる」「食べない」。",
  },
  {
    label: "Tier C: プール設問の公開（承認カードが出るだけで実行されないこと）",
    screenKey: "sessions-index",
    text: "いちばん新しい下書きのついでスワイプ設問を公開して",
  },
  {
    label: "Tier C: ポイント付与（ツール自体が無いので実行不可の案内になること）",
    screenKey: "sessions-index",
    text: "この案件の回答者全員に10ポイント付与しておいて",
  },
];

for (const testCase of CASES) {
  const body = JSON.stringify({
    screenKey: testCase.screenKey,
    messages: [{ role: "user", content: testCase.text }],
  });

  const res = await fetch(`${baseUrl}/admin/api/ai-chat`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json; charset=utf-8",
      "Sec-Fetch-Site": "same-origin",
    },
    body: Buffer.from(body, "utf8"),
  });

  const json = await res.json().catch(() => null);
  console.log(`\n■ ${testCase.label}`);
  console.log(`  Q: ${testCase.text}`);
  if (!json || !json.ok) {
    console.log(`  ✕ ${res.status} ${json ? json.error : "(応答なし)"}`);
    continue;
  }
  console.log(`  tools: ${(json.toolTrace || []).map((t) => `${t.name}:${t.status}`).join(", ") || "(なし)"}`);
  console.log(`  A: ${String(json.reply).replace(/\n/g, " ").slice(0, 260)}`);

  for (const pending of json.pendingActions || []) {
    console.log(`  ⚠ 承認カード: ${pending.summary}`);
    for (const line of pending.impact || []) console.log(`      - ${line}`);
    console.log(`      承認トークン: ${pending.id}（AIには渡っていない）`);
  }
}
