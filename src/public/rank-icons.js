/* ============================================================
 * rank-icons.js — ランクアイコンのインライン SVG ビルダー（LIFF 共有）
 *
 * window.RankIcons.badge(rankCode, tier, size)  … ブロンズ〜マスターの月桂冠／翼紋章
 * window.RankIcons.grandmaster(pos, size)        … グランドマスター #pos の白銀メダル
 *
 * 外部リクエストゼロ（CSP 安全）。gradient id はページ内で一意にするため連番。
 * デザインの正は artifact（月桂冠＝下位／金翼水晶＝マスター／白銀メダル＝GM）。
 * ============================================================ */
(function () {
  "use strict";

  var RANK_COLORS = {
    bronze:   { base: "#C77B3A", light: "#F0B978", dark: "#7A4A20" },
    silver:   { base: "#AEB8CC", light: "#EAF0FA", dark: "#6B7488" },
    gold:     { base: "#EFB50B", light: "#FBE07C", dark: "#9A7100" },
    platinum: { base: "#3FCBBA", light: "#A9F0E6", dark: "#1E7C72" },
    emerald:  { base: "#22B368", light: "#86E6B0", dark: "#127040" },
    diamond:  { base: "#5B9BF0", light: "#B7D6FB", dark: "#2C5FA8" },
    master:   { base: "#9A63E6", light: "#D3B6F7", dark: "#5C3390" }
  };
  var GOLD = { base: "#F5C64C", light: "#FDE9A6", dark: "#A9760F" };
  // 七宝（エナメル）の地色。金属リムを明るく、地を深くして紋章（金属色）を象嵌のように浮かせる。
  var ENAMEL = {
    bronze:   { mid: "#6A3D18", deep: "#331D0B" },
    silver:   { mid: "#3B4556", deep: "#212836" },
    gold:     { mid: "#5A4008", deep: "#2C1E03" },
    platinum: { mid: "#0F544C", deep: "#062E29" },
    emerald:  { mid: "#0F5533", deep: "#052E1B" },
    diamond:  { mid: "#1C477F", deep: "#0B2450" }
  };
  var LEAF = "M0 0 C 3.4 -2.4, 3.4 -8, 0 -11 C -3.4 -8, -3.4 -2.4, 0 0 Z";

  var _seq = 0;
  function uid() { return "rk" + (_seq++); }
  function polar(cx, cy, r, deg) { var a = deg * Math.PI / 180; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; }
  function gem(cx, cy, rx, ry) { return "M" + cx + " " + (cy - ry) + " L" + (cx + rx) + " " + cy + " L" + cx + " " + (cy + ry) + " L" + (cx - rx) + " " + cy + " Z"; }
  function star(cx, cy, r, inner) {
    inner = inner || r * 0.42; var p = "";
    for (var i = 0; i < 10; i++) { var rr = i % 2 ? inner : r; var a = -Math.PI / 2 + i * Math.PI / 5;
      p += (i ? "L" : "M") + (cx + rr * Math.cos(a)).toFixed(2) + " " + (cy + rr * Math.sin(a)).toFixed(2) + " "; }
    return p + "Z";
  }
  function sparkle(cx, cy, r, fill) { var s = r * 0.3;
    return "M" + cx + " " + (cy - r) + " C" + (cx + s) + " " + (cy - s) + " " + (cx + s) + " " + (cy - s) + " " + (cx + r) + " " + cy +
      " C" + (cx + s) + " " + (cy + s) + " " + (cx + s) + " " + (cy + s) + " " + cx + " " + (cy + r) +
      " C" + (cx - s) + " " + (cy + s) + " " + (cx - s) + " " + (cy + s) + " " + (cx - r) + " " + cy +
      " C" + (cx - s) + " " + (cy - s) + " " + (cx - s) + " " + (cy - s) + " " + cx + " " + (cy - r) + " Z";
  }
  function spark(cx, cy, r, fill) { return '<path d="' + sparkle(cx, cy, r, fill) + '" fill="' + fill + '"/>'; }

  // ── 月桂冠（ブロンズ〜ダイヤモンド）──
  function centerEmblem(r, tier, gid) {
    var cx = 32, cy = 34;
    if (tier === 1) {
      return '<circle cx="' + cx + '" cy="' + cy + '" r="8.4" fill="url(#' + gid + ')" stroke="' + r.dark + '" stroke-width="1.4"/>' +
        '<circle cx="' + cx + '" cy="' + cy + '" r="5.3" fill="none" stroke="#fff" stroke-width="1" opacity=".45"/>' +
        '<circle cx="' + cx + '" cy="' + cy + '" r="2.3" fill="#fff" opacity=".92"/>';
    }
    if (tier === 2) {
      return '<path d="' + gem(cx, cy, 9, 12) + '" fill="url(#' + gid + ')" stroke="' + r.dark + '" stroke-width="1.4" stroke-linejoin="round"/>' +
        '<path d="M' + cx + ' ' + (cy - 12) + ' L' + cx + ' ' + (cy + 12) + ' M' + (cx - 9) + ' ' + cy + ' L' + (cx + 9) + ' ' + cy + '" stroke="#fff" stroke-width=".8" opacity=".38"/>' +
        '<path d="' + gem(cx, cy, 4.4, 6) + '" fill="#fff" opacity=".28"/>';
    }
    var rays = "", d = [0, 90, 180, 270];
    for (var i = 0; i < d.length; i++) { var p = polar(cx, cy, 13.5, d[i] - 90);
      rays += '<path d="' + gem(p[0], p[1], 2.2, 4) + '" fill="' + r.light + '" stroke="' + r.dark + '" stroke-width=".6"/>'; }
    return '<circle cx="' + cx + '" cy="' + cy + '" r="13.5" fill="' + r.light + '" opacity=".18"/>' + rays +
      '<circle cx="' + cx + '" cy="' + cy + '" r="10.5" fill="url(#' + gid + ')" stroke="' + r.dark + '" stroke-width="1.5"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="7.3" fill="none" stroke="#fff" stroke-width="1" opacity=".4"/>' +
      '<path d="' + star(cx, cy, 6.4) + '" fill="#fff" opacity=".95"/>';
  }
  function wreathMarkup(r, N, A0, A1, rid) {
    var cx = 32, cy = 34, rad = 20, leaves = "", stems = "";
    var sides = [-1, 1];
    for (var s = 0; s < 2; s++) { var side = sides[s];
      var s0 = polar(cx, cy, rad, side < 0 ? A0 : 180 - A0), s1 = polar(cx, cy, rad, side < 0 ? A1 : 180 - A1);
      stems += '<path d="M ' + s0[0].toFixed(1) + " " + s0[1].toFixed(1) + " A " + rad + " " + rad + " 0 0 " + (side < 0 ? 1 : 0) + " " + s1[0].toFixed(1) + " " + s1[1].toFixed(1) + '" fill="none" stroke="' + r.dark + '" stroke-width="1.3" opacity=".5"/>';
      for (var i = 0; i < N; i++) { var t = i / (N - 1); var aDeg = A0 + t * (A1 - A0), radialDeg = aDeg;
        if (side === 1) { aDeg = 180 - aDeg; radialDeg = aDeg; }
        var pt = polar(cx, cy, rad, aDeg); var rot = radialDeg - 90 + side * 30; var sc = 1.18 - 0.5 * t;
        leaves += '<g transform="translate(' + pt[0].toFixed(1) + " " + pt[1].toFixed(1) + ") rotate(" + rot.toFixed(1) + ") scale(" + sc.toFixed(2) + ')">' +
          '<path d="' + LEAF + '" fill="url(#' + rid + ')" stroke="' + r.dark + '" stroke-width=".5"/>' +
          '<path d="M0 -1 L0 -9" stroke="' + r.light + '" stroke-width=".7" opacity=".45"/></g>';
      }
    }
    return stems + leaves;
  }
  function badgeWreath(r, tier, size) {
    var SPEC = { 1: { n: 5, a0: 130, a1: 228 }, 2: { n: 7, a0: 120, a1: 240 }, 3: { n: 9, a0: 110, a1: 250 } }[tier];
    var gid = uid(), rid = uid();
    return '<span class="rk-badge" style="line-height:0;display:inline-block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35)) drop-shadow(0 0 ' + (tier >= 3 ? 5 : 3) + 'px ' + r.base + '55)">' +
      '<svg viewBox="0 0 64 64" width="' + size + '" height="' + size + '"><defs>' +
      '<radialGradient id="' + gid + '" cx="36%" cy="30%" r="72%"><stop offset="0" stop-color="' + r.light + '"/><stop offset="1" stop-color="' + r.base + '"/></radialGradient>' +
      '<linearGradient id="' + rid + '" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="' + r.base + '"/><stop offset="1" stop-color="' + r.light + '"/></linearGradient>' +
      '</defs>' + wreathMarkup(r, SPEC.n, SPEC.a0, SPEC.a1, rid) + centerEmblem(r, tier, gid) + "</svg></span>";
  }

  // ── メダリオン（ブロンズ〜ダイヤ）──
  // 現行の月桂冠紋章（wreathMarkup + centerEmblem）はそのまま流用し、その周りに
  // 「鋳造された一枚」の器を与える：金属リム＋ミリング＋七宝地の窪み＋浮き彫りの陰影＋磨かれた光沢。
  // 小サイズ（<48px）ではミリング等の微細ディテールを省いて視認性を優先する。
  function badgeCoin(rankCode, tier, size) {
    var r = RANK_COLORS[rankCode] || RANK_COLORS.bronze;
    var en = ENAMEL[rankCode] || ENAMEL.bronze;
    var small = size < 48;
    var rimG = uid(), fldG = uid(), bevG = uid(), specG = uid(), gid = uid(), rid = uid();
    var SPEC = { 1: { n: 5, a0: 130, a1: 228 }, 2: { n: 7, a0: 120, a1: 240 }, 3: { n: 9, a0: 110, a1: 250 } }[tier];
    var wreathScale = small ? 0.9 : 0.82;
    var inner = '<g transform="translate(32 32) scale(' + wreathScale + ') translate(-32 -34)">' +
      wreathMarkup(r, SPEC.n, SPEC.a0, SPEC.a1, rid) + centerEmblem(r, tier, gid) + '</g>';
    var rim = '<circle cx="32" cy="32" r="30" fill="url(#' + rimG + ')" stroke="' + r.dark + '" stroke-width="' + (small ? 1.4 : 1.1) + '"/>';
    var reed = small ? '' :
      '<circle cx="32" cy="32" r="28.4" fill="none" stroke="' + r.dark + '" stroke-width="3.2" stroke-dasharray="1.1 3.05" opacity=".5"/>' +
      '<circle cx="32" cy="32" r="28.4" fill="none" stroke="' + r.light + '" stroke-width="1.5" stroke-dasharray="1.1 3.05" stroke-dashoffset="1.1" opacity=".55"/>';
    var bevel = '<circle cx="32" cy="32" r="' + (small ? 25.6 : 26.2) + '" fill="none" stroke="url(#' + bevG + ')" stroke-width="' + (small ? 2 : 2.4) + '"/>';
    var field = '<circle cx="32" cy="32" r="' + (small ? 24.2 : 24.6) + '" fill="url(#' + fldG + ')"/>';
    var vign = '<circle cx="32" cy="32" r="' + (small ? 24.2 : 24.6) + '" fill="none" stroke="#000" stroke-width="2.6" opacity=".18"/>';
    var spec = '<ellipse cx="32" cy="' + (small ? 22 : 21) + '" rx="' + (small ? 15 : 16) + '" ry="' + (small ? 7 : 8.5) + '" fill="url(#' + specG + ')"/>';
    var glow = (tier >= 3 && !small) ? '<circle cx="32" cy="32" r="31.4" fill="none" stroke="' + r.light + '" stroke-width="1" opacity=".55" stroke-dasharray="1 4"/>' : '';
    var defs = '<defs>' +
      '<linearGradient id="' + rimG + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + r.light + '"/><stop offset=".5" stop-color="' + r.base + '"/><stop offset="1" stop-color="' + r.dark + '"/></linearGradient>' +
      '<linearGradient id="' + bevG + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".85"/><stop offset=".5" stop-color="' + r.base + '" stop-opacity=".2"/><stop offset="1" stop-color="' + r.dark + '" stop-opacity=".9"/></linearGradient>' +
      '<radialGradient id="' + fldG + '" cx="46%" cy="34%" r="72%"><stop offset="0" stop-color="' + en.mid + '"/><stop offset="1" stop-color="' + en.deep + '"/></radialGradient>' +
      '<radialGradient id="' + specG + '" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fff" stop-opacity="' + (small ? .55 : .6) + '"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>' +
      '<radialGradient id="' + gid + '" cx="36%" cy="30%" r="72%"><stop offset="0" stop-color="' + r.light + '"/><stop offset="1" stop-color="' + r.base + '"/></radialGradient>' +
      '<linearGradient id="' + rid + '" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="' + r.base + '"/><stop offset="1" stop-color="' + r.light + '"/></linearGradient>' +
      '</defs>';
    var glowFilter = 'drop-shadow(0 2px 3px rgba(0,0,0,.5))' +
      (tier >= 2 ? ' drop-shadow(0 0 ' + (tier * 2.2) + 'px ' + r.base + (tier >= 3 ? '88' : '55') + ')' : ' drop-shadow(0 0 2px ' + r.base + '40)');
    return '<span class="rk-badge" style="line-height:0;display:inline-block;filter:' + glowFilter + '">' +
      '<svg viewBox="0 0 64 64" width="' + size + '" height="' + size + '">' + defs + rim + reed + bevel + field + vign + spec + inner + glow + "</svg></span>";
  }

  // ── 翼（マスター／GM 共通）──
  function blade(rootX, rootY, angleDeg, len, w, gid, dark) {
    var d = "M0 0 L" + (len * 0.62).toFixed(1) + " " + (-w * 0.5).toFixed(1) + " L" + len.toFixed(1) + " 0 L" + (len * 0.5).toFixed(1) + " " + (w * 0.55).toFixed(1) + " Z";
    return '<g transform="translate(' + rootX.toFixed(1) + " " + rootY.toFixed(1) + ") rotate(" + angleDeg.toFixed(1) + ')">' +
      '<path d="' + d + '" fill="url(#' + gid + ')" stroke="' + dark + '" stroke-width=".7" stroke-linejoin="round"/>' +
      '<path d="M0 0 L' + len.toFixed(1) + ' 0" stroke="#fff" stroke-width=".6" opacity=".35"/></g>';
  }
  function wing(cx, cy, side, blades, gid, dark, cfg) {
    cfg = cfg || {};
    var a0 = cfg.a0 == null ? -14 : cfg.a0, aSp = cfg.aSp == null ? 52 : cfg.aSp,
        l0 = cfg.l0 == null ? 27 : cfg.l0, lD = cfg.lD == null ? 11 : cfg.lD,
        w0 = cfg.w0 == null ? 8.5 : cfg.w0, wD = cfg.wD == null ? 3.2 : cfg.wD,
        dx = cfg.dx == null ? 3.5 : cfg.dx, dy = cfg.dy == null ? 4 : cfg.dy, dyD = cfg.dyD == null ? 2.5 : cfg.dyD;
    var s = "";
    for (var i = 0; i < blades; i++) {
      var t = blades > 1 ? i / (blades - 1) : 0;
      var ang = a0 - t * aSp, len = l0 - t * lD, w = w0 - t * wD;
      var rootX = cx + side * dx, rootY = cy + dy - t * dyD;
      var a = side > 0 ? ang : (-180 - ang);
      s += blade(rootX, rootY, a, len, w, gid, dark);
    }
    return s;
  }
  function crystal(cx, cy, halfW, topH, botH, gid, dark) {
    var sy = cy - topH * 0.32;
    var d = "M" + cx + " " + (cy - topH).toFixed(1) + " L" + (cx + halfW).toFixed(1) + " " + sy.toFixed(1) + " L" + cx + " " + (cy + botH).toFixed(1) + " L" + (cx - halfW).toFixed(1) + " " + sy.toFixed(1) + " Z";
    return '<path d="' + d + '" fill="url(#' + gid + ')" stroke="' + dark + '" stroke-width="1.3" stroke-linejoin="round"/>' +
      '<path d="M' + cx + " " + (cy - topH).toFixed(1) + " L" + cx + " " + (cy + botH).toFixed(1) + " M" + (cx - halfW).toFixed(1) + " " + sy.toFixed(1) + " L" + (cx + halfW).toFixed(1) + " " + sy.toFixed(1) + '" stroke="#fff" stroke-width=".7" opacity=".3"/>' +
      '<path d="M' + cx + " " + (cy - topH).toFixed(1) + " L" + (cx - halfW).toFixed(1) + " " + sy.toFixed(1) + " L" + cx + " " + (cy + botH).toFixed(1) + ' Z" fill="#fff" opacity=".13"/>';
  }

  // ── マスター（金翼の水晶紋章）──
  function badgeMaster(r, tier, size) {
    var cx = 32, cy = 33, wg = uid(), cg = uid(), ag = uid();
    var mainBlades = 2 + tier, auraR = 22 + tier * 3.5, halfW = 8.5 + tier * 0.6, topH = 15 + tier * 1.2;
    var aura = '<circle cx="' + cx + '" cy="' + cy + '" r="' + auraR + '" fill="url(#' + ag + ')"/>';
    var haloRing = tier >= 3 ? '<circle cx="' + cx + '" cy="' + cy + '" r="' + (auraR - 3) + '" fill="none" stroke="' + r.light + '" stroke-width="1" opacity=".28" stroke-dasharray="1 5"/>' : "";
    var wings = "";
    if (tier >= 2) { var uc = { a0: -2, aSp: 30, l0: 18, lD: 6, w0: 6, wD: 2, dx: 5, dy: 6, dyD: 1.5 };
      wings += wing(cx, cy, -1, tier, wg, GOLD.dark, uc) + wing(cx, cy, 1, tier, wg, GOLD.dark, uc); }
    wings += wing(cx, cy, -1, mainBlades, wg, GOLD.dark) + wing(cx, cy, 1, mainBlades, wg, GOLD.dark);
    var spire = '<path d="M' + cx + " " + (cy - 27) + " L" + (cx + 3.2) + " " + (cy - 17) + " L" + cx + " " + (cy - 19.5) + " L" + (cx - 3.2) + " " + (cy - 17) + ' Z" fill="url(#' + wg + ')" stroke="' + GOLD.dark + '" stroke-width=".7" stroke-linejoin="round"/>';
    var crest = tier >= 3 ? '<path d="M' + (cx - 6) + " " + (cy - 24) + " L" + (cx - 3.5) + " " + (cy - 32) + " L" + cx + " " + (cy - 25.5) + " L" + (cx + 3.5) + " " + (cy - 32) + " L" + (cx + 6) + " " + (cy - 24) + ' Z" fill="url(#' + wg + ')" stroke="' + GOLD.dark + '" stroke-width=".7" stroke-linejoin="round"/><circle cx="' + (cx - 3.5) + '" cy="' + (cy - 32) + '" r="1.3" fill="#fff"/><circle cx="' + (cx + 3.5) + '" cy="' + (cy - 32) + '" r="1.3" fill="#fff"/>' : "";
    var gems = "";
    if (tier >= 2) { var gx = auraR * 0.6, gy = cy + 1;
      gems += '<path d="' + gem(cx - gx, gy, 2.6, 3.9) + '" fill="url(#' + cg + ')" stroke="' + GOLD.dark + '" stroke-width=".7"/>' +
        '<path d="' + gem(cx + gx, gy, 2.6, 3.9) + '" fill="url(#' + cg + ')" stroke="' + GOLD.dark + '" stroke-width=".7"/>'; }
    var body = crystal(cx, cy, halfW, topH, topH, cg, GOLD.dark) + spark(cx, cy - 2.5, 3.2 + tier * 0.35, "#fff");
    var glints = "";
    if (tier >= 2) glints += spark(cx + auraR * 0.74, cy - auraR * 0.5, 2.8, "#fff") + spark(cx - auraR * 0.56, cy + auraR * 0.72, 2, "#fff");
    if (tier >= 3) glints += spark(cx - auraR * 0.74, cy - auraR * 0.42, 2.4, "#fff") + spark(cx + auraR * 0.36, cy + auraR * 0.82, 2, "#fff") + spark(cx, cy - auraR * 0.94, 2.4, "#fff");
    return '<span class="rk-badge" style="line-height:0;display:inline-block;filter:drop-shadow(0 1px 3px rgba(0,0,0,.45)) drop-shadow(0 0 ' + (5 + tier * 2.5) + 'px ' + r.base + '88)">' +
      '<svg viewBox="-12 -17 88 92" width="' + size + '" height="' + size + '"><defs>' +
      '<linearGradient id="' + wg + '" x1="0" y1="0" x2=".4" y2="1"><stop offset="0" stop-color="' + GOLD.light + '"/><stop offset=".5" stop-color="' + GOLD.base + '"/><stop offset="1" stop-color="' + GOLD.dark + '"/></linearGradient>' +
      '<linearGradient id="' + cg + '" x1="0" y1="0" x2=".5" y2="1"><stop offset="0" stop-color="' + r.light + '"/><stop offset=".55" stop-color="' + r.base + '"/><stop offset="1" stop-color="' + r.dark + '"/></linearGradient>' +
      '<radialGradient id="' + ag + '" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="' + r.light + '" stop-opacity="' + (tier === 3 ? .55 : tier === 2 ? .42 : .32) + '"/><stop offset=".6" stop-color="' + r.base + '" stop-opacity=".1"/><stop offset="1" stop-color="' + r.base + '" stop-opacity="0"/></radialGradient>' +
      '</defs>' + aura + haloRing + wings + crest + spire + gems + body + glints + "</svg></span>";
  }

  // ── グランドマスター（白銀の順位メダル）──
  function badgeGrandmaster(pos, size) {
    var cx = 32, cy = 33, wg = uid(), cg = uid(), ag = uid(), pg = uid();
    var SIL = { light: "#F8FAFE", base: "#CCD4E1", dark: "#828C9E" };
    var CORE = { light: "#FFFFFF", base: "#EAEEF5", dark: "#B6BECC" };
    var lv = pos === 1 ? 3 : pos <= 3 ? 2 : pos <= 6 ? 1 : 0;
    var blades = 3 + lv, auraR = 24 + lv * 3, ri = 12.5;
    var prism = pos === 1 ? '<circle cx="' + cx + '" cy="' + cy + '" r="' + (auraR + 4) + '" fill="url(#' + pg + ')"/>' : "";
    var aura = '<circle cx="' + cx + '" cy="' + cy + '" r="' + auraR + '" fill="url(#' + ag + ')"/>';
    var haloRing = lv >= 2 ? '<circle cx="' + cx + '" cy="' + cy + '" r="' + (auraR - 2) + '" fill="none" stroke="#fff" stroke-width="1" opacity=".32" stroke-dasharray="1 5"/>' : "";
    var wings = "";
    if (lv >= 2) { var uc = { a0: -2, aSp: 30, l0: 18, lD: 6, w0: 6, wD: 2, dx: 5, dy: 6, dyD: 1.5 };
      wings += wing(cx, cy, -1, lv, wg, SIL.dark, uc) + wing(cx, cy, 1, lv, wg, SIL.dark, uc); }
    wings += wing(cx, cy, -1, blades, wg, SIL.dark) + wing(cx, cy, 1, blades, wg, SIL.dark);
    var crest = '<path d="M' + (cx - 7.5) + " " + (cy - 13) + " L" + (cx - 4) + " " + (cy - 24) + " L" + cx + " " + (cy - 15) + " L" + (cx + 4) + " " + (cy - 24) + " L" + (cx + 7.5) + " " + (cy - 13) + ' Z" fill="url(#' + wg + ')" stroke="' + SIL.dark + '" stroke-width=".8" stroke-linejoin="round"/><circle cx="' + (cx - 4) + '" cy="' + (cy - 24) + '" r="1.4" fill="' + GOLD.base + '"/><circle cx="' + (cx + 4) + '" cy="' + (cy - 24) + '" r="1.4" fill="' + GOLD.base + '"/>';
    var tail = '<path d="M' + (cx - 5.5) + " " + (cy + 11) + " L" + cx + " " + (cy + 23) + " L" + (cx + 5.5) + " " + (cy + 11) + ' Z" fill="url(#' + wg + ')" stroke="' + SIL.dark + '" stroke-width=".8" stroke-linejoin="round"/>';
    var num = String(pos);
    var medal = '<circle cx="' + cx + '" cy="' + cy + '" r="' + ri + '" fill="url(#' + cg + ')" stroke="url(#' + wg + ')" stroke-width="2.6"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + (ri - 0.7).toFixed(1) + '" fill="none" stroke="' + GOLD.base + '" stroke-width=".9" opacity=".75"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + (ri - 3).toFixed(1) + '" fill="none" stroke="' + SIL.dark + '" stroke-width=".8" opacity=".45"/>' +
      '<text x="' + cx + '" y="' + (cy + 0.5).toFixed(1) + '" text-anchor="middle" dominant-baseline="central" font-family="-apple-system,Helvetica,sans-serif" font-weight="900" font-size="' + (num.length > 1 ? 13 : 17) + '" fill="#3D4658">' + num + "</text>";
    var glints = spark(cx + auraR * 0.66, cy - auraR * 0.42, 3, "#fff") + spark(cx - auraR * 0.66, cy - auraR * 0.36, 2.4, "#fff");
    if (lv >= 2) glints += spark(cx + auraR * 0.5, cy + auraR * 0.62, 2.6, "#fff");
    if (pos === 1) glints += spark(cx - auraR * 0.55, cy + auraR * 0.55, 2.4, "#fff") + spark(cx, cy - auraR * 0.95, 2.6, "#fff");
    return '<span class="rk-badge" style="line-height:0;display:inline-block;filter:drop-shadow(0 2px 4px rgba(0,0,0,.32)) drop-shadow(0 0 ' + (6 + lv * 3) + 'px #E7ECF5)">' +
      '<svg viewBox="-12 -15 88 92" width="' + size + '" height="' + size + '"><defs>' +
      '<linearGradient id="' + wg + '" x1="0" y1="0" x2=".4" y2="1"><stop offset="0" stop-color="' + SIL.light + '"/><stop offset=".5" stop-color="' + SIL.base + '"/><stop offset="1" stop-color="' + SIL.dark + '"/></linearGradient>' +
      '<radialGradient id="' + cg + '" cx="38%" cy="30%" r="72%"><stop offset="0" stop-color="' + CORE.light + '"/><stop offset=".6" stop-color="' + CORE.base + '"/><stop offset="1" stop-color="' + CORE.dark + '"/></radialGradient>' +
      '<radialGradient id="' + ag + '" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#FFFFFF" stop-opacity="' + (.4 + lv * .1).toFixed(2) + '"/><stop offset=".55" stop-color="#DCE3F0" stop-opacity=".14"/><stop offset="1" stop-color="#DCE3F0" stop-opacity="0"/></radialGradient>' +
      '<radialGradient id="' + pg + '" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".7" stop-color="#EAD9FF" stop-opacity=".2"/><stop offset=".86" stop-color="#D9F0EC" stop-opacity=".16"/><stop offset="1" stop-color="#FBE7F0" stop-opacity="0"/></radialGradient>' +
      '</defs>' + prism + aura + haloRing + wings + crest + tail + medal + glints + "</svg></span>";
  }

  window.RankIcons = {
    colors: RANK_COLORS,
    badge: function (rankCode, tier, size) {
      var r = RANK_COLORS[rankCode] || RANK_COLORS.bronze;
      tier = (tier === 1 || tier === 2 || tier === 3) ? tier : 1;
      size = size || 64;
      // ブロンズ〜ダイヤはメダリオン（badgeCoin）、マスターは金翼水晶。
      return rankCode === "master" ? badgeMaster(r, tier, size) : badgeCoin(rankCode, tier, size);
    },
    // 旧・月桂冠（枠なし）も明示的に呼びたい場合のために残す。
    wreath: function (rankCode, tier, size) {
      var r = RANK_COLORS[rankCode] || RANK_COLORS.bronze;
      tier = (tier === 1 || tier === 2 || tier === 3) ? tier : 1;
      return badgeWreath(r, tier, size || 64);
    },
    grandmaster: function (pos, size) { return badgeGrandmaster(pos, size || 64); }
  };
})();
