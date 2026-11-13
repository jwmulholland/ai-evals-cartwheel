/* Tiny markdown renderer: headings, paragraphs, bold/italic, inline code,
   lists, tables, fenced code, horizontal rules. Requirement ids such as
   **RESP-2.** get class "reqid" and data-req="RESP-2". No dependencies. */
(function () {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  function inline(src) {
    const codes = [];
    let s = src.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
    s = esc(s);
    s = s.replace(/\*\*([^*]+)\*\*/g, (_, t) => {
      const m = t.match(/^([A-Z]+-\d+)\.?$/);
      return m ? `<strong class="reqid" data-req="${m[1]}">${t}</strong>` : `<strong>${t}</strong>`;
    });
    s = s.replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:]|$)/g, '$1<em>$2</em>');
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<span class="mdlink">$1</span>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
  }

  function cells(line) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  }

  function render(md) {
    const lines = md.replace(/\r/g, '').split('\n');
    const out = [], toc = [];
    let i = 0, hn = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      let m;
      if (/^```/.test(line)) {
        const buf = []; i++;
        while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
        i++; out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`); continue;
      }
      if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
        const level = m[1].length, id = 'h-' + (hn++);
        if (level <= 3) toc.push({ level, id, text: m[2].replace(/[`*]/g, '') });
        out.push(`<h${level} id="${id}">${inline(m[2])}</h${level}>`); i++; continue;
      }
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
      if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
        const head = cells(line); i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
        out.push('<div class="tablewrap"><table><thead><tr>' + head.map(h => `<th>${inline(h)}</th>`).join('') +
          '</tr></thead><tbody>' + rows.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
          '</tbody></table></div>');
        continue;
      }
      if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
        const ordered = /^\s*\d+\./.test(line), items = [];
        while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
          let t = lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''); i++;
          while (i < lines.length && lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i])) t += ' ' + lines[i++].trim();
          items.push(t);
        }
        const tag = ordered ? 'ol' : 'ul';
        out.push(`<${tag}>` + items.map(t => `<li>${inline(t)}</li>`).join('') + `</${tag}>`); continue;
      }
      const buf = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\s*([-*]|\d+\.)\s+|\s*---+\s*$)/.test(lines[i]) &&
             !(lines[i].includes('|') && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || ''))) buf.push(lines[i++]);
      if (!buf.length) { buf.push(lines[i++]); }
      out.push(`<p>${inline(buf.join(' '))}</p>`);
    }
    return { html: out.join('\n'), toc };
  }
  window.MD = { render, esc };
})();
