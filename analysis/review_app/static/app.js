/* Cartwheel trace review UI. Vanilla JS, no network except same-origin /api. */
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = p => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const REQ_RE = /\b((?:AUTH|ESC|RESP|SCOPE|TOOL|PURPOSE)-\d+)\b/g;
const linkReqs = html => html.replace(REQ_RE, '<span class="req" role="button" tabindex="0" data-req="$1" title="Open $1 in the spec">$1</span>');
const FINAL_STATUSES = ['confirmed', 'final', 'frozen'];

const S = {
  sessions: [], byTrace: {}, blocks: {}, annotations: [], suggestions: [], patterns: { modes: [] },
  labels: {}, graph: { nodes: [], clusters: [] }, source: {}, sampledIds: new Set(),
  cur: null, tab: 'review', q: '', expanded: new Set(), showAll: new Set(), detailsOpen: false,
  labelFilter: 'all', specText: null,
  drafts: {}, judges: {}, lmode: null, ldraft: 'all', ljudged: 'all', ljudge: 'all', active: null,   // Label tab: drafts = mode -> trace -> {draft, reason}
  manifest: {}, batch: 'all', sort: 'id',   // manifest: trace_id -> pick ({batch, method, cluster, reason})
};
const batchesOf = () => [...new Set(Object.values(S.manifest).map(p => p.batch).filter(b => b != null))].sort((a, b) => a - b);
const pickTag = p => (p.batch == null ? 'thread sibling' : `batch ${p.batch} · ${p.method}${p.value ? ' · ' + p.value : ''}`) + (p.hw5_split ? ` · HW5 ${p.hw5_split}` : '');
const railBadge = ps => { const bs = [...new Set(ps.map(p => p.batch).filter(b => b != null))].sort((a, b) => a - b); return bs.length ? bs.map(b => 'B' + b).join('+') : 'sib'; };
const inBatch = t => { const p = S.manifest[t]; if (!p) return false; if (S.batch === 'all') return true; if (S.batch.startsWith('hw5:')) return p.hw5_split === S.batch.slice(4); return String(p.batch) === S.batch; };
const batchTraces = s => s.trace_ids.filter(inBatch);
function fillBatchSelect() {
  const sel = $('#batch'), bs = batchesOf();
  sel.innerHTML = `<option value="all">all (${allTraceIds().length})</option>` + bs.map(b => `<option value="${b}">batch ${b} (${Object.values(S.manifest).filter(p => p.batch === b).length})</option>`).join('')
    + ['train', 'dev', 'test'].map(k => `<option value="hw5:${k}">HW5 ${k} (${Object.values(S.manifest).filter(p => p.hw5_split === k).length})</option>`).join('');
  sel.value = S.batch;
}

/* ------------------------------------------------------------ api + save */
const api = {
  async get(p) { const r = await fetch(p); if (!r.ok) throw new Error(p + ' ' + r.status); return r.json(); },
  async post(p, body) {
    const r = await fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(p + ' ' + r.status); return r.json();
  },
};
let saveChain = Promise.resolve();
function setSave(state, msg) {
  const el = $('#savestate'); el.className = 'savestate' + (state === 'error' ? ' error' : '');
  el.textContent = state === 'saving' ? 'saving…' : state === 'error' ? 'SAVE FAILED, local backup kept: ' + (msg || '') : 'all changes saved';
}
function backup() {
  try { localStorage.setItem('cartwheel_review_backup_v1', JSON.stringify({ ts: Date.now(), annotations: S.annotations, suggestions: S.suggestions, patterns: S.patterns })); } catch (e) { /* storage may be unavailable */ }
}
function readBackup() { try { return JSON.parse(localStorage.getItem('cartwheel_review_backup_v1') || 'null'); } catch (e) { return null; } }
function persist(what) { // 'annotations' | 'suggestions' | 'patterns'
  backup(); setSave('saving');
  const body = what === 'patterns' ? S.patterns : S[what];
  saveChain = saveChain.then(() => api.post('/api/' + what, body)).then(() => setSave('saved')).catch(e => setSave('error', e.message));
  return saveChain;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2600); }

/* ------------------------------------------------------------ derived data */
const noteAnns = () => S.annotations.filter(a => a.kind !== 'no_failure');
const isReviewed = tid => S.annotations.some(a => a.trace_id === tid);
const modeName = m => m.name || m.mode || m.id;
function normModes(p) {
  let list = [];
  if (Array.isArray(p)) list = p;
  else if (p && Array.isArray(p.modes)) list = p.modes;
  else if (p && typeof p === 'object') list = Object.entries(p).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v)).map(([name, v]) => ({ name, ...v }));
  return list.map(m => ({ ...m, name: modeName(m) })).filter(m => m.name);
}
const modes = () => S.patterns.modes;
function finalModes() { const f = modes().filter(m => FINAL_STATUSES.includes(String(m.status || '').toLowerCase())); return f; }
const sessionOf = tid => S.byTrace[tid];
const sessionReviewState = s => { const n = s.trace_ids.filter(isReviewed).length; return n === 0 ? '' : n === s.trace_ids.length ? 'full' : 'half'; };

function indexData() {
  S.byTrace = {}; S.blocks = {};
  for (const s of S.sessions) for (const t of s.turns) {
    S.byTrace[t.trace_id] = s;
    S.blocks[t.trace_id + ':user'] = t.user; S.blocks[t.trace_id + ':reply'] = t.final;
    t.steps.forEach((st, i) => { if (st.narration) S.blocks[`${t.trace_id}:step:${i}`] = st.narration; });
  }
  for (const s of S.sessions) {
    s._blob = [s.scenario_id, s.role, s.user_id, ...s.turns.flatMap(t => [t.user, t.final, ...t.steps.map(x => x.narration || '')])].join(' \n ').toLowerCase();
  }
}
function blocksOfTrace(tid) { return Object.keys(S.blocks).filter(k => k.startsWith(tid + ':')).sort((a, b) => (a.endsWith(':reply') ? -1 : b.endsWith(':reply') ? 1 : 0)); }
/* Anchor a suggestion: trust block+offsets when the quote still matches, else find the quote. */
function resolveSugg(s) {
  if (s._r !== undefined) return s._r;
  let r = null;
  const t = S.blocks[s.block];
  if (s.block && t != null && s.start != null && s.end != null && (!s.quote || t.slice(s.start, s.end) === s.quote)) r = { block: s.block, start: s.start, end: s.end };
  else if (s.quote) for (const b of blocksOfTrace(s.trace_id)) { const i = (S.blocks[b] || '').indexOf(s.quote); if (i >= 0) { r = { block: b, start: i, end: i + s.quote.length }; break; } }
  Object.defineProperty(s, '_r', { value: r, enumerable: false, writable: true });
  return r;
}
const pendingSuggs = () => S.suggestions.filter(s => (s.status || 'pending') === 'pending');

/* ------------------------------------------------------------ highlights */
function anchorsFor(blockId) {
  const items = [];
  for (const a of noteAnns()) if (a.block === blockId && a.end > a.start) items.push({ id: a.id, start: a.start, end: a.end, sugg: false });
  if (S.tab !== 'label') for (const s of pendingSuggs()) { const r = resolveSugg(s); if (r && r.block === blockId) items.push({ id: s.id, start: r.start, end: r.end, sugg: true }); }
  return items;
}
/* Per-character markdown flags. The raw text is never altered (annotation offsets index into it):
   markdown markers stay in the DOM but are hidden with CSS, so rendered text and offsets still line up. */
