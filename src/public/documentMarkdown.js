(function () {
  function escHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderInline(value) {
    return escHtml(value)
      .replace(/&lt;br&gt;/g, "<br>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  }

  function splitTableRow(line) {
    const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
    const cells = [];
    let current = "";
    let escaped = false;
    for (const ch of trimmed) {
      if (escaped) {
        current += ch;
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "|") {
        cells.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    cells.push(current.trim());
    return cells;
  }

  function isTableSeparator(line) {
    return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
  }

  function renderTable(lines) {
    if (lines.length < 2 || !isTableSeparator(lines[1])) {
      return null;
    }
    const headers = splitTableRow(lines[0]);
    const rows = lines.slice(2).map(splitTableRow);
    const thead = `<thead><tr>${headers.map((cell) => `<th>${renderInline(cell)}</th>`).join("")}</tr></thead>`;
    const tbody = rows.length
      ? `<tbody>${rows.map((row) => `<tr>${headers.map((_, index) => `<td>${renderInline(row[index] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody>`
      : "";
    return `<div class="doc-table-wrap"><table class="doc-markdown-table">${thead}${tbody}</table></div>`;
  }

  function render(markdown) {
    const lines = String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n");
    const html = [];
    const paragraph = [];
    let listType = null;

    function flushParagraph() {
      if (paragraph.length === 0) return;
      html.push(`<p>${paragraph.map(renderInline).join("<br>")}</p>`);
      paragraph.length = 0;
    }

    function flushList() {
      if (!listType) return;
      html.push(`</${listType}>`);
      listType = null;
    }

    function openList(type) {
      flushParagraph();
      if (listType === type) return;
      flushList();
      listType = type;
      html.push(`<${type}>`);
    }

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const line = rawLine.trim();

      if (!line) {
        if (listType) {
          const nextLine = lines.slice(i + 1).find((candidate) => candidate.trim());
          const nextTrimmed = nextLine ? nextLine.trim() : "";
          if (
            (listType === "ul" && /^[-*]\s+/.test(nextTrimmed)) ||
            (listType === "ol" && /^\d+\.\s+/.test(nextTrimmed))
          ) {
            continue;
          }
        }
        flushParagraph();
        flushList();
        continue;
      }

      if (line.startsWith("|")) {
        const tableLines = [];
        let j = i;
        while (j < lines.length && lines[j].trim().startsWith("|")) {
          tableLines.push(lines[j]);
          j++;
        }
        const renderedTable = renderTable(tableLines);
        if (renderedTable) {
          flushParagraph();
          flushList();
          html.push(renderedTable);
          i = j - 1;
          continue;
        }
      }

      const heading = line.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        flushParagraph();
        flushList();
        const level = heading[1].length;
        html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
        continue;
      }

      const unordered = line.match(/^[-*]\s+(.+)$/);
      if (unordered) {
        openList("ul");
        html.push(`<li>${renderInline(unordered[1])}</li>`);
        continue;
      }

      const ordered = line.match(/^\d+\.\s+(.+)$/);
      if (ordered) {
        openList("ol");
        html.push(`<li>${renderInline(ordered[1])}</li>`);
        continue;
      }

      flushList();
      paragraph.push(rawLine.trim());
    }

    flushParagraph();
    flushList();
    return html.join("");
  }

  window.DocumentMarkdown = { render, escHtml };
})();
