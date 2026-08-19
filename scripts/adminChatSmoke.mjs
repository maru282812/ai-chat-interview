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
 *
 * 道しるべ（Phase 5・docs/plan-admin-navigator-ai.md）の疎通も確認する。
 * 追加したのは **Tier A の読み取りのみ**（find_screen / resolve_entity /
 * GET /admin/api/screen-search）。本番DBに書くスクリプトなので、
 * 道しるべ関連で書き込み系・Tier C のケースを足さないこと。
 */

import "dotenv/config";

const baseUrl = process.argv[2] || "http://localhost:3000";

// 管理画面は Basic 認証からログインセッションへ移行した（middleware/adminAuth.ts）。
// スクリプトはログイン画面を通れないので、非対話クライアント用の鍵で認証する。
const adminApiKey = process.env.ADMIN_API_KEY;
if (!adminApiKey) {
  console.error("ADMIN_API_KEY が未設定です。.env に設定してください（例: openssl rand -hex 32）。");
  process.exit(1);
}

const CASES = [
  // ── 道しるべ（Tier A・読み取りのみ。docs/plan-admin-navigator-ai.md Phase 5）──
  // 画面カタログを引くだけで DB へは一切書かない。
  // ⚠ このスクリプトは本番DBに書く（下の Tier B ケース）。道しるべの疎通確認を
  //   足すときも **読み取り系だけ** にすること。書き込み系・Tier C を足さない。
  {
    label: "道しるべ Tier A: find_screen（候補カードが navigations に載ること）",
    screenKey: "dashboard",
    text: "離脱率ってどの画面で見られる？",
    expectTools: ["find_screen"],
    expectNavigationUrl: "/admin/cycles",
  },
  {
    label: "道しるべ Tier A: find_screen 0件（無いものは無いと返すこと）",
    screenKey: "dashboard",
    text: "宇宙船の整備記録はどの画面？",
    expectTools: ["find_screen"],
    expectNoNavigations: true,
  },
  {
    label: "道しるべ Tier A: resolve_entity（企業名 → まとめ画面の実URL）",
    screenKey: "dashboard",
    text: "登録されている法人をひとつ選んで、そのまとめ画面を開くリンクを出して",
    expectTools: ["resolve_entity"],
  },
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

// ── 非LLMのグローバル検索API（読み取りのみ）─────────────────────────
// LLM を通さない経路なので、道しるべが変になったとき「台帳が悪いのか AI が悪いのか」を
// 切り分けられる。GET だけで副作用なし。
const SEARCH_PROBES = [
  { q: "離脱", expectUrl: "/admin/cycles" },
  { q: "配信", expectUrl: "/admin/delivery-operations" },
  { q: "該当しない語ZZZQQQ", expectEmpty: true },
];

console.log("\n══ グローバル検索API（GET /admin/api/screen-search・読み取りのみ）══");
for (const probe of SEARCH_PROBES) {
  const res = await fetch(`${baseUrl}/admin/api/screen-search?q=${encodeURIComponent(probe.q)}`, {
    headers: { "X-Admin-Api-Key": adminApiKey, "Sec-Fetch-Site": "same-origin" },
  });
  const json = await res.json().catch(() => null);
  if (!json || !Array.isArray(json.results)) {
    console.log(`  ✕ 「${probe.q}」 ${res.status} (応答が不正)`);
    continue;
  }
  const urls = json.results.map((r) => r.url);
  if (probe.expectEmpty) {
    console.log(
      `  ${urls.length === 0 ? "✓" : "✕"} 「${probe.q}」 → ${urls.length}件（0件が正解＝無理に候補を作らない）`
    );
  } else {
    console.log(
      `  ${urls.includes(probe.expectUrl) ? "✓" : "✕"} 「${probe.q}」 → ${urls.slice(0, 3).join(", ") || "(0件)"}`
    );
  }
}

console.log("\n══ AIチャット ══");
for (const testCase of CASES) {
  const body = JSON.stringify({
    screenKey: testCase.screenKey,
    messages: [{ role: "user", content: testCase.text }],
  });

  const res = await fetch(`${baseUrl}/admin/api/ai-chat`, {
    method: "POST",
    headers: {
      "X-Admin-Api-Key": adminApiKey,
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

  // 道しるべの候補カード。URL はサーバー計算値（navigations 封筒）だけを見る。
  const navigations = json.navigations || [];
  if (navigations.length > 0) {
    console.log(`  → 候補カード ${navigations.length}件:`);
    for (const nav of navigations.slice(0, 5)) console.log(`      ${nav.label} → ${nav.url}`);
  }
  if (testCase.expectTools) {
    const used = (json.toolTrace || []).map((t) => t.name);
    for (const name of testCase.expectTools) {
      console.log(`  ${used.includes(name) ? "✓" : "✕"} ${name} が呼ばれること`);
    }
  }
  if (testCase.expectNavigationUrl) {
    const hit = navigations.some((nav) => nav.url === testCase.expectNavigationUrl);
    console.log(`  ${hit ? "✓" : "✕"} 候補に ${testCase.expectNavigationUrl} が出ること`);
  }
  if (testCase.expectNoNavigations) {
    console.log(`  ${navigations.length === 0 ? "✓" : "✕"} 候補0件で正直に返すこと`);
  }
  // 本文にURLを書かせない方針（押させるのはカードだけ）の観察用
  if (String(json.reply).includes("/admin/")) {
    console.log("  ⚠ 本文に /admin/ のURLが含まれている（カード誘導に寄せたい）");
  }

  for (const pending of json.pendingActions || []) {
    console.log(`  ⚠ 承認カード: ${pending.summary}`);
    for (const line of pending.impact || []) console.log(`      - ${line}`);
    console.log(`      承認トークン: ${pending.id}（AIには渡っていない）`);
  }
}
