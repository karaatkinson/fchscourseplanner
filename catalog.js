/* =========================================================
   CATALOG (course list, filters, search, course trays)
   Laid out like the FCHS Course Description Guide site so both sites read the same way.
   Course facts come from c._rec (the guide row as written). Planner-only information
   (diploma requirement, seals, College Core, schedule buttons) is added to the tray.
   Loaded before app.js; uses app.js globals (allCourses, coursesById, ...) at run time.
   ========================================================= */
'use strict';

/* ---------- text helpers ---------- */
function gEsc(s) { return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
function gSlug(s) { return String(s).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
const G_EMPTY = /^(n\/?a|none|-+|—|–)\.?$/i;
function gHas(v) { return !!v && !G_EMPTY.test(String(v).trim()); }
function gYes(v) { return !!v && /^\s*yes\b/i.test(v); }
function gIsAP(c) {
  const v = ((c._rec && c._rec.ap_raw) || '').trim();
  if (!gHas(v)) return false;
  if (/^(no|not|n\/a|none)\b/i.test(v)) return false;
  if (/\bAP course\s*:?\s*(no|not)\b/i.test(v)) return false;
  return true;
}
function gHasWBL(c) {
  const v = ((c._rec && c._rec.wbl_raw) || '').trim();
  return gHas(v) && !/^0+(\.0+)?$/.test(v);
}
function gShortCode(code) {
  if (!gHas(code)) return '';
  const s = String(code).replace(/\s*\([^)]*\)/g, '').replace(/\s*,\s*/g, ', ').trim();
  return s || code;
}
function gFormatLength(text) {
  return String(text).split(/\s+\/\s+/).map(p => p.replace(/\b(semesters?|credits?)\b/gi, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join(' | ');
}
function gTruncateNone(s) { return s; }

/* ---------- state ---------- */
const catalogState = { dept: 'all', search: '', grade: null, flags: {}, pathway: null, nlps: [], nlpsConfig: null, pathways: {}, titleIndex: [], departments: [], openId: null };
// planner-only filters (not on the guide site)
let filters = { duration: 'all', repeatable: false, diplomaReq: 'all', iccCat: 'all', sealTag: 'all' };

const FLAG_FILTERS = [
  { id: 'ap', label: 'AP', test: c => gIsAP(c) },
  { id: 'dual', label: 'Dual Credit', test: c => gYes(c._rec.dual_raw) },
  { id: 'ncaa', label: 'NCAA Approved', test: c => gYes(c._rec.ncaa_raw) },
  { id: 'credential', label: 'Industry Credential', test: c => gHas(c._rec.certs_raw) },
  { id: 'wbl', label: 'Work-Based Learning Hours', test: c => gHasWBL(c) },
  { id: 'noprereq', label: 'No Prerequisite', test: c => !gHas(c._rec.prereq_raw) },
  { id: 'application', label: 'Application / Audition Required', test: c => gYes(c._rec.approval_raw) }
];

/* ---------- compatibility helpers still used by the planner ---------- */
function isAP(c) { return gIsAP(c) || /\bAP\b/.test(c.title) || /Advanced Placement/i.test(c.title); }
function isWBL(c) {
  return (c.flexible_category_tags || []).includes('seal.employment_honors_wbl_hours_source') || /internship|cooperative education|work.?based learning/i.test(c.title);
}
function hasNoPrereqs(c) { return !c.prerequisites || c.prerequisites.length === 0; }

/* ---------- start-up (called by app.js after courses are built) ---------- */
function initCatalog(deptList, nlpsConfig) {
  const st = catalogState;
  st.departments = deptList.map(d => ({ name: d.name, slug: gSlug(d.name), failed: !!d.failed }));
  st.nlpsConfig = nlpsConfig || null;
  allCourses.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }));
  allCourses.forEach(c => {
    c._deptSlugName = gSlug(c._dept);
    const r = c._rec || {};
    c._searchText = [c.title, r.state_code_raw, r.description, r.pathway_raw, r.prereq_raw, r.college_courses_raw, c._dept].filter(Boolean).join(' ').toLowerCase();
  });
  buildTitleIndex();
  buildGuidePathways();
  buildNlpsPathways();
  renderFilterBar();
  readHash();
  syncFilterBar();
  renderDeptRail();
  renderCatalog();
  window.addEventListener('hashchange', () => readHash(true));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.getElementById('detailPanel').classList.contains('open')) closeDetail(); });
  document.getElementById('searchInput').addEventListener('input', e => {
    st.search = e.target.value.trim();
    renderDeptRail(); renderCatalog();
  });
}