const MD_HIDE = 1, MD_B = 2, MD_I = 4, MD_C = 8;
const MD_CLS = [[MD_HIDE, 'mx'], [MD_B, 'md-b'], [MD_I, 'md-i'], [MD_C, 'md-c']];
function mdFlags(text) {
  const f = new Uint8Array(text.length); let mask = text;
  const blank = (a, b) => { mask = mask.slice(0, a) + ' '.repeat(b - a) + mask.slice(b); };
  const set = (a, b, v) => { for (let i = a; i < b; i++) f[i] |= v; };
  let m, re;
  re = /^(#{1,6})[ \t]+([^\n]*)/gm;
  while ((m = re.exec(text))) { set(m.index, m.index + m[0].length - m[2].length, MD_HIDE); set(m.index + m[0].length - m[2].length, m.index + m[0].length, MD_B); }
  re = /^([ \t]*)([*-])[ \t]/gm;
  while ((m = re.exec(mask))) blank(m.index, m.index + m[0].length);
  re = /`([^`\n]+)`/g;
  while ((m = re.exec(mask))) { set(m.index, m.index + 1, MD_HIDE); set(m.index + 1, m.index + m[0].length - 1, MD_C); set(m.index + m[0].length - 1, m.index + m[0].length, MD_HIDE); blank(m.index, m.index + m[0].length); }
  re = /\*\*(?=\S)([^*\n]+?)\*\*/g;
  while ((m = re.exec(mask))) { set(m.index, m.index + 2, MD_HIDE); set(m.index + 2, m.index + m[0].length - 2, MD_B); set(m.index + m[0].length - 2, m.index + m[0].length, MD_HIDE); blank(m.index, m.index + m[0].length); }
  re = /(^|[^*\w])\*(?=\S)([^*\n]+?)\*(?![*\w])/g;
  while ((m = re.exec(mask))) { const s = m.index + m[1].length; set(s, s + 1, MD_HIDE); set(s + 1, s + m[0].length - m[1].length - 1, MD_I); set(s + m[0].length - m[1].length - 1, s + m[0].length - m[1].length, MD_HIDE); }
  return f;
}
function textBlock(blockId, text, cls = '', md = false) {
  const items = anchorsFor(blockId); const len = text.length;
  const flags = md ? mdFlags(text) : null;
  const cuts = new Set([0, len]);
  items.forEach(i => { i.start = Math.max(0, Math.min(len, i.start)); i.end = Math.max(0, Math.min(len, i.end)); cuts.add(i.start); cuts.add(i.end); });
  if (flags) for (let i = 1; i < len; i++) if (flags[i] !== flags[i - 1]) cuts.add(i);
  const pts = [...cuts].sort((a, b) => a - b); let html = '';
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k], b = pts[k + 1]; if (a === b) continue;
    const cov = items.filter(i => i.start <= a && i.end >= b); let seg = esc(text.slice(a, b));
    if (flags && flags[a]) seg = `<span class="${MD_CLS.filter(([bit]) => flags[a] & bit).map(c => c[1]).join(' ')}">${seg}</span>`;
    html += cov.length ? `<mark class="hl${cov.every(c => c.sugg) ? ' sugg' : ''}" data-ids="${cov.map(c => c.id).join(' ')}">${seg}</mark>` : seg;
  }
  return `<div class="tb ${cls}" data-block="${esc(blockId)}">${html}</div>`;
}

/* ------------------------------------------------------------ rail */
const byId = (a, b) => String(a.scenario_id).localeCompare(String(b.scenario_id), undefined, { numeric: true });
const completionRank = s => { const r = sessionReviewState(s); return r === '' ? 0 : r === 'half' ? 1 : 2; };   // unreviewed, partly, reviewed
const SORTERS = { id: byId, role: (a, b) => String(a.role).localeCompare(String(b.role)) || byId(a, b), completion: (a, b) => completionRank(a) - completionRank(b) || byId(a, b) };
try { const v = localStorage.getItem('cartwheel_rail_sort'); if (v && SORTERS[v]) S.sort = v; } catch (e) { /* storage may be unavailable */ }
function renderRail() {
  if (S.tab === 'label') return renderLabelRail();
  const q = S.q.trim().toLowerCase();
  const list = S.sessions.filter(s => (!q || s._blob.includes(q)) && (S.batch === 'all' || batchTraces(s).length)).sort(SORTERS[S.sort] || SORTERS.id);
  const scope = S.batch === 'all' ? allTraceIds() : allTraceIds().filter(inBatch);
  const nRev = scope.filter(isReviewed).length;
  $('#rail-count').innerHTML = `<span>${list.length} of ${S.sessions.length} sessions</span><span class="rev">${nRev} ${nRev === 1 ? 'trace' : 'traces'} reviewed</span>`;
  $('#sessions').innerHTML = list.map(s => {
    const rs = sessionReviewState(s), nb = batchTraces(s).length;
    return `<li data-sid="${s.session_id}" class="${s.session_id === S.cur ? 'cur' : ''}" tabindex="0">
      <span class="sid">${esc(s.scenario_id)}</span><span class="bslot">${nb ? `<span class="bbadge" title="${nb} trace(s) in a review batch">${esc(railBadge(batchTraces(s).map(t => S.manifest[t])))}${nb > 1 ? ' ×' + nb : ''}</span>` : ''}</span><span class="badge ${esc(s.role)}">${esc(s.role)}</span>
      <span class="tc">${s.turn_count} ${s.turn_count === 1 ? 'turn' : 'turns'}</span>
      <span class="dot ${rs}" title="${rs === 'full' ? 'all traces reviewed' : rs === 'half' ? 'some traces reviewed' : 'not reviewed'}" role="img" aria-label="${rs === 'full' ? 'reviewed' : rs === 'half' ? 'partly reviewed' : 'unreviewed'}"></span></li>`;
  }).join('') || '<li class="muted">No matches</li>';
}

/* ------------------------------------------------------------ header + tabs */
const TABS = [['review', 'Review'], ['taxonomy', 'Taxonomy'], ['label', 'Label'], ['progress', 'Progress'], ['suggestions', 'Suggestions'], ['map', 'Map']];
function renderHead() {
  const s = curSession(); let h = '';
  if (s) {
    h = `<div class="head-row"><h1>${esc(s.scenario_id)}</h1><span class="badge ${esc(s.role)}">${esc(s.role)}</span>
      <span class="muted small">user ${esc(s.user_id)}</span><span class="muted small">${s.turn_count} ${s.turn_count === 1 ? 'turn' : 'turns'}</span>
      ${s.error_badges.map(e => `<span class="badge err" title="a tool in this session returned ok:false">${esc(e)}</span>`).join('')}</div>
      <details class="metrics" ${S.detailsOpen ? 'open' : ''}><summary>details</summary><dl>
      <dt>cost</dt><dd>${s.cost == null ? 'n/a' : '$' + s.cost}</dd><dt>latency</dt><dd>${s.latency == null ? 'n/a' : s.latency + ' s'}</dd>
      <dt>model</dt><dd>${esc(s.model || 'n/a')}</dd><dt>prompt version</dt><dd>${esc(s.prompt_version || 'n/a')}</dd>
      <dt>data source</dt><dd>${esc(S.source.source || '?')} (${esc(S.source.detail || '')})</dd><dt>session id</dt><dd>${esc(s.session_id)}</dd></dl></details>`;
  } else h = '<div class="head-row"><h1>Select a session</h1></div>';
  $('#sess-head').innerHTML = (S.tab === 'review' || S.tab === 'label') ? h : '';
  const d = $('details.metrics'); if (d) d.addEventListener('toggle', () => S.detailsOpen = d.open);
}
const curSession = () => S.sessions.find(s => s.session_id === S.cur);

function render(keepScroll = true) {
  const sc = $('#main').scrollTop;
  $('#tabs').innerHTML = TABS.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${S.tab === k}">${l}</button>`).join('');
  $('#app').classList.toggle('no-rail', S.tab !== 'review' && S.tab !== 'label');
  $('#rail-label').hidden = S.tab !== 'label'; if (S.tab === 'label') fillLabelControls();
  renderRail(); renderHead();
  ({ review: renderReview, taxonomy: renderTaxonomy, label: renderLabel, progress: renderProgress, suggestions: renderSuggestions, map: renderMap })[S.tab]();
  if (keepScroll) $('#main').scrollTop = sc;
}

