/**
 * Phase 0 の実挙動スモーク。
 * createApp() を実ポートで起動し、admin 画面と体験設定の GET/POST 往復を実際に叩く。
 * 本番 Supabase を参照するため、体験設定は最後に元の値へ戻す（他は一切書き換えない）。
 */
import "dotenv/config";
const { createApp } = await import("../src/app.ts");
const { appSettingsRepository, EXPERIENCE_DEFAULTS_KEY } = await import(
  "../src/repositories/appSettingsRepository.ts"
);
const { experienceService } = await import("../src/services/experienceService.ts");

const before = await appSettingsRepository.get(EXPERIENCE_DEFAULTS_KEY);
console.log("saved value BEFORE:", JSON.stringify(before));

const app = createApp();
const server = app.listen(0);
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;
const auth =
  "Basic " +
  Buffer.from(`${process.env.ADMIN_BASIC_USER}:${process.env.ADMIN_BASIC_PASSWORD}`).toString(
    "base64",
  );

async function get(path) {
  const r = await fetch(base + path, { headers: { authorization: auth } });
  return { status: r.status, body: await r.text() };
}

// 1) GET /admin/experience-settings
let r = await get("/admin/experience-settings");
console.log("GET  /admin/experience-settings ->", r.status);
console.log("  has form         :", /<form method="post" action="\/admin\/experience-settings">/.test(r.body));
console.log("  has probe_skip   :", /name="probe_skip_button" value="true" checked/.test(r.body));
console.log("  has preset select:", /name="default_answer_ui_preset"/.test(r.body));
console.log("  section headings :", (r.body.match(/<h3 style="margin:0 0 4px">/g) || []).length);

// 2) POST で 2 つだけ変更（probe_skip_button OFF / persona_name 変更）
const form = new URLSearchParams();
form.set("anonymity_note", "true");
form.set("persona_name", "テスト太郎");
form.set("referral_bonus_points", "250");
form.set("default_answer_ui_preset", "casual");
// probe_skip_button は送らない ＝ 未チェック ＝ false
const post = await fetch(base + "/admin/experience-settings", {
  method: "POST",
  headers: { authorization: auth, "content-type": "application/x-www-form-urlencoded" },
  body: form.toString(),
  redirect: "manual",
});
console.log("POST /admin/experience-settings ->", post.status, post.headers.get("location"));

// 3) 再読込で保持されているか
r = await get("/admin/experience-settings");
console.log("GET  again ->", r.status);
console.log("  probe_skip now OFF  :", !/name="probe_skip_button" value="true" checked/.test(r.body));
console.log("  anonymity still ON  :", /name="anonymity_note" value="true" checked/.test(r.body));
console.log("  persona_name kept   :", /name="persona_name" value="テスト太郎"/.test(r.body));
console.log("  bonus kept          :", /name="referral_bonus_points" value="250"/.test(r.body));
console.log("  preset casual kept  :", /<option value="casual" selected>/.test(r.body));

// 4) 解決値が全体既定を反映するか（サービス経由・キャッシュ破棄済み）
const g = await experienceService.getGlobal();
console.log("resolved global: probe_skip_button =", g.probe_skip_button, "/ persona_name =", g.persona_name);
console.log("resolved default preset =", await experienceService.getDefaultAnswerUiPreset());

// 5) researchForm（新規作成）に若年層体験オプションが出るか
r = await get("/admin/projects/new");
console.log("GET  /admin/projects/new ->", r.status);
console.log("  fieldset            :", /若年層体験オプション/.test(r.body));
console.log("  inherit option      :", /name="experience_config\[probe_skip_button\]"/.test(r.body));
console.log("  anonymity text input:", /name="experience_config\[anonymity_note_text\]"/.test(r.body));
console.log("  preset 全体既定 option:", /<option value="" selected>（全体既定に従う）/.test(r.body));
console.log("  global-only key absent:", !/experience_config\[haptics\]/.test(r.body));

// 6) LIFF projects ページに window.EXPERIENCE が入るか（認証不要ページ）
const liff = await fetch(base + "/liff/projects");
const liffBody = await liff.text();
const m = liffBody.match(/window\.EXPERIENCE = (\{.*?\});/);
console.log("GET  /liff/projects ->", liff.status, "window.EXPERIENCE present:", Boolean(m));
if (m) {
  const parsed = JSON.parse(m[1]);
  console.log("  keys =", Object.keys(parsed).length, "probe_skip_button =", parsed.probe_skip_button);
}

// 後片付け: 元の値へ戻す
if (before === null) {
  await appSettingsRepository.upsert(EXPERIENCE_DEFAULTS_KEY, {});
} else {
  await appSettingsRepository.upsert(EXPERIENCE_DEFAULTS_KEY, before);
}
experienceService.invalidateCache();
console.log("restored value:", JSON.stringify(await appSettingsRepository.get(EXPERIENCE_DEFAULTS_KEY)));

server.close();
process.exit(0);
