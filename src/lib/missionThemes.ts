/**
 * missionThemes.ts — ミッションページのテーマ 15種（純データ・Migration 098 の theme_key）
 *
 * テーマ＝色6値＋見出し文言＋情景SVG。**色だけ替えても意味がない**
 * （祭りには提灯・屋台、正月には門松を描く。文言も世界の一部）。
 * ページ実装は1枚のままで、theme_key の切り替えだけで世界が変わる。
 *
 * 全テーマ、文字/地 4.5:1 以上・CTA地/地 3:1 以上をコントラスト実測して選定済み
 * （mockups/campaign/ の検証を移植。値を変えるときは再計測すること）。
 * 情景SVGは var(--t-*) を参照するので、配色と情景は独立して差し替えられる。
 */

export interface MissionTheme {
  key: string;
  name: string;
  usage: string;
  /** 面の色（世界の地） */ bg: string;
  /** 面の陰（絵の奥行き） */ bg2: string;
  /** 面の上の文字 */ ink: string;
  /** 面の上の補助文字 */ sub: string;
  /** CTAの地 */ accent: string;
  /** CTAの枠＋ベタ影 */ edge: string;
  /** CTA上の文字（実測で選定） */ onAccent: string;
  /** 見出し上の小ラベル */ kicker: string;
  /** 見出し（テーマごとに変わる） */ heading: string;
  /** ヒーローの情景（viewBox 0 0 360 190。var(--t-*) を参照） */ sceneSvg: string;
  sceneAlt: string;
}

