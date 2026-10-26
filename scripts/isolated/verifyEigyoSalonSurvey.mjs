/**
 * （営業）美容室 お客様アンケート（entry_code=eigyo-salon）を隔離環境（PORT 3101・ローカル Supabase）で
 * 実 Chromium・モバイルビューポートで Q1→送信完了まで通す。
 *
 * 前提: `node scripts/isolated/startIsolated.mjs` でアプリが 3101 で起動済み・seed がローカルDBへ投入済み。
 * LIFF SDK は route intercept でスタブに置き換え、`Authorization: Bearer tmtest:<userId>`（非本番 seam）で認証する。
 *
 * Usage:
 *   node scripts/isolated/verifyEigyoSalonSurvey.mjs            # 4人分（ペルソナ）通して検証
 *   node scripts/isolated/verifyEigyoSalonSurvey.mjs --dump     # Q1 の DOM を出して止まる（ハーネス調整用）
 */
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3101";
const ENTRY = "eigyo-salon";
const OUT = "C:/work/ai-chat-interview/.tmverify/eigyo-salon";
fs.mkdirSync(OUT, { recursive: true });

const DUMP = process.argv.includes("--dump");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) ?? "").slice(7);

function liffStub(userId) {
  return `
    window.liff = {
      init: async function(){}, ready: Promise.resolve(),
      isInClient: function(){ return false; }, isLoggedIn: function(){ return true; },
      getIDToken: function(){ return 'tmtest:${userId}'; },
      getDecodedIDToken: function(){ return { sub: '${userId}', name: '検証 ${userId}' }; },
      getProfile: async function(){ return { userId: '${userId}', displayName: '検証 ${userId}' }; },
      login: function(){}, logout: function(){}, closeWindow: function(){}, openWindow: function(){},
      getOS: function(){ return 'web'; }, getLanguage: function(){ return 'ja'; }, getVersion: function(){ return '2.0.0'; },
      isApiAvailable: function(){ return false; }, getContext: function(){ return { type: 'external' }; }
    };`;
}

/** ペルソナ: 各設問の回答。値は調査票の選択肢番号（value）。 */
const PERSONAS = [
  {
    id: "sl001",
    Q1: "2", Q2: "34", Q3: "1", Q5: "1",
    Q6: ["1", "2"], Q7: ["11"], Q7pre: ["1", "4"],   // Googleマップ・Instagramを選んでから「覚えていない」＝排他で他が外れること
    Q8: "1", Q9: "提案が的確で仕上がりも理想どおりでした。",
    Q10: "1", Q11: ["14"], Q11pre: ["2", "9"],       // 特になし（排他）
    Q12: "1", Q13: "また来ます。"
  },
  {
    id: "sl002",
    Q1: "1", Q2: "52", Q3: "3", Q3other: "C町", Q5: "4",
    Q6: ["1", "7"], Q6other: "眉カット",
    Q7: ["3", "10"], Q7other: "近所の看板",
    Q8: "3", Q9: "待ち時間が長かったです。",
    Q10: "6", Q11: ["9", "13"], Q11other: "予約の取りやすさ",
    Q12: "4", Q13: ""
  },
  {
    id: "sl003",
    Q1: "3", Q2: "19", Q3: "4", Q5: "2",
    Q6: ["5", "6"], Q7: ["5", "6", "9"],
    Q8: "5", Q9: "仕上がりがイメージと違いました。",
    Q10: "5", Q11: ["1", "6", "10"],
    Q12: "7", Q13: "カウンセリングを丁寧にしてほしいです。"
  }
];

// 同じ userId は2回目以降「回答済み」になる（店舗入口は同じ assignment を再利用する）ので、再走時は --fresh で別人にする
const FRESH = process.argv.includes("--fresh") ? String(Date.now()).slice(-5) : "";
for (const p of PERSONAS) p.id = p.id + FRESH;

const log = (...a) => console.log(...a);

async function currentQuestion(page) {
  return page.evaluate(() => {
    const area = document.getElementById("questionArea");
    const num = area?.querySelector(".question-card")?.getAttribute("data-code") ?? "";
    const text = area?.querySelector(".question-text")?.textContent?.trim() ?? "";
    const complete = document.getElementById("completeScreen");
    const completeVisible = complete && getComputedStyle(complete).display !== "none";
    return { num, text, completeVisible, html: area?.innerHTML ?? "" };
  });
}