/* ------------------------------------------------------------ tool results */
const compact = v => JSON.stringify(v);
function callLine(c) {
  const args = Object.entries(c.arguments || {}).map(([k, v]) => `${k}=${compact(v)}`).join(', ');
  const full = `${c.name}(${args})`;
  return `<code class="callline" title="${esc(full)}"><b>${esc(c.name)}</b>(${esc(args.length > 200 ? args.slice(0, 200) + '…' : args)})</code>`;
}
const cell = v => { const t = typeof v === 'object' && v !== null ? compact(v) : String(v ?? ''); return esc(t.length > 90 ? t.slice(0, 90) + '…' : t); };
function table(rows, key) {
  const cols = []; rows.forEach(r => Object.keys(r).forEach(k => { if (!cols.includes(k)) cols.push(k); }));
  /* Show every column, with the decision-relevant ones first (eligibility was being cut off at 8 columns). */
  const FIRST = ['order_id', 'status', 'refund_eligible', 'delivered_at', 'shipped_at', 'ordered_at', 'total_usd', 'quantity', 'product_id', 'store_id'];
  const rank = c => { const i = FIRST.indexOf(c); return i < 0 ? 99 : i; };
  const shown = [...cols].sort((x, y) => rank(x) - rank(y)); const open = S.showAll.has(key);
  const body = rows.map((r, i) => `<tr${i >= 5 && !open ? ' hidden' : ''}>${shown.map(c => `<td>${cell(r[c])}</td>`).join('')}</tr>`).join('');
  const more = rows.length > 5 ? `<button class="more" data-showall="${esc(key)}">${open ? 'show first 5 only' : `show all ${rows.length} rows`}</button>` : '';
  return `<table><thead><tr>${shown.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>${more}`;
}
function kv(o, skip = []) { return '<div class="kv">' + Object.entries(o).filter(([k]) => !skip.includes(k)).map(([k, v]) => `<span>${esc(k)}</span><span>${cell(v)}</span>`).join('') + '</div>'; }
function renderResult(st, key) {
  const r = st.result;
  if (r == null) return '';
  if (st.error) return `<div class="res"><span class="badge err">${esc(st.error)}</span> <span>${esc(st.reason || '')}</span></div>`;
  let h;
  if (Array.isArray(r.orders)) h = table(r.orders, key) + (r.count != null ? `<div class="muted small">count ${esc(r.count)}</div>` : '') + (r.orders.length ? '' : '<div class="muted small">no orders</div>');
  else if (Array.isArray(r.products)) h = r.products.length ? table(r.products, key) : '<div class="muted small">no products</div>';
  else if (Array.isArray(r.results)) {
    const open = S.showAll.has(key);
    h = r.results.map((x, i) => `<div class="card"${i >= 5 && !open ? ' hidden' : ''}><span class="t">${esc(x.policy_id || '')}</span> ${esc(x.title || '')}${x.score != null ? ` <span class="muted small">score ${esc(x.score)}</span>` : ''}<div class="body">${esc(x.snippet || x.text || '')}</div></div>`).join('') || '<div class="muted small">no results</div>';
    if (r.results.length > 5) h += `<button class="more" data-showall="${esc(key)}">${open ? 'show first 5 only' : `show all ${r.results.length} rows`}</button>`;
  }
  else if (r.order && typeof r.order === 'object') h = `<div class="card">${kv(r.order)}</div>`;
  else if (r.refund_id != null) h = `<div class="card"><span class="t">Refund #${esc(r.refund_id)}</span> <span class="badge ok">${esc(r.status)}</span> $${esc(r.amount_usd)} on order ${esc(r.order_id)}${r.note ? `<div class="muted small">${esc(r.note)}</div>` : ''}</div>`;
  else if (r.ticket_id != null) h = `<div class="card"><span class="t">Ticket #${esc(r.ticket_id)}</span> SLA ${esc(r.sla_hours)} h</div>`;
  else if (r.policy_id && r.body) h = `<div class="card"><span class="t">${esc(r.policy_id)}</span> ${esc(r.title || '')} <span class="muted small">audience ${esc(r.audience || '')}</span><div class="body">${esc(r.body)}</div></div>`;
  else if (r.status === 'cancelled' && r.order_id != null) h = `<div class="card"><span class="t">Order ${esc(r.order_id)}</span> <span class="badge ok">cancelled</span></div>`;
  else h = `<code class="callline">${esc(compact(r))}</code>`;
  return `<div class="res">${h}</div>`;
}