/* ---------- names the guides use to refer to courses (for prerequisite links) ---------- */
function buildTitleIndex() {
  const exact = {};
  allCourses.forEach(c => { exact[c.title.toLowerCase()] = true; });
  const aliasCount = {}, entries = [];
  allCourses.forEach(c => {
    const names = [c.title];
    const stripped = c.title.replace(/\s*\([^)]*\)\s*$/, '');
    if (stripped !== c.title && !exact[stripped.toLowerCase()]) names.push(stripped);
    names.slice().forEach(n => {
      if (/ and /i.test(n)) names.push(n.replace(/ and /gi, ' & '));
      if (/ & /.test(n)) names.push(n.replace(/ & /g, ' and '));
    });
    names.forEach((n, i) => {
      const k = n.toLowerCase();
      if (i > 0) aliasCount[k] = (aliasCount[k] || 0) + 1;
      entries.push({ title: n, id: c.id, alias: i > 0 });
    });
  });
  catalogState.titleIndex = entries
    .filter(e => !e.alias || (aliasCount[e.title.toLowerCase()] === 1 && !exact[e.title.toLowerCase()]))
    .sort((a, b) => b.title.length - a.title.length);
}
function gBoundary(ch) { return !ch || !/[A-Za-z0-9]/.test(ch); }
function tokenizeCourses(text) {
  const idx = catalogState.titleIndex, tokens = [], lower = text.toLowerCase();
  let i = 0, plainStart = 0;
  while (i < text.length) {
    let hit = null;
    if (gBoundary(text.charAt(i - 1))) {
      for (let k = 0; k < idx.length; k++) {
        const t = idx[k].title;
        if (t.length < 4) continue;
        if (lower.substr(i, t.length) === t.toLowerCase()) {
          const next = text.charAt(i + t.length), after = text.charAt(i + t.length + 1);
          if (gBoundary(next) && !(/[-–]/.test(next) && /[A-Za-z0-9]/.test(after))) { hit = idx[k]; break; }
        }
      }
    }
    if (hit) {
      if (i > plainStart) tokens.push({ text: text.slice(plainStart, i) });
      tokens.push({ text: text.substr(i, hit.title.length), id: hit.id });
      i += hit.title.length; plainStart = i;
    } else i++;
  }
  if (plainStart < text.length) tokens.push({ text: text.slice(plainStart) });
  return tokens;
}
function findCourseMentions(text) {
  const ids = [];
  tokenizeCourses(text).forEach(t => { if (t.id && ids.indexOf(t.id) === -1) ids.push(t.id); });
  return ids;
}
function courseLink(id, text) { return `<a class="course-link" href="#course=${encodeURIComponent(id)}" data-goto="${gEsc(id)}">${gEsc(text)}</a>`; }
function gPlain(text, opts) {
  if (!opts.linkCourses) return gEsc(text);
  return tokenizeCourses(text).map(t => (t.id && t.id !== opts.selfId) ? courseLink(t.id, t.text) : gEsc(t.text)).join('');
}
function renderRich(text, opts) {
  opts = opts || {};
  let out = '', last = 0, m;
  const linkRe = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s<>()]+)/g;
  while ((m = linkRe.exec(text)) !== null) {
    out += gPlain(text.slice(last, m.index), opts);
    const url = m[2] || m[3], label = m[1] || m[3];
    out += `<a href="${gEsc(url)}" target="_blank" rel="noopener">${gEsc(label)}</a>`;
    last = m.index + m[0].length;
  }
  out += gPlain(text.slice(last), opts);
  return out.replace(/\n/g, '<br>');
}