async function run(persona, browser, consoleErrors) {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1"
  });
  await context.route("**/static.line-scdn.net/liff/**/sdk.js", (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: liffStub(persona.id) })
  );
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(`[${persona.id}] ${m.text()}`);
  });
  page.on("pageerror", (e) => consoleErrors.push(`[${persona.id}] pageerror: ${e.message}`));

  await page.goto(`${BASE}/liff/store?entry_code=${ENTRY}`);
  await page.waitForURL(/\/liff\/survey\//, { timeout: 30000 });
  await page.waitForFunction(() => (document.getElementById("questionArea")?.children.length ?? 0) > 0, null, { timeout: 30000 });

  if (DUMP) {
    const q = await currentQuestion(page);
    fs.writeFileSync(`${OUT}/dump-q1.html`, q.html, "utf8");
    log("Q1 dumped:", q.num, q.text);
    await page.screenshot({ path: `${OUT}/dump-q1.png`, fullPage: true });
    await context.close();
    return { ok: true, dumped: true };
  }

  const steps = [];
  for (let guard = 0; guard < 40; guard++) {
    const q = await currentQuestion(page);
    if (q.completeVisible) break;
    const code = (q.num.match(/Q\d+/) ?? [])[0];
    if (!code) throw new Error(`設問番号が取れません: num="${q.num}" text="${q.text}"`);
    const before = q.html.length;
    fs.writeFileSync(`${OUT}/${persona.id}-${code}.html`, q.html, "utf8");
    await answer(page, code, persona, q);
    steps.push({ code, text: q.text.slice(0, 40) });
    await page.screenshot({ path: `${OUT}/${persona.id}-${code}.png`, fullPage: true });
    await page.waitForTimeout(350);
    const after = await currentQuestion(page);
    if (after.completeVisible || after.num !== code) {
      // single_choice の自動遷移（data-autoadvance）で既に次へ進んでいる
      steps.at(-1).autoAdvanced = true;
      await page.waitForTimeout(250);
      continue;
    }
    await clickNext(page, code);
    await page.waitForFunction(
      ({ code, before }) => {
        const area = document.getElementById("questionArea");
        const num = area?.querySelector(".question-card")?.getAttribute("data-code") ?? "";
        const complete = document.getElementById("completeScreen");
        const cv = complete && getComputedStyle(complete).display !== "none";
        return cv || num !== code || area.innerHTML.length !== before;
      },
      { code, before },
      { timeout: 15000 }
    );
    // 画面遷移のアニメーション待ち
    await page.waitForTimeout(250);
  }
  const done = await currentQuestion(page);
  await page.screenshot({ path: `${OUT}/${persona.id}-complete.png`, fullPage: true });
  const completeText = await page.evaluate(() => document.getElementById("completeScreen")?.innerText ?? "");
  await context.close();
  return { ok: done.completeVisible, steps, completeText };
}

async function clickNext(page, code) {
  const btn = page.locator("#btnNext");
  await btn.waitFor({ state: "visible", timeout: 5000 });
  await btn.click();
  // 必須エラーが出たらそれを報告する
  await page.waitForTimeout(150);
  const err = await page.evaluate(() => {
    const e = document.getElementById("answerError");
    return e && getComputedStyle(e).display !== "none" ? e.textContent?.trim() : "";
  });
  if (err) throw new Error(`${code}: 次へで検証エラー「${err}」`);
}

/** value を data-value / input[value] から探してクリックする。 */
async function pick(page, value) {
  const area = page.locator("#questionArea");
  const byData = area.locator(`[data-value="${value}"]`).first();
  if (await byData.count()) {
    await byData.click();
    return;
  }
  const input = area.locator(`input[value="${value}"]`).first();
  if (await input.count()) {
    const id = await input.getAttribute("id");
    if (id) {
      const label = area.locator(`label[for="${id}"]`).first();
      if (await label.count()) { await label.click(); return; }
    }
    const wrap = input.locator("xpath=ancestor::*[contains(@class,'card-item') or contains(@class,'chip-item') or self::label][1]");
    if (await wrap.count()) { await wrap.click(); return; }
    await input.click({ force: true });
    return;
  }
  throw new Error(`選択肢 value=${value} が見つかりません`);
}