/* ------------------------------------------------------------ review thread */
function turnHtml(t, ro) {
  const hasAnn = t.steps.some((st, i) => anchorsFor(`${t.trace_id}:step:${i}`).length);
  const open = S.expanded.has(t.trace_id) || hasAnn;
  const thinkOpen = S.expanded.has('th:' + t.trace_id) && t.thinking && t.thinking.length > 0;
  const noFail = S.annotations.some(a => a.kind === 'no_failure' && a.trace_id === t.trace_id);
  const badges = t.steps.filter(s => s.error).map(s => `<span class="badge err" title="${esc(s.call.name + ': ' + (s.reason || ''))}">${esc(s.error)}</span>`).join('');
  const steps = t.steps.map((st, i) => `<div class="step"><div class="muted small">step ${i + 1}</div>
    ${st.narration ? textBlock(`${t.trace_id}:step:${i}`, st.narration, 'narr', true) : ''}${st.call ? callLine(st.call) : ''}${renderResult(st, `${t.trace_id}:${i}`)}</div>`).join('');
  return `<section class="turn${ro && S.active === t.trace_id ? ' active' : ''}" data-trace="${t.trace_id}">
    <div class="turn-div"><span>turn</span><span class="tid" title="Langfuse trace id">${t.trace_id}</span>${S.manifest[t.trace_id] ? `<span class="bbadge" title="${esc(S.manifest[t.trace_id].reason)}">${esc(pickTag(S.manifest[t.trace_id]))}</span>` : ''}
      ${ro ? '' : `<label><input type="checkbox" data-nofail="${t.trace_id}" ${noFail ? 'checked' : ''}> no failure observed</label>`}</div>
    <div class="msg user"><div class="lbl">User</div>${textBlock(t.trace_id + ':user', t.user)}</div>
    <div class="toolrow">${t.thinking && t.thinking.length ? `<button class="tog" data-toggle="th:${t.trace_id}" aria-expanded="${thinkOpen}">${thinkOpen ? '▾' : '▸'} Thinking${t.thinking.length > 1 ? ` (${t.thinking.length})` : ''}</button>` : '<span>no thinking recorded</span>'}<span class="sep">•</span>
      ${t.tool_count ? `<button class="tog" data-toggle="${t.trace_id}" aria-expanded="${open}">${open ? '▾' : '▸'} Tool calls (${t.tool_count})</button>` : '<span>Tool calls (0)</span>'}${badges}</div>
    ${thinkOpen ? `<div class="thinking">${t.thinking.map((x, i) => `<div class="think-block">${t.thinking.length > 1 ? `<div class="muted small">thinking ${i + 1} of ${t.thinking.length}</div>` : ''}${esc(x)}</div>`).join('')}</div>` : ''}
    ${t.tool_count && open ? `<div class="tools">${steps}</div>` : ''}
    <div class="msg reply"><div class="lbl">Assistant reply</div>${textBlock(t.trace_id + ':reply', t.final, '', true)}</div></section>`;
}
function renderReview() {
  const s = curSession();
  if (!s) { $('#content').innerHTML = '<div class="empty">Pick a session on the left.</div>'; return; }
  const narrow = matchMedia('(max-width: 900px)').matches;
  $('#content').innerHTML = `<div class="hint">Select text in a message to add a note. <kbd>t</kbd> expands or collapses all tool calls. <kbd>/</kbd> searches.</div>
    <div class="thread-wrap"><div id="thread">
    <details class="sys"><summary>System prompt (once per session)</summary><pre>${esc(s.system || '(not recorded)')}</pre></details>
    ${s.turns.map(t => turnHtml(t)).join('')}</div><div class="margin" id="margin"></div></div>`;
  renderMargin(s); if (!narrow) layoutMargin();
}
function renderMargin(s) {
  const items = [];
  for (const a of noteAnns()) if (sessionOf(a.trace_id) === s) items.push({ kind: 'ann', a });
  for (const g of pendingSuggs()) if (sessionOf(g.trace_id) === s && resolveSugg(g)) items.push({ kind: 'sugg', g });
  $('#margin').innerHTML = items.map(it => it.kind === 'ann' ? annNote(it.a) : suggNote(it.g)).join('');
}
function modeSelect(a) {
  const ms = modes(); if (!ms.length) return '';
  return `<select data-annmode="${a.id}" aria-label="failure mode"><option value="">no mode</option>${ms.map(m => `<option ${a.mode === m.name ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>`;
}
function annNote(a) {
  return `<div class="mnote" data-note="${a.id}"><div class="q">“${esc(a.quote)}”</div>
    <div class="nb" data-edit="${a.id}" title="Click to edit">${linkReqs(esc(a.note || '(empty note)'))}</div>
    <div class="act">${a.source === 'accepted_suggestion' ? '<span class="badge neutral">accepted suggestion</span>' : ''}${modeSelect(a)}<button class="linkish" data-del="${a.id}">delete</button></div></div>`;
}
function suggNote(g) {
  return `<div class="mnote sugg" data-note="${g.id}"><span class="badge sugg">agent suggestion</span> ${g.mode ? `<span class="badge neutral">${esc(g.mode)}</span>` : ''}
    <div class="q">“${esc(g.quote || '')}”</div>${g.note ? `<div class="nb">${linkReqs(esc(g.note))}</div>` : ''}
    <div class="act"><button class="btn sm primary" data-accept="${g.id}">Accept</button><button class="btn sm" data-reject="${g.id}">Reject</button></div></div>`;
}
function layoutMargin() {
  const m = $('#margin'); if (!m || matchMedia('(max-width: 900px)').matches) return;
  const mt = m.getBoundingClientRect().top; let bottom = 0;
  const notes = $$('.mnote', m).map(n => {
    const mark = n.dataset.turn ? $(`.turn[data-trace="${n.dataset.turn}"] .msg.reply`) : $(`mark[data-ids~="${n.dataset.note}"]`); let top = 0;
    if (mark && mark.getClientRects().length) top = mark.getBoundingClientRect().top - mt;
    else { const tr = mark && mark.closest('.turn'); top = tr ? tr.getBoundingClientRect().top - mt : 0; }
    return { n, top };
  }).sort((a, b) => a.top - b.top);
  for (const { n, top } of notes) { const y = Math.max(top, bottom); n.style.top = y + 'px'; bottom = y + n.offsetHeight + 8; }
  m.style.minHeight = bottom + 'px';
}
function flash(el) { if (!el) return; el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1400); }
function openTrace(tid, annId) {
  const s = sessionOf(tid); if (!s) return toast('Trace not in this data set');
  S.cur = s.session_id; S.tab = 'review'; render(false);
  const el = annId && $(`mark[data-ids~="${annId}"]`) || $(`.turn[data-trace="${tid}"]`);
  if (el) { el.scrollIntoView({ block: 'center' }); flash(el); }
  else $('#main').scrollTop = 0;
}

/* ------------------------------------------------------------ annotations */
let pendingSel = null;
function offsetIn(block, node, off) { const r = document.createRange(); r.selectNodeContents(block); r.setEnd(node, off); return r.toString().length; }
function onMouseUp(e) {
  if (e.target.closest('#pop')) return;
  setTimeout(() => {
    const sel = getSelection(); if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    const elOf = n => (n.nodeType === 1 ? n : n.parentElement)?.closest('.tb');
    const b1 = elOf(r.startContainer), b2 = elOf(r.endContainer);
    if (!b1 || !b2) return;
    if (b1 !== b2) return toast('Select text within a single message');
    const start = offsetIn(b1, r.startContainer, r.startOffset), end = offsetIn(b1, r.endContainer, r.endOffset);
    if (end <= start) return;
    const block = b1.dataset.block, tid = block.split(':')[0];
    const text = S.blocks[block] || '';
    pendingSel = { trace_id: tid, block, start, end, quote: text.slice(start, end) };
    const rect = r.getBoundingClientRect(), pop = $('#pop');
    pop.hidden = false; pop.style.left = Math.min(innerWidth - 340, Math.max(8, rect.left)) + 'px'; pop.style.top = Math.min(innerHeight - 110, rect.bottom + 8) + 'px';
    $('#pop-text').value = ''; $('#pop-text').focus();
  }, 0);
}
function closePop() { $('#pop').hidden = true; pendingSel = null; }
function saveNote() {
  const note = $('#pop-text').value.trim(); if (!pendingSel || !note) return;
  S.annotations.push({ id: uid('a'), ...pendingSel, note, ts: new Date().toISOString(), source: 'human' });
  getSelection().removeAllRanges(); closePop(); persist('annotations'); render();
}
function toggleNoFailure(tid, on) {
  S.annotations = S.annotations.filter(a => !(a.kind === 'no_failure' && a.trace_id === tid));
  if (on) S.annotations.push({ id: uid('nf'), kind: 'no_failure', trace_id: tid, ts: new Date().toISOString(), source: 'human' });
  persist('annotations'); render();
}
function startEdit(id) {
  const el = $(`[data-edit="${id}"]`); const a = S.annotations.find(x => x.id === id); if (!el || !a) return;
  el.outerHTML = `<textarea data-editing="${id}" rows="3"></textarea>`; const ta = $(`[data-editing="${id}"]`); ta.value = a.note || ''; ta.focus();
  ta.onkeydown = ev => {
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); a.note = ta.value.trim() || a.note; persist('annotations'); render(); }
    else if (ev.key === 'Escape') { ev.stopPropagation(); render(); }
  };
}
function acceptSuggestion(id) {
  const g = S.suggestions.find(x => x.id === id); if (!g) return; const r = resolveSugg(g);
  S.annotations.push({ id: uid('a'), trace_id: g.trace_id, block: r?.block || null, start: r?.start ?? null, end: r?.end ?? null, quote: g.quote || '',
    note: g.note || (g.mode ? `[${g.mode}]` : 'accepted suggestion'), mode: g.mode || null, source: 'accepted_suggestion', suggestion_id: g.id, ts: new Date().toISOString() });
  g.status = 'accepted'; g.decided_at = new Date().toISOString();
  persist('annotations'); persist('suggestions'); render();
}
function rejectSuggestion(id, back) {
  const g = S.suggestions.find(x => x.id === id); if (!g) return;
  if (back) { g.status = 'pending'; delete g.decided_at; } else { g.status = 'rejected'; g.decided_at = new Date().toISOString(); }
  persist('suggestions'); render();
}

/* ------------------------------------------------------------ taxonomy */
function supportFor(m) {
  const anns = noteAnns().filter(a => a.mode === m.name);
  const tids = new Set([...(m.example_trace_ids || []), ...(m.trace_ids || []), ...anns.map(a => a.trace_id)]);
  return { anns, tids: [...tids] };
}
function renderTaxonomy() {
  const ms = modes();
  const blocks = ms.map((m, i) => {
    const sup = supportFor(m); const st = String(m.status || 'candidate').toLowerCase();
    return `<div class="panel"><h3><span class="mname">${esc(m.name)}</span> <span class="badge ${FINAL_STATUSES.includes(st) ? 'ok' : 'warn'}">${esc(st)}</span></h3>
      <div>${linkReqs(esc(m.definition || '(no definition yet)'))}</div>
      <div class="muted small" style="margin-top:6px">${sup.anns.length} supporting annotation(s), ${sup.tids.length} trace(s)
        · status <select data-mstatus="${i}">${['candidate', 'confirmed', 'final', 'frozen'].map(x => `<option ${x === st ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
      <div class="chips">${sup.tids.map(t => { const a = sup.anns.find(x => x.trace_id === t); return `<button class="chip" data-jump="${t}" data-ann="${a ? a.id : ''}" title="${t}">${esc(sessionOf(t)?.scenario_id || '?')} · ${t.slice(0, 8)}</button>`; }).join('') || '<span class="muted small">no examples yet; tag a note with this mode in the Review margin</span>'}</div>
      ${(m.example_quotes || []).slice(0, 3).map(q => `<div class="muted small">“${esc(q)}”</div>`).join('')}</div>`;
  }).join('');
  $('#content').innerHTML = `<p class="hint">Failure modes from patterns.json. Status confirmed, final or frozen modes are the ones you judge in the Label tab. Requirement ids open the spec.</p>
    ${blocks || '<div class="empty">No failure modes yet. Add one below, or let the agent push taxonomy to /api/patterns.</div>'}
    <div class="panel"><h3>Add a mode</h3><div class="form-row"><input id="nm-name" placeholder="mode_name" size="24"><input id="nm-def" placeholder="definition (cite e.g. RESP-2)" size="46"><button class="btn" id="nm-add">Add</button></div></div>`;
}
function savePatterns() { S.patterns = { modes: modes() }; persist('patterns'); }

/* ------------------------------------------------------------ label */
function allTraceIds() { return S.sessions.flatMap(s => s.trace_ids); }
function traceJudgeState(tid, fm) { const n = fm.filter(m => S.labels[tid]?.[m.name] != null).length; return n === 0 ? 'none' : n === fm.length ? 'complete' : 'incomplete'; }
const lmodeObj = () => modes().find(m => m.name === S.lmode);
const turnNo = tid => (sessionOf(tid)?.turns.findIndex(t => t.trace_id === tid) ?? -1) + 1;
const savedLabel = tid => S.labels[tid]?.[S.lmode];
/* What we already know about a pair: the user's own positives and close negatives win over agent drafts. */
function draftFor(tid) {
  const m = lmodeObj(); if (!m) return null;
  if ((m.example_trace_ids || []).includes(tid)) return { draft: 'present', reason: 'Already decided: your positive for this mode (a note or a test case).', known: true };
  if ((m.close_negative_trace_ids || []).includes(tid)) return { draft: 'absent', reason: 'Already decided: your close negative for this mode.', known: true };
  const d = (S.drafts[S.lmode] || {})[tid]; return d ? { ...d, known: false } : null;
}
/* HW5: judge verdicts beside the human HW5 label (Pass = 1, Fail = 0). Latest judge version with a prediction wins for filtering. */
const judgeInfo = () => S.judges[S.lmode] || { human: {}, judges: [] };
const judgeRuns = tid => judgeInfo().judges.filter(j => tid in j.preds);
function judgeState(tid) {
  const runs = judgeRuns(tid), h = judgeInfo().human[tid];
  if (!runs.length) return 'none';
  return h != null && runs[runs.length - 1].preds[tid].pred !== h ? 'disagree' : 'agree';
}
const pf = v => (v === 1 ? 'Pass' : 'Fail');
function judgeLines(tid) {
  const info = judgeInfo(), runs = judgeRuns(tid), h = info.human[tid];
  if (!runs.length) return info.judges.length ? '<div class="jline muted small">judge: no prediction for this trace</div>' : '';
  return runs.slice().reverse().map(j => {
    const p = j.preds[tid], bad = h != null && p.pred !== h, key = `jc:${tid}:${j.judge_id}`, open = S.expanded.has(key);
    return `<div class="jline"><span class="jl">${esc(j.judge_id.split('-').pop())}${j.status === 'frozen' ? ' frozen' : ''} · ${esc(p.split || '')}</span>
      judge <span class="dchip ${p.pred === 1 ? 'absent' : 'present'}">${pf(p.pred)}</span>
      HW5 human <span class="dchip ${h === 1 ? 'absent' : 'present'}">${h == null ? '?' : pf(h)}</span>
      ${bad ? '<b class="dis">disagree</b>' : '<span class="muted small">agree</span>'}
      <button class="linkish" data-toggle="${esc(key)}">${open ? 'hide' : 'show'} critique</button>
      ${open ? `<div class="dreason">${esc(p.critique || '(no critique saved)')}</div>` : ''}</div>`;
  }).join('');
}
function passesLabelFilter(tid) {
  const d = draftFor(tid), sv = savedLabel(tid);
  if (S.ldraft !== 'all' && (d ? d.draft : 'none') !== S.ldraft) return false;
  if (S.ljudged === 'todo' && sv != null) return false;
  if (S.ljudged === 'done' && sv == null) return false;
  if (S.ljudge !== 'all' && judgeState(tid) !== S.ljudge) return false;
  return true;
}
function labelSessions() {
  const q = S.q.trim().toLowerCase();
  return S.sessions.filter(s => (!q || s._blob.includes(q)) && batchTraces(s).some(passesLabelFilter)).sort(SORTERS[S.sort] || SORTERS.id);
}
const labelOrder = () => labelSessions().flatMap(s => batchTraces(s).filter(passesLabelFilter));
function fillLabelControls() {
  const ms = finalModes(); if (!S.lmode || !ms.some(m => m.name === S.lmode)) S.lmode = (ms.find(m => S.drafts[m.name]) || ms[0] || {}).name || null;
  $('#lmode').innerHTML = ms.map(m => `<option ${m.name === S.lmode ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
  $('#ldraft').value = S.ldraft; $('#ljudged').value = S.ljudged; $('#ljudge').value = S.ljudge;
}
function renderLabelRail() {
  const list = labelSessions(), all = allTraceIds().filter(t => S.manifest[t]);
  const nJ = all.filter(t => savedLabel(t) != null).length;
  $('#rail-count').innerHTML = `<span>${list.length} sessions shown</span><span class="rev">${nJ} of ${all.length} judged</span>`;
  $('#sessions').innerHTML = list.map(s => {
    const ts = batchTraces(s), nd = ts.filter(t => savedLabel(t) != null).length, rs = nd === 0 ? '' : nd === ts.length ? 'full' : 'half';
    const chips = ts.map(t => {
      const sv = savedLabel(t), d = draftFor(t);
      const cls = sv != null ? (sv === 1 ? 'sf' : 'sp') : d ? 'd-' + d.draft : '';
      const tip = sv != null ? (sv === 1 ? 'judged: fail' : 'judged: pass') : d ? `${d.known ? 'decided' : 'draft'}: ${d.draft}` : 'no draft';
      return `<span class="jt ${cls}${passesLabelFilter(t) ? '' : ' dim'}" title="turn ${turnNo(t)} ${tip}">t${turnNo(t)}</span>`;
    }).join('');
    return `<li data-sid="${s.session_id}" class="${s.session_id === S.cur ? 'cur' : ''}" tabindex="0"><span class="sid">${esc(s.scenario_id)}</span><span class="badge ${esc(s.role)}">${esc(s.role)}</span>
      <span class="jts">${chips}</span><span class="dot ${rs}" title="${nd} of ${ts.length} judged" role="img" aria-label="${nd} of ${ts.length} judged"></span></li>`;
  }).join('') || '<li class="muted">No matches</li>';
}
function judgeBar(t) {
  const tid = t.trace_id;
  if (!S.manifest[tid]) return '';
  const sv = savedLabel(tid), d = draftFor(tid), open = S.expanded.has('dr:' + tid), md = esc(S.lmode);
  const pre = sv == null && d ? (d.draft === 'present' ? 'fail' : d.draft === 'absent' ? 'pass' : '') : '';
  const chip = d ? `<span class="dchip ${d.draft}">${d.known ? 'decided' : 'draft'}: ${d.draft}</span>` : '<span class="dchip none">no draft</span>';
  return `<div class="mnote jcard${S.active === tid ? ' active' : ''}" data-turn="${tid}"><span class="jl">turn ${turnNo(tid)} · ${md}</span>
    <span class="seg"><button class="pass${pre === 'pass' ? ' draft' : ''}" data-label="${tid}|${md}|0" aria-pressed="${sv === 0}">Pass</button><button class="fail${pre === 'fail' ? ' draft' : ''}" data-label="${tid}|${md}|1" aria-pressed="${sv === 1}">Fail</button></span>
    ${chip}${pre ? `<button class="btn sm" data-accept-draft="${tid}">Accept draft</button>` : ''}
    ${d ? `<button class="linkish" data-toggle="dr:${tid}">${open ? 'hide' : 'show'} reason</button>` : ''}
    <input class="jc" data-jc="${tid}" placeholder="optional comment" size="26" aria-label="Optional comment saved with the label">
    ${open && d ? `<div class="dreason">${esc(d.reason)}</div>` : ''}${judgeLines(tid)}</div>`;
}
function roNote(a) { return `<div class="mnote" data-note="${a.id}"><div class="q">“${esc(a.quote)}”</div><div class="nb">${linkReqs(esc(a.note || '(empty note)'))}</div>${a.mode ? `<div class="act"><span class="badge neutral">${esc(a.mode)}</span></div>` : ''}</div>`; }
function renderLabel() {
  const m = lmodeObj();
  if (!m) { $('#content').innerHTML = '<div class="empty">No final failure modes yet. Mark modes final in the Taxonomy tab.</div>'; return; }
  const s = curSession();
  const panel = `<div class="panel mode-panel"><h3><span class="mname">${esc(m.name)}</span> <span class="muted small">judge each turn: <b>Fail</b> = failure present (1), <b>Pass</b> = absent (0). <kbd>p</kbd> <kbd>f</kbd> judge, <kbd>j</kbd> <kbd>k</kbd> move. Dashed button = pre-marked draft; click to save.</span></h3>
    <div>${linkReqs(esc(m.definition || ''))}</div>
    <details><summary class="muted small">boundary and references</summary><div class="small">${m.boundary ? '<b>Boundary.</b> ' + linkReqs(esc(m.boundary)) : ''}
      <div class="chips">${[['positive', m.example_trace_ids], ['close negative', m.close_negative_trace_ids]].flatMap(([k, ids]) => (ids || []).map(t => `<button class="chip" data-jump="${t}" title="${k}">${k === 'positive' ? '＋' : '−'} ${esc(sessionOf(t)?.scenario_id || '?')} t${turnNo(t)}</button>`)).join('')}</div></div></details></div>`;
  if (!s) { $('#content').innerHTML = panel + '<div class="empty">Pick a session on the left.</div>'; return; }
  $('#content').innerHTML = `${panel}<div class="thread-wrap"><div id="thread"><details class="sys"><summary>System prompt (once per session)</summary><pre>${esc(s.system || '(not recorded)')}</pre></details>
    ${s.turns.map(t => turnHtml(t, true)).join('')}</div><div class="margin" id="margin">${s.turns.map(judgeBar).join('')}${noteAnns().filter(a => sessionOf(a.trace_id) === s).map(roNote).join('')}</div></div>`;
  if (!matchMedia('(max-width: 900px)').matches) layoutMargin();
}
function goTrace(tid) {
  const s = sessionOf(tid); if (!s) return; S.cur = s.session_id; S.active = tid; render(false);
  const el = $(`.turn[data-trace="${tid}"]`); if (el) el.scrollIntoView({ block: 'start' });
}
async function setLabel(tid, mode, val) {
  const prev = S.labels[tid]?.[mode]; const next = prev === val ? null : val;
  const inLabel = S.tab === 'label', order = inLabel ? labelOrder() : [], comment = (inLabel && $(`[data-jc="${tid}"]`)?.value.trim()) || undefined;
  try {
    setSave('saving'); const r = await api.post('/api/labels', { trace_id: tid, mode, label: next, comment });
    (S.labels[tid] ||= {}); if (next == null) delete S.labels[tid][mode]; else S.labels[tid][mode] = next;
    setSave('saved'); if (r.langfuse === 'failed') toast('Saved locally; Langfuse write failed: ' + (r.langfuse_error || ''));
  } catch (e) { setSave('error', e.message); return render(); }
  if (inLabel && next != null) {   // move on to the next trace in the current list
    const nxt = order[order.indexOf(tid) + 1];
    if (nxt) return goTrace(nxt);
    toast('End of the current list');
  }
  render();
}

/* ------------------------------------------------------------ progress */
function renderProgress() {
  const ids = allTraceIds(), reviewed = ids.filter(isReviewed).length;
  const nf = S.annotations.filter(a => a.kind === 'no_failure').length;
  let fm = finalModes(); if (!fm.length) fm = modes();
  const unrev = ids.filter(t => !isReviewed(t));
  const rows = fm.map(m => {
    let f = 0, p = 0; ids.forEach(t => { const v = S.labels[t]?.[m.name]; if (v === 1) f++; else if (v === 0) p++; });
    const un = ids.length - f - p;
    return `<tr><td>${esc(m.name)}</td><td>${f}</td><td>${p}</td><td>${un}</td><td><div class="bar" title="fail / pass / unjudged"><i class="f" style="width:${f / ids.length * 100}%"></i><i class="p" style="width:${p / ids.length * 100}%"></i></div></td></tr>`;
  }).join('');
  const inc = fm.length ? ids.filter(t => traceJudgeState(t, fm) === 'incomplete') : [];
  $('#content').innerHTML = `<div class="tiles"><div class="tile"><b>${reviewed} / ${ids.length}</b>traces reviewed</div><div class="tile"><b>${ids.length - reviewed}</b>unreviewed</div>
    <div class="tile"><b>${noteAnns().length}</b>notes</div><div class="tile"><b>${nf}</b>no failure observed</div><div class="tile"><b>${inc.length}</b>incomplete judgments</div></div>
    <p class="hint">A trace counts as reviewed when it has a note or a "no failure observed" mark. ${unrev.length ? `<button class="linkish plain" data-jump="${unrev[0]}">Jump to next unreviewed</button>` : ''}</p>
    <h3>Judgments per mode</h3>${fm.length ? `<table class="grid"><thead><tr><th>Mode</th><th>Fail</th><th>Pass</th><th>Unjudged</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="empty">No modes yet.</div>'}
    ${inc.length ? `<h3 style="margin-top:18px">Traces with incomplete judgments</h3><div class="chips">${inc.map(t => `<button class="chip" data-jump="${t}">${esc(sessionOf(t).scenario_id)} · ${t.slice(0, 8)} (${fm.filter(m => S.labels[t]?.[m.name] == null).map(m => m.name).join(', ')} missing)</button>`).join('')}</div>` : ''}`;
}

/* ------------------------------------------------------------ suggestions */
function suggCard(g, kind) {
  const r = resolveSugg(g);
  return `<div class="sugg-card"><span class="badge sugg">agent suggestion</span> ${g.mode ? `<span class="badge neutral">${esc(g.mode)}</span>` : ''}
    <button class="linkish" data-jump="${g.trace_id}">${esc(sessionOf(g.trace_id)?.scenario_id || g.trace_id)}</button>${r ? '' : ' <span class="badge warn">quote not located</span>'}
    <div class="muted small">“${esc(g.quote || '')}”</div>${g.note ? `<div>${linkReqs(esc(g.note))}</div>` : ''}
    <div class="act" style="margin-top:6px">${kind === 'pending' ? `<button class="btn sm primary" data-accept="${g.id}">Accept as annotation</button> <button class="btn sm" data-reject="${g.id}">Reject</button>` :
      `<span class="badge ${kind === 'accepted' ? 'ok' : 'neutral'}">${kind}</span> ${kind === 'rejected' ? `<button class="linkish" data-restore="${g.id}">move back to pending</button>` : ''}`}</div></div>`;
}
function renderSuggestions() {
  const by = k => S.suggestions.filter(g => (g.status || 'pending') === k);
  const sec = (k, title) => `<h3>${title} (${by(k).length})</h3>${by(k).map(g => suggCard(g, k)).join('') || `<div class="muted small" style="margin-bottom:12px">none</div>`}`;
  $('#content').innerHTML = `<p class="hint">Suggestions come from the agent and are kept apart from your own notes. Accepting turns one into a human annotation (source accepted_suggestion); rejections are saved with status "rejected".</p>
    ${sec('pending', 'Pending')}${sec('accepted', 'Accepted')}${sec('rejected', 'Rejected (kept)')}`;
}

/* ------------------------------------------------------------ map */
const PALETTE = ['#2563eb', '#16a34a', '#9333ea', '#0891b2', '#db2777', '#65a30d', '#4f46e5', '#0d9488'];
function renderMap() {
  const nodes = S.graph.nodes || [];
  if (!nodes.length) { $('#content').innerHTML = '<div class="empty"><b>No projection yet</b><br>No projection yet; generated in Part B.</div>'; return; }
  const clusters = [...new Set(nodes.map(n => n.cluster ?? 0))].sort();
  const cl = new Map((S.graph.clusters || []).map((c, i) => [c.id ?? c.cluster ?? i, c.label || c.name || '']));
  $('#content').innerHTML = `<div class="legend">${clusters.map(c => `<span><i style="background:${PALETTE[Math.abs(+c || 0) % PALETTE.length]}"></i>cluster ${esc(c)}${cl.get(c) ? ' ' + esc(cl.get(c)) : ''}</span>`).join('')}
    <span><i style="background:#f97316"></i>annotated</span><span>larger with dark border = sampled (click to open)</span></div>
    <div id="mapwrap"><canvas id="map" aria-label="2D projection of traces"></canvas><div id="maptip" hidden></div></div>`;
  const cv = $('#map'), dpr = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr; const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
  const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y), pad = 24;
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const sx = x => pad + (x - x0) / ((x1 - x0) || 1) * (W - 2 * pad), sy = y => H - pad - (y - y0) / ((y1 - y0) || 1) * (H - 2 * pad);
  const annotated = new Set(S.annotations.map(a => a.trace_id));
  const pts = nodes.map(n => ({ n, x: sx(n.x), y: sy(n.y), sampled: n.sampled === true || S.sampledIds.has(n.trace_id), ann: annotated.has(n.trace_id) }));
  const draw = () => { ctx.clearRect(0, 0, W, H); for (const p of pts) {
    ctx.beginPath(); ctx.arc(p.x, p.y, p.sampled ? 7 : 4, 0, 7); ctx.fillStyle = p.ann ? '#f97316' : PALETTE[Math.abs(+p.n.cluster || 0) % PALETTE.length]; ctx.globalAlpha = p.sampled ? 1 : .75; ctx.fill(); ctx.globalAlpha = 1;
    if (p.sampled) { ctx.lineWidth = 2; ctx.strokeStyle = '#111827'; ctx.stroke(); } } };
  draw();
  const hit = e => { const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top; let best = null, bd = 100;
    for (const p of pts) { const d = (p.x - mx) ** 2 + (p.y - my) ** 2; if (d < bd) { bd = d; best = p; } } return best; };
  const tip = $('#maptip');
  cv.onmousemove = e => { const p = hit(e); if (!p) { tip.hidden = true; cv.style.cursor = ''; return; }
    const s = sessionOf(p.n.trace_id); tip.hidden = false; tip.textContent = `${s ? s.scenario_id : '?'} · ${String(p.n.trace_id).slice(0, 8)} · cluster ${p.n.cluster ?? 0}${p.sampled ? ' · sampled' : ''}`;
    const r = cv.getBoundingClientRect(); tip.style.left = (e.clientX - r.left + 12) + 'px'; tip.style.top = (e.clientY - r.top + 12) + 'px'; cv.style.cursor = p.sampled ? 'pointer' : ''; };
  cv.onmouseleave = () => tip.hidden = true;
  cv.onclick = e => { const p = hit(e); if (p && p.sampled) openTrace(p.n.trace_id); };
}

/* ------------------------------------------------------------ spec modal */
async function openSpec(reqId) {
  const ov = $('#spec-overlay'); ov.hidden = false; $('.modal', ov).focus();
  if (S.specText == null) {
    try { S.specText = (await api.get('/api/spec')).text; } catch (e) { S.specText = null; $('#spec-content').textContent = 'Could not load SPEC.md'; return; }
    const { html, toc } = MD.render(S.specText);
    $('#spec-content').innerHTML = html;
    $('#spec-toc').innerHTML = toc.map(t => `<a class="l${t.level}" data-h="${t.id}">${esc(t.text)}</a>`).join('');
  }
  if (reqId) {
    const el = $(`#spec-content [data-req="${reqId}"]`);
    if (el) { el.scrollIntoView({ block: 'center' }); flash(el); } else toast(reqId + ' not found in SPEC.md');
  } else $('#spec-content').scrollTop = 0;
  specSpy();
}
const closeSpec = () => { $('#spec-overlay').hidden = true; };
function specSpy() {
  const c = $('#spec-content'), hs = $$('h1,h2,h3', c); let on = hs[0];
  const top = c.getBoundingClientRect().top;
  for (const h of hs) if (h.getBoundingClientRect().top - top <= 40) on = h;
  $$('#spec-toc a').forEach(a => a.classList.toggle('on', on && a.dataset.h === on.id));
}

/* ------------------------------------------------------------ events */
document.addEventListener('click', e => {
  const t = e.target;
  const q = sel => t.closest(sel);
  let el;
  if ((el = q('.req'))) return openSpec(el.dataset.req);
  if (S.tab === 'label' && (el = q('.jcard[data-turn], .turn[data-trace]')) && !q('button,input,a,select,summary,mark,.req')) {
    S.active = el.dataset.turn || el.dataset.trace; $$('.turn.active, .jcard.active').forEach(x => x.classList.remove('active'));
    $(`.turn[data-trace="${S.active}"]`)?.classList.add('active'); $(`.jcard[data-turn="${S.active}"]`)?.classList.add('active');
  }
  if ((el = q('#sessions li[data-sid]'))) {
    S.cur = el.dataset.sid; if (S.tab !== 'label') S.tab = 'review';
    else { const sx = curSession(); S.active = batchTraces(sx).find(passesLabelFilter) || batchTraces(sx)[0] || null; }
    render(false); $('#main').scrollTop = 0; return; }
  if ((el = q('[data-accept-draft]'))) { const d = draftFor(el.dataset.acceptDraft); return d && d.draft !== 'unsure' ? setLabel(el.dataset.acceptDraft, S.lmode, d.draft === 'present' ? 1 : 0) : undefined; }
  if ((el = q('[data-tab]'))) { S.tab = el.dataset.tab; render(false); $('#main').scrollTop = 0; return; }
  if ((el = q('[data-toggle]'))) { const id = el.dataset.toggle; S.expanded.has(id) ? S.expanded.delete(id) : S.expanded.add(id); return render(); }
  if ((el = q('[data-showall]'))) { const k = el.dataset.showall; S.showAll.has(k) ? S.showAll.delete(k) : S.showAll.add(k); return render(); }
  if ((el = q('[data-jump]'))) return openTrace(el.dataset.jump, el.dataset.ann || null);
  if ((el = q('[data-del]'))) { S.annotations = S.annotations.filter(a => a.id !== el.dataset.del); persist('annotations'); return render(); }
  if ((el = q('[data-edit]'))) return startEdit(el.dataset.edit);
  if ((el = q('[data-accept]'))) return acceptSuggestion(el.dataset.accept);
  if ((el = q('[data-reject]'))) return rejectSuggestion(el.dataset.reject);
  if ((el = q('[data-restore]'))) return rejectSuggestion(el.dataset.restore, true);
  if ((el = q('[data-label]'))) { const [tid, mode, v] = el.dataset.label.split('|'); return setLabel(tid, mode, +v); }
  if ((el = q('mark.hl'))) { const id = el.dataset.ids.split(' ')[0]; flash($(`.mnote[data-note="${id}"]`)); return; }
  if ((el = q('.mnote .q')) ) { const id = el.parentElement.dataset.note; const m = $(`mark[data-ids~="${id}"]`); if (m) { m.scrollIntoView({ block: 'center' }); flash(m); } return; }
  if (q('#nm-add')) { const n = $('#nm-name').value.trim().replace(/\s+/g, '_'); if (!n) return toast('Give the mode a name'); if (modes().some(m => m.name === n)) return toast('Mode exists');
    S.patterns = { modes: [...modes(), { name: n, definition: $('#nm-def').value.trim(), status: 'candidate' }] }; persist('patterns'); return render(); }
  if (t.id === 'btn-spec') return openSpec();
  if (t.id === 'spec-close' || t.id === 'spec-overlay') return closeSpec();
  if ((el = q('#spec-toc a'))) { const h = $('#' + el.dataset.h); if (h) $('#spec-content').scrollTo({ top: h.offsetTop - 8 }); return; }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.nofail) return toggleNoFailure(t.dataset.nofail, t.checked);
  if (t.dataset.annmode != null && t.dataset.annmode !== '') { const a = S.annotations.find(x => x.id === t.dataset.annmode); if (a) { a.mode = t.value || null; persist('annotations'); render(); } return; }
  if (t.dataset.mstatus != null) { const ms = modes(); ms[+t.dataset.mstatus].status = t.value; S.patterns = { modes: ms }; persist('patterns'); return render(); }
  if (t.id === 'lmode') { S.lmode = t.value; S.active = null; return render(); }
  if (t.id === 'ldraft') { S.ldraft = t.value; return render(); }
  if (t.id === 'ljudged') { S.ljudged = t.value; return render(); }
  if (t.id === 'ljudge') { S.ljudge = t.value; return render(); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if (!$('#spec-overlay').hidden) return closeSpec(); if (!$('#pop').hidden) return closePop(); }
  if (e.target.id === 'pop-text' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); return saveNote(); }
  if (e.target.classList?.contains('req') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); return openSpec(e.target.dataset.req); }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  if (typing || e.metaKey || e.ctrlKey || e.altKey || !$('#spec-overlay').hidden) return;
  if (S.tab === 'label' && lmodeObj() && S.active && 'pfjk'.includes(e.key)) {
    e.preventDefault(); if (e.repeat) return;
    if (e.key === 'p' || e.key === 'f') return setLabel(S.active, S.lmode, e.key === 'p' ? 0 : 1);
    const order = labelOrder(), i = order.indexOf(S.active), nxt = order[i + (e.key === 'j' ? 1 : -1)] ?? order[0]; return nxt && goTrace(nxt);
  }
  if (e.key === '/') { e.preventDefault(); $('#q').focus(); }
  else if (e.key === 't' && S.tab === 'review') {
    const s = curSession(); if (!s) return; const ts = s.turns.filter(t => t.tool_count);
    const anyClosed = ts.some(t => !S.expanded.has(t.trace_id));
    ts.forEach(t => anyClosed ? S.expanded.add(t.trace_id) : S.expanded.delete(t.trace_id)); render();
  }
});
document.addEventListener('mousedown', e => { if (!e.target.closest('#pop')) closePop(); });
document.addEventListener('mouseup', e => { if ($('#thread') && S.tab === 'review') onMouseUp(e); });
/* Draggable rail width (persisted per browser). */
(function () {
  const rail = $('#rail'), rz = $('#resizer'), KEY = 'cartwheel_rail_w';
  const clamp = w => Math.max(200, Math.min(w, Math.round(innerWidth * 0.7)));
  const apply = w => document.documentElement.style.setProperty('--rail-w', clamp(w) + 'px');
  try { const w = +localStorage.getItem(KEY); if (w) apply(w); } catch (e) { /* storage may be unavailable */ }
  rz.addEventListener('pointerdown', e => {
    e.preventDefault(); rz.setPointerCapture(e.pointerId); document.body.classList.add('resizing');
    const left = rail.getBoundingClientRect().left;
    const move = ev => apply(ev.clientX - left);
    const up = () => {
      rz.removeEventListener('pointermove', move); rz.removeEventListener('pointerup', up); document.body.classList.remove('resizing');
      try { localStorage.setItem(KEY, String(Math.round(rail.getBoundingClientRect().width))); } catch (e) { /* ignore */ }
      if (S.tab === 'review') layoutMargin();
    };
    rz.addEventListener('pointermove', move); rz.addEventListener('pointerup', up);
  });
  rz.addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return; e.preventDefault();
    apply(rail.getBoundingClientRect().width + (e.key === 'ArrowRight' ? 20 : -20));
    try { localStorage.setItem(KEY, String(Math.round(rail.getBoundingClientRect().width))); } catch (er) { /* ignore */ }
  });
  rz.addEventListener('dblclick', () => { document.documentElement.style.removeProperty('--rail-w'); try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } });
})();
$('#q').addEventListener('input', e => { S.q = e.target.value; renderRail(); });
$('#sort').value = S.sort;
$('#sort').addEventListener('change', e => {
  S.sort = e.target.value; try { localStorage.setItem('cartwheel_rail_sort', S.sort); } catch (err) { /* ignore */ }
  renderRail();
});
$('#batch').addEventListener('change', e => {
  S.batch = e.target.value; renderRail();
  const first = S.sessions.find(s => batchTraces(s).length);
  if (S.batch !== 'all' && first && !batchTraces(curSession() || { trace_ids: [] }).length) { S.cur = first.session_id; render(false); }
});
$('#spec-content').addEventListener('scroll', specSpy);
addEventListener('resize', () => { if (S.tab === 'review') layoutMargin(); });