/* ---------- pathways ---------- */
// Guide-written pathways ("Pathway / Sequence" row): used in the tray when a course is not in the NLPS file.
function gSplitPathway(v) {
  if (!gHas(v)) return null;
  const parts = String(v).split(/\s+—\s+/);
  return { name: parts.shift().trim(), sequence: parts.join(' — ').trim() };
}
function gNormName(s) { return String(s).toLowerCase().replace(/&/g, ' and ').replace(/\bpathways?\b/g, ' ').replace(/[^a-z0-9()]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function gContains(hay, needle) { return (' ' + hay + ' ').indexOf(' ' + needle + ' ') !== -1; }
function buildGuidePathways() {
  const known = {};
  allCourses.forEach(c => {
    c._pw = gSplitPathway(c._rec && c._rec.pathway_raw);
    c._pws = [];
    if (!c._pw) return;
    c._pw.name.split(/\s*;\s*|\s+and\/or\s+/i).forEach(piece => { const n = gNormName(piece); if (n && !known[n]) known[n] = piece.trim(); });
  });
  let names = Object.keys(known);
  names.forEach(n => { if (names.filter(o => o !== n && gContains(n, o)).length >= 2) delete known[n]; });
  names = Object.keys(known);
  const pathways = {};
  allCourses.forEach(c => {
    if (!c._pw) return;
    const found = [], main = gNormName(c._pw.name);
    names.forEach(n => { if (gContains(main, n)) found.push(n); });
    c._pwFollows = {};
    const alsoRe = /also (?:part of|an option in|included in|in) (?:the )?(.+?) pathway([^;]*)/gi;
    let m;
    while ((m = alsoRe.exec(c._pw.sequence)) !== null) {
      const extra = gNormName(m[1]), f = m[2].match(/\bfollow(?:s|ing)?\s+(.+)/i);
      names.forEach(n => {
        if (!gContains(extra, n)) return;
        if (found.indexOf(n) === -1) found.push(n);
        if (f) c._pwFollows[n] = f[1].replace(/[()]/g, ' ');
      });
    }
    found.forEach(n => {
      if (!pathways[n]) pathways[n] = { key: n, name: known[n], members: [] };
      pathways[n].members.push(c); c._pws.push(pathways[n]);
    });
  });
  Object.keys(pathways).forEach(k => pathways[k].members.forEach(c => stepOf(c, pathways[k], {})));
  catalogState.pathways = pathways;
}
function stepOf(c, pw, seen) {
  c._steps = c._steps || {};
  if (pw.key in c._steps) return c._steps[pw.key];
  if (seen[c.id]) return null;
  seen[c.id] = true;
  const seq = c._pw ? c._pw.sequence : '';
  let step = null;
  if (/\bfirst course\b/i.test(seq) && !(c._pwFollows && c._pwFollows[pw.key])) step = 1;
  else {
    const m = seq.match(/\bfollows\s+([^;(]+)/i);
    const followText = (c._pwFollows && c._pwFollows[pw.key]) || (m ? m[1] : '');
    let best = null;
    (followText ? findCourseMentions(followText) : []).forEach(id => {
      const r = coursesById[id];
      if (!r || r === c || pw.members.indexOf(r) === -1) return;
      const s = stepOf(r, pw, seen);
      if (s !== null && (best === null || s > best)) best = s;
    });
    if (best !== null) step = best + 1;
  }
  c._steps[pw.key] = step;
  return step;
}
function pathwayTitle(name) { return /pathway$/i.test(name) ? name : name + ' Pathway'; }
function pathwayItem(c, m) { return m === c ? `<strong class="pw-current" aria-current="true">${gEsc(m.title)}</strong>` : courseLink(m.id, m.title); }
function guidePathwayBlock(c, pw) {
  const byStep = {}, unplaced = [];
  pw.members.forEach(m => { const s = m._steps[pw.key]; if (s === null || s === undefined) unplaced.push(m); else (byStep[s] = byStep[s] || []).push(m); });
  const steps = Object.keys(byStep).map(Number).sort((a, b) => a - b);
  const sortT = (a, b) => a.title.localeCompare(b.title);
  let shared = false, html = '';
  if (steps.length) html += '<ol class="pathway-list">' + steps.map(s => {
    const list = byStep[s].sort(sortT); if (list.length > 1) shared = true;
    return `<li value="${s}">${list.map(m => pathwayItem(c, m)).join('<br>')}</li>`;
  }).join('') + '</ol>';
  if (unplaced.length) html += `<p class="pw-also"><strong>${steps.length ? 'Also in this pathway' : 'Courses in this pathway'}:</strong><br>${unplaced.sort(sortT).map(m => pathwayItem(c, m)).join('<br>')}</p>`;
  if (shared) html += '<p class="pw-note">Courses that share a number come at the same point in the pathway. Check each course’s prerequisites to see what is required.</p>';
  return `<h3>${gEsc(pathwayTitle(pw.name))}</h3><div class="dc-block">${html}</div>`;
}
// Official NLPS order (data/pathways.json), matched by state course code.
function courseCodes(c) {
  return gShortCode((c._rec && c._rec.state_code_raw) || '').split(/[,;+]/).map(x => { const m = x.trim().match(/^(\d{4})\b/); return m ? m[1] : null; }).filter(Boolean);
}
function buildNlpsPathways() {
  allCourses.forEach(c => { c._nlps = []; });
  const cfg = catalogState.nlpsConfig;
  if (!cfg || !cfg.pathways) return;
  const byCode = {};
  allCourses.forEach(c => courseCodes(c).forEach(code => (byCode[code] = byCode[code] || []).push(c)));
  const labels = cfg.stepLabels || [], sortT = (a, b) => a.title.localeCompare(b.title);
  catalogState.nlps = cfg.pathways.map(p => {
    const pw = { name: p.name, slug: gSlug(p.name), note: p.note || '', steps: [] };
    (p.steps || []).forEach((codes, i) => {
      const list = [];
      codes.forEach(code => (byCode[code] || []).forEach(c => { if (list.indexOf(c) === -1) list.push(c); }));
      if (list.length) pw.steps.push({ num: i + 1, label: labels[i] || '', courses: list.sort(sortT) });
    });
    return pw;
  }).filter(pw => pw.steps.length).sort((a, b) => a.name.localeCompare(b.name));
  catalogState.nlps.forEach(pw => pw.steps.forEach(st => st.courses.forEach(c => { if (c._nlps.indexOf(pw) === -1) c._nlps.push(pw); })));
}
function nlpsBlock(c, pw) {
  let html = '<ol class="pathway-list">' + pw.steps.map(st =>
    `<li value="${st.num}">${st.courses.length > 1 ? '<span class="pw-choose">Choose one:</span><br>' : ''}${st.courses.map(m => pathwayItem(c, m)).join('<br>')}</li>`).join('') + '</ol>';
  if (pw.note) html += `<p class="pw-note">${gEsc(pw.note)}</p>`;
  html += `<p class="pw-view"><a href="#pathway=${encodeURIComponent(pw.slug)}" data-pathway="${gEsc(pw.slug)}">See this pathway in the course list</a></p>`;
  return `<h3>${gEsc(pathwayTitle(pw.name))}</h3><div class="dc-block">${html}</div>`;
}
function showPathway(slug) {
  const st = catalogState;
  st.pathway = slug || null;
  if (st.pathway) st.dept = 'all';
  writeHash(); refreshCatalogView();
  const top = document.querySelector('.layout').getBoundingClientRect().top;
  if (top < 0) window.scrollBy({ top: top, behavior: 'smooth' });
}
function renderPathwayView(main) {
  const pw = catalogState.nlps.find(p => p.slug === catalogState.pathway);
  if (!pw) return false;
  let count = 0;
  let html = `<section class="dept-section"><h2 class="dept-heading">${gEsc(pathwayTitle(pw.name))}</h2><p class="pw-intro">Take these courses in order, starting with step 1.</p>`;
  if (pw.note) html += `<div class="dept-note"><p>${gEsc(pw.note)}</p></div>`;
  html += '<ol class="pw-steps">' + pw.steps.map(st => {
    count += st.courses.length;
    return `<li class="pw-step"><div class="pw-step-num" aria-hidden="true">${st.num}</div><div class="pw-step-body"><p class="pw-step-label">Step ${st.num}${st.label ? ' · ' + gEsc(st.label) : ''}${st.courses.length > 1 ? ' <span class="pw-choose">· Choose one</span>' : ''}</p>${st.courses.map(courseRowHTML).join('')}</div></li>`;
  }).join('') + '</ol>';
  const src = catalogState.nlpsConfig && catalogState.nlpsConfig.source;
  html += '<p class="pw-source">Course order follows the Indiana Next Level Programs of Study' + (src ? ' (' + gEsc(src.replace(/^Indiana Next Level Programs of Study \(NLPS\)\s*/i, '')) + ')' : '') + '. Only courses offered at FC are listed. Check each course’s prerequisites and talk with your counselor when planning.</p><button class="filter-clear pw-back" id="pwBack">← Back to all courses</button></section>';
  main.innerHTML = html;
  bindRows(main);
  document.getElementById('pwBack').addEventListener('click', () => showPathway(null));
  setCount(count);
  return true;
}

/* ---------- filtering ---------- */
function activeFlagFilters() { return FLAG_FILTERS.filter(f => catalogState.flags[f.id]); }
function courseMatchesFilters(c, ignoreDept) {
  const st = catalogState;
  if (!ignoreDept && st.dept !== 'all' && c._deptSlugName !== st.dept) return false;
  if (st.grade && c.grades && c.grades.indexOf(st.grade) === -1) return false;
  for (const f of activeFlagFilters()) if (!f.test(c)) return false;
  if (st.search) { const words = st.search.toLowerCase().split(/\s+/).filter(Boolean); for (const w of words) if (c._searchText.indexOf(w) === -1) return false; }
  // planner-only
  if (filters.duration === '1' && parseSemesters(c) != 1) return false;
  if (filters.duration === '2' && !isFullYear(c)) return false;
  if (filters.repeatable && !c.repeatable) return false;
  if (filters.diplomaReq !== 'all' && !(c.diploma_requirement_id === filters.diplomaReq || (c.diploma_requirement_id_options || []).includes(filters.diplomaReq))) return false;
  if (filters.iccCat !== 'all' && !(c.icc && c.icc.category === filters.iccCat)) return false;
  if (filters.sealTag !== 'all' && !(c.flexible_category_tags || []).includes(filters.sealTag)) return false;
  return true;
}
function plannerFilterCount() {
  let n = 0;
  if (filters.duration !== 'all') n++;
  if (filters.repeatable) n++;
  ['diplomaReq', 'iccCat', 'sealTag'].forEach(k => { if (filters[k] !== 'all') n++; });
  return n;
}
function updateFiltersToggleLabel() {
  const btn = document.getElementById('filtersToggleBtn');
  if (!btn) return;
  const n = (catalogState.grade ? 1 : 0) + activeFlagFilters().length + (catalogState.pathway ? 1 : 0) + plannerFilterCount();
  btn.textContent = n > 0 ? `Filters (${n})` : 'Filters';
  btn.classList.toggle('active', n > 0);
}

/* ---------- department rail ---------- */
function railButton(slug, name, count, missing) {
  const on = catalogState.dept === slug && !catalogState.pathway;
  return `<button class="dept-item${on ? ' active' : ''}${missing ? ' missing' : ''}" data-dept="${gEsc(slug)}"${on ? ' aria-current="true"' : ''}><span>${gEsc(name)}</span><span class="dept-count">${count}</span></button>`;
}
function renderDeptRail() {
  const wrap = document.getElementById('deptRailButtons'), st = catalogState;
  let html = railButton('all', 'All Departments', allCourses.filter(c => courseMatchesFilters(c, true)).length, false);
  st.departments.forEach(d => {
    const n = allCourses.filter(c => c._deptSlugName === d.slug && courseMatchesFilters(c, true)).length;
    html += railButton(d.slug, d.name, d.failed ? '—' : n, d.failed);
  });
  wrap.innerHTML = html;
  wrap.querySelectorAll('.dept-item').forEach(btn => btn.addEventListener('click', () => {
    st.dept = btn.dataset.dept; st.pathway = null;
    syncFilterBar(); writeHash(); renderDeptRail(); renderCatalog();
    const top = document.querySelector('.layout').getBoundingClientRect().top;
    if (top < 0) window.scrollBy({ top: top, behavior: 'smooth' });
  }));
  const active = wrap.querySelector('.dept-item.active');
  if (active && wrap.scrollWidth > wrap.clientWidth) wrap.scrollLeft = active.offsetLeft - wrap.offsetLeft - (wrap.clientWidth - active.offsetWidth) / 2;
}

/* ---------- filter bar ---------- */
function renderFilterBar() {
  const bar = document.getElementById('filterBar'), st = catalogState;
  const reqOptions = Object.entries(REQUIREMENT_LABELS).filter(([k, v]) => v).map(([k, v]) => `<option value="${k}" ${filters.diplomaReq === k ? 'selected' : ''}>${v}</option>`).join('');
  const iccOptions = iccRules ? Object.entries(iccRules.categories).map(([k, v]) => `<option value="${k}" ${filters.iccCat === k ? 'selected' : ''}>${v.label}</option>`).join('') : '';
  const sealOptions = Object.entries(SEAL_TAG_LABELS).map(([k, v]) => `<option value="${k}" ${filters.sealTag === k ? 'selected' : ''}>${v}</option>`).join('');
  let html = '<div class="filter-group" role="group" aria-label="Grade level"><span class="filter-group-label">Grade</span>' + GRADES.map(g => `<button class="filter-chip" data-grade="${g}">${g}th</button>`).join('') + '</div>';
  html += '<div class="filter-group" role="group" aria-label="Course features">' + FLAG_FILTERS.map(f => `<button class="filter-chip" data-flag="${f.id}">${gEsc(f.label)}</button>`).join('') + '</div>';
  if (st.nlps.length) html += '<div class="filter-group" role="group" aria-label="Pathway"><label class="filter-group-label" for="pathwaySelect">Pathway</label><select class="filter-select" id="pathwaySelect"><option value="">All pathways</option>' + st.nlps.map(pw => `<option value="${gEsc(pw.slug)}">${gEsc(pw.name)}</option>`).join('') + '</select></div>';
  html += `<div class="filter-group" role="group" aria-label="Planner filters"><span class="filter-group-label">Planner</span>
      <button class="filter-chip ${filters.duration === '1' ? 'active' : ''}" data-duration="1">1 Semester</button>
      <button class="filter-chip ${filters.duration === '2' ? 'active' : ''}" data-duration="2">2 Semesters</button>
      <button class="filter-chip ${filters.repeatable ? 'active' : ''}" data-toggle="repeatable">Repeatable</button>
      <select class="filter-select" data-selfilter="diplomaReq"><option value="all">Diploma Requirement&hellip;</option>${reqOptions}</select>
      <select class="filter-select" data-selfilter="sealTag"><option value="all">Readiness Seal&hellip;</option>${sealOptions}</select>
      <select class="filter-select" data-selfilter="iccCat"><option value="all">Indiana College Core&hellip;</option>${iccOptions}</select></div>
    <button class="filter-clear" id="filterClearBtn">Clear filters</button>`;
  bar.innerHTML = html;
  const sel = document.getElementById('pathwaySelect');
  if (sel) sel.addEventListener('change', () => showPathway(sel.value || null));
  bar.querySelectorAll('[data-grade]').forEach(btn => btn.addEventListener('click', () => { const g = +btn.dataset.grade; st.grade = st.grade === g ? null : g; refreshCatalogView(); }));
  bar.querySelectorAll('[data-flag]').forEach(btn => btn.addEventListener('click', () => { const id = btn.dataset.flag; st.flags[id] = !st.flags[id]; refreshCatalogView(); }));
  bar.querySelectorAll('[data-duration]').forEach(btn => btn.addEventListener('click', () => { filters.duration = filters.duration === btn.dataset.duration ? 'all' : btn.dataset.duration; refreshCatalogView(); }));
  bar.querySelectorAll('[data-toggle]').forEach(btn => btn.addEventListener('click', () => { filters[btn.dataset.toggle] = !filters[btn.dataset.toggle]; refreshCatalogView(); }));
  bar.querySelectorAll('[data-selfilter]').forEach(s => s.addEventListener('change', () => { filters[s.dataset.selfilter] = s.value; refreshCatalogView(); }));
  document.getElementById('filterClearBtn').addEventListener('click', () => {
    st.grade = null; st.flags = {}; st.search = ''; st.pathway = null;
    filters = { duration: 'all', repeatable: false, diplomaReq: 'all', iccCat: 'all', sealTag: 'all' };
    document.getElementById('searchInput').value = '';
    writeHash(); refreshCatalogView();
  });
  syncFilterBar();
}
function syncFilterBar() {
  const st = catalogState;
  document.querySelectorAll('#filterBar [data-grade]').forEach(b => { const on = st.grade === +b.dataset.grade; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on); });
  document.querySelectorAll('#filterBar [data-flag]').forEach(b => { const on = !!st.flags[b.dataset.flag]; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on); });
  document.querySelectorAll('#filterBar [data-duration]').forEach(b => b.classList.toggle('active', filters.duration === b.dataset.duration));
  document.querySelectorAll('#filterBar [data-toggle]').forEach(b => b.classList.toggle('active', !!filters[b.dataset.toggle]));
  document.querySelectorAll('#filterBar [data-selfilter]').forEach(s => { s.value = filters[s.dataset.selfilter]; });
  const sel = document.getElementById('pathwaySelect'); if (sel) sel.value = st.pathway || '';
  updateFiltersToggleLabel();
}
function refreshCatalogView() { syncFilterBar(); renderDeptRail(); renderCatalog(); }

/* ---------- course list ---------- */
function plannerStatusBadges(c) {
  const b = [], times = lifetimeCount(c.id);
  if (c.repeatable && times > 0) b.push(`<span class="badge inschedule">${c.repeatable.max_times ? `${times}/${c.repeatable.max_times}× taken` : `Taken ${times}×`}</span>`);
  else if (inSchedule(c.id)) b.push('<span class="badge inschedule">In Schedule</span>');
  else if (inAlternates(c.id)) b.push('<span class="badge alt">Alternate</span>');
  return b;
}
function guideBadges(c) {
  const r = c._rec || {}, b = [];
  if (gIsAP(c)) b.push('<span class="badge ap">AP</span>');
  if (gYes(r.dual_raw)) b.push('<span class="badge dual">Dual Credit</span>');
  if (gYes(r.ncaa_raw)) b.push('<span class="badge req">NCAA</span>');
  if (gHas(r.certs_raw)) b.push('<span class="badge seal">Credential</span>');
  if (gHasWBL(c)) b.push('<span class="badge pathway">Work-Based Learning</span>');
  if (gYes(r.approval_raw)) b.push('<span class="badge icc">Application</span>');
  return b;
}
function courseRowHTML(c) {
  const r = c._rec || {}, meta = [];
  if (gHas(r.grades_raw)) meta.push('Grade Level(s): ' + gEsc(r.grades_raw));
  if (gHas(r.length_credits_raw)) meta.push(gEsc(gFormatLength(r.length_credits_raw)));
  const badges = plannerStatusBadges(c).concat(guideBadges(c));
  if (c._review && c._review.length) badges.push('<span class="badge review" title="Needs review">Needs review</span>');
  return `<div class="course-row" data-id="${c.id}" role="button" tabindex="0"><div><p class="course-title">${gEsc(c.title)}</p><div class="course-meta">${meta.join(' | ')}</div></div><div class="badges">${badges.join('')}</div></div>`;
}
function bindRows(root) {
  root.querySelectorAll('.course-row').forEach(row => {
    row.addEventListener('click', () => openDetail(row.dataset.id));
    row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(row.dataset.id); } });
  });
}
function setCount(n) { const el = document.getElementById('resultCount'); if (el) el.textContent = n + (n === 1 ? ' course' : ' courses'); }
function renderCatalog() {
  const main = document.getElementById('catalog'), st = catalogState;
  if (st.pathway && renderPathwayView(main)) return;
  const depts = st.dept === 'all' ? st.departments : st.departments.filter(d => d.slug === st.dept);
  let total = 0, html = '';
  depts.forEach(d => {
    const all = allCourses.filter(c => c._deptSlugName === d.slug);
    const list = all.filter(c => courseMatchesFilters(c));
    total += list.length;
    if (!list.length && st.dept === 'all') return;
    html += `<section class="dept-section"><h2 class="dept-heading">${gEsc(d.name)}</h2>`;
    const notes = (all[0] && all[0]._deptNotes) || [];
    if (notes.length && list.length) html += '<div class="dept-note">' + notes.map(n => `<p>${gEsc(n)}</p>`).join('') + '</div>';
    if (d.failed && !all.length) html += '<p class="empty-state">This department’s guide has not been added yet.</p>';
    else if (!list.length) html += `<p class="empty-state">No ${gEsc(d.name)} courses match your search and filters.</p>`;
    else html += list.map(courseRowHTML).join('');
    html += '</section>';
  });
  if (!total && st.dept === 'all') html = '<p class="empty-state">No courses match your search and filters. Try removing a filter or searching for a different word.</p>';
  main.innerHTML = html;
  bindRows(main);
  setCount(total);
}

