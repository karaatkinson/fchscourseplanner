/* =========================================================
   GUIDES PARSER
   Reads a department Course Description Guide (Markdown downloaded
   from Google Docs) and returns plain course records.
   Works in the browser (window.GuidesParser) and in Node (module.exports).
   This file only READS guide text. It never adds or guesses course facts:
   anything it can't read cleanly is returned in `issues` so it can be shown.
   ========================================================= */
(function (root) {
  'use strict';

  // Row label (lowercased, no bold marks) -> record field.
  // New/unknown labels are kept under `extra` and shown as "Additional Information".
  var LABELS = [
    [/^course title$/, 'title'],
    [/^department$/, 'department'],
    [/^course description$/, 'description'],
    [/^grade level/, 'grades_raw'],
    [/^length\s*&\s*credits/, 'length_credits_raw'],
    [/^(max times course may be taken|course may be taken up to)/, 'max_times_raw'],
    [/^pathway/, 'pathway_raw'],
    [/^prerequisite/, 'prereq_raw'],
    [/^co-?requisite/, 'coreq_raw'],
    [/^ncaa/, 'ncaa_raw'],
    [/^application/, 'approval_raw'],
    [/work-based learning hours/, 'wbl_raw'],
    [/^ap course/, 'ap_raw'],
    [/^required texts/, 'texts_raw'],
    [/^industry certification/, 'certs_raw'],
    [/^dual credit offered/, 'dual_raw'],
    [/^partnering university/, 'partner_raw'],
    [/^college course code/, 'college_courses_raw'],
    [/^dual credit eligibility/, 'dc_eligibility_raw'],
    [/^fc \/ state course code|^state course code/, 'state_code_raw'],
    [/^other notes/, 'notes_raw'],
    [/^school year/, 'school_year']
  ];

  function unescapeMd(s) {
    return s.replace(/\\([\\`*_{}\[\]()#+\-.!|$=<>~&"'])/g, '$1');
  }
  // [text](url) -> text, collecting urls
  function stripLinks(s, links) {
    return s.replace(/\[([^\]]*)\]\((https?:[^)\s]+)\)/g, function (_, t, u) { links.push({ text: t, url: u }); return t; });
  }
  function clean(s, links) {
    s = (s || '').trim();
    s = stripLinks(s, links || []);
    s = unescapeMd(s);
    s = s.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
    return s;
  }
  function splitRow(line) {
    // split on unescaped pipes, drop the empty first/last cell
    var cells = line.split(/(?<!\\)\|/).map(function (c) { return c; });
    if (cells.length && cells[0].trim() === '') cells.shift();
    if (cells.length && cells[cells.length - 1].trim() === '') cells.pop();
    return cells;
  }
  function isBlank(v) { return v === '' || /^n\/?a$/i.test(v) || /^none$/i.test(v) && false; }

  // "9–12", "11", "10–12 (grade 9 ...)", "9-12"
  function parseGrades(raw) {
    var m = /^\s*(\d{1,2})\s*(?:[–\-—]\s*(\d{1,2}))?/.exec(raw || '');
    if (!m) return null;
    var a = +m[1], b = m[2] ? +m[2] : a, out = [];
    for (var g = a; g <= b; g++) out.push(g);
    return out;
  }
  // "2 semesters / 2 credits", "1–2 semesters / 1–2 credits per semester",
  // "1 semester / No credit", "1 or 2 semesters / 1 or 2 credits"
  function parseLength(raw) {
    var r = (raw || '').toLowerCase().replace(/\s+/g, ' ');
    var sem = /(\d+)\s*(?:[–\-]|or)\s*(\d+)\s*semesters?|(\d+)\s*semesters?/.exec(r);
    if (!sem) return { semesters: null, credits: null };
    var semesters = sem[3] ? +sem[3] : (sem[1] + '-' + sem[2]);
    var credits = null;
    if (/no credit|0 cr/.test(r)) credits = 0;
    else {
      var cr = /\/\s*(\d+)\s*(?:[–\-]|or)\s*(\d+)\s*credit|\/\s*(\d+)\s*credit/.exec(r);
      if (cr) credits = cr[3] ? +cr[3] : (cr[1] + '-' + cr[2]);
    }
    return { semesters: semesters, credits: credits };
  }
  function yesNo(raw) {
    if (raw == null || raw === '') return null;           // blank -> unknown
    if (/^yes/i.test(raw)) return true;
    if (/^no\b/i.test(raw)) return false;
    return null;
  }

  function parseGuide(md, fileName) {
    var lines = md.replace(/\r/g, '').split('\n');
    var issues = [];
    var dept = { name: null, school_year: null, notes: [], file: fileName };
    var courses = [];

    // header + preamble (everything above the first table)
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      if (/^\|/.test(ln)) break;
      var h = /^#\s+\*\*(.+?)\s*\\?\|\s*Course Overview\*\*/.exec(ln) || /^#\s+\*\*(.+?)\s*\\\|\s*Course Overview/.exec(ln);
      var dm = /\*\*Department:\*\*\s*(.+?)\s{2,}\*\*School Year:\*\*\s*(\S+)/.exec(ln);
      if (dm) { dept.name = clean(dm[1]); dept.school_year = clean(dm[2]); }
      else if (/^\s*\\?\*Unless/.test(ln) || /^\s*\\?\*/.test(ln) && !/^\s*\*\*/.test(ln)) dept.notes.push(clean(ln.replace(/^\s*\\?\*/, '')));
    }

    // course detail tables: first row is "| Course Title | <title> |"
    for (i = 0; i < lines.length; i++) {
      if (!/^\|\s*Course Title\s*\|/.test(lines[i])) continue;
      var firstCells = splitRow(lines[i]);
      if (firstCells.length > 2) continue;                 // overview table header, skip
      var rec = { extra: {}, links: [], _line: i + 1 };
      for (var j = i; j < lines.length && /^\|/.test(lines[j]); j++) {
        if (/^\|\s*:?-{2,}/.test(lines[j])) continue;       // separator row
        var cells = splitRow(lines[j]);
        if (cells.length < 2) continue;
        var label = clean(cells[0]).toLowerCase();
        // value may itself have been split if it held an unescaped pipe
        var value = clean(cells.slice(1).join('|'), rec.links);
        var field = null;
        for (var k = 0; k < LABELS.length; k++) if (LABELS[k][0].test(label)) { field = LABELS[k][1]; break; }
        if (field) rec[field] = value; else rec.extra[clean(cells[0])] = value;
      }
      i = j;
      if (!rec.title) { issues.push({ line: rec._line, msg: 'Course table with no title' }); continue; }
      courses.push(finish(rec, issues, dept));
    }
    return { department: dept, courses: courses, issues: issues };
  }

  function finish(rec, issues, dept) {
    var t = rec.title;
    function warn(msg) { issues.push({ course: t, msg: msg }); }
    rec.grades = parseGrades(rec.grades_raw);
    if (!rec.grades) warn('Could not read grade levels: "' + (rec.grades_raw || '') + '"');
    var L = parseLength(rec.length_credits_raw);
    rec.semesters = L.semesters; rec.credits = L.credits;
    if (L.semesters == null) warn('Could not read length: "' + (rec.length_credits_raw || '') + '"');
    else if (L.credits == null) warn('Could not read credits: "' + rec.length_credits_raw + '"');
    // placeholder text left in the template label is not a value
    rec.max_times = /^\[?x\]?$/i.test(rec.max_times_raw || '') ? '' : (rec.max_times_raw || '');
    rec.ncaa = yesNo(rec.ncaa_raw);
    rec.dual_credit = yesNo(rec.dual_raw);
    if (rec.dual_credit === null) warn('Dual Credit Offered is blank or unclear');
    if (rec.dual_credit && /^n\/?a$/i.test(rec.partner_raw || '')) warn('Dual credit = Yes but no Partnering University');
    rec.state_codes = (rec.state_code_raw || '').match(/\b\d{4}(?:\/[A-Z0-9]+)?/g) || [];
    if (!rec.state_codes.length && !/^c9/i.test(rec.state_code_raw || '')) warn('No readable state course code: "' + (rec.state_code_raw || '') + '"');
    if (rec.school_year && dept.school_year && rec.school_year !== dept.school_year) warn('Course school year (' + rec.school_year + ') differs from the guide header (' + dept.school_year + ')');
    rec.notes = (rec.notes_raw && !/^(none|n\/a)$/i.test(rec.notes_raw)) ? [rec.notes_raw] : [];
    // [[NOTE: ...]] tags (per the Notes convention guide) in any text field
    var tagRe = /\[\[NOTE:\s*([\s\S]*?)\]\]/g, m;
    ['description', 'notes_raw'].forEach(function (f) {
      while ((m = tagRe.exec(rec[f] || ''))) rec.notes.push(m[1].trim());
    });
    return rec;
  }

  // Normalized key used to match a guide title to an existing course title.
  function titleKey(s) {
    return (s || '').toLowerCase().replace(/&/g, ' and ').replace(/[–—\-]+/g, ' ').replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\b(the|a)\b/g, ' ').replace(/\s+/g, ' ').trim();
  }

  var api = { parseGuide: parseGuide, titleKey: titleKey, parseGrades: parseGrades, parseLength: parseLength };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GuidesParser = api;
})(typeof window !== 'undefined' ? window : this);