export const MISSION_THEMES: readonly MissionTheme[] = [
  {
    key: "forest", name: "定番（フォレスト）", usage: "通年・既定",
    bg: "#0E6B5A", bg2: "#0A5245", ink: "#FFFFFF", sub: "#BFE0D6",
    accent: "#FFD836", edge: "#C79A00", onAccent: "#2B1A00",
    kicker: "MISSION", heading: "こたえて、ひらこう。",
    sceneAlt: "街でアンケートに答える人々",
    sceneSvg: `<path d="M0 150 Q40 120 80 148 T160 146 T240 150 T320 144 T360 152 L360 190 L0 190Z" fill="var(--t-bg2)"/>
<g fill="var(--t-sub)" opacity=".45">
  <rect x="18" y="96" width="34" height="58" rx="3"/><rect x="60" y="112" width="26" height="42" rx="3"/>
  <rect x="272" y="104" width="30" height="50" rx="3"/><rect x="310" y="120" width="24" height="34" rx="3"/>
</g>
<circle cx="300" cy="34" r="24" fill="var(--t-accent)" opacity=".9"/>
<circle cx="132" cy="130" r="10" fill="var(--t-sub)" opacity=".9"/><rect x="124" y="141" width="16" height="24" rx="7" fill="var(--t-accent)"/><circle cx="180" cy="134" r="10" fill="var(--t-sub)" opacity=".9"/><rect x="172" y="145" width="16" height="24" rx="7" fill="var(--t-sub)"/><circle cx="228" cy="138" r="10" fill="var(--t-sub)" opacity=".9"/><rect x="220" y="149" width="16" height="24" rx="7" fill="var(--t-accent)"/>
<g fill="var(--t-ink)" opacity=".9">
  <rect x="146" y="104" width="26" height="19" rx="5"/><path d="M154 123l-3 7 9-7z"/>
  <rect x="196" y="96" width="26" height="19" rx="5"/><path d="M204 115l-3 7 9-7z"/>
</g>`,
  },
  {
    key: "sakura", name: "さくら", usage: "3-4月・新生活",
    bg: "#8E3B5A", bg2: "#6E2A44", ink: "#FFF4F8", sub: "#F3C3D6",
    accent: "#FFD9E4", edge: "#C98BA4", onAccent: "#2B1A00",
    kicker: "はじまり", heading: "あたらしい 春に。",
    sceneAlt: "桜並木と舞う花びら",
    sceneSvg: `<path d="M0 150 Q40 120 80 148 T160 146 T240 150 T320 144 T360 152 L360 190 L0 190Z" fill="var(--t-bg2)"/>
<g fill="var(--t-sub)" opacity=".5">
  <rect x="40" y="112" width="9" height="44" rx="3"/><rect x="300" y="106" width="9" height="50" rx="3"/>
</g>
<g fill="var(--t-accent)" opacity=".9">
  <circle cx="44" cy="98" r="22"/><circle cx="26" cy="110" r="15"/><circle cx="63" cy="110" r="15"/>
  <circle cx="304" cy="92" r="24"/><circle cx="285" cy="105" r="16"/><circle cx="324" cy="105" r="16"/>
</g>
<g fill="var(--t-accent)" opacity=".75">
  <ellipse cx="110" cy="42" rx="6" ry="4" transform="rotate(24 110 42)"/>
  <ellipse cx="168" cy="26" rx="6" ry="4" transform="rotate(-18 168 26)"/>
  <ellipse cx="222" cy="52" rx="6" ry="4" transform="rotate(38 222 52)"/>
  <ellipse cx="140" cy="76" rx="5" ry="3.5" transform="rotate(12 140 76)"/>
  <ellipse cx="252" cy="90" rx="5" ry="3.5" transform="rotate(-28 252 90)"/>
</g>
<circle cx="150" cy="130" r="10" fill="var(--t-sub)" opacity=".9"/><rect x="142" y="141" width="16" height="24" rx="7" fill="var(--t-accent)"/><circle cx="196" cy="134" r="10" fill="var(--t-sub)" opacity=".9"/><rect x="188" y="145" width="16" height="24" rx="7" fill="var(--t-sub)"/>`,
  },
  {
    key: "freshgreen", name: "新緑", usage: "5-6月",
    bg: "#2A6B36", bg2: "#1E5228", ink: "#F4FBF2", sub: "#CDECCF",
    accent: "#FFE86B", edge: "#C0A72E", onAccent: "#2B1A00",
    kicker: "MISSION", heading: "風がきもちいい。",
    sceneAlt: "新緑の木漏れ日",
    sceneSvg: `<path d="M0 150 Q40 120 80 148 T160 146 T240 150 T320 144 T360 152 L360 190 L0 190Z" fill="var(--t-bg2)"/>
<g fill="var(--t-accent)" opacity=".85">
  <path d="M60 40c26 0 40 18 40 36S86 108 60 108 20 94 20 76 34 40 60 40z"/>
  <path d="M312 30c22 0 34 16 34 32s-12 30-34 30-34-14-34-30 12-32 34-32z"/>
</g>
<g stroke="var(--t-sub)" stroke-width="3" opacity=".5" stroke-linecap="round">
  <path d="M60 108v34M312 92v42"/>
</g>
<g fill="var(--t-ink)" opacity=".18">
  <ellipse cx="140" cy="120" rx="26" ry="7"/><ellipse cx="212" cy="132" rx="22" ry="6"/>
</g>
<circle cx="148" cy="130" r="10" fill="var(--t-sub)" opacity=".9"/><rect x="140" y="141" width="16" height="24" rx="7" fill="var(--t-accent)"/><circle cx="204" cy="134" r="10" fill="var(--t-sub)" opacity=".9"/><rect x="196" y="145" width="16" height="24" rx="7" fill="var(--t-sub)"/>`,
  },
  {
    key: "tsuyu", name: "つゆ", usage: "6月・梅雨",
    bg: "#34527A", bg2: "#243E5C", ink: "#F2F7FC", sub: "#C6D8EC",
    accent: "#8FE3D8", edge: "#3E958A", onAccent: "#2B1A00",
    kicker: "つゆ", heading: "雨の日は、ゆっくり。",
    sceneAlt: "雨の日。傘をさして歩く人",
    sceneSvg: `<path d="M0 150 Q40 120 80 148 T160 146 T240 150 T320 144 T360 152 L360 190 L0 190Z" fill="var(--t-bg2)"/>
<g stroke="var(--t-sub)" stroke-width="2" opacity=".55" stroke-linecap="round">
  <path d="M40 20l-6 20M92 12l-6 20M148 24l-6 20M206 14l-6 20M262 26l-6 20M318 16l-6 20
           M66 52l-5 16M120 46l-5 16M178 56l-5 16M234 48l-5 16M292 58l-5 16"/>
</g>
<g>
  <path d="M126 96a34 34 0 0168 0z" fill="var(--t-accent)"/>
  <path d="M160 96v34" stroke="var(--t-ink)" stroke-width="3" stroke-linecap="round"/>
  <path d="M232 104a26 26 0 0152 0z" fill="var(--t-sub)"/>
  <path d="M258 104v28" stroke="var(--t-ink)" stroke-width="2.5" stroke-linecap="round"/>
</g>
<g fill="var(--t-ink)" opacity=".2">
  <ellipse cx="160" cy="152" rx="22" ry="5"/><ellipse cx="258" cy="150" rx="18" ry="4"/>
</g>`,
  },
  {
    key: "summer", name: "なつ", usage: "7-8月",
    bg: "#0E5E8A", bg2: "#0A4668", ink: "#F0FAFF", sub: "#B4DCEF",
    accent: "#FFD836", edge: "#C79A00", onAccent: "#2B1A00",
    kicker: "なつ", heading: "こたえて、ひらこう。",
    sceneAlt: "入道雲と夏の日ざし",
    sceneSvg: `<path d="M0 150 Q40 120 80 148 T160 146 T240 150 T320 144 T360 152 L360 190 L0 190Z" fill="var(--t-bg2)"/>
<circle cx="298" cy="36" r="26" fill="var(--t-accent)"/>
<g stroke="var(--t-accent)" stroke-width="3" stroke-linecap="round" opacity=".7">
  <path d="M298 0v-0M262 36h-12M334 36h12M272 10l-8-8M324 62l8 8M324 10l8-8M272 62l-8 8"/>
</g>
<g fill="var(--t-ink)" opacity=".22">
  <circle cx="70" cy="60" r="26"/><circle cx="102" cy="48" r="32"/><circle cx="140" cy="62" r="24"/>
  <rect x="70" y="60" width="70" height="24"/>
</g>
<circle cx="164" cy="130" r="10" fill="var(--t-sub)" opacity=".9"/><rect x="156" y="141" width="16" height="24" rx="7" fill="var(--t-accent)"/><circle cx="210" cy="134" r="10" fill="var(--t-sub)" opacity=".9"/><rect x="202" y="145" width="16" height="24" rx="7" fill="var(--t-sub)"/><circle cx="254" cy="138" r="10" fill="var(--t-sub)" opacity=".9"/><rect x="246" y="149" width="16" height="24" rx="7" fill="var(--t-accent)"/>`,
  },
  {
    key: "festival", name: "なつまつり", usage: "8月・お祭り",
    bg: "#5B2140", bg2: "#40162D", ink: "#FFF2E8", sub: "#E8B49C",
    accent: "#FF8A3D", edge: "#C25A1C", onAccent: "#2B1A00",
    kicker: "なつまつり", heading: "今夜は、おまつり。",
    sceneAlt: "夏祭り。提灯と屋台と打ち上げ花火",
    sceneSvg: `<path d="M0 150 Q40 120 80 148 T160 146 T240 150 T320 144 T360 152 L360 190 L0 190Z" fill="var(--t-bg2)"/>
<g stroke="var(--t-sub)" stroke-width="2" opacity=".7"><path d="M0 26h360"/></g>
<g>
  <g fill="var(--t-accent)">
    <ellipse cx="34" cy="42" rx="13" ry="17"/><ellipse cx="106" cy="46" rx="13" ry="17"/>
    <ellipse cx="254" cy="46" rx="13" ry="17"/><ellipse cx="326" cy="42" rx="13" ry="17"/>
  </g>
  <g stroke="var(--t-bg2)" stroke-width="1.6" opacity=".6">
    <path d="M21 42h26M93 46h26M241 46h26M313 42h26"/>
  </g>
  <g fill="var(--t-bg2)">
    <rect x="30" y="24" width="8" height="4"/><rect x="102" y="28" width="8" height="4"/>
    <rect x="250" y="28" width="8" height="4"/><rect x="322" y="24" width="8" height="4"/>
  </g>
</g>
<g stroke="var(--t-ink)" stroke-width="2" stroke-linecap="round" opacity=".9">
  <g transform="translate(180,52)">
    <path d="M0-22V-9M0 22V9M-22 0H-9M22 0H9M-15-15l7 7M15 15l-7-7M15-15l-7 7M-15 15l7-7"/>
  </g>
</g>
<circle cx="180" cy="52" r="4.5" fill="var(--t-ink)"/>
<g>
  <rect x="120" y="104" width="120" height="10" rx="3" fill="var(--t-accent)"/>
  <rect x="126" y="114" width="108" height="30" rx="3" fill="var(--t-bg2)"/>
  <g fill="var(--t-accent)" opacity=".55">
    <rect x="120" y="96" width="20" height="8"/><rect x="160" y="96" width="20" height="8"/>
    <rect x="200" y="96" width="20" height="8"/>
  </g>
  <rect x="122" y="144" width="5" height="14" fill="var(--t-sub)"/>
  <rect x="233" y="144" width="5" height="14" fill="var(--t-sub)"/>
</g>
<circle cx="70" cy="124" r="10" fill="var(--t-sub)" opacity=".9"/><rect x="62" y="135" width="16" height="24" rx="7" fill="var(--t-accent)"/><circle cx="286" cy="128" r="10" fill="var(--t-sub)" opacity=".9"/><rect x="278" y="139" width="16" height="24" rx="7" fill="var(--t-sub)"/>`,
  },
  {
    key: "autumn", name: "あき", usage: "9-10月",
    bg: "#7A4318", bg2: "#5A3010", ink: "#FFF6EC", sub: "#E2BE96",
    accent: "#FFC24D", edge: "#C08A1F", onAccent: "#2B1A00",
    kicker: "あき", heading: "こたえて、ひらこう。",
    sceneAlt: "紅葉と落ち葉",
    sceneSvg: `<path d="M0 150 Q40 120 80 148 T160 146 T240 150 T320 144 T360 152 L360 190 L0 190Z" fill="var(--t-bg2)"/>
<g fill="var(--t-accent)" opacity=".9">
  <path d="M52 96l10-24 10 24 20-8-14 22 24 6-24 6 14 22-20-8-10 24-10-24-20 8 14-22-24-6 24-6-14-22z"/>
  <path d="M304 84l8-19 8 19 16-6-11 17 19 5-19 5 11 17-16-6-8 19-8-19-16 6 11-17-19-5 19-5-11-17z"/>
</g>
<g stroke="var(--t-sub)" stroke-width="3" opacity=".5" stroke-linecap="round">
  <path d="M62 122v30M312 106v34"/>
</g>
<g fill="var(--t-accent)" opacity=".6">
  <ellipse cx="130" cy="60" rx="7" ry="4.5" transform="rotate(30 130 60)"/>
  <ellipse cx="196" cy="40" rx="7" ry="4.5" transform="rotate(-22 196 40)"/>
  <ellipse cx="240" cy="72" rx="6" ry="4" transform="rotate(46 240 72)"/>
</g>
<circle cx="158" cy="130" r="10" fill="var(--t-sub)" opacity=".9"/><rect x="150" y="141" width="16" height="24" rx="7" fill="var(--t-accent)"/><circle cx="208" cy="134" r="10" fill="var(--t-sub)" opacity=".9"/><rect x="200" y="145" width="16" height="24" rx="7" fill="var(--t-sub)"/>`,
  },
  {
    key: "harvest", name: "みのり", usage: "10-11月・収穫",
    bg: "#5E4A1C", bg2: "#463612", ink: "#FDF7E6", sub: "#DFCE9C",
    accent: "#F0925E", edge: "#B05A28", onAccent: "#2B1A00",
    kicker: "みのり", heading: "たくさん 実りました。",
    sceneAlt: "実った稲穂と収穫",
    sceneSvg: `<path d="M0 150 Q40 120 80 148 T160 146 T240 150 T320 144 T360 152 L360 190 L0 190Z" fill="var(--t-bg2)"/>
<g stroke="var(--t-accent)" stroke-width="2.6" stroke-linecap="round" opacity=".95">
  <path d="M28 154v-44M44 154v-38M60 154v-46M300 154v-40M316 154v-46M332 154v-36"/>
</g>
<g fill="var(--t-accent)">
  <ellipse cx="28" cy="104" rx="5" ry="9"/><ellipse cx="44" cy="112" rx="5" ry="9"/>
  <ellipse cx="60" cy="102" rx="5" ry="9"/><ellipse cx="300" cy="108" rx="5" ry="9"/>
  <ellipse cx="316" cy="102" rx="5" ry="9"/><ellipse cx="332" cy="114" rx="5" ry="9"/>
</g>
<g><rect x="150" y="112" width="60" height="40" rx="5" fill="var(--t-sub)" opacity=".8"/>
   <rect x="144" y="104" width="72" height="12" rx="4" fill="var(--t-accent)"/>
   <circle cx="166" cy="130" r="8" fill="var(--t-accent)"/><circle cx="188" cy="134" r="7" fill="var(--t-accent)" opacity=".7"/>
</g>
<circle cx="100" cy="130" r="10" fill="var(--t-sub)" opacity=".9"/><rect x="92" y="141" width="16" height="24" rx="7" fill="var(--t-accent)"/><circle cx="258" cy="134" r="10" fill="var(--t-sub)" opacity=".9"/><rect x="250" y="145" width="16" height="24" rx="7" fill="var(--t-sub)"/>`,
  },
  {
    key: "winter", name: "ふゆ", usage: "12-1月",
    bg: "#2A3F6B", bg2: "#1C2C4E", ink: "#F3F7FF", sub: "#B4C4E2",
    accent: "#9FE0FF", edge: "#3E7FA0", onAccent: "#2B1A00",
    kicker: "ふゆ", heading: "しずかな 冬の夜に。",
    sceneAlt: "雪の日。降る結晶",
    sceneSvg: `<path d="M0 150 Q40 120 80 148 T160 146 T240 150 T320 144 T360 152 L360 190 L0 190Z" fill="var(--t-bg2)"/>
<g stroke="var(--t-accent)" stroke-width="2" stroke-linecap="round" opacity=".95">
  <g transform="translate(58,44)"><path d="M0-14V14M-14 0H14M-10-10l20 20M10-10l-20 20"/></g>
  <g transform="translate(302,34)"><path d="M0-11V11M-11 0H11M-8-8l16 16M8-8l-16 16"/></g>
  <g transform="translate(214,20)" opacity=".7"><path d="M0-8V8M-8 0H8M-6-6l12 12M6-6l-12 12"/></g>
</g>
<g fill="var(--t-accent)" opacity=".6">
  <circle cx="120" cy="60" r="3"/><circle cx="164" cy="34" r="2.4"/><circle cx="252" cy="66" r="3"/>
  <circle cx="94" cy="92" r="2.4"/><circle cx="278" cy="96" r="2.6"/>
</g>
<g fill="var(--t-ink)" opacity=".14"><ellipse cx="180" cy="150" rx="120" ry="10"/></g>
<circle cx="152" cy="130" r="10" fill="var(--t-sub)" opacity=".9"/><rect x="144" y="141" width="16" height="24" rx="7" fill="var(--t-accent)"/><circle cx="206" cy="134" r="10" fill="var(--t-sub)" opacity=".9"/><rect x="198" y="145" width="16" height="24" rx="7" fill="var(--t-sub)"/>`,
  },
  {
    key: "newyear", name: "おしょうがつ", usage: "1月",
    bg: "#8C1F2A", bg2: "#6A141D", ink: "#FFF4F0", sub: "#E8B4B0",
    accent: "#F2D06B", edge: "#B0912E", onAccent: "#2B1A00",
    kicker: "あけまして", heading: "ことしも、よろしく。",
    sceneAlt: "門松と初日の出",
    sceneSvg: `<path d="M0 150 Q40 120 80 148 T160 146 T240 150 T320 144 T360 152 L360 190 L0 190Z" fill="var(--t-bg2)"/>
<circle cx="180" cy="66" r="30" fill="var(--t-accent)"/>
<g stroke="var(--t-accent)" stroke-width="2.4" stroke-linecap="round" opacity=".55">
  <path d="M180 22v-8M136 66h-10M234 66h10M148 34l-6-6M212 98l6 6M212 34l6-6M148 98l-6 6"/>
</g>
<g>
  <g transform="translate(46,0)">
    <rect x="0" y="112" width="30" height="44" rx="3" fill="var(--t-sub)"/>
    <path d="M4 112l6-30M15 112V78M26 112l-6-30" stroke="var(--t-accent)" stroke-width="4" stroke-linecap="round"/>
    <rect x="-3" y="124" width="36" height="7" rx="3" fill="var(--t-accent)"/>
  </g>
  <g transform="translate(284,0)">
    <rect x="0" y="112" width="30" height="44" rx="3" fill="var(--t-sub)"/>
    <path d="M4 112l6-30M15 112V78M26 112l-6-30" stroke="var(--t-accent)" stroke-width="4" stroke-linecap="round"/>
    <rect x="-3" y="124" width="36" height="7" rx="3" fill="var(--t-accent)"/>
  </g>
</g>
<circle cx="150" cy="130" r="10" fill="var(--t-sub)" opacity=".9"/><rect x="142" y="141" width="16" height="24" rx="7" fill="var(--t-accent)"/><circle cx="206" cy="134" r="10" fill="var(--t-sub)" opacity=".9"/><rect x="198" y="145" width="16" height="24" rx="7" fill="var(--t-sub)"/>`,
  },
  {
    key: "night", name: "よる", usage: "特別・ボス部屋",
    bg: "#1B1030", bg2: "#120A22", ink: "#EFE8FA", sub: "#9C8FBC",
    accent: "#FFD836", edge: "#C79A00", onAccent: "#2B1A00",
    kicker: "SPECIAL", heading: "よるだけの、とくべつ。",
    sceneAlt: "夜。星空の下の小さな灯り",
    sceneSvg: `<path d="M0 150 Q40 120 80 148 T160 146 T240 150 T320 144 T360 152 L360 190 L0 190Z" fill="var(--t-bg2)"/>
<g fill="var(--t-accent)">
  <circle cx="48" cy="30" r="2.4"/><circle cx="106" cy="18" r="1.8"/><circle cx="164" cy="34" r="2"/>
  <circle cx="228" cy="20" r="2.4"/><circle cx="292" cy="36" r="1.8"/><circle cx="332" cy="22" r="2"/>
  <circle cx="76" cy="58" r="1.6"/><circle cx="262" cy="60" r="1.6"/>
</g>
<g>
  <circle cx="180" cy="88" r="26" fill="var(--t-accent)" opacity=".18"/>
  <circle cx="180" cy="88" r="14" fill="var(--t-accent)"/>
  <rect x="177" y="102" width="6" height="26" rx="3" fill="var(--t-sub)"/>
</g>
<circle cx="120" cy="126" r="10" fill="var(--t-sub)" opacity=".9"/><rect x="112" y="137" width="16" height="24" rx="7" fill="var(--t-accent)"/><circle cx="240" cy="130" r="10" fill="var(--t-sub)" opacity=".9"/><rect x="232" y="141" width="16" height="24" rx="7" fill="var(--t-sub)"/>`,
  },
  {
    key: "ocean", name: "うみ", usage: "夏の海・旅行",
    bg: "#0A5E6B", bg2: "#07454F", ink: "#EFFCFD", sub: "#A2D6DC",
    accent: "#FFCF5C", edge: "#C29524", onAccent: "#2B1A00",
    kicker: "うみ", heading: "夏の海へ、いこう。",
    sceneAlt: "海。波と小さな船",
    sceneSvg: `<path d="M0 118 Q30 106 60 118 T120 118 T180 118 T240 118 T300 118 T360 118 L360 190 L0 190Z" fill="var(--t-bg2)"/>
<path d="M0 138 Q30 128 60 138 T120 138 T180 138 T240 138 T300 138 T360 138 L360 190 L0 190Z" fill="var(--t-bg2)" opacity=".7"/>
<circle cx="300" cy="40" r="22" fill="var(--t-accent)"/>
<g>
  <path d="M140 108h80l-12 20h-56z" fill="var(--t-sub)"/>
  <path d="M178 108V64l34 30z" fill="var(--t-accent)"/>
  <rect x="176" y="58" width="4" height="52" rx="2" fill="var(--t-ink)" opacity=".8"/>
</g>
<g fill="var(--t-ink)" opacity=".28">
  <path d="M52 126c6-6 14-6 20 0M74 126c6-6 14-6 20 0M262 132c6-6 14-6 20 0"/>
</g>
<g fill="var(--t-accent)" opacity=".5">
  <circle cx="66" cy="96" r="4"/><circle cx="84" cy="86" r="3"/><circle cx="100" cy="94" r="2.4"/>
</g>`,
  },
  {
    key: "candy", name: "キャンディ", usage: "軽い企画・若年層",
    bg: "#63348A", bg2: "#472565", ink: "#FBF2FF", sub: "#D8BFEA",
    accent: "#FF9CC2", edge: "#C25E85", onAccent: "#2B1A00",
    kicker: "MISSION", heading: "きょうも、たのしく。",
    sceneAlt: "風船と紙吹雪",
    sceneSvg: `<path d="M0 150 Q40 120 80 148 T160 146 T240 150 T320 144 T360 152 L360 190 L0 190Z" fill="var(--t-bg2)"/>
<g>
  <ellipse cx="70" cy="52" rx="20" ry="24" fill="var(--t-accent)"/>
  <ellipse cx="300" cy="44" rx="17" ry="21" fill="var(--t-accent)" opacity=".8"/>
  <ellipse cx="252" cy="66" rx="13" ry="16" fill="var(--t-sub)"/>
  <g stroke="var(--t-sub)" stroke-width="1.8" opacity=".8" fill="none">
    <path d="M70 76q6 20-2 34M300 65q-6 18 2 30M252 82q5 14-1 24"/>
  </g>
</g>
<g fill="var(--t-accent)" opacity=".75">
  <rect x="118" y="30" width="7" height="10" rx="2" transform="rotate(24 118 30)"/>
  <rect x="196" y="20" width="7" height="10" rx="2" transform="rotate(-30 196 20)"/>
  <rect x="150" y="62" width="6" height="9" rx="2" transform="rotate(44 150 62)"/>
  <rect x="222" y="52" width="6" height="9" rx="2" transform="rotate(-16 222 52)"/>
</g>
<circle cx="160" cy="130" r="10" fill="var(--t-sub)" opacity=".9"/><rect x="152" y="141" width="16" height="24" rx="7" fill="var(--t-accent)"/><circle cx="206" cy="134" r="10" fill="var(--t-sub)" opacity=".9"/><rect x="198" y="145" width="16" height="24" rx="7" fill="var(--t-sub)"/>`,
  },
  {
    key: "mono", name: "モノトーン", usage: "真面目な調査",
    bg: "#2E3330", bg2: "#1E2220", ink: "#F5F7F6", sub: "#B4BEB9",
    accent: "#E8E2D2", edge: "#A79E88", onAccent: "#2B1A00",
    kicker: "MISSION", heading: "ご協力おねがいします。",
    sceneAlt: "落ち着いた図形と人",
    sceneSvg: `<path d="M0 150 Q40 120 80 148 T160 146 T240 150 T320 144 T360 152 L360 190 L0 190Z" fill="var(--t-bg2)"/>
<g fill="var(--t-sub)" opacity=".4">
  <rect x="30" y="86" width="52" height="68" rx="4"/>
  <rect x="286" y="98" width="46" height="56" rx="4"/>
</g>
<g stroke="var(--t-accent)" stroke-width="3" fill="none" opacity=".85">
  <circle cx="180" cy="56" r="22"/><path d="M158 56h44M180 34v44"/>
</g>
<circle cx="146" cy="130" r="10" fill="var(--t-sub)" opacity=".9"/><rect x="138" y="141" width="16" height="24" rx="7" fill="var(--t-accent)"/><circle cx="196" cy="134" r="10" fill="var(--t-sub)" opacity=".9"/><rect x="188" y="145" width="16" height="24" rx="7" fill="var(--t-sub)"/><circle cx="240" cy="138" r="10" fill="var(--t-sub)" opacity=".9"/><rect x="232" y="149" width="16" height="24" rx="7" fill="var(--t-accent)"/>`,
  },
  {
    key: "cheer", name: "おうえん", usage: "キャンペーン全般",
    bg: "#9E3225", bg2: "#7A241A", ink: "#FFF3F0", sub: "#F2C8C1",
    accent: "#FFD836", edge: "#C79A00", onAccent: "#2B1A00",
    kicker: "おうえん", heading: "みんなで、いこう。",
    sceneAlt: "応援の旗と声援",
    sceneSvg: `<path d="M0 150 Q40 120 80 148 T160 146 T240 150 T320 144 T360 152 L360 190 L0 190Z" fill="var(--t-bg2)"/>
<g>
  <rect x="52" y="60" width="4" height="94" rx="2" fill="var(--t-sub)"/>
  <path d="M56 62h56l-14 16 14 16H56z" fill="var(--t-accent)"/>
  <rect x="304" y="72" width="4" height="82" rx="2" fill="var(--t-sub)"/>
  <path d="M304 74h-48l12 14-12 14h48z" fill="var(--t-accent)"/>
</g>
<g fill="var(--t-ink)" opacity=".9">
  <rect x="142" y="52" width="30" height="21" rx="6"/><path d="M150 73l-3 8 10-8z"/>
  <rect x="196" y="44" width="30" height="21" rx="6"/><path d="M204 65l-3 8 10-8z"/>
</g>
<circle cx="150" cy="130" r="10" fill="var(--t-sub)" opacity=".9"/><rect x="142" y="141" width="16" height="24" rx="7" fill="var(--t-accent)"/><circle cx="196" cy="134" r="10" fill="var(--t-sub)" opacity=".9"/><rect x="188" y="145" width="16" height="24" rx="7" fill="var(--t-sub)"/><circle cx="242" cy="138" r="10" fill="var(--t-sub)" opacity=".9"/><rect x="234" y="149" width="16" height="24" rx="7" fill="var(--t-accent)"/>`,
  },
];

export const DEFAULT_THEME_KEY = "forest";

export function resolveMissionTheme(key: string | null | undefined): MissionTheme {
  return MISSION_THEMES.find((t) => t.key === key)
    ?? MISSION_THEMES.find((t) => t.key === DEFAULT_THEME_KEY)!;
}