/* ---------- course tray ---------- */
function gRow(label, value, opts) {
  if (value === undefined || value === '') return '';
  if (opts && opts.hideEmpty && !gHas(value)) return '';
  return `<p><strong>${gEsc(label)}:</strong> ${renderRich(value, opts && opts.rich)}</p>`;
}
function gBlock(title, inner) { return inner ? `<h3>${gEsc(title)}</h3><div class="dc-block">${inner}</div>` : ''; }
function maxTimesRow(c) {
  const v = ((c._rec && c._rec.max_times_raw) || '').trim();
  if (!gHas(v)) return '';
  const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
  const m = v.match(/^(\d+|one|two|three|four|five|six|seven|eight)\b\s*(?:times?)?\s*(.*)$/i);
  if (m) {
    const n = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : words[m[1].toLowerCase()];
    if (n <= 1) return '';
    return `<p><strong>Course may be taken up to ${n} times</strong>${m[2] ? ' ' + gEsc(m[2]) : ''}</p>`;
  }
  if (/^once\b\.?$/i.test(v) || /^once\s*\(/i.test(v) || /not repeatable/i.test(v)) return '';
  return `<p><strong>Course may be taken:</strong> ${gEsc(v)}</p>`;
}
function gPathwayRows(c, link) {
  if (!c._pw) return '';
  let out = `<p><strong>Pathway:</strong> ${gEsc(c._pw.name)}</p>`;
  if (gHas(c._pw.sequence)) out += `<p><strong>Sequence:</strong> ${renderRich(c._pw.sequence, link)}</p>`;
  return out;
}
function plannerBlock(c) {
  let inner = '';
  const req = c.diploma_requirement_id ? (REQUIREMENT_LABELS[c.diploma_requirement_id] || (c.diploma_requirement_id === 'personalized_electives' ? 'Personalized Electives' : c.diploma_requirement_id)) : '';
  if (c.credit_split) inner += '<p><strong>Counts as two courses:</strong></p><ul>' + c.credit_split.map(p => `<li>${gEsc(p.label)} (${gEsc(p.code)}): ${p.credits} credit \u2192 ${gEsc(REQUIREMENT_LABELS[p.requirement] || (p.requirement === 'personalized_electives' ? 'Personalized Electives' : p.requirement))}</li>`).join('') + '</ul>';
  else if (c.diploma_requirement_id_options) inner += `<p><strong>Diploma requirement:</strong> ${c.diploma_requirement_id_options.map(id => gEsc(REQUIREMENT_LABELS[id] || id)).join(' or ')} (counts toward one of these)</p>`;
  else if (req) inner += `<p><strong>Diploma requirement:</strong> ${gEsc(req)}${c.diploma_requirement_id_fallback ? ' (can also count as ' + gEsc(REQUIREMENT_LABELS[c.diploma_requirement_id_fallback] || c.diploma_requirement_id_fallback) + ' once the first is full)' : ''}</p>`;
  const seals = (c.flexible_category_tags || []).filter(t => SEAL_TAG_LABELS[t]);
  if (seals.length) inner += '<p><strong>Readiness Seal categories:</strong></p><ul>' + seals.map(t => `<li>${gEsc(SEAL_TAG_LABELS[t])}</li>`).join('') + '</ul>';
  if (c.icc && iccRules && iccRules.categories[c.icc.category]) {
    const cat = iccRules.categories[c.icc.category];
    inner += `<p><strong>Indiana College Core:</strong> ${gEsc(cat.label)} | ${c.icc.credit_hours} credit hours${c.icc.vincennes_sourced ? ' (counts toward the 15-credit Vincennes minimum)' : ''}${c.icc.requires_ap_score ? ` | requires a score of ${c.icc.min_ap_score}+ on the AP exam` : ''}${c.icc.is_estimate ? ' (estimate)' : ''}</p>`;
  }
  if (c.certifications) {
    const lines = c.certifications.filter(x => x.credential_of_value);
    if (lines.length) inner += '<p><strong>Credentials of Value:</strong></p><ul>' + lines.map(x => `<li>${gEsc(x.name)}: ${gEsc(x.credential_of_value)}</li>`).join('') + '</ul>';
  }
  if (c.special_diploma_note) inner += `<p>${gEsc(c.special_diploma_note)}</p>`;
  const dependents = coursesThatRequire(c.id);
  if (dependents.length) inner += '<p><strong>This course is a prerequisite for:</strong></p><ul>' + dependents.map(d => `<li>${courseLink(d.id, d.title)}</li>`).join('') + '</ul>';
  const checked = (c.prerequisites || []).filter(p => typeof p === 'string' || p.type === 'any_of');
  if (checked.length) inner += `<p style="color:var(--ink-dim);font-size:0.82rem;">The planner checks for: ${checked.map(p => typeof p === 'string' ? gEsc(coursesById[p]?.title || p) : (p.courses || []).map(x => gEsc(coursesById[x]?.title || x)).join(' or ')).join('; ')}</p>`;
  if (c._review && c._review.length) inner += `<div class="review-box"><strong>Needs review</strong> — check with your counselor before relying on this:<ul>${c._review.map(n => `<li>${gEsc(n)}</li>`).join('')}</ul></div>`;
  return gBlock('For Your Plan', inner);
}
function openDetail(id, fromHash) {
  const c = coursesById[id];
  if (!c) return;
  const r = c._rec || {}, link = { linkCourses: true, selfId: c.id };
  currentDetailId = id;
  let html = `<h2 id="detailTitle">${gEsc(c.title)}</h2>`;
  const code = gShortCode(r.state_code_raw);
  html += `<div class="detail-code">${gEsc(c._dept)}${code ? ' · ' + gEsc(code) : ''}</div>`;
  const badges = plannerStatusBadges(c).concat(guideBadges(c)).join('');
  if (badges) html += `<div class="badges">${badges}</div>`;
  if (gHas(r.description)) html += `<h3>Description</h3><p>${renderRich(r.description)}</p>`;
  html += gBlock('At a Glance', gRow('Grade Level(s)', r.grades_raw) + gRow('Length & Credits', r.length_credits_raw) + maxTimesRow(c) + gPathwayRows(c, link));
  let prereq = gRow('Prerequisite(s)', r.prereq_raw, { rich: link }) + gRow('Co-requisite(s)', r.coreq_raw, { hideEmpty: true, rich: link }) + (gYes(r.approval_raw) ? gRow('Application / Audition / Approval Required', r.approval_raw, { rich: {} }) : '');
  if (c._deptNotes.length && gHas(r.prereq_raw)) prereq += c._deptNotes.map(n => `<p><em>${gEsc(n)}</em></p>`).join('');
  html += gBlock('Prerequisites & Requirements', prereq);
  if (c._nlps && c._nlps.length) c._nlps.forEach(pw => { html += nlpsBlock(c, pw); });
  else (c._pws || []).forEach(pw => { if (pw.members.length > 1) html += guidePathwayBlock(c, pw); });
  if (gYes(r.dual_raw)) html += gBlock('Dual Credit', gRow('Dual Credit Offered', r.dual_raw) + gRow('Partnering University', r.partner_raw, { hideEmpty: true }) + gRow('College Course Code(s) & Title(s)', r.college_courses_raw, { hideEmpty: true }) + gRow('Dual Credit Eligibility (GPA/test scores)', r.dc_eligibility_raw, { hideEmpty: true }));
  let more = '';
  if (!gYes(r.dual_raw)) more += gRow('Dual Credit Offered', r.dual_raw);
  if (gHas(r.state_code_raw) && r.state_code_raw.trim() !== gShortCode(r.state_code_raw)) more += gRow('FC / State Course Code', r.state_code_raw);
  more += gRow('AP Course / AP Exam Required', r.ap_raw) + gRow('NCAA Approved', r.ncaa_raw) + gRow('Industry Certification / Credential Earned', r.certs_raw, { hideEmpty: true }) + (gHasWBL(c) ? gRow('Work-Based Learning Hours', r.wbl_raw) : '') + gRow('Required Texts / Novels / Major Works', r.texts_raw, { hideEmpty: true }) + gRow('Other Notes / Footnotes', r.notes_raw, { hideEmpty: true, rich: link });
  Object.keys(r.extra || {}).forEach(k => { if (gHas(r.extra[k])) more += `<p><strong>${gEsc(k)}:</strong> ${renderRich(r.extra[k])}</p>`; });
  if (c._credit_rule) more += `<p><strong>Credit:</strong> ${gEsc(c._credit_rule)}</p>`;
  if (c._credit_note) more += `<p><strong>Credit:</strong> ${gEsc(c._credit_note)}</p>`;
  html += gBlock('Additional Information', more);
  html += plannerBlock(c);
  html += `<p class="detail-source">From the ${gEsc(c._dept)} ${gEsc((typeof guideStatus !== 'undefined' && guideStatus.schoolYear) || '')} Course Description Guide. Course offerings can change; confirm details with your school counselor.</p>`;

  const content = document.getElementById('detailContent');
  content.innerHTML = html;
  content.querySelectorAll('[data-goto]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); openDetail(a.dataset.goto); }));
  content.querySelectorAll('[data-pathway]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); closeDetail(); showPathway(a.dataset.pathway); }));
  updateAddBtn();
  const panel = document.getElementById('detailPanel');
  panel.scrollTop = 0;
  panel.classList.add('open');
  document.getElementById('scrim').classList.add('open');
  catalogState.openId = id;
  if (!fromHash) writeHash();
}
function closeDetail() {
  document.getElementById('detailPanel').classList.remove('open');
  document.getElementById('scrim').classList.remove('open');
  catalogState.openId = null;
  writeHash();
}

/* ---------- address bar: #dept=science&course=biology-i-honors ---------- */
function writeHash() {
  const st = catalogState, parts = [];
  if (st.pathway) parts.push('pathway=' + encodeURIComponent(st.pathway));
  else if (st.dept !== 'all') parts.push('dept=' + encodeURIComponent(st.dept));
  if (st.openId) parts.push('course=' + encodeURIComponent(st.openId));
  const h = parts.length ? '#' + parts.join('&') : '';
  if (h !== location.hash) history.replaceState(null, '', h || (location.pathname + location.search));
}
function readHash(rerender) {
  const st = catalogState, p = {};
  location.hash.replace(/^#/, '').split('&').forEach(kv => { const i = kv.indexOf('='); if (i > 0) p[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); });
  st.dept = 'all'; st.pathway = null;
  if (p.pathway && st.nlps.some(x => x.slug === p.pathway)) st.pathway = p.pathway;
  else if (p.dept && st.departments.some(d => d.slug === p.dept)) st.dept = p.dept;
  if (rerender) { syncFilterBar(); renderDeptRail(); renderCatalog(); }
  if (p.course && coursesById[p.course]) openDetail(p.course, true);
  else if (rerender && st.openId) { document.getElementById('detailPanel').classList.remove('open'); document.getElementById('scrim').classList.remove('open'); st.openId = null; }
}
