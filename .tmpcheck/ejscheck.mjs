import ejs from "ejs";
import fs from "node:fs";

const files = [
  "src/views/admin/experience-settings/index.ejs",
  "src/views/admin/projects/researchForm.ejs",
  "src/views/partials/experience-inject.ejs",
  "src/views/partials/header.ejs",
  "src/views/liff/survey.ejs",
  "src/views/liff/projects.ejs",
  "src/views/liff/mypage.ejs",
  "src/views/liff/daily-survey.ejs",
];
let bad = 0;
for (const f of files) {
  try {
    ejs.compile(fs.readFileSync(f, "utf8"), { filename: f });
    console.log("compile OK   ", f);
  } catch (e) {
    bad++;
    console.log("compile FAIL ", f, "::", String(e.message).split("\n").slice(-3).join(" | "));
  }
}

// 体験設定画面を実データ相当で描画してみる
const { EXPERIENCE_KEYS, EXPERIENCE_KEY_LIST, resolveExperience } = await import(
  "../src/lib/experienceConfig.ts"
);
const html = await ejs.renderFile("src/views/admin/experience-settings/index.ejs", {
  title: "体験設定（若年層体験パック）",
  keyDefs: EXPERIENCE_KEYS,
  keyList: EXPERIENCE_KEY_LIST,
  values: resolveExperience({}, { haptics: false, default_answer_ui_preset: "casual" }),
  loadError: null,
  msg: null,
  err: null,
});
console.log("render experience-settings OK, length =", html.length);
console.log("has haptics checkbox unchecked:", /name="haptics" value="true"\s*\/>/.test(html));
console.log("has casual selected:", /<option value="casual" selected>/.test(html));
console.log("has 25 rows:", (html.match(/<code>/g) || []).length);

// 読み込み失敗時はフォームを出さない
const errHtml = await ejs.renderFile("src/views/admin/experience-settings/index.ejs", {
  title: "x",
  keyDefs: EXPERIENCE_KEYS,
  keyList: EXPERIENCE_KEY_LIST,
  values: null,
  loadError: "boom",
  msg: null,
  err: null,
});
console.log("loadError: no <form> rendered:", !/<form method="post"/.test(errHtml));

// window.EXPERIENCE 注入
const inj = await ejs.renderFile("src/views/partials/experience-inject.ejs", {
  experience: resolveExperience({ anonymity_note: false }, {}),
});
console.log("inject:", inj.trim().split("\n").pop().trim().slice(0, 120));
const injEmpty = await ejs.renderFile("src/views/partials/experience-inject.ejs", {});
console.log("inject (no locals):", injEmpty.trim().split("\n").pop().trim());

process.exit(bad ? 1 : 0);
