/* =============================================
   Flow Designer Canvas Logic
   ============================================= */
(function () {
  'use strict';

  /** @type {{ projectId: string, project: object, questions: object[], pageGroups: object[] }} */
  const DATA = window.FLOW_DESIGNER_DATA;
  if (!DATA) return;

  // ─── State ────────────────────────────────────
  let questions = DATA.questions.slice().sort((a, b) => a.sort_order - b.sort_order);
  let selectedId = null;
  let nodePositions = {}; // { [id]: {x, y} }
  let zoom = 1;
  let activeRpTab = 'basic';

  // Drag state
  let dragState = null; // { nodeId, startClientX, startClientY, startNodeX, startNodeY, moved }

  // Layout constants
  const NODE_W = 220;
  const NODE_GAP_Y = 56;
  const COL_X = 60;
  const ROW_START_Y = 50;
  const START_NODE_H = 60;
  const NODE_APPROX_H = 100;

  // DOM refs (set after DOMContentLoaded)
  let $canvas, $svg, $rightPanel, $statusText, $canvasWrapper;

  // ─── Boot ─────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    $canvas       = document.getElementById('flowCanvas');
    $svg          = document.getElementById('flowSvg');
    $rightPanel   = document.getElementById('rightPanel');
    $statusText   = document.getElementById('flowStatusText');
    $canvasWrapper = document.getElementById('canvasWrapper');

    computeInitialPositions();
    renderAll();
    bindToolbar();
    bindLeftPanel();
    bindCanvasBackground();
    showRightPanelEmpty();
  });

  // ─── Position computation ──────────────────────
  function computeInitialPositions() {
    // START is always at fixed position
    nodePositions['__start__'] = { x: COL_X, y: ROW_START_Y };

    let y = ROW_START_Y + START_NODE_H + NODE_GAP_Y;
    for (const q of questions) {
      if (!nodePositions[q.id]) {
        nodePositions[q.id] = { x: COL_X, y };
      }
      y += NODE_APPROX_H + NODE_GAP_Y;
    }
    nodePositions['__end__'] = { x: COL_X, y };
  }

  function recalcEndPosition() {
    const sorted = questions.slice().sort((a, b) => a.sort_order - b.sort_order);
    if (sorted.length === 0) {
      nodePositions['__end__'] = { x: COL_X, y: ROW_START_Y + START_NODE_H + NODE_GAP_Y };
      return;
    }
    const lastId = sorted[sorted.length - 1].id;
    const lastEl = document.getElementById('node-' + lastId);
    const lastPos = nodePositions[lastId] || { x: COL_X, y: ROW_START_Y };
    const lastH = lastEl ? lastEl.offsetHeight : NODE_APPROX_H;
    nodePositions['__end__'] = { x: COL_X, y: lastPos.y + lastH + NODE_GAP_Y };
  }

  // ─── Render ───────────────────────────────────
  function renderAll() {
    renderNodes();
    // Wait a tick so offsetHeight is available
    setTimeout(function () {
      recalcEndPosition();
      updateEndNodePosition();
      renderConnections();
      updateCanvasSize();
    }, 0);
  }

  function renderNodes() {
    // Remove existing dynamic nodes
    $canvas.querySelectorAll('.flow-node').forEach(function (n) { n.remove(); });

    renderStartNode();

    const sorted = questions.slice().sort((a, b) => a.sort_order - b.sort_order);
    for (const q of sorted) {
      renderQuestionNode(q);
    }

    renderEndNode();
  }

  function renderStartNode() {
    const pos = nodePositions['__start__'] || { x: COL_X, y: ROW_START_Y };
    const el = makeEl('div', 'flow-node node-start');
    el.id = 'node-__start__';
    el.style.left = pos.x + 'px';
    el.style.top  = pos.y + 'px';
    el.style.width = NODE_W + 'px';
    el.innerHTML =
      '<div class="node-header">' +
        '<span class="node-type-badge" style="background:#c8f0e0;color:#0a5a3a">START</span>' +
      '</div>' +
      '<div class="node-text" style="color:#0a5a3a">開始</div>';
    $canvas.appendChild(el);
  }

  function renderEndNode() {
    const pos = nodePositions['__end__'] || { x: COL_X, y: 400 };
    const existing = document.getElementById('node-__end__');
    if (existing) existing.remove();

    const el = makeEl('div', 'flow-node node-end');
    el.id = 'node-__end__';
    el.style.left = pos.x + 'px';
    el.style.top  = pos.y + 'px';
    el.style.width = NODE_W + 'px';
    el.innerHTML =
      '<div class="node-header">' +
        '<span class="node-type-badge" style="background:#fcd8c8;color:#7a3020">END</span>' +
      '</div>' +
      '<div class="node-text" style="color:#7a3020">終了</div>';
    el.addEventListener('click', function () { selectNode('__end__'); });
    $canvas.appendChild(el);
  }

  function updateEndNodePosition() {
    const el = document.getElementById('node-__end__');
    if (!el) return;
    const pos = nodePositions['__end__'];
    if (!pos) return;
    el.style.left = pos.x + 'px';
    el.style.top  = pos.y + 'px';
  }

  function renderQuestionNode(q) {
    const pos = nodePositions[q.id] || { x: COL_X, y: 100 };
    const el = makeEl('div', 'flow-node' + (q.ai_probe_enabled ? ' node-ai' : ''));
    el.id = 'node-' + q.id;
    el.style.left = pos.x + 'px';
    el.style.top  = pos.y + 'px';
    el.style.width = NODE_W + 'px';
    if (selectedId === q.id) el.classList.add('selected');

    const typeLabel = getTypeLabel(q.question_type);
    const branchRule = (q.branch_rule && !Array.isArray(q.branch_rule)) ? q.branch_rule : {};
    const branchCount = (branchRule.branches || []).length;

    const badgesHtml =
      (q.is_required ? '<span class="node-badge required">必須</span>' : '') +
      (q.ai_probe_enabled ? '<span class="node-badge ai">AI深掘</span>' : '') +
      (branchCount > 0 ? '<span class="node-badge branch">' + branchCount + '分岐</span>' : '') +
      (branchRule.default_next ? '<span class="node-badge">→' + esc(branchRule.default_next) + '</span>' : '');

    const textPreview = q.question_text.length > 55 ? q.question_text.slice(0, 55) + '…' : q.question_text;

    el.innerHTML =
      '<div class="node-header">' +
        '<span class="node-code">' + esc(q.question_code) + '</span>' +
        '<span class="node-type-badge">' + esc(typeLabel) + '</span>' +
        '<span class="node-order">#' + q.sort_order + '</span>' +
      '</div>' +
      '<div class="node-text">' + esc(textPreview) + '</div>' +
      '<div class="node-meta">' + badgesHtml + '</div>';

    el.addEventListener('click', function (e) {
      if (dragState && dragState.moved) return;
      selectNode(q.id);
    });
    el.addEventListener('mousedown', function (e) { startDrag(e, q.id); });

    $canvas.appendChild(el);
  }

  // ─── Connections (SVG arrows) ──────────────────
  function renderConnections() {
    // Clear SVG content
    while ($svg.firstChild) $svg.removeChild($svg.firstChild);

    const defs = createSvgEl('defs');
    $svg.appendChild(defs);

    const sorted = questions.slice().sort((a, b) => a.sort_order - b.sort_order);

    // START → first question (or END)
    if (sorted.length > 0) {
      drawArrow(defs, '__start__', sorted[0].id, '', '#6abfa0', false);
    } else {
      drawArrow(defs, '__start__', '__end__', '', '#6abfa0', false);
    }

    for (let i = 0; i < sorted.length; i++) {
      const q = sorted[i];
      const branchRule = (q.branch_rule && !Array.isArray(q.branch_rule)) ? q.branch_rule : {};

      // Conditional branches (orange)
      for (const branch of (branchRule.branches || [])) {
        if (!branch.next) continue;
        const label = getBranchLabel(branch);
        if (branch.next === 'END') {
          drawArrow(defs, q.id, '__end__', label, '#dda020', true);
        } else {
          const targetQ = questions.find(function (x) { return x.question_code === branch.next; });
          if (targetQ) drawArrow(defs, q.id, targetQ.id, label, '#dda020', true);
        }
      }

      // Default next / sequential
      if (branchRule.default_next) {
        if (branchRule.default_next === 'END') {
          drawArrow(defs, q.id, '__end__', 'default', '#2ca87a', false);
        } else {
          const targetQ = questions.find(function (x) { return x.question_code === branchRule.default_next; });
          if (targetQ) drawArrow(defs, q.id, targetQ.id, 'default', '#2ca87a', false);
        }
      } else {
        // Sequential
        const nextQ = sorted[i + 1];
        if (nextQ) {
          drawArrow(defs, q.id, nextQ.id, '', '#aec8c4', false);
        } else {
          drawArrow(defs, q.id, '__end__', '', '#aec8c4', false);
        }
      }
    }
  }

  function getNodeBox(nodeId) {
    const el = document.getElementById('node-' + nodeId);
    if (!el) return null;
    return {
      x: parseInt(el.style.left, 10) || 0,
      y: parseInt(el.style.top, 10)  || 0,
      w: el.offsetWidth  || NODE_W,
      h: el.offsetHeight || NODE_APPROX_H,
    };
  }

  function drawArrow(defs, fromId, toId, label, color, isDashed) {
    const fromBox = getNodeBox(fromId);
    const toBox   = getNodeBox(toId);
    if (!fromBox || !toBox) return;

    const markerId = 'mk-' + fromId.replace(/\W/g, '') + '-' + toId.replace(/\W/g, '') + '-' + (Math.random() * 1e6 | 0);

    // Arrowhead marker
    const marker = createSvgEl('marker');
    marker.setAttribute('id', markerId);
    marker.setAttribute('markerWidth', '7');
    marker.setAttribute('markerHeight', '7');
    marker.setAttribute('refX', '6');
    marker.setAttribute('refY', '3');
    marker.setAttribute('orient', 'auto');
    const poly = createSvgEl('polygon');
    poly.setAttribute('points', '0 0, 7 3, 0 6');
    poly.setAttribute('fill', color);
    marker.appendChild(poly);
    defs.appendChild(marker);

    // Bezier from bottom-center of from to top-center of to
    const x1 = fromBox.x + fromBox.w / 2;
    const y1 = fromBox.y + fromBox.h;
    const x2 = toBox.x  + toBox.w  / 2;
    const y2 = toBox.y;

    // If target is above source (backward branch), arc to the side
    let pathD;
    if (y2 < y1 - 10) {
      // Backward: route through the right side
      const sideX = fromBox.x + fromBox.w + 40;
      const midY1 = fromBox.y + fromBox.h / 2;
      const midY2 = toBox.y   + toBox.h   / 2;
      pathD = 'M ' + x1 + ' ' + (fromBox.y + fromBox.h / 2) +
              ' L ' + sideX + ' ' + midY1 +
              ' L ' + sideX + ' ' + midY2 +
              ' L ' + (toBox.x + toBox.w) + ' ' + midY2;
      // Start from right side of fromBox
      pathD = 'M ' + (fromBox.x + fromBox.w) + ' ' + (fromBox.y + fromBox.h / 2) +
              ' C ' + sideX + ' ' + midY1 + ', ' + sideX + ' ' + midY2 + ', ' + (toBox.x + toBox.w) + ' ' + midY2;
    } else {
      const cy = (y1 + y2) / 2;
      pathD = 'M ' + x1 + ' ' + y1 + ' C ' + x1 + ' ' + cy + ', ' + x2 + ' ' + cy + ', ' + x2 + ' ' + (y2 - 1);
    }

    const path = createSvgEl('path');
    path.setAttribute('d', pathD);
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', '1.8');
    path.setAttribute('fill', 'none');
    path.setAttribute('marker-end', 'url(#' + markerId + ')');
    if (isDashed) path.setAttribute('stroke-dasharray', '5 3');
    $svg.appendChild(path);

    // Label
    if (label) {
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;
      const bg = createSvgEl('rect');
      const textEl = createSvgEl('text');
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
    const w = branch.when || {};
    if (w.equals   !== undefined) return '=' + w.equals;
    if (w.any_of   !== undefined) return '∈[' + (w.any_of || []).join(',') + ']';
    if (w.includes !== undefined) return '含' + w.includes;
    if (w.gte      !== undefined) return '≥' + w.gte;
    if (w.lte      !== undefined) return '≤' + w.lte;
    return '';
  }

  function updateCanvasSize() {
    let maxBottom = 400, maxRight = NODE_W + COL_X + 120;
    $canvas.querySelectorAll('.flow-node').forEach(function (el) {
      const b = parseInt(el.style.top, 10) + el.offsetHeight;
      const r = parseInt(el.style.left, 10) + el.offsetWidth;
      if (b > maxBottom) maxBottom = b;
      if (r > maxRight)  maxRight  = r;
    });
    $canvas.style.minHeight = (maxBottom + 80) + 'px';
    $canvas.style.minWidth  = (maxRight  + 80) + 'px';
  }

  // ─── Selection ────────────────────────────────
  function selectNode(id) {
    selectedId = id;
    $canvas.querySelectorAll('.flow-node').forEach(function (n) { n.classList.remove('selected'); });
    const el = document.getElementById('node-' + id);
    if (el) el.classList.add('selected');

    if (id === '__start__') {
      showRightPanelSpecial('start');
    } else if (id === '__end__') {
      showRightPanelSpecial('end');
    } else {
      const q = questions.find(function (x) { return x.id === id; });
      if (q) showRightPanel(q);
    }
    updateToolbarState();
  }

  function clearSelection() {
    selectedId = null;
    $canvas.querySelectorAll('.flow-node').forEach(function (n) { n.classList.remove('selected'); });
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
    const label = type === 'start' ? '開始ノード' : '終了ノード';
    const desc  = type === 'start'
      ? 'アンケート/インタビューの開始点です。\n最初の質問から処理が始まります。'
      : 'アンケート/インタビューの終了点です。\nここに到達したら回答が完了します。';
    $rightPanel.innerHTML =
      '<div class="rp-header"><h3>' + label + '</h3></div>' +
      '<div class="rp-body"><p style="color:#60726f;font-size:12px;white-space:pre-line">' + esc(desc) + '</p></div>';
  }

  // ─── Right panel: question form ───────────────
  function showRightPanel(q) {
    const config    = (q.question_config || {});
    const meta      = (config.meta || {});
    const opts      = (config.options || []);
    const branchRule = (q.branch_rule && !Array.isArray(q.branch_rule)) ? q.branch_rule : {};

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
      const btn = e.target.closest('.rp-tab');
      if (!btn) return;
      activeRpTab = btn.getAttribute('data-tab');
      document.querySelectorAll('.rp-tab').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      document.querySelectorAll('.rp-tab-pane').forEach(function (p) { p.classList.remove('active'); });
      const pane = document.getElementById('rp-tab-' + activeRpTab);
      if (pane) pane.classList.add('active');
    });

    // AI probe toggle
    const aiChk = document.getElementById('rp-ai_probe');
    if (aiChk) {
      aiChk.addEventListener('change', function () {
        const opts = document.getElementById('rp-ai-options');
        if (opts) opts.style.display = this.checked ? '' : 'none';
      });
    }
  }

  function buildRpTabBasic(q, meta) {
    const activeClass = activeRpTab === 'basic' ? ' active' : '';
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
    const activeClass = activeRpTab === 'answer' ? ' active' : '';
    const CHOICE_TYPES = ['single_select','multi_select','single_choice','multi_choice','yes_no','hidden_single','hidden_multi','text_with_image','sd'];
    const isChoice = CHOICE_TYPES.includes(q.question_type);
    const allTypeOpts = [
      ['text','テキスト（旧）'],['single_select','単一選択（旧）'],['multi_select','複数選択（旧）'],
      ['yes_no','はい/いいえ（旧）'],['scale','スケール（旧）'],
      ['single_choice','単一選択'],['multi_choice','複数選択'],
      ['free_text_short','短文自由記述'],['free_text_long','長文自由記述'],
      ['numeric','数値入力'],['matrix_single','マトリクス（単一）'],['matrix_multi','マトリクス（複数）'],
      ['matrix_mixed','マトリクス（混合）'],['image_upload','画像アップロード'],
      ['hidden_single','隠し項目（単一）'],['hidden_multi','隠し項目（複数）'],
      ['text_with_image','テキスト+画像選択肢'],['sd','SD法'],
    ];
    const typeSelOpts = allTypeOpts.map(function (t) {
      return '<option value="' + t[0] + '"' + (q.question_type === t[0] ? ' selected' : '') + '>' + t[1] + '</option>';
    }).join('');

    const optRows = isChoice ? opts.map(function (o, i) {
      return '<div class="rp-option-row" data-idx="' + i + '">' +
        '<input type="text" class="rp-opt-input" value="' + esc(o.label || '') + '" />' +
        '<button type="button" class="rp-del-btn" data-del-opt="' + i + '">✕</button>' +
      '</div>';
    }).join('') : '';

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
      '</div>'
    );
  }

  function buildRpTabBranch(q, branchRule) {
    const activeClass = activeRpTab === 'branch' ? ' active' : '';
    const branches = branchRule.branches || [];

    const allNextOpts = questions
      .filter(function (x) { return x.id !== q.id; })
      .map(function (x) {
        const sel = branchRule.default_next === x.question_code ? ' selected' : '';
        return '<option value="' + esc(x.question_code) + '"' + sel + '>' + esc(x.question_code) + ': ' + esc(x.question_text.slice(0, 20)) + '</option>';
      }).join('');

    const defaultNextSel =
      '<select id="rp-default_next">' +
        '<option value="">次の質問（順番通り）</option>' +
        '<option value="END"' + (branchRule.default_next === 'END' ? ' selected' : '') + '>END（終了）</option>' +
        allNextOpts +
      '</select>';

    const branchRowsHtml = branches.map(function (b, i) {
      const w = b.when || {};
      const condStr =
        w.equals   !== undefined ? 'equals:'   + w.equals :
        w.any_of   !== undefined ? 'any_of:'   + (w.any_of || []).join(',') :
        w.includes !== undefined ? 'includes:' + w.includes :
        w.gte      !== undefined ? 'gte:'      + w.gte :
        w.lte      !== undefined ? 'lte:'      + w.lte : '';
      return (
        '<div class="rp-branch-row" data-bidx="' + i + '">' +
          '<div class="rp-row">' +
            '<div class="rp-field"><label>条件</label><input type="text" class="rp-branch-cond" value="' + esc(condStr) + '" placeholder="equals:1" /></div>' +
            '<div class="rp-field"><label>遷移先コード</label><input type="text" class="rp-branch-next" value="' + esc(b.next || '') + '" placeholder="q2 or END" /></div>' +
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

  // Delegate events for dynamic elements in right panel
  document.addEventListener('click', function (e) {
    // Delete option button
    if (e.target.hasAttribute('data-del-opt')) {
      const idx = parseInt(e.target.getAttribute('data-del-opt'), 10);
      const rows = document.querySelectorAll('#rp-option-rows .rp-option-row');
      if (rows[idx]) rows[idx].remove();
      return;
    }
    // Delete branch button
    if (e.target.hasAttribute('data-del-branch')) {
      const idx = parseInt(e.target.getAttribute('data-del-branch'), 10);
      const rows = document.querySelectorAll('#rp-branch-rows .rp-branch-row');
      if (rows[idx]) rows[idx].remove();
      return;
    }
    // Add option button
    if (e.target.id === 'rp-add-opt') {
      const container = document.getElementById('rp-option-rows');
      if (!container) return;
      const idx = container.querySelectorAll('.rp-option-row').length;
      const row = document.createElement('div');
      row.className = 'rp-option-row';
      row.setAttribute('data-idx', idx);
      row.innerHTML = '<input type="text" class="rp-opt-input" value="" /><button type="button" class="rp-del-btn" data-del-opt="' + idx + '">✕</button>';
      container.appendChild(row);
      return;
    }
    // Add branch button
    if (e.target.id === 'rp-add-branch') {
      const container = document.getElementById('rp-branch-rows');
      if (!container) return;
      const idx = container.querySelectorAll('.rp-branch-row').length;
      const row = document.createElement('div');
      row.className = 'rp-branch-row';
      row.setAttribute('data-bidx', idx);
      row.innerHTML =
        '<div class="rp-row">' +
          '<div class="rp-field"><label>条件</label><input type="text" class="rp-branch-cond" value="" placeholder="equals:1" /></div>' +
          '<div class="rp-field"><label>遷移先コード</label><input type="text" class="rp-branch-next" value="" placeholder="q2 or END" /></div>' +
        '</div>' +
        '<button type="button" class="rp-add-btn" style="color:#c04040;border-color:#e8c0c0" data-del-branch="' + idx + '">削除</button>';
      container.appendChild(row);
      return;
    }
  });

  // ─── Collect right panel data ─────────────────
  function collectRpData() {
    const q = questions.find(function (x) { return x.id === selectedId; });
    if (!q) return null;

    const val = function (id) {
      const el = document.getElementById(id);
      return el ? el.value : '';
    };
    const checked = function (id) {
      const el = document.getElementById(id);
      return el ? el.checked : false;
    };

    const questionText  = val('rp-question_text').trim();
    const questionType  = val('rp-question_type') || q.question_type;
    const questionRole  = val('rp-question_role') || q.question_role;
    const sortOrder     = parseInt(val('rp-sort_order'), 10) || q.sort_order;
    const isRequired    = checked('rp-is_required');
    const aiProbe       = checked('rp-ai_probe');
    const probeGuideline = aiProbe ? (val('rp-probe_guideline').trim() || null) : null;
    const maxProbeCount  = aiProbe ? (parseInt(val('rp-max_probe_count'), 10) || null) : null;
    const questionGoal  = val('rp-question_goal').trim();
    const defaultNext   = val('rp-default_next') || null;

    // Options
    const optInputs = document.querySelectorAll('#rp-option-rows .rp-opt-input');
    const options = Array.from(optInputs).map(function (i) { return i.value.trim(); }).filter(Boolean);

    // Branches
    const branchRowEls = document.querySelectorAll('#rp-branch-rows .rp-branch-row');
    const branches = [];
    branchRowEls.forEach(function (row) {
      const condStr  = (row.querySelector('.rp-branch-cond')  || {}).value || '';
      const nextCode = (row.querySelector('.rp-branch-next') || {}).value || '';
      if (!condStr.trim() || !nextCode.trim()) return;
      const when = parseBranchCond(condStr.trim());
      if (when) branches.push({ source: 'answer', when: when, next: nextCode.trim() });
    });

    const branchRule = (defaultNext || branches.length > 0) ? {
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
    };
  }

  function parseBranchCond(str) {
    const colon = str.indexOf(':');
    if (colon < 0) return { equals: parseScalar(str) };
    const op  = str.slice(0, colon).trim();
    const val = str.slice(colon + 1).trim();
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
    const q = questions.find(function (x) { return x.id === selectedId; });
    if (!q) return;

    const payload = collectRpData();
    if (!payload) return;

    if (!payload.question_text) { showStatus('設問文を入力してください', 'error'); return; }
    if (!payload.question_goal) { showStatus('この質問で知りたいことを入力してください', 'error'); return; }

    const btn = document.getElementById('rpSaveBtn');
    if (btn) { btn.textContent = '保存中…'; btn.disabled = true; }

    try {
      const resp = await fetch('/admin/api/questions/' + q.id, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(function () { return {}; });
        showStatus('保存失敗: ' + (err.error || resp.statusText), 'error');
        return;
      }
      const result = await resp.json();
      const idx = questions.findIndex(function (x) { return x.id === selectedId; });
      if (idx >= 0) {
        questions[idx] = result.question || Object.assign({}, questions[idx], payload);
      }
      renderAll();
      showStatus('保存しました ✓', 'success');
      selectNode(selectedId);
    } catch (e) {
      showStatus('保存中にエラー: ' + e.message, 'error');
    } finally {
      if (btn) { btn.textContent = '保存'; btn.disabled = false; }
    }
  }

  // ─── Delete ───────────────────────────────────
  async function deleteCurrentNode() {
    if (!selectedId || ['__start__','__end__'].includes(selectedId)) return;
    const q = questions.find(function (x) { return x.id === selectedId; });
    if (!q) return;
    if (!confirm('「' + q.question_text.slice(0, 30) + '」を削除しますか？')) return;

    try {
      const resp = await fetch('/admin/api/questions/' + q.id + '/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!resp.ok) {
        const err = await resp.json().catch(function () { return {}; });
        showStatus('削除失敗: ' + (err.error || resp.statusText), 'error');
        return;
      }
      questions = questions.filter(function (x) { return x.id !== selectedId; });
      delete nodePositions[selectedId];
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
    const maxOrder = questions.length > 0
      ? Math.max.apply(null, questions.map(function (q) { return q.sort_order; }))
      : 0;
    const payload = {
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
      const resp = await fetch('/admin/api/projects/' + DATA.projectId + '/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(function () { return {}; });
        showStatus('追加失敗: ' + (err.error || resp.statusText), 'error');
        return;
      }
      const result = await resp.json();
      if (result.question) {
        questions.push(result.question);
        // Position: below current last node
        computeInitialPositions();
        renderAll();
        setTimeout(function () { selectNode(result.question.id); }, 60);
        showStatus('質問を追加しました ✓', 'success');
      }
    } catch (e) {
      showStatus('追加中にエラー: ' + e.message, 'error');
    }
  }

  // ─── Drag ─────────────────────────────────────
  function startDrag(e, nodeId) {
    if (['BUTTON','INPUT','SELECT','TEXTAREA','A'].includes(e.target.tagName)) return;
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
    if (!dragState) return;
    const dx = e.clientX - dragState.startClientX;
    const dy = e.clientY - dragState.startClientY;
    if (!dragState.moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
    dragState.moved = true;

    const nx = Math.max(0, dragState.startNodeX + dx);
    const ny = Math.max(0, dragState.startNodeY + dy);
    nodePositions[dragState.nodeId] = { x: nx, y: ny };

    const el = document.getElementById('node-' + dragState.nodeId);
    if (el) { el.style.left = nx + 'px'; el.style.top = ny + 'px'; }

    renderConnections();
    updateCanvasSize();
  });

  document.addEventListener('mouseup', function () {
    dragState = null;
  });

  // ─── Toolbar ──────────────────────────────────
  function bindToolbar() {
    on('tb-add-question', 'click', function () { addQuestionNode(false); });
    on('tb-add-ai',       'click', function () { addQuestionNode(true); });
    on('tb-add-end',      'click', function () {
      const el = document.getElementById('node-__end__');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    on('tb-save',  'click', function () { saveCurrentNode(); });
    on('tb-back',  'click', function () {
      window.location.href = '/admin/projects/' + DATA.projectId + '/questions';
    });
    on('tb-preview', 'click', function () {
      window.open('/admin/projects/' + DATA.projectId + '/questions', '_blank');
    });
    on('tb-zoom-in',  'click', function () { setZoom(zoom + 0.15); });
    on('tb-zoom-out', 'click', function () { setZoom(zoom - 0.15); });
    on('tb-fit',      'click', function () { setZoom(1); $canvasWrapper.scrollTo(0, 0); });
  }

  function setZoom(z) {
    zoom = Math.max(0.3, Math.min(2.0, z));
    $canvas.style.transform = zoom !== 1 ? 'scale(' + zoom + ')' : '';
    $canvas.style.transformOrigin = 'top left';
  }

  function updateToolbarState() {
    const hasQ = selectedId && !['__start__','__end__'].includes(selectedId);
    const saveBtn = document.getElementById('tb-save');
    if (saveBtn) saveBtn.disabled = !hasQ;
  }

  // ─── Left panel ───────────────────────────────
  function bindLeftPanel() {
    document.querySelectorAll('.part-item').forEach(function (item) {
      item.addEventListener('click', function () {
        const type = item.getAttribute('data-type');
        if (type === 'question') addQuestionNode(false);
        else if (type === 'ai')  addQuestionNode(true);
        else if (type === 'end') {
          const el = document.getElementById('node-__end__');
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

  // ─── Helpers ──────────────────────────────────
  function makeEl(tag, cls) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    return el;
  }

  function createSvgEl(tag) {
    return document.createElementNS('http://www.w3.org/2000/svg', tag);
  }

  function on(id, event, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, fn);
  }

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function getTypeLabel(type) {
    const map = {
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

  // ─── Public API (for inline onclick) ──────────
  window.FlowCanvas = {
    saveCurrentNode:   saveCurrentNode,
    deleteCurrentNode: deleteCurrentNode,
  };

})();