/* ------------------------------------------------------------ boot */
(async function boot() {
  try {
    const [sessions, source, ann, sug, pat, graph, labels, st] = await Promise.all([
      api.get('/api/samples'), api.get('/api/source'), api.get('/api/annotations'), api.get('/api/suggestions'),
      api.get('/api/patterns'), api.get('/api/graph'), api.get('/api/labels'), api.get('/api/samples_state').catch(() => []),
    ]);
    S.drafts = await api.get('/api/drafts').catch(() => ({}));
    S.judges = await api.get('/api/judges').catch(() => ({}));
    S.sessions = sessions; S.source = source; indexData();
    try {
      const mf = await api.get('/api/manifest');
      (mf.picks || []).forEach(p => { S.manifest[p.trace_id] = p; S.sampledIds.add(p.trace_id); });
      fillBatchSelect();
    } catch (e) { /* no manifest yet */ }
    if (source.filter) {
      const sc = $('#scope'); sc.hidden = false; sc.textContent = 'Only showing ' + source.filter;
      sc.title = source.excluded ? `${source.excluded} other traces (e.g. pilot runs) are hidden` : 'filtered to final scenarios';
    }
    S.annotations = Array.isArray(ann) ? ann : []; S.suggestions = Array.isArray(sug) ? sug : [];
    S.patterns = { modes: normModes(pat) }; S.labels = labels || {}; S.graph = graph && graph.nodes ? graph : { nodes: [], clusters: [] };
    (Array.isArray(st) ? st : []).forEach(x => S.sampledIds.add(typeof x === 'string' ? x : x.trace_id));
    const bk = readBackup();
    if (!S.annotations.length && bk && Array.isArray(bk.annotations) && bk.annotations.length) {
      S.annotations = bk.annotations; persist('annotations'); toast('Restored ' + bk.annotations.length + ' notes from the browser backup');
    } else setSave('saved');
    S.cur = S.sessions[0]?.session_id || null;
    render(false);
  } catch (e) { $('#content').innerHTML = `<div class="empty">Failed to load: ${esc(e.message)}</div>`; setSave('error', e.message); }
})();
