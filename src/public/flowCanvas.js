/* =============================================
   Flow Designer Canvas Logic  (v2)
   ============================================= */
(function () {
  'use strict';

  /** @type {{ projectId: string, project: object, questions: object[], pageGroups: object[] }} */
  const DATA = window.FLOW_DESIGNER_DATA;
  if (!DATA) return;

  // ─── State ────────────────────────────────────
  let questions = DATA.questions.slice().sort(function (a, b) { return a.sort_order - b.sort_order; });
  let pageGroups = DATA.pageGroups || [];
  let selectedId = null;
  let nodePositions = {}; // { [id]: {x, y} }
  let zoom = 1;
  let activeRpTab = 'basic';

  // Node drag state
  let dragState = null; // { nodeId, startClientX, startClientY, startNodeX, startNodeY, moved }

  // Connection drag state
  let connDrag = null; // { fromId, branchKey, startX, startY }

  // Selected connection { fromId, toId, branchKey }
  let selectedConn = null;

  // AI suggestion cache { questionId: suggestions }
  let aiSuggestionCache = {};

  // Layout constants
  const NODE_W = 220;
  const NODE_GAP_Y = 56;
  const COL_X = 60;
  const ROW_START_Y = 50;
  const START_NODE_H = 60;
  const NODE_APPROX_H = 100;
  const DIAMOND_W = 200;
  const DIAMOND_H = 140;

  // DOM refs (set after DOMContentLoaded)
  let $canvas, $svg, $rightPanel, $statusText, $canvasWrapper;

  // Temp SVG for drag line
  let $connDragSvg = null;

  // ─── Boot ─────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    $canvas       = document.getElementById('flowCanvas');
    $svg          = document.getElementById('flowSvg');
    $rightPanel   = document.getElementById('rightPanel');
    $statusText   = document.getElementById('flowStatusText');
    $canvasWrapper = document.getElementById('canvasWrapper');

    // Create overlay SVG for drag preview
    $connDragSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    $connDragSvg.id = 'connDragSvg';
    document.body.appendChild($connDragSvg);

    computeInitialPositions();
    renderAll();
    bindToolbar();
    bindLeftPanel();
    bindCanvasBackground();
    bindKeyboard();
    showRightPanelEmpty();
  });

  // ─── Position computation ──────────────────────
  function computeInitialPositions() {
    nodePositions['__start__'] = { x: COL_X, y: ROW_START_Y };

    let y = ROW_START_Y + START_NODE_H + NODE_GAP_Y;
    for (var i = 0; i < questions.length; i++) {
      var q = questions[i];
      if (!nodePositions[q.id]) {
        nodePositions[q.id] = { x: COL_X, y: y };
      }
      y += (isBranchNode(q) ? DIAMOND_H : NODE_APPROX_H) + NODE_GAP_Y;
    }
    nodePositions['__end__'] = { x: COL_X, y: y };
  }

  function recalcEndPosition() {
    var sorted = questions.slice().sort(function (a, b) { return a.sort_order - b.sort_order; });
    if (sorted.length === 0) {
      nodePositions['__end__'] = { x: COL_X, y: ROW_START_Y + START_NODE_H + NODE_GAP_Y };
      return;
    }
    var lastId = sorted[sorted.length - 1].id;
    var lastEl = document.getElementById('node-' + lastId);
    var lastPos = nodePositions[lastId] || { x: COL_X, y: ROW_START_Y };
    var lastH = lastEl ? lastEl.offsetHeight : NODE_APPROX_H;
    nodePositions['__end__'] = { x: COL_X, y: lastPos.y + lastH + NODE_GAP_Y };
  }

  // ─── Helpers ──────────────────────────────────
  function isBranchNode(q) {
    var branchRule = (q.branch_rule && !Array.isArray(q.branch_rule)) ? q.branch_rule : {};
    return (branchRule.branches || []).length > 0;
  }

  function makeEl(tag, cls) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    return el;
  }

  function createSvgEl(tag) {
    return document.createElementNS('http://www.w3.org/2000/svg', tag);
  }

  function on(id, event, fn) {
    var el = document.getElementById(id);
    if (el) el.addEventListener(event, fn);
  }

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function getTypeLabel(type) {
    var map = {
      'text':'テキスト', 'single_select':'単一選択', 'multi_select':'複数選択',
      'yes_no':'はい/いいえ', 'scale':'スケール',
      'single_choice':'単一選択', 'multi_choice':'複数選択',
      'free_text_short':'短文', 'free_text_long':'長文', 'numeric':'数値',
      'matrix_single':'マトリクス', 'matrix_multi':'マトリクス(複)', 'matrix_mixed':'マトリクス(混)',
      'image_upload':'画像', 'hidden_single':'隠し', 'hidden_multi':'隠し複',
      'text_with_image':'テキスト+画像', 'sd':'SD法',
    };
    return map[type] || type;
  }

  function buildSelect(id, opts, selected) {
    return '<select id="' + id + '">' +
      opts.map(function (o) {
        return '<option value="' + esc(o) + '"' + (selected === o ? ' selected' : '') + '>' + esc(o) + '</option>';
      }).join('') +
      '</select>';
  }

  function getNodeBox(nodeId) {
    var el = document.getElementById('node-' + nodeId);
    if (!el) return null;
    return {
      x: parseInt(el.style.left, 10) || 0,
      y: parseInt(el.style.top,  10) || 0,
      w: el.offsetWidth  || NODE_W,
      h: el.offsetHeight || NODE_APPROX_H,
    };
  }

  // ─── Render ───────────────────────────────────
  function renderAll() {
    renderGroupBoxes();
    renderNodes();
    setTimeout(function () {
      recalcEndPosition();
      updateEndNodePosition();
      renderConnections();
      updateCanvasSize();
    }, 0);
  }

  // ─── Group boxes (page_group) ─────────────────
  function renderGroupBoxes() {
    // Remove existing
    $canvas.querySelectorAll('.group-box').forEach(function (el) { el.remove(); });

    var groups = {}; // { pageGroupId|'__unassigned__': { label, ids[] } }

    questions.forEach(function (q) {
      var gid = q.page_group_id || '__unassigned__';
      if (!groups[gid]) {
        if (gid === '__unassigned__') {
          groups[gid] = { label: '未分類', ids: [], isUnassigned: true };
        } else {
          var pg = pageGroups.find(function (p) { return p.id === gid; });
          var label = pg ? (pg.title || 'ページ ' + pg.page_number) : gid.slice(0, 8);
          groups[gid] = { label: label, ids: [], isUnassigned: false };
        }
      }
      groups[gid].ids.push(q.id);
    });

    // Only show groups that have > 0 questions
    Object.keys(groups).forEach(function (gid) {
      var group = groups[gid];
      if (group.ids.length === 0) return;

      // Compute bounding box
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      group.ids.forEach(function (id) {
        var pos = nodePositions[id];
        if (!pos) return;
        var q = questions.find(function (x) { return x.id === id; });
        var w = isBranchNode(q) ? DIAMOND_W : NODE_W;
        var h = isBranchNode(q) ? DIAMOND_H : NODE_APPROX_H;
        if (pos.x < minX) minX = pos.x;
        if (pos.y < minY) minY = pos.y;
        if (pos.x + w > maxX) maxX = pos.x + w;
        if (pos.y + h > maxY) maxY = pos.y + h;
      });

      if (minX === Infinity) return;

      var pad = 20;
      var box = makeEl('div', 'group-box' + (group.isUnassigned ? ' group-unassigned' : ''));
      box.style.left   = (minX - pad) + 'px';
      box.style.top    = (minY - pad) + 'px';
      box.style.width  = (maxX - minX + pad * 2) + 'px';
      box.style.height = (maxY - minY + pad * 2) + 'px';

      var lbl = makeEl('div', 'group-box-label');
      lbl.textContent = group.label;
      box.appendChild(lbl);

      $canvas.insertBefore(box, $canvas.firstChild);
    });
  }

  function renderNodes() {
    $canvas.querySelectorAll('.flow-node').forEach(function (n) { n.remove(); });
    renderStartNode();
    var sorted = questions.slice().sort(function (a, b) { return a.sort_order - b.sort_order; });
    sorted.forEach(function (q) { renderQuestionNode(q); });
    renderEndNode();
  }

  function renderStartNode() {
    var pos = nodePositions['__start__'] || { x: COL_X, y: ROW_START_Y };
    var el = makeEl('div', 'flow-node node-start');
    el.id = 'node-__start__';
    el.style.left  = pos.x + 'px';
    el.style.top   = pos.y + 'px';
    el.style.width = NODE_W + 'px';
    el.innerHTML =
      '<div class="node-handle node-handle-out" data-handle-out="__start__"></div>' +
      '<div class="node-header">' +
        '<span class="node-type-badge" style="background:#c8f0e0;color:#0a5a3a">START</span>' +
      '</div>' +
      '<div class="node-text" style="color:#0a5a3a">開始</div>';
    el.addEventListener('click', function () { selectNode('__start__'); });
    $canvas.appendChild(el);
  }

  function renderEndNode() {
    var pos = nodePositions['__end__'] || { x: COL_X, y: 400 };
    var existing = document.getElementById('node-__end__');
    if (existing) existing.remove();

    var el = makeEl('div', 'flow-node node-end');
    el.id = 'node-__end__';
    el.style.left  = pos.x + 'px';
    el.style.top   = pos.y + 'px';
    el.style.width = NODE_W + 'px';
    el.innerHTML =
      '<div class="node-handle node-handle-in" data-handle-in="__end__"></div>' +
      '<div class="node-header">' +
        '<span class="node-type-badge" style="background:#fcd8c8;color:#7a3020">END</span>' +
      '</div>' +
      '<div class="node-text" style="color:#7a3020">終了</div>';
    el.addEventListener('click', function () { selectNode('__end__'); });
    $canvas.appendChild(el);
  }

  function updateEndNodePosition() {
    var el = document.getElementById('node-__end__');
    if (!el) return;
    var pos = nodePositions['__end__'];
    if (!pos) return;
    el.style.left = pos.x + 'px';
    el.style.top  = pos.y + 'px';
  }

  function renderQuestionNode(q) {
    var pos = nodePositions[q.id] || { x: COL_X, y: 100 };
    var branchRule = (q.branch_rule && !Array.isArray(q.branch_rule)) ? q.branch_rule : {};
    var branchCount = (branchRule.branches || []).length;
    var isConnected = isNodeConnected(q);

    if (branchCount > 0) {
      renderDiamondNode(q, pos, branchRule, branchCount, isConnected);
    } else {
      renderRectNode(q, pos, branchRule, isConnected);
    }
  }

  function isNodeConnected(q) {
    // A node is considered connected if something points to it OR it has explicit next
    var branchRule = (q.branch_rule && !Array.isArray(q.branch_rule)) ? q.branch_rule : {};
    if (branchRule.default_next) return true;
    if ((branchRule.branches || []).length > 0) return true;
    // Check if previous sequential node exists
    var sorted = questions.slice().sort(function (a, b) { return a.sort_order - b.sort_order; });
    var idx = sorted.findIndex(function (x) { return x.id === q.id; });
    if (idx > 0 && !isBranchNode(sorted[idx - 1])) return true;
    if (idx === 0) return true; // START → first question always connected
    return false;
  }

  function renderRectNode(q, pos, branchRule, isConnected) {
    var cls = 'flow-node' +
      (q.ai_probe_enabled ? ' node-ai' : '') +
      (selectedId === q.id ? ' selected' : '') +
      (isConnected ? '' : ' node-unconnected');

    var el = makeEl('div', cls);
    el.id = 'node-' + q.id;
    el.style.left  = pos.x + 'px';
    el.style.top   = pos.y + 'px';
    el.style.width = NODE_W + 'px';

    var typeLabel = getTypeLabel(q.question_type);
    var textPreview = q.question_text.length > 55 ? q.question_text.slice(0, 55) + '…' : q.question_text;

    var badgesHtml =
      (q.is_required ? '<span class="node-badge required">必須</span>' : '') +
      (q.ai_probe_enabled ? '<span class="node-badge ai">AI深掘</span>' : '') +
      (q.answer_options_locked ? '<span class="node-badge locked">選択肢固定</span>' : '') +
      (branchRule.default_next ? '<span class="node-badge">→' + esc(branchRule.default_next) + '</span>' : '');

    el.innerHTML =
      '<div class="node-handle node-handle-in" data-handle-in="' + q.id + '"></div>' +
      '<div class="node-header">' +
        '<span class="node-code">' + esc(q.question_code) + '</span>' +
        '<span class="node-type-badge">' + esc(typeLabel) + '</span>' +
        '<span class="node-order">#' + q.sort_order + '</span>' +
      '</div>' +
      '<div class="node-text">' + esc(textPreview) + '</div>' +
      '<div class="node-meta">' + badgesHtml + '</div>' +
      '<div class="node-handle node-handle-out" data-handle-out="' + q.id + '"></div>';

    el.addEventListener('click', function (e) {
      if (dragState && dragState.moved) return;
      if (connDrag) return;
      selectNode(q.id);
    });
    el.addEventListener('mousedown', function (e) { startNodeDrag(e, q.id); });

    // Handle events
    var handleOut = el.querySelector('[data-handle-out]');
    if (handleOut) {
      handleOut.addEventListener('mousedown', function (e) {
        e.stopPropagation();
        startConnDrag(e, q.id, 'default');
      });
    }
    var handleIn = el.querySelector('[data-handle-in]');
    if (handleIn) {
      handleIn.addEventListener('mouseenter', function () {
        if (connDrag && connDrag.fromId !== q.id) handleIn.classList.add('drag-target');
      });
      handleIn.addEventListener('mouseleave', function () {
        handleIn.classList.remove('drag-target');
      });
    }

    $canvas.appendChild(el);
  }

  function renderDiamondNode(q, pos, branchRule, branchCount, isConnected) {
    var cls = 'flow-node node-branch' +
      (selectedId === q.id ? ' selected' : '') +
      (isConnected ? '' : ' node-unconnected');

    var el = makeEl('div', cls);
    el.id = 'node-' + q.id;
    el.style.left   = pos.x + 'px';
    el.style.top    = pos.y + 'px';
    el.style.width  = DIAMOND_W + 'px';
    el.style.height = DIAMOND_H + 'px';

    var textPreview = q.question_text.length > 25 ? q.question_text.slice(0, 25) + '…' : q.question_text;

    // Build branch output handles (right side for each branch)
    var branchHandles = (branchRule.branches || []).map(function (b, i) {
      var label = getBranchLabel(b);
      var topPct = (i + 1) / (branchCount + 1);
      var topPx = Math.round(topPct * DIAMOND_H);
      return '<div class="node-handle node-handle-out" style="bottom:auto;left:' + (DIAMOND_W - 4) + 'px;top:' + topPx + 'px;transform:none;" ' +
             'data-handle-out="' + q.id + '" data-branch-key="branch_' + i + '" title="' + esc(label || '分岐' + (i+1)) + '"></div>';
    }).join('');

    el.innerHTML =
      '<div class="node-diamond-bg"></div>' +
      '<div class="node-handle node-handle-in" data-handle-in="' + q.id + '"></div>' +
      // bottom tip = default out
      '<div class="node-handle node-handle-out" style="top:113px;left:93px;bottom:auto;transform:none;" data-handle-out="' + q.id + '" data-branch-key="default" title="デフォルト遷移"></div>' +
      branchHandles +
      '<div class="node-diamond-content">' +
        '<span class="node-code">' + esc(q.question_code) + '</span>' +
        '<div class="node-text">' + esc(textPreview) + '</div>' +
        '<div class="node-meta"><span class="node-badge branch">' + branchCount + '分岐</span>' +
          (q.answer_options_locked ? '<span class="node-badge locked">固定</span>' : '') +
        '</div>' +
      '</div>';

    el.addEventListener('click', function (e) {
      if (dragState && dragState.moved) return;
      if (connDrag) return;
      selectNode(q.id);
    });
    el.addEventListener('mousedown', function (e) { startNodeDrag(e, q.id); });

    // Handle events
    el.querySelectorAll('[data-handle-out]').forEach(function (handleOut) {
      handleOut.addEventListener('mousedown', function (e) {
        e.stopPropagation();
        var bkey = handleOut.getAttribute('data-branch-key') || 'default';
        startConnDrag(e, q.id, bkey);
      });
    });

    var handleIn = el.querySelector('[data-handle-in]');
    if (handleIn) {
      handleIn.addEventListener('mouseenter', function () {
        if (connDrag && connDrag.fromId !== q.id) handleIn.classList.add('drag-target');
      });
      handleIn.addEventListener('mouseleave', function () {
        handleIn.classList.remove('drag-target');
      });
    }

    $canvas.appendChild(el);
  }

  // ─── Connections (SVG arrows) ──────────────────
  function renderConnections() {
    while ($svg.firstChild) $svg.removeChild($svg.firstChild);

    var defs = createSvgEl('defs');
    $svg.appendChild(defs);

    var sorted = questions.slice().sort(function (a, b) { return a.sort_order - b.sort_order; });

    // START → first question (or END)
    if (sorted.length > 0) {
      drawArrow(defs, '__start__', sorted[0].id, '', '#6abfa0', false, null);
    } else {
      drawArrow(defs, '__start__', '__end__', '', '#6abfa0', false, null);
    }

    for (var i = 0; i < sorted.length; i++) {
      var q = sorted[i];
      var branchRule = (q.branch_rule && !Array.isArray(q.branch_rule)) ? q.branch_rule : {};
      var branches = branchRule.branches || [];

      // Conditional branches (orange)
      for (var bi = 0; bi < branches.length; bi++) {
        var branch = branches[bi];
        if (!branch.next) continue;
        var label = getBranchLabel(branch);
        var connId = q.id + ':branch_' + bi;
        if (branch.next === 'END') {
          drawArrow(defs, q.id, '__end__', label, '#dda020', true, connId);
        } else {
          var targetQ = questions.find(function (x) { return x.question_code === branch.next; });
          if (targetQ) drawArrow(defs, q.id, targetQ.id, label, '#dda020', true, connId);
        }
      }

      // Default next / sequential
      if (branchRule.default_next) {
        var defConnId = q.id + ':default';
        if (branchRule.default_next === 'END') {
          drawArrow(defs, q.id, '__end__', 'default', '#2ca87a', false, defConnId);
        } else {
          var defQ = questions.find(function (x) { return x.question_code === branchRule.default_next; });
          if (defQ) drawArrow(defs, q.id, defQ.id, 'default', '#2ca87a', false, defConnId);
        }
      } else if (branches.length === 0) {
        // Sequential
        var nextQ = sorted[i + 1];
        var seqConnId = q.id + ':seq';
        if (nextQ) {
          drawArrow(defs, q.id, nextQ.id, '', '#aec8c4', false, seqConnId);
        } else {
          drawArrow(defs, q.id, '__end__', '', '#aec8c4', false, seqConnId);
        }
      }
    }
  }

  function drawArrow(defs, fromId, toId, label, color, isDashed, connId) {
    var fromBox = getNodeBox(fromId);
    var toBox   = getNodeBox(toId);
    if (!fromBox || !toBox) return;

    var isSelected = selectedConn && selectedConn.connId === connId;
    var markerId = 'mk-' + (fromId + toId + (connId || '')).replace(/\W/g, '') + '-' + (Math.random() * 1e6 | 0);

    // Arrowhead
    var marker = createSvgEl('marker');
    marker.setAttribute('id', markerId);
    marker.setAttribute('markerWidth', '7');
    marker.setAttribute('markerHeight', '7');
    marker.setAttribute('refX', '6');
    marker.setAttribute('refY', '3');
    marker.setAttribute('orient', 'auto');
    var poly = createSvgEl('polygon');
    poly.setAttribute('points', '0 0, 7 3, 0 6');
    poly.setAttribute('fill', color);
    marker.appendChild(poly);
    defs.appendChild(marker);

    var x1, y1, x2, y2, pathD;

    // Check if from is diamond
    var fromQ = questions.find(function (x) { return x.id === fromId; });
    var fromIsDiamond = fromQ && isBranchNode(fromQ);

    if (fromIsDiamond) {
      // Default out: bottom tip
      x1 = fromBox.x + 100; // diamond center-x
      y1 = fromBox.y + 140; // diamond bottom tip
    } else {
      x1 = fromBox.x + fromBox.w / 2;
      y1 = fromBox.y + fromBox.h;
    }
    x2 = toBox.x + toBox.w / 2;
    y2 = toBox.y;

    if (y2 < y1 - 10) {
      // Backward arc
      var sideX = Math.max(fromBox.x, toBox.x) + (fromIsDiamond ? DIAMOND_W : NODE_W) + 50;
      var midY1 = fromBox.y + fromBox.h / 2;
      var midY2 = toBox.y + toBox.h / 2;
      var exitX = fromBox.x + fromBox.w;
      pathD = 'M ' + exitX + ' ' + midY1 +
              ' C ' + sideX + ' ' + midY1 + ', ' + sideX + ' ' + midY2 + ', ' + (toBox.x + toBox.w) + ' ' + midY2;
    } else {
      var cy = (y1 + y2) / 2;
      pathD = 'M ' + x1 + ' ' + y1 + ' C ' + x1 + ' ' + cy + ', ' + x2 + ' ' + cy + ', ' + x2 + ' ' + (y2 - 1);
    }

    var path = createSvgEl('path');
    path.setAttribute('d', pathD);
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', isSelected ? '3' : '1.8');
    path.setAttribute('fill', 'none');
    path.setAttribute('marker-end', 'url(#' + markerId + ')');
    if (isDashed) path.setAttribute('stroke-dasharray', '5 3');
    if (isSelected) path.setAttribute('class', 'flow-conn-selected');
    path.style.pointerEvents = 'stroke';
    path.style.cursor = 'pointer';

    if (connId) {
      (function (cid, fid, tid) {
        path.addEventListener('click', function (e) {
          e.stopPropagation();
          selectConnection(cid, fid, tid);
        });
      })(connId, fromId, toId);
    }

    $svg.appendChild(path);

    // Hit-area path (invisible, wider)
    if (connId) {
      var hitPath = createSvgEl('path');
      hitPath.setAttribute('d', pathD);
      hitPath.setAttribute('stroke', 'transparent');
      hitPath.setAttribute('stroke-width', '12');
      hitPath.setAttribute('fill', 'none');
      hitPath.style.cursor = 'pointer';
      (function (cid, fid, tid) {
        hitPath.addEventListener('click', function (e) {
          e.stopPropagation();
          selectConnection(cid, fid, tid);
        });
      })(connId, fromId, toId);
      $svg.appendChild(hitPath);
    }

    // Label
    if (label) {
      var midX = (x1 + x2) / 2;
      var midY = (y1 + y2) / 2;
      var textEl = createSvgEl('text');
      textEl.setAttribute('x', String(midX));
      textEl.setAttribute('y', String(midY));
      textEl.setAttribute('text-anchor', 'middle');
      textEl.setAttribute('dominant-baseline', 'middle');
      textEl.setAttribute('font-size', '9');
      textEl.setAttribute('fill', color);
      textEl.textContent = label;
      $svg.appendChild(textEl);
    }
  }

  function getBranchLabel(branch) {
    var w = branch.when || {};
    if (w.equals   !== undefined) return '=' + w.equals;
    if (w.any_of   !== undefined) return '∈[' + (w.any_of || []).join(',') + ']';
    if (w.includes !== undefined) return '含' + w.includes;
    if (w.gte      !== undefined) return '≥' + w.gte;
    if (w.lte      !== undefined) return '≤' + w.lte;
    return '';
  }

  function updateCanvasSize() {
    var maxBottom = 400, maxRight = NODE_W + COL_X + 120;
    $canvas.querySelectorAll('.flow-node').forEach(function (el) {
      var b = parseInt(el.style.top, 10) + el.offsetHeight;
      var r = parseInt(el.style.left, 10) + el.offsetWidth;
      if (b > maxBottom) maxBottom = b;
      if (r > maxRight)  maxRight  = r;
    });
    $canvas.style.minHeight = (maxBottom + 80) + 'px';
    $canvas.style.minWidth  = (maxRight  + 80) + 'px';
  }

  // ─── Connection selection ──────────────────────
  function selectConnection(connId, fromId, toId) {
    selectedConn = { connId: connId, fromId: fromId, toId: toId };
    selectedId = null;
    $canvas.querySelectorAll('.flow-node').forEach(function (n) { n.classList.remove('selected'); });
    renderConnections();
    showRightPanelConn(connId, fromId, toId);
  }

  function clearConnectionSelection() {
    if (!selectedConn) return;
    selectedConn = null;
    renderConnections();
  }

  function showRightPanelConn(connId, fromId, toId) {
    var fromLabel = fromId === '__start__' ? 'START' : (questions.find(function (q) { return q.id === fromId; }) || {}).question_code || fromId;
    var toLabel   = toId   === '__end__'   ? 'END'   : (questions.find(function (q) { return q.id === toId;   }) || {}).question_code || toId;
    $rightPanel.innerHTML =
      '<div class="rp-header"><h3>接続</h3></div>' +
      '<div class="rp-body">' +
        '<p style="font-size:12px;color:#3d5a57;">' + esc(fromLabel) + ' → ' + esc(toLabel) + '</p>' +
        '<button class="rp-del-btn-full" id="rp-del-conn" style="width:100%">この接続を削除</button>' +
        '<p style="font-size:10px;color:#8aacaa;margin-top:8px">Delete キーでも削除できます</p>' +
      '</div>';
    on('rp-del-conn', 'click', function () { deleteSelectedConnection(); });
  }

  // ─── Connection drag ───────────────────────────
  function startConnDrag(e, fromId, branchKey) {
    e.preventDefault();
    e.stopPropagation();
    var rect = $canvasWrapper.getBoundingClientRect();
    connDrag = {
      fromId: fromId,
      branchKey: branchKey,
      clientX: e.clientX,
      clientY: e.clientY,
    };
    updateConnDragLine(e.clientX, e.clientY);
  }

  function updateConnDragLine(clientX, clientY) {
    if (!connDrag) return;
    // Clear temp SVG
    while ($connDragSvg.firstChild) $connDragSvg.removeChild($connDragSvg.firstChild);

    var fromEl = document.getElementById('node-' + connDrag.fromId);
    if (!fromEl) return;
    var fromRect = fromEl.getBoundingClientRect();
    var x1 = fromRect.left + fromRect.width / 2;
    var y1 = fromRect.bottom;

    var path = createSvgEl('path');
    var cy = (y1 + clientY) / 2;
    var d = 'M ' + x1 + ' ' + y1 + ' C ' + x1 + ' ' + cy + ', ' + clientX + ' ' + cy + ', ' + clientX + ' ' + clientY;
    path.setAttribute('d', d);
    path.setAttribute('stroke', '#0b7a75');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-dasharray', '6 3');
    path.setAttribute('fill', 'none');
    $connDragSvg.appendChild(path);
  }

  function finishConnDrag(e) {
    if (!connDrag) return;
    // Clear drag line
    while ($connDragSvg.firstChild) $connDragSvg.removeChild($connDragSvg.firstChild);

    // Find drop target: look for element with data-handle-in under cursor
    var els = document.elementsFromPoint(e.clientX, e.clientY);
    var toId = null;
    for (var i = 0; i < els.length; i++) {
      var hi = els[i].getAttribute ? els[i].getAttribute('data-handle-in') : null;
      if (hi) { toId = hi; break; }
      // Also accept dropping on a node itself
      var nodeMatch = els[i].id && els[i].id.startsWith('node-');
      if (nodeMatch && !toId) {
        var nid = els[i].id.slice(5);
        if (nid !== connDrag.fromId && nid !== '__start__') toId = nid;
      }
    }

    if (toId && toId !== connDrag.fromId) {
      applyConnection(connDrag.fromId, connDrag.branchKey, toId);
    }

    // Remove drag-target highlights
    document.querySelectorAll('.drag-target').forEach(function (el) { el.classList.remove('drag-target'); });
    connDrag = null;
  }

  function applyConnection(fromId, branchKey, toId) {
    // toCode
    var toCode = toId === '__end__' ? 'END' : null;
    if (!toCode) {
      var toQ = questions.find(function (x) { return x.id === toId; });
      if (!toQ) return;
      toCode = toQ.question_code;
    }

    if (fromId === '__start__') {
      // START can't hold branch_rule; just scroll to first question for now
      showStatus('STARTノードの接続先は先頭の質問が自動設定されます', 'info');
      return;
    }

    var fromQ = questions.find(function (x) { return x.id === fromId; });
    if (!fromQ) return;
    var branchRule = (fromQ.branch_rule && !Array.isArray(fromQ.branch_rule))
      ? JSON.parse(JSON.stringify(fromQ.branch_rule))
      : {};

    if (branchKey === 'default') {
      branchRule.default_next = toCode;
    } else if (branchKey.startsWith('branch_')) {
      var bidx = parseInt(branchKey.slice(7), 10);
      if (!branchRule.branches) branchRule.branches = [];
      if (branchRule.branches[bidx]) {
        branchRule.branches[bidx].next = toCode;
      }
    }

    // Persist
    saveBranchRule(fromId, branchRule);
  }

  async function saveBranchRule(questionId, branchRule) {
    var q = questions.find(function (x) { return x.id === questionId; });
    if (!q) return;

    try {
      var resp = await fetch('/admin/api/questions/' + questionId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question_text:    q.question_text,
          question_type:    q.question_type,
          question_role:    q.question_role,
          sort_order:       q.sort_order,
          is_required:      q.is_required,
          ai_probe_enabled: q.ai_probe_enabled,
          probe_guideline:  q.probe_guideline || null,
          max_probe_count:  q.max_probe_count || null,
          question_goal:    (q.question_config && q.question_config.meta && q.question_config.meta.research_goal) || '',
          options:          extractOptions(q),
          branch_rule:      branchRule,
          answer_options_locked: q.answer_options_locked || false,
        }),
      });
      if (!resp.ok) {
        var err = await resp.json().catch(function () { return {}; });
        showStatus('接続保存失敗: ' + (err.error || resp.statusText), 'error');
        return;
      }
      var result = await resp.json();
      var idx = questions.findIndex(function (x) { return x.id === questionId; });
      if (idx >= 0) questions[idx] = result.question || questions[idx];
      renderAll();
      showStatus('接続を更新しました ✓', 'success');
    } catch (e) {
      showStatus('接続保存エラー: ' + e.message, 'error');
    }
  }

  function extractOptions(q) {
    var config = q.question_config || {};
    var opts = config.options || [];
    return opts.map(function (o) { return o.label || o.value || ''; }).filter(Boolean);
  }

  // ─── Delete connection ─────────────────────────
  function deleteSelectedConnection() {
    if (!selectedConn) return;
    var connId = selectedConn.connId;
    var fromId = selectedConn.fromId;

    if (fromId === '__start__') {
      showStatus('STARTの接続は削除できません', 'error');
      return;
    }

    var fromQ = questions.find(function (x) { return x.id === fromId; });
    if (!fromQ) return;
    var branchRule = (fromQ.branch_rule && !Array.isArray(fromQ.branch_rule))
      ? JSON.parse(JSON.stringify(fromQ.branch_rule))
      : {};

    if (connId.endsWith(':seq')) {
      // Sequential connection – just set default_next to null (already seq)
      showStatus('順番通りの接続はデフォルトです。分岐設定で変更してください。', 'info');
      return;
    } else if (connId.endsWith(':default')) {
      branchRule.default_next = null;
    } else {
      var parts = connId.split(':branch_');
      if (parts.length === 2) {
        var bidx = parseInt(parts[1], 10);
        if (branchRule.branches && branchRule.branches[bidx]) {
          branchRule.branches[bidx].next = '';
        }
      }
    }

    selectedConn = null;
    showRightPanelEmpty();
    saveBranchRule(fromId, branchRule);
  }

  // ─── Selection ────────────────────────────────
  function selectNode(id) {
    selectedId = id;
    selectedConn = null;
    $canvas.querySelectorAll('.flow-node').forEach(function (n) { n.classList.remove('selected'); });
    var el = document.getElementById('node-' + id);
    if (el) el.classList.add('selected');

    renderConnections();

    if (id === '__start__') {
      showRightPanelSpecial('start');
    } else if (id === '__end__') {
      showRightPanelSpecial('end');
    } else {
      var q = questions.find(function (x) { return x.id === id; });
      if (q) showRightPanel(q);
    }
    updateToolbarState();
  }

  function clearSelection() {
    selectedId = null;
    selectedConn = null;
    $canvas.querySelectorAll('.flow-node').forEach(function (n) { n.classList.remove('selected'); });
    renderConnections();
    showRightPanelEmpty();
    updateToolbarState();
  }

  // ─── Right panel: empty ───────────────────────
  function showRightPanelEmpty() {
    $rightPanel.innerHTML =
      '<div class="flow-right-empty">' +
        '<div><div class="empty-icon">📋</div>' +
        'ノードを選択すると<br>詳細が表示されます</div>' +
      '</div>';
  }

  function showRightPanelSpecial(type) {
    var label = type === 'start' ? '開始ノード' : '終了ノード';
    var desc  = type === 'start'
      ? 'アンケート/インタビューの開始点です。\n最初の質問から処理が始まります。'
      : 'アンケート/インタビューの終了点です。\nここに到達したら回答が完了します。';
    $rightPanel.innerHTML =
      '<div class="rp-header"><h3>' + label + '</h3></div>' +
      '<div class="rp-body"><p style="color:#60726f;font-size:12px;white-space:pre-line">' + esc(desc) + '</p></div>';
  }

  // ─── Right panel: question form ───────────────
  function showRightPanel(q) {
    var config    = (q.question_config || {});
    var meta      = (config.meta || {});
    var opts      = (config.options || []);
    var branchRule = (q.branch_rule && !Array.isArray(q.branch_rule)) ? q.branch_rule : {};

    $rightPanel.innerHTML =
      '<div class="rp-header">' +
        '<h3>' + esc(q.question_code) + '</h3>' +
        '<a class="rp-header-link" href="/admin/questions/' + q.id + '/edit" target="_blank">詳細編集 ↗</a>' +
      '</div>' +
      '<div class="rp-tabs" id="rpTabs">' +
        '<button class="rp-tab' + (activeRpTab === 'basic'  ? ' active' : '') + '" data-tab="basic">基本</button>' +
        '<button class="rp-tab' + (activeRpTab === 'answer' ? ' active' : '') + '" data-tab="answer">回答形式</button>' +
        '<button class="rp-tab' + (activeRpTab === 'branch' ? ' active' : '') + '" data-tab="branch">分岐</button>' +
      '</div>' +
      '<div class="rp-body" id="rpBody">' +
        buildRpTabBasic(q, meta) +
        buildRpTabAnswer(q, opts, config) +
        buildRpTabBranch(q, branchRule) +
      '</div>' +
      '<div class="rp-footer">' +
        '<button class="rp-save-btn" id="rpSaveBtn" onclick="FlowCanvas.saveCurrentNode()">保存</button>' +
        '<button class="rp-del-btn-full" onclick="FlowCanvas.deleteCurrentNode()">削除</button>' +
      '</div>';

    // Tab switching
    document.getElementById('rpTabs').addEventListener('click', function (e) {
      var btn = e.target.closest('.rp-tab');
      if (!btn) return;
      activeRpTab = btn.getAttribute('data-tab');
      document.querySelectorAll('.rp-tab').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      document.querySelectorAll('.rp-tab-pane').forEach(function (p) { p.classList.remove('active'); });
      var pane = document.getElementById('rp-tab-' + activeRpTab);
      if (pane) pane.classList.add('active');
    });

    // AI probe toggle
    var aiChk = document.getElementById('rp-ai_probe');
    if (aiChk) {
      aiChk.addEventListener('change', function () {
        var opts = document.getElementById('rp-ai-options');
        if (opts) opts.style.display = this.checked ? '' : 'none';
      });
    }

    // Restore AI suggestion if cached
    var cached = aiSuggestionCache[q.id];
    if (cached) {
      renderAiSuggestion(cached, q);
    }
  }

  function buildRpTabBasic(q, meta) {
    var activeClass = activeRpTab === 'basic' ? ' active' : '';
    var pgOptions = '<option value="">未分類</option>' +
      pageGroups.map(function (pg) {
        var sel = q.page_group_id === pg.id ? ' selected' : '';
        return '<option value="' + esc(pg.id) + '"' + sel + '>' + esc(pg.title || 'ページ ' + pg.page_number) + '</option>';
      }).join('');

    return (
      '<div class="rp-tab-pane' + activeClass + '" id="rp-tab-basic">' +
        '<div class="rp-field">' +
          '<label>設問文 <span style="color:red">*</span></label>' +
          '<textarea id="rp-question_text" rows="4">' + esc(q.question_text) + '</textarea>' +
        '</div>' +
        '<div class="rp-row">' +
          '<div class="rp-field">' +
            '<label>質問ロール</label>' +
            buildSelect('rp-question_role', ['screening','main','probe_trigger','attribute','comparison_core','free_comment'], q.question_role) +
          '</div>' +
          '<div class="rp-field" style="max-width:70px">' +
            '<label>表示順</label>' +
            '<input type="number" id="rp-sort_order" value="' + q.sort_order + '" min="1" />' +
          '</div>' +
        '</div>' +
        '<div class="rp-field">' +
          '<label>セクション (page_group)</label>' +
          '<select id="rp-page_group_id">' + pgOptions + '</select>' +
        '</div>' +
        '<label class="rp-check"><input type="checkbox" id="rp-is_required"' + (q.is_required ? ' checked' : '') + ' /> 必須にする</label>' +
        '<label class="rp-check"><input type="checkbox" id="rp-ai_probe"' + (q.ai_probe_enabled ? ' checked' : '') + ' /> AI深掘り有効</label>' +
        '<div id="rp-ai-options" style="' + (q.ai_probe_enabled ? '' : 'display:none') + '">' +
          '<div class="rp-field"><label>深掘りガイドライン</label><input type="text" id="rp-probe_guideline" value="' + esc(q.probe_guideline || '') + '" /></div>' +
          '<div class="rp-field"><label>深掘り上限回数</label><input type="number" id="rp-max_probe_count" value="' + (q.max_probe_count != null ? q.max_probe_count : '') + '" min="0" max="5" /></div>' +
        '</div>' +
        '<div class="rp-field"><label>この質問で知りたいこと <span style="color:red">*</span></label><textarea id="rp-question_goal" rows="2">' + esc(meta.research_goal || '') + '</textarea></div>' +
      '</div>'
    );
  }

  function buildRpTabAnswer(q, opts, config) {
    var activeClass = activeRpTab === 'answer' ? ' active' : '';
    var CHOICE_TYPES = ['single_select','multi_select','single_choice','multi_choice','yes_no','hidden_single','hidden_multi','text_with_image','sd'];
    var isChoice = CHOICE_TYPES.includes(q.question_type);
    var allTypeOpts = [
      ['single_choice','単一選択'],['multi_choice','複数選択'],
      ['free_text_short','短文自由記述'],['free_text_long','長文自由記述'],
      ['numeric','数値入力'],['matrix_single','マトリクス（単一）'],['matrix_multi','マトリクス（複数）'],
      ['matrix_mixed','マトリクス（混合）'],['image_upload','画像アップロード'],
      ['hidden_single','隠し項目（単一）'],['hidden_multi','隠し項目（複数）'],
      ['text_with_image','テキスト+画像選択肢'],['sd','SD法'],
      // 旧形式（既存データ表示専用・新規選択不可）
      ['text','テキスト ⚠旧形式'],['single_select','単一選択 ⚠旧形式'],['multi_select','複数選択 ⚠旧形式'],
      ['yes_no','はい/いいえ ⚠旧形式'],['scale','スケール ⚠旧形式'],
    ];
    var typeSelOpts = allTypeOpts.map(function (t) {
      return '<option value="' + t[0] + '"' + (q.question_type === t[0] ? ' selected' : '') + '>' + t[1] + '</option>';
    }).join('');

    var optRows = isChoice ? opts.map(function (o, i) {
      return '<div class="rp-option-row" data-idx="' + i + '">' +
        '<input type="text" class="rp-opt-input" value="' + esc(o.label || '') + '" />' +
        '<button type="button" class="rp-del-btn" data-del-opt="' + i + '">✕</button>' +
      '</div>';
    }).join('') : '';

    var lockedNotice = q.answer_options_locked
      ? '<div class="rp-locked-notice">🔒 選択肢固定中 - AI自動上書き無効</div>'
      : '';

    return (
      '<div class="rp-tab-pane' + activeClass + '" id="rp-tab-answer">' +
        '<div class="rp-field">' +
          '<label>回答形式 <span style="color:red">*</span></label>' +
          '<select id="rp-question_type">' + typeSelOpts + '</select>' +
        '</div>' +
        (isChoice
          ? '<div class="rp-section-title">選択肢</div>' +
            '<div id="rp-option-rows">' + optRows + '</div>' +
            '<button type="button" class="rp-add-btn" id="rp-add-opt">＋ 選択肢追加</button>'
          : '') +
        '<div class="rp-section-title">選択肢オプション</div>' +
        '<label class="rp-check"><input type="checkbox" id="rp-answer_options_locked"' + (q.answer_options_locked ? ' checked' : '') + ' /> 回答項目を固定 <span style="font-size:10px;color:#60726f">（AI候補による自動反映を無効化）</span></label>' +
        lockedNotice +
        '<div class="rp-ai-section" id="rp-ai-section">' +
          '<div class="rp-ai-section-title">🤖 AI候補</div>' +
          '<button type="button" class="rp-ai-btn" id="rp-ai-suggest-btn">候補を取得</button>' +
          '<div id="rp-ai-suggestion-area"></div>' +
        '</div>' +
        '<div style="margin:4px 0 8px">' +
          '<button type="button" class="rp-add-btn" id="rp-reuse-options-btn" style="width:100%;font-size:11px">📋 他の設問から選択肢を流用</button>' +
        '</div>' +
      '</div>'
    );
  }

  function buildRpTabBranch(q, branchRule) {
    var activeClass = activeRpTab === 'branch' ? ' active' : '';
    var branches = branchRule.branches || [];

    var allNextOpts = questions
      .filter(function (x) { return x.id !== q.id; })
      .map(function (x) {
        var sel = branchRule.default_next === x.question_code ? ' selected' : '';
        return '<option value="' + esc(x.question_code) + '"' + sel + '>' + esc(x.question_code) + ': ' + esc(x.question_text.slice(0, 20)) + '</option>';
      }).join('');

    var defaultNextSel =
      '<select id="rp-default_next">' +
        '<option value="">次の質問（順番通り）</option>' +
        '<option value="END"' + (branchRule.default_next === 'END' ? ' selected' : '') + '>END（終了）</option>' +
        allNextOpts +
      '</select>';

    var branchRowsHtml = branches.map(function (b, i) {
      var w = b.when || {};
      var condStr =
        w.equals   !== undefined ? 'equals:'   + w.equals :
        w.any_of   !== undefined ? 'any_of:'   + (w.any_of || []).join(',') :
        w.includes !== undefined ? 'includes:' + w.includes :
        w.gte      !== undefined ? 'gte:'      + w.gte :
        w.lte      !== undefined ? 'lte:'      + w.lte : '';
      var nextOpts = questions
        .filter(function (x) { return x.id !== q.id; })
        .map(function (x) {
          var sel = b.next === x.question_code ? ' selected' : '';
          return '<option value="' + esc(x.question_code) + '"' + sel + '>' + esc(x.question_code) + '</option>';
        }).join('');
      return (
        '<div class="rp-branch-row" data-bidx="' + i + '">' +
          '<div class="rp-row">' +
            '<div class="rp-field"><label>条件</label><input type="text" class="rp-branch-cond" value="' + esc(condStr) + '" placeholder="equals:1" /></div>' +
            '<div class="rp-field"><label>遷移先</label>' +
              '<select class="rp-branch-next">' +
                '<option value="">未設定</option>' +
                '<option value="END"' + (b.next === 'END' ? ' selected' : '') + '>END</option>' +
                nextOpts +
              '</select>' +
            '</div>' +
          '</div>' +
          '<button type="button" class="rp-add-btn" style="color:#c04040;border-color:#e8c0c0" data-del-branch="' + i + '">削除</button>' +
        '</div>'
      );
    }).join('');

    return (
      '<div class="rp-tab-pane' + activeClass + '" id="rp-tab-branch">' +
        '<div class="rp-field"><label>デフォルト遷移先</label>' + defaultNextSel + '</div>' +
        '<div class="rp-section-title">条件分岐</div>' +
        '<p style="font-size:10px;color:#60726f;margin:0 0 8px">条件式: <code>equals:値</code>, <code>any_of:1,2,3</code>, <code>gte:数値</code>, <code>lte:数値</code></p>' +
        '<div id="rp-branch-rows">' + branchRowsHtml + '</div>' +
        '<button type="button" class="rp-add-btn" id="rp-add-branch">＋ 分岐追加</button>' +
      '</div>'
    );
  }

  // ─── AI Suggestion ────────────────────────────
  document.addEventListener('click', function (e) {
    if (e.target.id === 'rp-ai-suggest-btn') {
      fetchAiSuggestion();
      return;
    }
    if (e.target.id === 'rp-ai-apply-all') {
      applyAiSuggestionAll();
      return;
    }
    if (e.target.id === 'rp-ai-apply-type') {
      applyAiSuggestionType();
      return;
    }
    // Delete option
    if (e.target.hasAttribute('data-del-opt')) {
      var idx = parseInt(e.target.getAttribute('data-del-opt'), 10);
      var rows = document.querySelectorAll('#rp-option-rows .rp-option-row');
      if (rows[idx]) rows[idx].remove();
      return;
    }
    // Delete branch
    if (e.target.hasAttribute('data-del-branch')) {
      var bidx = parseInt(e.target.getAttribute('data-del-branch'), 10);
      var brows = document.querySelectorAll('#rp-branch-rows .rp-branch-row');
      if (brows[bidx]) brows[bidx].remove();
      return;
    }
    // Add option
    if (e.target.id === 'rp-add-opt') {
      var container = document.getElementById('rp-option-rows');
      if (!container) return;
      var newIdx = container.querySelectorAll('.rp-option-row').length;
      var row = document.createElement('div');
      row.className = 'rp-option-row';
      row.setAttribute('data-idx', newIdx);
      row.innerHTML = '<input type="text" class="rp-opt-input" value="" /><button type="button" class="rp-del-btn" data-del-opt="' + newIdx + '">✕</button>';
      container.appendChild(row);
      return;
    }
    // Add branch
    if (e.target.id === 'rp-add-branch') {
      var bc = document.getElementById('rp-branch-rows');
      if (!bc) return;
      var blen = bc.querySelectorAll('.rp-branch-row').length;
      var q = questions.find(function (x) { return x.id === selectedId; });
      var nextOpts2 = q ? questions
        .filter(function (x) { return x.id !== q.id; })
        .map(function (x) { return '<option value="' + esc(x.question_code) + '">' + esc(x.question_code) + '</option>'; }).join('') : '';
      var brow = document.createElement('div');
      brow.className = 'rp-branch-row';
      brow.setAttribute('data-bidx', blen);
      brow.innerHTML =
        '<div class="rp-row">' +
          '<div class="rp-field"><label>条件</label><input type="text" class="rp-branch-cond" value="" placeholder="equals:1" /></div>' +
          '<div class="rp-field"><label>遷移先</label>' +
            '<select class="rp-branch-next"><option value="">未設定</option><option value="END">END</option>' + nextOpts2 + '</select>' +
          '</div>' +
        '</div>' +
        '<button type="button" class="rp-add-btn" style="color:#c04040;border-color:#e8c0c0" data-del-branch="' + blen + '">削除</button>';
      bc.appendChild(brow);
      return;
    }
  });

  async function fetchAiSuggestion() {
    if (!selectedId || ['__start__','__end__'].includes(selectedId)) return;
    var q = questions.find(function (x) { return x.id === selectedId; });
    if (!q) return;

    // Check locked
    var lockedChk = document.getElementById('rp-answer_options_locked');
    var isLocked = lockedChk ? lockedChk.checked : q.answer_options_locked;
    if (isLocked) {
      var area = document.getElementById('rp-ai-suggestion-area');
      if (area) area.innerHTML = '<p style="font-size:11px;color:#8a2020;">🔒 選択肢が固定されています。固定を解除してから候補を取得してください。</p>';
      return;
    }

    var btn = document.getElementById('rp-ai-suggest-btn');
    if (btn) { btn.disabled = true; btn.textContent = '取得中…'; }

    try {
      var resp = await fetch('/admin/api/questions/' + q.id + '/suggest-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      var data = await resp.json();
      if (!resp.ok) {
        showStatus('AI候補取得失敗: ' + (data.error || resp.statusText), 'error');
        return;
      }
      if (data.locked) {
        showStatus(data.message, 'info');
        return;
      }
      var suggestions = data.suggestions;
      aiSuggestionCache[q.id] = suggestions;
      renderAiSuggestion(suggestions, q);
    } catch (err) {
      showStatus('AI候補取得エラー: ' + err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '候補を取得'; }
    }
  }

  function renderAiSuggestion(suggestions, q) {
    var area = document.getElementById('rp-ai-suggestion-area');
    if (!area) return;

    var typeLabel = getTypeLabel(suggestions.suggestedQuestionType || '');
    var opts = suggestions.suggestedOptions || [];
    var reason = suggestions.reason || '';
    var warnings = suggestions.warnings || [];

    var optsHtml = opts.map(function (o) {
      return '<div class="rp-ai-opt-row">• ' + esc(o) + '</div>';
    }).join('');

    var warningsHtml = warnings.length > 0
      ? '<p style="font-size:10px;color:#8a6000;margin-top:4px">⚠ ' + esc(warnings.join(' / ')) + '</p>'
      : '';

    area.innerHTML =
      '<div class="rp-ai-suggestion-box">' +
        '<div class="rp-ai-suggestion-type">推奨形式: ' + esc(typeLabel || suggestions.suggestedQuestionType) + '</div>' +
        (opts.length > 0 ? '<div class="rp-ai-suggestion-opts">' + optsHtml + '</div>' : '') +
        '<div class="rp-ai-reason">' + esc(reason) + '</div>' +
        warningsHtml +
        '<button type="button" class="rp-ai-apply-btn" id="rp-ai-apply-all">選択肢を適用</button>' +
        '<button type="button" class="rp-ai-apply-type-btn" id="rp-ai-apply-type">回答形式のみ適用</button>' +
      '</div>';
  }

  function applyAiSuggestionAll() {
    if (!selectedId) return;
    var q = questions.find(function (x) { return x.id === selectedId; });
    if (!q) return;
    var suggestions = aiSuggestionCache[q.id];
    if (!suggestions) return;

    var opts = suggestions.suggestedOptions || [];
    var newType = suggestions.suggestedQuestionType;

    // タイプが変わる場合 or rp-option-rows がまだ DOM にない場合は右パネルを再描画する。
    // 再描画前に q.question_type を更新しておくことで buildRpTabAnswer が正しい isChoice で描画する。
    var needsRedraw = false;
    if (newType && newType !== q.question_type) {
      q.question_type = newType;
      needsRedraw = true;
    }
    if (!document.getElementById('rp-option-rows')) {
      needsRedraw = true;
    }

    if (needsRedraw) {
      activeRpTab = 'answer';
      showRightPanel(q);
    } else {
      // すでに描画済みの場合はセレクトだけ更新
      var typeEl = document.getElementById('rp-question_type');
      if (typeEl && newType) typeEl.value = newType;
    }

    // 再描画後に container を取得して選択肢を投入する
    var container = document.getElementById('rp-option-rows');
    if (container && opts.length > 0) {
      container.innerHTML = '';
      opts.forEach(function (o, i) {
        var row = document.createElement('div');
        row.className = 'rp-option-row';
        row.setAttribute('data-idx', i);
        row.innerHTML = '<input type="text" class="rp-opt-input" value="' + esc(o) + '" />' +
          '<button type="button" class="rp-del-btn" data-del-opt="' + i + '">✕</button>';
        container.appendChild(row);
      });
    }

    showStatus('AI候補を適用しました ✓', 'success');
  }

  function applyAiSuggestionType() {
    if (!selectedId) return;
    var q = questions.find(function (x) { return x.id === selectedId; });
    if (!q) return;
    var suggestions = aiSuggestionCache[q.id];
    if (!suggestions) return;
    var typeEl = document.getElementById('rp-question_type');
    if (typeEl && suggestions.suggestedQuestionType) {
      typeEl.value = suggestions.suggestedQuestionType;
    }
    showStatus('回答形式を適用しました ✓', 'success');
  }

  // ─── Collect right panel data ─────────────────
  function collectRpData() {
    var q = questions.find(function (x) { return x.id === selectedId; });
    if (!q) return null;

    var val = function (id) { var el = document.getElementById(id); return el ? el.value : ''; };
    var checked = function (id) { var el = document.getElementById(id); return el ? el.checked : false; };

    var questionText  = val('rp-question_text').trim();
    var questionType  = val('rp-question_type') || q.question_type;
    var questionRole  = val('rp-question_role') || q.question_role;
    var sortOrder     = parseInt(val('rp-sort_order'), 10) || q.sort_order;
    var isRequired    = checked('rp-is_required');
    var aiProbe       = checked('rp-ai_probe');
    var probeGuideline = aiProbe ? (val('rp-probe_guideline').trim() || null) : null;
    var maxProbeCount  = aiProbe ? (parseInt(val('rp-max_probe_count'), 10) || null) : null;
    var questionGoal  = val('rp-question_goal').trim();
    var defaultNext   = val('rp-default_next') || null;
    var pageGroupId   = val('rp-page_group_id') || null;
    var answerOptionsLocked = checked('rp-answer_options_locked');

    var optInputs = document.querySelectorAll('#rp-option-rows .rp-opt-input');
    var options = Array.from(optInputs).map(function (i) { return i.value.trim(); }).filter(Boolean);

    var branchRowEls = document.querySelectorAll('#rp-branch-rows .rp-branch-row');
    var branches = [];
    branchRowEls.forEach(function (row) {
      var condStr  = (row.querySelector('.rp-branch-cond')  || {}).value || '';
      var nextCode = (row.querySelector('.rp-branch-next') || {}).value || '';
      if (!condStr.trim() || !nextCode.trim()) return;
      var when = parseBranchCond(condStr.trim());
      if (when) branches.push({ source: 'answer', when: when, next: nextCode.trim() });
    });

    var branchRule = (defaultNext || branches.length > 0) ? {
      default_next: defaultNext || null,
      branches: branches.length > 0 ? branches : undefined,
    } : null;

    return {
      question_text:    questionText,
      question_type:    questionType,
      question_role:    questionRole,
      sort_order:       sortOrder,
      is_required:      isRequired,
      ai_probe_enabled: aiProbe,
      probe_guideline:  probeGuideline,
      max_probe_count:  maxProbeCount,
      question_goal:    questionGoal,
      options:          options,
      branch_rule:      branchRule,
      page_group_id:    pageGroupId,
      answer_options_locked: answerOptionsLocked,
    };
  }

  function parseBranchCond(str) {
    var colon = str.indexOf(':');
    if (colon < 0) return { equals: parseScalar(str) };
    var op  = str.slice(0, colon).trim();
    var val = str.slice(colon + 1).trim();
    switch (op) {
      case 'equals':   return { equals:   parseScalar(val) };
      case 'any_of':   return { any_of:   val.split(',').map(function (v) { return parseScalar(v.trim()); }) };
      case 'includes': return { includes: parseScalar(val) };
      case 'gte':      return { gte: Number(val) };
      case 'lte':      return { lte: Number(val) };
      default:         return { equals: parseScalar(str) };
    }
  }

  function parseScalar(s) {
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    if (s === 'true') return true;
    if (s === 'false') return false;
    return s;
  }

  // ─── Save ─────────────────────────────────────
  async function saveCurrentNode() {
    if (!selectedId || ['__start__','__end__'].includes(selectedId)) return;
    var q = questions.find(function (x) { return x.id === selectedId; });
    if (!q) return;

    var payload = collectRpData();
    if (!payload) return;

    if (!payload.question_text) { showStatus('設問文を入力してください', 'error'); return; }
    if (!payload.question_goal) { showStatus('この質問で知りたいことを入力してください', 'error'); return; }

    var btn = document.getElementById('rpSaveBtn');
    if (btn) { btn.textContent = '保存中…'; btn.disabled = true; }

    try {
      var resp = await fetch('/admin/api/questions/' + q.id, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        var err = await resp.json().catch(function () { return {}; });
        showStatus('保存失敗: ' + (err.error || resp.statusText), 'error');
        return;
      }
      var result = await resp.json();
      var idx = questions.findIndex(function (x) { return x.id === selectedId; });
      if (idx >= 0) {
        questions[idx] = result.question || Object.assign({}, questions[idx], payload);
      }
      // page_group_id を更新したらグループ再描画
      renderAll();
      showStatus('保存しました ✓', 'success');
      selectNode(selectedId);
    } catch (e) {
      showStatus('保存中にエラー: ' + e.message, 'error');
    } finally {
      if (btn) { btn.textContent = '保存'; btn.disabled = false; }
    }
  }

  // ─── Delete node ──────────────────────────────
  async function deleteCurrentNode() {
    if (!selectedId || ['__start__','__end__'].includes(selectedId)) return;
    var q = questions.find(function (x) { return x.id === selectedId; });
    if (!q) return;
    if (!confirm('「' + q.question_text.slice(0, 30) + '」を削除しますか？')) return;

    try {
      var resp = await fetch('/admin/api/questions/' + q.id + '/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!resp.ok) {
        var err = await resp.json().catch(function () { return {}; });
        showStatus('削除失敗: ' + (err.error || resp.statusText), 'error');
        return;
      }
      questions = questions.filter(function (x) { return x.id !== selectedId; });
      delete nodePositions[selectedId];
      delete aiSuggestionCache[selectedId];
      selectedId = null;
      computeInitialPositions();
      renderAll();
      showRightPanelEmpty();
      showStatus('削除しました', 'success');
    } catch (e) {
      showStatus('削除中にエラー: ' + e.message, 'error');
    }
  }

  // ─── Add question ─────────────────────────────
  async function addQuestionNode(aiEnabled) {
    var maxOrder = questions.length > 0
      ? Math.max.apply(null, questions.map(function (q) { return q.sort_order; }))
      : 0;
    var payload = {
      question_type:    'free_text_short',
      question_role:    'main',
      question_text:    '新しい質問',
      question_goal:    '（後で記入してください）',
      sort_order:       maxOrder + 1,
      is_required:      false,
      ai_probe_enabled: !!aiEnabled,
      options:          [],
      branch_rule:      null,
    };

    try {
      var resp = await fetch('/admin/api/projects/' + DATA.projectId + '/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        var err = await resp.json().catch(function () { return {}; });
        showStatus('追加失敗: ' + (err.error || resp.statusText), 'error');
        return;
      }
      var result = await resp.json();
      if (result.question) {
        questions.push(result.question);
        computeInitialPositions();
        renderAll();
        setTimeout(function () { selectNode(result.question.id); }, 60);
        showStatus('質問を追加しました ✓', 'success');
      }
    } catch (e) {
      showStatus('追加中にエラー: ' + e.message, 'error');
    }
  }

  // ─── Node drag ────────────────────────────────
  function startNodeDrag(e, nodeId) {
    if (['BUTTON','INPUT','SELECT','TEXTAREA','A'].includes(e.target.tagName)) return;
    if (e.target.classList.contains('node-handle')) return; // handles use connDrag
    dragState = {
      nodeId:       nodeId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startNodeX:   (nodePositions[nodeId] || { x: 0 }).x,
      startNodeY:   (nodePositions[nodeId] || { y: 0 }).y,
      moved:        false,
    };
    e.preventDefault();
  }

  document.addEventListener('mousemove', function (e) {
    // Connection drag line update
    if (connDrag) {
      updateConnDragLine(e.clientX, e.clientY);
      // Highlight potential target
      document.querySelectorAll('.drag-target').forEach(function (el) { el.classList.remove('drag-target'); });
      var els = document.elementsFromPoint(e.clientX, e.clientY);
      for (var i = 0; i < els.length; i++) {
        var hi = els[i].getAttribute ? els[i].getAttribute('data-handle-in') : null;
        if (hi && hi !== connDrag.fromId) {
          els[i].classList.add('drag-target');
          break;
        }
      }
      return;
    }

    if (!dragState) return;
    var dx = e.clientX - dragState.startClientX;
    var dy = e.clientY - dragState.startClientY;
    if (!dragState.moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
    dragState.moved = true;

    var nx = Math.max(0, dragState.startNodeX + dx);
    var ny = Math.max(0, dragState.startNodeY + dy);
    nodePositions[dragState.nodeId] = { x: nx, y: ny };

    var el = document.getElementById('node-' + dragState.nodeId);
    if (el) { el.style.left = nx + 'px'; el.style.top = ny + 'px'; }

    renderConnections();
    renderGroupBoxes();
    updateCanvasSize();
  });

  document.addEventListener('mouseup', function (e) {
    if (connDrag) {
      finishConnDrag(e);
      return;
    }
    dragState = null;
  });

  // ─── Keyboard ─────────────────────────────────
  function bindKeyboard() {
    document.addEventListener('keydown', function (e) {
      if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedConn) {
          deleteSelectedConnection();
        }
      }
      if (e.key === 'Escape') {
        clearSelection();
      }
    });
  }

  // ─── Toolbar ──────────────────────────────────
  function bindToolbar() {
    on('tb-add-question', 'click', function () { addQuestionNode(false); });
    on('tb-add-ai',       'click', function () { addQuestionNode(true); });
    on('tb-add-end',      'click', function () {
      var el = document.getElementById('node-__end__');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    on('tb-save',    'click', function () { saveCurrentNode(); });
    on('tb-back',    'click', function () { window.location.href = '/admin/projects/' + DATA.projectId + '/questions'; });
    on('tb-preview', 'click', function () { window.open('/admin/projects/' + DATA.projectId + '/questions', '_blank'); });
    on('tb-zoom-in',  'click', function () { setZoom(zoom + 0.15); });
    on('tb-zoom-out', 'click', function () { setZoom(zoom - 0.15); });
    on('tb-fit',      'click', function () { setZoom(1); $canvasWrapper.scrollTo(0, 0); });
    on('tb-import-flow',   'click', openImportFlowModal);
    on('tb-generate-flow', 'click', openGenerateFlowModal);
  }

  function setZoom(z) {
    zoom = Math.max(0.3, Math.min(2.0, z));
    $canvas.style.transform = zoom !== 1 ? 'scale(' + zoom + ')' : '';
    $canvas.style.transformOrigin = 'top left';
  }

  function updateToolbarState() {
    var hasQ = selectedId && !['__start__','__end__'].includes(selectedId);
    var saveBtn = document.getElementById('tb-save');
    if (saveBtn) saveBtn.disabled = !hasQ;
  }

  // ─── Left panel ───────────────────────────────
  function bindLeftPanel() {
    document.querySelectorAll('.part-item').forEach(function (item) {
      item.addEventListener('click', function () {
        var type = item.getAttribute('data-type');
        if (type === 'question') addQuestionNode(false);
        else if (type === 'ai')  addQuestionNode(true);
        else if (type === 'end') {
          var el = document.getElementById('node-__end__');
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    });
  }

  // ─── Canvas background click ──────────────────
  function bindCanvasBackground() {
    $canvasWrapper.addEventListener('click', function (e) {
      if (e.target === $canvasWrapper || e.target === $canvas || e.target === $svg) {
        clearSelection();
      }
    });
  }

  // ─── Status bar ───────────────────────────────
  function showStatus(msg, type) {
    if (!$statusText) return;
    $statusText.textContent = msg;
    $statusText.className = 'tb-status ' + (type || 'info');
    setTimeout(function () {
      if ($statusText.textContent === msg) {
        $statusText.textContent = '';
        $statusText.className = '';
      }
    }, 3500);
  }

  // ─── Public API (for inline onclick) ──────────
  window.FlowCanvas = {
    saveCurrentNode:   saveCurrentNode,
    deleteCurrentNode: deleteCurrentNode,
  };

  // ═══════════════════════════════════════════════
  // ─── 過去案件流用モーダル ──────────────────────
  // ═══════════════════════════════════════════════

  var importSelectedProjectId = null;
  var importAllProjects = [];

  function openImportFlowModal() {
    importSelectedProjectId = null;
    importAllProjects = [];
    showImportStep(1);
    document.getElementById('importFlowModal').style.display = 'flex';
    document.getElementById('importStep1Next').disabled = true;
    document.getElementById('importProjectSearch').value = '';
    loadImportProjects();
  }

  function closeImportFlowModal() {
    document.getElementById('importFlowModal').style.display = 'none';
  }

  function showImportStep(n) {
    document.getElementById('importStep1').style.display = n === 1 ? '' : 'none';
    document.getElementById('importStep2').style.display = n === 2 ? '' : 'none';
    document.getElementById('importStep3').style.display = n === 3 ? '' : 'none';
  }

  async function loadImportProjects() {
    var listEl = document.getElementById('importProjectList');
    listEl.innerHTML = '<div class="fd-loading">読み込み中…</div>';
    try {
      var resp = await fetch('/admin/api/projects-for-import?exclude=' + encodeURIComponent(DATA.projectId));
      var data = await resp.json();
      importAllProjects = data.projects || [];
      renderImportProjectList(importAllProjects);
    } catch (e) {
      listEl.innerHTML = '<div class="fd-error">読み込みに失敗しました: ' + esc(e.message) + '</div>';
    }
  }

  function renderImportProjectList(list) {
    var listEl = document.getElementById('importProjectList');
    if (list.length === 0) {
      listEl.innerHTML = '<div class="fd-empty">該当する案件がありません</div>';
      return;
    }
    listEl.innerHTML = list.map(function (p) {
      var sel = importSelectedProjectId === p.id ? ' fd-project-item-selected' : '';
      var objPreview = p.objective ? p.objective.slice(0, 60) + (p.objective.length > 60 ? '…' : '') : '調査目的なし';
      return '<div class="fd-project-item' + sel + '" data-pid="' + esc(p.id) + '">' +
        '<div class="fd-project-item-name">' + esc(p.name) + '</div>' +
        '<div class="fd-project-item-obj">' + esc(objPreview) + '</div>' +
      '</div>';
    }).join('');

    listEl.querySelectorAll('.fd-project-item').forEach(function (el) {
      el.addEventListener('click', function () {
        importSelectedProjectId = el.getAttribute('data-pid');
        listEl.querySelectorAll('.fd-project-item').forEach(function (x) { x.classList.remove('fd-project-item-selected'); });
        el.classList.add('fd-project-item-selected');
        document.getElementById('importStep1Next').disabled = false;
      });
    });
  }

  async function loadImportPreview() {
    if (!importSelectedProjectId) return;
    showImportStep(2);
    var descEl = document.getElementById('importPreviewDesc');
    var listEl = document.getElementById('importPreviewList');
    descEl.textContent = '読み込み中…';
    listEl.innerHTML = '';
    try {
      var resp = await fetch('/admin/api/projects/' + importSelectedProjectId + '/flow-preview');
      var data = await resp.json();
      var proj = data.project || {};
      descEl.textContent = '「' + (proj.name || '') + '」から ' + (data.questions || []).length + ' 件の設問を流用します。AIが新規案件向けにテキストを調整します。';
      listEl.innerHTML = (data.questions || []).map(function (q) {
        var typeLabel = getTypeLabel(q.question_type);
        var isImg = ['image_upload', 'text_with_image'].includes(q.question_type);
        return '<div class="fd-preview-item' + (isImg ? ' fd-preview-item-warn' : '') + '">' +
          '<span class="fd-preview-code">' + esc(q.question_code) + '</span>' +
          '<span class="fd-preview-type">' + esc(typeLabel) + '</span>' +
          (isImg ? '<span class="fd-preview-badge-warn">画像→変換</span>' : '') +
          '<div class="fd-preview-text">' + esc(q.question_text.slice(0, 80)) + '</div>' +
        '</div>';
      }).join('');
    } catch (e) {
      descEl.textContent = 'プレビューの読み込みに失敗しました';
      listEl.innerHTML = '<div class="fd-error">' + esc(e.message) + '</div>';
    }
  }

  async function executeImportFlow() {
    if (!importSelectedProjectId) return;
    showImportStep(3);
    try {
      var resp = await fetch('/admin/api/projects/' + DATA.projectId + '/flow/import-from-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_project_id: importSelectedProjectId }),
      });
      var data = await resp.json();
      if (!resp.ok) {
        closeImportFlowModal();
        showStatus('流用失敗: ' + (data.error || resp.statusText), 'error');
        return;
      }
      var newQs = data.questions || [];
      newQs.forEach(function (q) {
        if (!questions.find(function (x) { return x.id === q.id; })) {
          questions.push(q);
        }
      });
      computeInitialPositions();
      renderAll();
      closeImportFlowModal();
      var warnMsg = (data.warnings || []).length > 0 ? ' (' + data.warnings.length + '件の画像変換あり)' : '';
      showStatus(newQs.length + ' 件の設問を流用しました ✓' + warnMsg, 'success');
      if (data.warnings && data.warnings.length > 0) {
        setTimeout(function () { alert('【画像変換の通知】\n' + data.warnings.join('\n')); }, 500);
      }
    } catch (e) {
      closeImportFlowModal();
      showStatus('流用中にエラー: ' + e.message, 'error');
    }
  }

  // Import modal event binding (on DOMContentLoaded completes)
  document.addEventListener('DOMContentLoaded', function () {
    // 過去案件流用モーダル
    on('importModalClose',  'click', closeImportFlowModal);
    on('importModalCancel', 'click', closeImportFlowModal);
    on('importStep1Next',   'click', loadImportPreview);
    on('importStep2Back',   'click', function () { showImportStep(1); });
    on('importStep2Execute','click', executeImportFlow);

    var searchEl = document.getElementById('importProjectSearch');
    if (searchEl) {
      searchEl.addEventListener('input', function () {
        var q = this.value.toLowerCase();
        var filtered = q
          ? importAllProjects.filter(function (p) { return p.name.toLowerCase().includes(q) || (p.objective || '').toLowerCase().includes(q); })
          : importAllProjects;
        renderImportProjectList(filtered);
      });
    }

    // AI生成モーダル
    on('generateModalClose',  'click', closeGenerateFlowModal);
    on('generateModalCancel', 'click', closeGenerateFlowModal);
    on('generateExecute',     'click', executeGenerateFlow);

    // 選択肢流用モーダル
    on('optionReuseModalClose', 'click', closeOptionReuseModal);
    on('optionReuseCancel',     'click', closeOptionReuseModal);
  });

  // モーダルのオーバーレイクリックで閉じる
  document.addEventListener('click', function (e) {
    if (e.target.classList && e.target.classList.contains('fd-modal-overlay')) {
      e.target.style.display = 'none';
    }
  });

  // ═══════════════════════════════════════════════
  // ─── AIフロー自動生成モーダル ──────────────────
  // ═══════════════════════════════════════════════

  function openGenerateFlowModal() {
    document.getElementById('generateStep1').style.display = '';
    document.getElementById('generateStep2').style.display = 'none';
    document.getElementById('genProjectName').textContent = DATA.project.name || '（未設定）';
    document.getElementById('genProjectObjective').textContent = DATA.project.objective || '（未設定）';
    document.getElementById('generateFlowModal').style.display = 'flex';
  }

  function closeGenerateFlowModal() {
    document.getElementById('generateFlowModal').style.display = 'none';
  }

  async function executeGenerateFlow() {
    document.getElementById('generateStep1').style.display = 'none';
    document.getElementById('generateStep2').style.display = '';
    try {
      var resp = await fetch('/admin/api/projects/' + DATA.projectId + '/flow/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      var data = await resp.json();
      if (!resp.ok) {
        closeGenerateFlowModal();
        showStatus('AI生成失敗: ' + (data.error || resp.statusText), 'error');
        return;
      }
      var newQs = data.questions || [];
      newQs.forEach(function (q) {
        if (!questions.find(function (x) { return x.id === q.id; })) {
          questions.push(q);
        }
      });
      computeInitialPositions();
      renderAll();
      closeGenerateFlowModal();
      showStatus(newQs.length + ' 件の設問を自動生成しました ✓', 'success');
    } catch (e) {
      closeGenerateFlowModal();
      showStatus('AI生成中にエラー: ' + e.message, 'error');
    }
  }

  // ═══════════════════════════════════════════════
  // ─── 選択肢流用モーダル ────────────────────────
  // ═══════════════════════════════════════════════

  var optionReuseAllSets = [];

  function closeOptionReuseModal() {
    document.getElementById('optionReuseModal').style.display = 'none';
  }

  async function openOptionReuseModal() {
    document.getElementById('optionReuseModal').style.display = 'flex';
    document.getElementById('optionReuseSearch').value = '';
    var listEl = document.getElementById('optionReuseList');
    listEl.innerHTML = '<div class="fd-loading">読み込み中…</div>';
    try {
      var resp = await fetch('/admin/api/projects/' + DATA.projectId + '/option-sets');
      var data = await resp.json();
      optionReuseAllSets = (data.option_sets || []).filter(function (s) {
        return s.question_id !== selectedId;
      });
      renderOptionReuseList(optionReuseAllSets);
    } catch (e) {
      listEl.innerHTML = '<div class="fd-error">読み込みに失敗: ' + esc(e.message) + '</div>';
    }
  }

  function renderOptionReuseList(list) {
    var listEl = document.getElementById('optionReuseList');
    if (list.length === 0) {
      listEl.innerHTML = '<div class="fd-empty">流用できる選択肢セットがありません</div>';
      return;
    }
    listEl.innerHTML = list.map(function (s) {
      var preview = s.options.slice(0, 4).join(' / ') + (s.options.length > 4 ? ' …' : '');
      return '<div class="fd-project-item" data-sid="' + esc(s.question_id) + '">' +
        '<div class="fd-project-item-name"><span class="fd-preview-code">' + esc(s.question_code) + '</span> ' + esc(s.question_text) + '</div>' +
        '<div class="fd-project-item-obj">選択肢 (' + s.options.length + '件): ' + esc(preview) + '</div>' +
      '</div>';
    }).join('');

    listEl.querySelectorAll('.fd-project-item').forEach(function (el) {
      el.addEventListener('click', function () {
        var sid = el.getAttribute('data-sid');
        var src = optionReuseAllSets.find(function (s) { return s.question_id === sid; });
        if (!src) return;
        applyOptionSetToPanel(src);
        closeOptionReuseModal();
      });
    });
  }

  function applyOptionSetToPanel(src) {
    // 右パネルの option-rows に選択肢を流し込む（保存は別途）
    var container = document.getElementById('rp-option-rows');
    if (!container) {
      showStatus('先に「回答形式」タブを開いてください', 'error');
      return;
    }
    container.innerHTML = '';
    src.options.forEach(function (o, i) {
      var row = document.createElement('div');
      row.className = 'rp-option-row';
      row.setAttribute('data-idx', i);
      row.innerHTML = '<input type="text" class="rp-opt-input" value="' + esc(o) + '" />' +
        '<button type="button" class="rp-del-btn" data-del-opt="' + i + '">✕</button>';
      container.appendChild(row);
    });

    // 回答形式も合わせる（互換性がある場合）
    var typeEl = document.getElementById('rp-question_type');
    if (typeEl) {
      var CHOICE_TYPES = ['single_choice','multi_choice','single_select','multi_select','yes_no','hidden_single','hidden_multi','text_with_image','sd'];
      if (CHOICE_TYPES.includes(src.question_type)) {
        // 現在のタイプが選択型でなければ single_choice に変える
        var currentType = typeEl.value;
        if (!CHOICE_TYPES.includes(currentType)) {
          typeEl.value = 'single_choice';
        }
      }
    }

    showStatus('選択肢を流用しました。「保存」ボタンで確定してください ✓', 'success');
  }

  // 選択肢流用ボタンの動的クリックハンドラ
  document.addEventListener('click', function (e) {
    if (e.target.id === 'rp-reuse-options-btn') {
      openOptionReuseModal();
    }
  });

  // 選択肢流用検索
  document.addEventListener('input', function (e) {
    if (e.target.id === 'optionReuseSearch') {
      var q = e.target.value.toLowerCase();
      var filtered = q
        ? optionReuseAllSets.filter(function (s) {
            return s.question_code.toLowerCase().includes(q) || s.question_text.toLowerCase().includes(q);
          })
        : optionReuseAllSets;
      renderOptionReuseList(filtered);
    }
  });

})();