async function answer(page, code, persona, q) {
  const v = persona[code];
  const area = page.locator("#questionArea");
  switch (code) {
    case "Q2": {
      // number_wheel: 項目クリックで確定（scrollToItem + commit）
      const item = area.locator(`.wheel-item[data-val="${v}"]`).first();
      await item.scrollIntoViewIfNeeded();
      await item.click();
      await page.waitForTimeout(400);
      return;
    }
    case "Q4": {
      // カレンダー: 今日を選ぶ
      const today = area.locator(".dt-day.is-today").first();
      if (await today.count()) { await today.click(); return; }
      const dateInput = area.locator("input[type=date]").first();
      if (await dateInput.count()) {
        const d = new Date();
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        await dateInput.fill(iso);
        await dateInput.dispatchEvent("change");
        return;
      }
      throw new Error("Q4: 日付の入力手段が見つかりません\n" + q.html.slice(0, 1500));
    }
    case "Q9":
    case "Q13": {
      if (!v) return; // 任意
      const ta = area.locator("textarea, .free-text-input").first();
      await ta.fill(String(v));
      await ta.dispatchEvent("input");
      return;
    }
    case "Q12": {
      // 1〜7 スケール（big_slider）。目盛りは左=7 … 右=1 の順なので index = 7 - v。目盛り位置をタップして確定する
      const tick = area.locator(`.bigslider-tick[data-i="${7 - Number(v)}"]`).first();
      const hit = await area.locator(".bigslider-hit").first().boundingBox();
      const tb = await tick.boundingBox();
      await page.mouse.click(tb.x + tb.width / 2, hit.y + hit.height / 2);
      await page.waitForTimeout(400);
      return;
    }
    case "Q10": {
      // matrix_list: label.matrixlist-cell > input[name=mq_Q10_<row>][value=<列index 0始まり>]。ページごとに全行を選び「次へ」で送る
      const colIndex = String(Number(v) - 1);
      for (let p = 0; p < 5; p++) {
        const pageEl = area.locator(".matrixlist-page:visible").first();
        const rows = pageEl.locator(".matrixlist-row");
        const n = await rows.count();
        for (let i = 0; i < n; i++) {
          await rows.nth(i).locator(`label.matrixlist-cell:has(input[value="${colIndex}"])`).first().click();
          await page.waitForTimeout(80);
        }
        const next = area.locator(".matrixlist-next:visible");
        if ((await next.count()) && (await next.first().isEnabled())) {
          await next.first().click();
          await page.waitForTimeout(250);
        } else break;
      }
      return;
    }
    default: {
      const pre = persona[`${code}pre`];
      if (pre) for (const val of pre) await pick(page, val);
      const values = Array.isArray(v) ? v : [v];
      for (const val of values) await pick(page, val);
      if (pre) {
        await page.waitForTimeout(200);
        const selected = await area.locator(".card-item.selected, .chip-item.selected, input:checked").evaluateAll((els) =>
          [...new Set(els.map((e) => (e.querySelector("input") ?? e).value))]
        );
        if (selected.length !== values.length || !values.every((x) => selected.includes(x))) {
          throw new Error(`${code}: 排他が効いていません selected=${JSON.stringify(selected)}`);
        }
      }
      const other = persona[`${code}other`];
      if (other) {
        const ot = area.locator(".other-text-input:visible, input.other-text:visible").first();
        await ot.fill(other);
        await ot.dispatchEvent("input");
        await page.waitForTimeout(250);
      }
    }
  }
}

const browser = await chromium.launch({ headless: true });
const consoleErrors = [];
const results = [];
try {
  for (const p of DUMP ? [PERSONAS[0]] : PERSONAS.filter((x) => !ONLY || x.id.startsWith(ONLY))) {
    try {
      const r = await run(p, browser, consoleErrors);
      results.push({ id: p.id, ...r });
      log(`${p.id}: ${r.ok ? "OK" : "NG"} ${r.steps ? r.steps.map((s) => s.code).join(">") : ""}`);
    } catch (e) {
      results.push({ id: p.id, ok: false, error: String(e.message ?? e) });
      log(`${p.id}: ERROR ${e.message}`);
    }
  }
} finally {
  await browser.close();
}
fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({ results, consoleErrors }, null, 2), "utf8");
log("console errors:", consoleErrors.length);
process.exit(results.every((r) => r.ok) && consoleErrors.length === 0 ? 0 : 1);
