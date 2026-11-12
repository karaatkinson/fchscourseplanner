/* =========================================================
   GUIDES BUILDER
   Turns the parsed department guides (guides-parser.js) plus the small
   rules file (data/rules.json) and the IDOE course-code lists
   (data/diploma-base-rules.json) into the course records the planner uses.

   What comes from where:
   - Guides: title, text, grades, length, credits, prerequisites (read as
     text and translated), dual credit, certifications, pathway wording,
     notes, work-based-learning hours, AP, repeat limits.
   - IDOE code lists: which diploma requirement a course can count toward,
     and which Readiness Seal categories it belongs to (matched on the
     state course code printed in the guide).
   - rules.json: things no guide states (Indiana College Core placement,
     shared credit caps, reviewed prerequisite readings).
   Nothing here invents a course fact. Anything that cannot be read or
   checked is returned in `review` / `report` so it can be shown.
   ========================================================= */
(function (root) {
  'use strict';
  var P = (typeof module !== 'undefined' && module.exports) ? require('./guides-parser.js') : root.GuidesParser;
var LEVEL_WORDS = /\b(honors|early college|dual credit|advanced placement|ap|dc)\b/g;
  function normText(s) {
    return ' ' + (s || '').toLowerCase()
      .replace(/&/g, ' and ').replace(/\b2d\b/g, '2 dimensional').replace(/\b3d\b/g, '3 dimensional')
      .replace(/[–—\-\/:]+/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ') + ' ';
  }
  function baseKey(title) { return P.titleKey(title).replace(LEVEL_WORDS, ' ').replace(/\s+/g, ' ').trim(); }
  function hasLevel(title) { return /\b(honors|early college|dual credit|advanced placement|ap|dc)\b/.test(P.titleKey(title)); }
  
  /** courses: [{id, dept, title}] (all guide courses). deptNotes: {dept: [notes]} */
  function makeResolver(courses, deptHasLevelNote, aliases) {
    const stripParen = t => t.replace(/\s*\([^)]*\)\s*$/, '');
    const index = [];
    courses.forEach(c => {
      index.push({ c, key: normText(c.title) });
      const sp = stripParen(c.title);
      if (sp !== c.title) index.push({ c, key: normText(sp) });          // "Management Fundamentals" for "Management Fundamentals (McCormick's Cafe)"
    });
    (aliases || []).forEach(a => { const c = courses.find(x => x.id === a.id); if (c) index.push({ c, key: normText(a.text) }); });
    index.sort((a, b) => b.key.length - a.key.length);
    const byBase = {};
    courses.forEach(c => { (byBase[c.dept + '|' + baseKey(c.title)] = byBase[c.dept + '|' + baseKey(c.title)] || []).push(c); });
  
    function siblings(c) {
      if (!deptHasLevelNote[c.dept] || hasLevel(c.title)) return [c];
      return byBase[c.dept + '|' + baseKey(c.title)] || [c];
    }
  
    // find titles inside a fragment, longest first, same-dept preferred; returns {found:[course], rest:string}
    function extractTitles(fragment, dept) {
      let t = normText(fragment);
      const found = [];
      for (const { c, key } of index) {
        if (key.trim().length < 4) continue;
        let pos = t.indexOf(key);
        if (pos < 0) continue;
        // avoid cross-dept false hits on very short generic titles
        if (c.dept !== dept && key.trim().split(' ').length < 2) continue;
        found.push(c);
        t = t.slice(0, pos) + ' ' + t.slice(pos + key.length - 1);
      }
      return { found, rest: t };
    }
  
    const NOISE = /\b(and|or|plus|the|a|an|in|of|for|with|must|have|receive|complete|completed|credits?|previous|level|study|pre|co|requisite|required|both|semesters?|sem|better|c|d|b|a|average|grade)\b/g;
  
    function resolve(raw, dept, selfId) {
      const out = { items: [], flags: [], status: 'none' };
      let s = (raw || '').trim();
      if (!s || /^(none|n\/a)$/i.test(s)) return out;
      // "None; Recommended: ..." / "None (recommended ...)" -> no prerequisite
      if (/^none\b/i.test(s)) return out;
      // cut recommendations (never requirements)
      const orig = s;
      s = s.replace(/\s*\(pre-? or co-?requisite\)/ig, '').trim();     // same-year enrollment already satisfies a prerequisite check in the planner
      s = s.replace(/;?\s*\(?\s*recommended[:\s][^;]*$/i, '').replace(/\s*\(recommended[^)]*\)/ig, '').trim();
      // dual-credit eligibility sentences that live in this field stay as notes
      let dcNote = null;
      const dcIdx = s.search(/\s+For Dual Credit/i);
      if (dcIdx > 0) { dcNote = s.slice(dcIdx).trim(); s = s.slice(0, dcIdx).trim(); }
      const dcLead = /^For dual credit/i.test(s);
  
      // split top level on ';' (all must hold), then OR groups
      const parts = s.split(/\s*;\s*/).filter(Boolean);
      let leftoverNotes = [];
      let unstructured = false;
      parts.forEach(part => {
        let orParts = part.split(/\s+OR\s+/i).filter(Boolean);
        let groups = orParts.map(op => extractTitles(op, dept));
        if (orParts.length > 1 && !/\sOR\s/.test(part) && !groups.every(g => g.found.length)) {   // lower-case "or" inside plain text: not a choice between courses
          orParts = [part]; groups = [extractTitles(part, dept)];
        }
        const leftoverOf = g => g.rest.replace(NOISE, ' ').replace(/[0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
        if (orParts.length > 1) {
          const allCourse = groups.every(g => g.found.length && !leftoverOf(g).replace(/\b(i|ii|iii|iv)\b/g, '').trim());
          if (allCourse) {
            const ids = [];
            groups.forEach(g => g.found.forEach(c => siblings(c).forEach(x => { if (!ids.includes(x.id)) ids.push(x.id); })));
            out.items.push({ type: 'any_of', courses: ids });
          } else {
            leftoverNotes.push(part); unstructured = true;      // an OR with a non-course option can't be enforced
          }
          return;
        }
        // single (AND) part: "X and Y", "X, plus ...", titles + leftover
        const g = groups[0];
        const left = leftoverOf(g);
        if (dcLead) { leftoverNotes.push(part); unstructured = true; return; }
        const seen = new Set();
        g.found.forEach(c => {
          if (seen.has(c.id)) return;
          const sib = siblings(c);
          sib.forEach(x => seen.add(x.id));
          if (sib.length > 1) out.items.push({ type: 'any_of', courses: sib.map(x => x.id) });
          else if (c.id !== selfId) out.items.push(c.id);
        });
        if (left) { leftoverNotes.push(part); }
        if (!g.found.length) unstructured = true;
      });
      // a plain-text note carries every condition that cannot be enforced
      if (leftoverNotes.length || dcNote) {
        const noteText = [leftoverNotes.join('; '), dcNote].filter(Boolean).join(' ');
        out.items.push({ type: 'requirement', note: noteText });
      }
      const enforced = out.items.filter(i => typeof i === 'string' || i.type === 'any_of').length;
      out.status = !out.items.length ? 'none' : enforced ? (leftoverNotes.length || dcNote ? 'partial' : 'structured') : 'text_only';
      out.original = orig;
      return out;
    }
    return { resolve };
  }
  
  /* ---------------- building ---------------- */
  function slug(s) { return P.titleKey(s).replace(/ /g, '-'); }
  function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }

  function codeLookup(base) {            // state code -> [requirement ids] from the IDOE memo lists
    var map = {};
    Object.keys(base.base_diploma_requirements).forEach(function (cat) {
      var c = base.base_diploma_requirements[cat];
      ['required', 'flexible'].forEach(function (k) {
        (c[k] || []).forEach(function (r) {
          (r.satisfied_by_state_course_codes || []).forEach(function (code) { (map[code] = map[code] || []).push(r.id); });
        });
      });
    });
    return map;
  }

  function fourDigit(codes) { return uniq([].concat.apply([], (codes || []).map(function (c) { return String(c).split('/').map(function (p) { return p.slice(0, 4); }).filter(function (p) { return /^\d{4}$/.test(p); }); }))); }

  function deriveRequirements(codes, dept, title, codeMap, rules, review) {
    var out = {};
    var reqs = uniq([].concat.apply([], codes.map(function (c) { return codeMap[c] || []; })));
    // World-language level III-VI count as World Perspectives (IDOE memo)
    if (rules.world_language_level3_plus_world_perspectives && dept === 'wl' && /\b(III|IV|V|VI)\b/.test(title)) reqs.push('ss.world_perspectives');
    if (!reqs.length) { out.diploma_requirement_id = 'personalized_electives'; return out; }
    var stem = reqs.filter(function (r) { return /^stem\./.test(r); });
    var rest = reqs.filter(function (r) { return !/^stem\./.test(r); });
    var primary = reqs.slice();
    if (stem.length) {
      // memo: any course in the science sections (except 4565) may also fill STEM-Focused
      var pick = stem.indexOf('stem.biology1_required') >= 0 ? 'stem.biology1_required'
        : stem.indexOf('stem.computer_science') >= 0 ? 'stem.computer_science'
        : stem.indexOf('stem.additional_science') >= 0 ? 'stem.additional_science' : 'stem.stem_focused';
      primary = [pick].concat(rest);
      if (pick !== 'stem.stem_focused' && codes.indexOf('4565') < 0) out.diploma_requirement_id_fallback = 'stem.stem_focused';
    }
    primary = uniq(primary);
    if (primary.length === 1) out.diploma_requirement_id = primary[0];
    else { out.diploma_requirement_id = primary[0]; out.diploma_requirement_id_options = primary.slice().sort(); delete out.diploma_requirement_id; }
    return out;
  }

  function deriveSealTags(codes, dept, title, rules) {
    var tags = [], sc = rules.seal_codes || {};
    Object.keys(sc).forEach(function (tag) { if (codes.some(function (c) { return sc[tag].indexOf(c) >= 0; })) tags.push(tag); });
    if (dept === 'wl' && rules.world_language_seal_all_wl) tags.push('seal.enrollment_honors_world_language');
    return tags;
  }

  function parseRepeat(raw) {
    raw = (raw || '').trim();
    if (!raw || /^(1|n\/a)$/i.test(raw) || /^1 each/i.test(raw)) return null;
    var out = {}, m;
    if ((m = /^(\d+)\s*\((\d+)\s*credits? max\)/i.exec(raw))) { out.max_times = +m[1]; out.max_credits = +m[2]; }
    else if ((m = /^up to (\d+) credits?/i.exec(raw))) out.max_credits = +m[1];
    else if (/^repeatable/i.test(raw)) { /* no stated limit */ }
    else if (/^once per school year/i.test(raw)) { /* retake yearly; cap comes from the shared pool */ }
    else return { _unreadable: raw };
    out.source = 'Course guide: "' + raw + '"';
    return out;
  }

  function splitCerts(raw) {
    if (!raw || /^(none|n\/a)$/i.test(raw)) return [];
    // split on ';' that is not inside parentheses
    var out = [], depth = 0, cur = '';
    for (var i = 0; i < raw.length; i++) {
      var ch = raw[i];
      if (ch === '(') depth++; if (ch === ')') depth = Math.max(0, depth - 1);
      if (ch === ';' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out.filter(Boolean);
  }
  function covKey(s) { return (s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[–—\-]/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); }

  // "Pathway label — first course in pathway" / "— follows X" / "— Capstone; follows X"
  function parsePathway(raw) {
    raw = (raw || '').trim();
    if (!raw || /^(n\/a|none)$/i.test(raw)) return null;
    var idx = raw.indexOf(' \u2014 ');
    var labelPart = idx >= 0 ? raw.slice(0, idx) : raw;
    var detail = idx >= 0 ? raw.slice(idx + 3).trim() : '';
    var labels = labelPart.split(/\s*;\s*/).reduce(function (a, l) { return a.concat(l.split(/\s+and\/or\s+/i)); }, []);
    if (/\bboth pathways\b/i.test(detail) && labels.length === 1) labels = labels[0].replace(/^(Construction Trades \u2013 )?/, '').split(/\s+and\s+/).map(function (l, i, arr) { return (/^Carpentry$/.test(l) ? 'Construction Trades \u2013 ' : '') + l; });
    labels = labels.map(function (l) { return l.trim(); }).filter(Boolean);
    var isWBL = /^work-based learning/i.test(labelPart);
    return { raw: raw, labels: labels, detail: detail, work_based: isWBL };
  }

  function wblHours(raw) {
    if (!raw || /^(none|n\/a)$/i.test(raw)) return null;
    var n = parseFloat(String(raw).replace(/[^0-9.]/g, ''));
    return isNaN(n) || n === 0 ? (n === 0 ? 0 : null) : n;
  }

  /**
   * parsed: [{prefix, department:{name,school_year,notes}, courses:[...], issues:[...]}]
   * returns {courses:[...], report:{...}}
   */
  function build(parsed, ctx) {
    var rules = ctx.rules || {}, base = ctx.base, cov = ctx.cov || { credentials: {} };
    var codeMap = codeLookup(base);
    Object.keys(rules.extra_code_requirements || {}).forEach(function (code) { rules.extra_code_requirements[code].forEach(function (r) { (codeMap[code] = codeMap[code] || []); if (codeMap[code].indexOf(r) < 0) codeMap[code].push(r); }); });
    var report = { unreadable: [], needs_review: [], code_notes: [], prereq_text_only: [], prereq_partial: [], prereq_override_stale: [], parse_issues: [], no_icc: [], cov_missing: [], duplicate_ids: [] };
    var flat = [], deptHasLevelNote = {};
    parsed.forEach(function (d) {
      deptHasLevelNote[d.prefix] = (d.department.notes || []).some(function (n) { return /any level of a prerequisite course/i.test(n); });
      d.issues.forEach(function (i) { report.parse_issues.push((d.department.name || d.prefix) + ': ' + (i.course ? i.course + ' - ' : '') + i.msg); });
      d.courses.forEach(function (rec) { flat.push({ prefix: d.prefix, dept: d.department, rec: rec, id: d.prefix + '-' + slug(rec.title) }); });
    });
    var seen = {};
    flat.forEach(function (f) { if (seen[f.id]) { report.duplicate_ids.push(f.id); f.id += '-' + (f.rec.state_codes[0] || 'x').slice(0, 4).toLowerCase(); } seen[f.id] = true; });
    var resolver = makeResolver(flat.map(function (f) { return { id: f.id, dept: f.prefix, title: f.rec.title }; }), deptHasLevelNote, rules.prereq_aliases || []);
    var courseRules = rules.course_rules || {};
    var out = [];

    flat.forEach(function (f) {
      var r = f.rec, id = f.id, cr = courseRules[id] || {}, review = (cr.review || []).slice();
      var codes = fourDigit(r.state_codes);
      var c = { id: id, title: r.title, _dept: f.dept.name, _prefix: f.prefix, state_course_code: r.state_code_raw || '', grades: r.grades || [9, 10, 11, 12], description: r.description || '' };

      // length & credits (guide values are used as written; unreadable ones are flagged)
      c.semesters = r.semesters != null ? r.semesters : (/varies/i.test(r.length_credits_raw || '') ? '1-2' : (/2 semesters/i.test(r.length_credits_raw || '') ? 2 : '1-2'));
      c.credits = r.credits != null ? r.credits : 0;
      if (r.credits == null) { c._credit_note = 'Credit is not stated in the course guide (' + (r.length_credits_raw || 'blank') + '). Ask your counselor.'; review.push('Credits could not be read from the guide ("' + (r.length_credits_raw || '') + '").'); }
      c._length_text = r.length_credits_raw || '';
      // credit/length facts the guide cannot state in a readable form (supplied in rules.json, with the source of the decision)
      if (cr.credit_override) {
        var co = cr.credit_override;
        if (co.semesters != null) c.semesters = co.semesters;
        c.credits = co.credits;
        if (co.grades) c.grades = co.grades.slice();
        if (co.repeatable) c.repeatable = { max_times: co.repeatable.max_times || null, max_credits: co.repeatable.max_credits || null, source: co.source };
        delete c._credit_note; c._credit_rule = co.source;
        review = review.filter(function (x) { return x.indexOf('Credits could not be read') !== 0; });
      }

      // diploma requirement + seal tags from IDOE code lists
      var d = deriveRequirements(codes, f.prefix, r.title, codeMap, rules, review);
      Object.keys(d).forEach(function (k) { c[k] = d[k]; });
      var tags = deriveSealTags(codes, f.prefix, r.title, rules);
      if (!codes.length && !cr.no_code_ok) review.push('No state course code in the guide, so no diploma requirement or seal category could be assigned (treated as an elective).');
      if ((cr.diploma_requirement_id || cr.diploma_requirement_id_options) && cr.override_reason) {
        delete c.diploma_requirement_id; delete c.diploma_requirement_id_options; delete c.diploma_requirement_id_fallback;
        ['diploma_requirement_id', 'diploma_requirement_id_options', 'diploma_requirement_id_fallback'].forEach(function (k) { if (cr[k]) c[k] = cr[k]; });
        report.code_notes.push(r.title + ': ' + cr.override_reason);
      }
      if (cr.credit_split) c.credit_split = cr.credit_split;
      (cr.extra_tags || []).forEach(function (t) { tags.push(t); });
      if (f.prefix !== 'wl' && c.diploma_requirement_id === 'ss.world_perspectives') { /* ok */ }
      var pw = parsePathway(r.pathway_raw);
      if (pw && !pw.work_based) pw.labels.forEach(function (l) { tags.push('cte_pathway.' + slug(l)); });
      c._pathway = pw;
      c.flexible_category_tags = uniq(tags);

      // prerequisites: reviewed override (only while guide text is unchanged) else automatic reading
      var pr;
      var ov = (rules.prereq_overrides || {})[id];
      if (ov && (ov.source || '') === (r.prereq_raw || '')) pr = { items: ov.items, status: 'reviewed' };
      else {
        if (ov) report.prereq_override_stale.push(r.title + ': guide text changed since review ("' + ov.source + '" -> "' + r.prereq_raw + '")');
        pr = resolver.resolve(r.prereq_raw, f.prefix, id);
        if (pr.status === 'text_only') report.prereq_text_only.push(r.title + ': ' + r.prereq_raw);
        if (pr.status === 'partial') report.prereq_partial.push(r.title + ': ' + r.prereq_raw);
      }
      c.prerequisites = pr.items;
      c._prereq_status = pr.status;
      c._prereq_text = r.prereq_raw && !/^(none|n\/a)$/i.test(r.prereq_raw) ? r.prereq_raw : '';
      c._coreq_text = r.coreq_raw && !/^(none|n\/a)$/i.test(r.coreq_raw) ? r.coreq_raw : '';
      c.ncaa_approved = r.ncaa;

      // dual credit
      if (r.dual_credit) {
        c.dual_credit = { institution: /^n\/a$/i.test(r.partner_raw || '') ? '' : (r.partner_raw || ''), college_course: /^n\/a$/i.test(r.college_courses_raw || '') ? '' : (r.college_courses_raw || ''), eligibility_text: (r.dc_eligibility_raw && !/^n\/a$/i.test(r.dc_eligibility_raw)) ? r.dc_eligibility_raw : '' };
      } else c.dual_credit = null;

      // certifications (+ Credentials of Value lookup)
      var certs = splitCerts(r.certs_raw);
      if (certs.length) c.certifications = certs.map(function (name) {
        var k = covKey(name), al = (rules.certification_aliases || {})[k], hit = cov.credentials[al ? covKey(al) : k];
        if (!hit) report.cov_missing.push(r.title + ': ' + name);
        return { name: name, credential_of_value: hit ? ('On the ' + (cov.list_year || '2026-2027') + ' Credentials of Value list' + (hit.score && hit.score !== 'N/A' ? ' (score ' + hit.score + ')' : '')) : null };
      });

      // repeating / shared caps
      var rp = parseRepeat(r.max_times);
      if (rp && rp._unreadable) { review.push('"Course may be taken up to" could not be read: ' + rp._unreadable); rp = null; }
      if (rp) c.repeatable = { max_times: rp.max_times || null, max_credits: rp.max_credits || null, source: rp.source };
      if (cr.shared_pool) { c.shared_pool = cr.shared_pool; if (!c.repeatable && !cr.single_take_only) c.repeatable = { max_times: null, max_credits: null, source: 'Guide: the same elective may be taken once per school year' }; }
      if (cr.single_take_only) c.single_take_only = true;
      if (cr.special_diploma_note) c.special_diploma_note = cr.special_diploma_note;
      if (cr.counts_toward_communications_or_additional_english) c.counts_toward_communications_or_additional_english = cr.counts_toward_communications_or_additional_english;

      // Indiana College Core placement (not in guides; from rules.json, only while the college course text is unchanged)
      if (cr.icc) {
        if (cr.icc_source && cr.icc_source !== (r.college_courses_raw || '')) review.push('College course listing in the guide changed since the Indiana College Core placement was reviewed. Re-check placement.');
        c.icc = cr.icc;
      } else if (r.dual_credit || /advanced placement/i.test(r.title)) report.no_icc.push(r.title);

      // notes shown to students (guide wording, unchanged)
      var notes = [];
      (r.notes || []).forEach(function (n) { notes.push(n); });
      if (r.approval_raw && !/^no$/i.test(r.approval_raw) && !/^n\/a$/i.test(r.approval_raw)) notes.push('Approval/placement: ' + r.approval_raw.replace(/^Yes\s*[\u2014\-]\s*/i, ''));
      if (r.ap_raw && /^(yes|ap course: yes)/i.test(r.ap_raw)) notes.push('AP: ' + r.ap_raw.replace(/^AP course: Yes\. AP exam required:\s*/i, 'exam required: ').replace(/^Yes\s*[\u2014;\-]?\s*/i, ''));
      c.special_notes = notes;
      c._approval = r.approval_raw || '';
      c._wbl_hours = wblHours(r.wbl_raw);
      c._texts = r.texts_raw && !/^(none|n\/a)$/i.test(r.texts_raw) ? r.texts_raw : '';
      c._links = r.links || [];
      c._rec = r;                       // the guide row text, exactly as read (used by the catalog trays)
      c._deptNotes = f.dept.notes || [];
      c._deptSlug = f.prefix;
      c._review = review;
      if (review.length) report.needs_review.push({ id: id, title: r.title, why: review });
      out.push(c);
    });
    // second pass: any prerequisite id that does not exist
    var ids = {}; out.forEach(function (c) { ids[c.id] = true; });
    out.forEach(function (c) {
      (c.prerequisites || []).forEach(function (p) {
        var list = typeof p === 'string' ? [p] : (p.courses || []);
        list.forEach(function (x) { if (!ids[x]) c._review.push('Prerequisite refers to a course that is not in the guides: ' + x); });
      });
    });
    return { courses: out, report: report };
  }

  var api = { build: build, makeResolver: makeResolver, slug: slug, codeLookup: codeLookup, parsePathway: parsePathway, parseRepeat: parseRepeat, splitCerts: splitCerts, covKey: covKey, baseKey: baseKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GuidesBuilder = api;
})(typeof window !== 'undefined' ? window : this);
