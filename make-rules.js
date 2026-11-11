/* Generates data/rules.json (one-time carry-over from the 2026-27 build + IDOE code lists).
   Usage: node tools/make-rules.js <old-data-dir>
   The result is a plain JSON file people can read and edit; this script is only needed
   if the rules are ever regenerated from scratch. */
'use strict';
const fs = require('fs'), path = require('path');
const P = require('../guides-parser.js'), B = require('../guides-builder.js');
const OLD = process.argv[2] || path.join(__dirname, 'legacy-2026-27');
const root = path.join(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'data/guides.json'), 'utf8'));
const parsed = cfg.departments.map(d => Object.assign({ prefix: d.prefix }, P.parseGuide(fs.readFileSync(path.join(root, 'guides', d.file), 'utf8'), d.file)));
const base = JSON.parse(fs.readFileSync(path.join(root, 'data/diploma-base-rules.json'), 'utf8'));

// ---- old (2026-27) courses
const E = [];
fs.readdirSync(OLD).filter(f => /^courses-/.test(f)).forEach(f => (JSON.parse(fs.readFileSync(path.join(OLD, f), 'utf8')).courses || []).forEach(c => { if (c.title && c.grades) E.push(c); }));
const syn = s => P.titleKey(s).replace(/\bpre calculus\b/g, 'precalculus').replace(/\bu s\b|\bus\b/g, 'united states').replace(/\badvanced placement\b/g, 'ap').replace(/\bdual credit\b/g, 'dc').replace(/\bearly college\b/g, 'ec').replace(/\bi\b/g, '1').replace(/\bii\b/g, '2').replace(/\biii\b/g, '3').replace(/\biv\b/g, '4').replace(/\btheater\b/g, 'theatre').replace(/\bcalculus ab ap\b/, 'calculus ab ap');
const tok = s => new Set(syn(s).split(' ').filter(w => !['of', 'and', 'the', 'in', 'mccormicks', 'spirit', 'shop'].includes(w)));
const jac = (a, b) => { const i = [...a].filter(x => b.has(x)).length; return i / (a.size + b.size - i || 1); };
const codes4 = s => (String(s || '').match(/\d{4}/g) || []);
// Manual matches where the title changed so much the scorer cannot be trusted (checked by hand).
const MANUAL = {
  'business-information-technology-support-cyber-flashes': 'business-it-support-cyberflashes',
  'math-precalculus-dual-credit': 'math-precalc-algebra-dc',
  'ela-mass-media-production': 'ete-dc-mass-media-production',
  'ela-radio-and-tv-broadcasting-capstone': 'ete-dc-radiotv-capstone',
  'physical-education': null
};
function matchOld(id, title, guideCodes) {
  if (MANUAL[id] !== undefined) return E.find(e => e.id === MANUAL[id]) || null;
  const k = P.titleKey(title);
  const exact = E.find(e => P.titleKey(e.title) === k);
  if (exact) return exact;
  let best = null, bs = 0;
  E.forEach(e => {
    let s = jac(tok(title), tok(e.title));
    const shared = codes4(e.state_course_code).some(x => guideCodes.includes(x));
    if (shared) s += 0.2;
    if (s > bs) { bs = s; best = e; }
  });
  return bs >= 0.8 ? best : null;
}

const rules = {
  _about: 'Rules the course guides do not state. The site reads course facts from the guides; this file adds Readiness Seal code lists (from the IDOE memo), Indiana College Core placement, shared credit caps and reviewed prerequisite readings. Anything marked review is shown to students as "needs review".',
  schema: 1,
  sources: ['1.16.25 Memo 2627 Indiana Diploma Course Eligibility (IDOE)', 'Final Diploma Rule One Pager', 'Updated New Indiana Diploma FAQ', '2025-26 Dual Credit Crosswalks (FCHS; FCHS-Vincennes)'],
  world_language_level3_plus_world_perspectives: true,
  world_language_seal_all_wl: true,
  seal_codes: {
    'seal.enrollment_honors_math_base': ['2532', '2522'],
    'seal.enrollment_honors_advanced_math': ['2530', '2550', '2564', '2566', '2527', '2546', '2595', '2570', '2543', '2562', '2572', '2563', '2544'],
    'seal.enrollment_honors_chemistry_required': ['3064', '3066', '3060'],
    'seal.enrollment_honors_physics_option': ['3084', '3086', '3080', '3081', '3087', '3089'],
    'seal.enrollment_honors_advanced_lab_science_option': ['3026', '3030', '3044', '3046', '3108', '3008', '3010', '3012', '3102', '5276', '3090', '3092', '5216', '5217', '5219', '5070', '5072', '5074'],
    'lab_science': ['3026', '3030', '3044', '3046', '3108', '3064', '3066', '3060', '3084', '3086', '3080', '3081', '3087', '3089', '3008', '3010', '3012', '3102', '5276', '3090', '3092', '5216', '5217', '5219', '5070', '5072', '5074'],
    'seal.enrollment_honors_ss_sixth_credit': ['1518', '1514', '1532', '1534', '1556', '1558', '1564', '1566', '1572', '4558'],
    'seal.enlistment_honors_public_service_requirement': ['3524']
  },
  // IDOE memo: Communications-Focused courses marked * may also count as Additional English credit
  extra_code_requirements: { '1064': ['english.additional_english'], '1070': ['english.additional_english'], '1074': ['english.additional_english'], '1076': ['english.additional_english'], '1078': ['english.additional_english'], '1080': ['english.additional_english'], '1084': ['english.additional_english'], '1086': ['english.additional_english'], '1096': ['english.additional_english'] },
  certification_aliases: { 'adobe photoshop': 'Adobe Certified Professional \u2013 Photoshop', 'adobe illustrator': 'Adobe Certified Professional \u2013 Illustrator', 'adobe premiere pro': 'Adobe Certified Professional \u2013 Premiere Pro', 'nccer core': 'NCCER Core Curriculum' },
  prereq_aliases: [{ id: 'pe-physical-education-i-ii', text: 'Physical Education I' }],
  course_rules: {},
  prereq_overrides: {}
};

const report = { carried: [], unmatched: [], icc_changed: [] };
parsed.forEach(d => d.courses.forEach(rec => {
  const id = d.prefix + '-' + B.slug(rec.title);
  const codes = [...new Set(rec.state_codes.map(c => c.slice(0, 4)))];
  const old = matchOld(id, rec.title, codes);
  const cr = {};
  if (old) {
    report.carried.push(rec.title + '  <-  ' + old.title);
    if (old.icc) {
      cr.icc = old.icc; cr.icc_source = rec.college_courses_raw || '';
      const oldCodes = JSON.stringify((String((old.dual_credit && old.dual_credit.college_course) || '').match(/[A-Z]{3,4}\s?\d{3}/g) || []).map(x => x.replace(/\s/g, '')).sort());
      const newCodes = JSON.stringify((String(rec.college_courses_raw || '').match(/[A-Z]{3,4}\s?\d{3}/g) || []).map(x => x.replace(/\s/g, '')).sort());
      if (old.dual_credit && oldCodes !== newCodes) { cr.review = [`Indiana College Core placement was carried over from "${old.title}" but the guide's college course listing is different (${rec.college_courses_raw}). Verify the placement.`]; report.icc_changed.push(rec.title); }
      if (!old.dual_credit && !/advanced placement/i.test(rec.title)) { /* AP-only estimate carried */ }
    }
    if (old.counts_toward_communications_or_additional_english) cr.counts_toward_communications_or_additional_english = old.counts_toward_communications_or_additional_english;
    if (old.special_diploma_note) cr.special_diploma_note = old.special_diploma_note;
    if ((old.flexible_category_tags || []).includes('seal.employment_honors_wbl_hours_source')) cr.extra_tags = ['seal.employment_honors_wbl_hours_source'];
  } else report.unmatched.push(`${d.prefix}: ${rec.title}`);
  if (/^Elective Physical Education \(/.test(rec.title)) {
    cr.shared_pool = 'pe_elective';
    if (/Lifeguard Training/.test(rec.title)) cr.single_take_only = true;
    cr.diploma_requirement_id = 'personalized_electives';
    cr.override_reason = 'IDOE lists 3560 as eligible for the PE requirement, but the guide says the Class of 2029+ PE requirement is Physical Education I or II. Elective PE is counted as an elective until the school confirms otherwise.';
  }
  if (Object.keys(cr).length) rules.course_rules[id] = cr;
}));

// ---- IDOE: Principles of Computing (7183) counts for Computer Science only when paired with another listed course
const PAIR_NOTE = 'IDOE memo: Principles of Computing (7183) meets the Computer Science requirement only when paired with one of: 7351, 7352, 7178, 7179, 7180, 7181, 7182, 7184 Software Development or 7185 Website and Database Development.';
['business-principles-of-computing', 'business-software-development', 'business-website-and-database-development'].forEach(id => { rules.course_rules[id] = Object.assign(rules.course_rules[id] || {}, { special_diploma_note: PAIR_NOTE }); });

// ---- reviewed prerequisite readings (applied only while the guide's prerequisite text is unchanged)
const rawOf = id => { for (const d of parsed) for (const r of d.courses) if (d.prefix + '-' + B.slug(r.title) === id) return r.prereq_raw; return null; };
function ov(id, items, reason) { const src = rawOf(id); if (src == null) { console.log('override target missing', id); return; } rules.prereq_overrides[id] = { source: src, items, reason }; }
ov('math-geometry-honors', [{ type: 'requirement', note: rawOf('math-geometry-honors') }], 'Algebra I and II are completed before high school, so they cannot be checked against a high school schedule. Shown as text only.');
ov('math-calculus-ab-advanced-placement', [{ type: 'any_of', courses: ['math-precalculus-advanced-placement', 'math-precalculus-dual-credit'] }], 'Guide says "Precalculus (AP or Dual Credit)". Read as either of those two courses. Please confirm.');
ov('wl-spanish-iv-dual-credit', [{ type: 'any_of', courses: ['wl-spanish-iii-honors-dual-credit'] }, { type: 'requirement', note: rawOf('wl-spanish-iv-dual-credit') }], 'Guide names Spanish III Dual Credit specifically (not regular Spanish III).');
fs.writeFileSync(path.join(root, 'data/rules.json'), JSON.stringify(rules, null, 1));

// ---- second pass: where the guide's state code changes what a course counts toward compared with the 2026-27 build, say so on the course
const cov = fs.existsSync(path.join(root, 'data/cov.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'data/cov.json'), 'utf8')) : { credentials: {} };
const built = B.build(parsed, { rules, base, cov }).courses;
const oldByTitle = {}; E.forEach(e => { oldByTitle[e.title] = e; });
const fmt = c => [c.diploma_requirement_id, (c.diploma_requirement_id_options || []).join(' or ')].filter(Boolean).join('') || 'electives';
const SEAL = t => (t || []).filter(x => /^seal\./.test(x)).sort().join(',');
report.carried.forEach(line => {
  const [nt, ot] = line.split('  <-  ');
  const nc = built.find(c => c.title === nt), oc = oldByTitle[ot];
  if (!nc || !oc) return;
  const reasons = [];
  if (fmt(nc) !== fmt(oc) && !(nc.diploma_requirement_id_options && oc.diploma_requirement_id_options && fmt(nc).split(' or ').sort().join() === fmt(oc).split(' or ').sort().join()))
    reasons.push(`With the state course code in the guide (${nc.state_course_code}) this course counts toward ${fmt(nc).replace(/\./g, ' ')}. The 2026-27 build counted it toward ${fmt(oc).replace(/\./g, ' ')} (old code ${oc.state_course_code || 'n/a'}).`);
  if (SEAL(nc.flexible_category_tags) !== SEAL(oc.flexible_category_tags))
    reasons.push(`Readiness Seal categories changed with the guide's code: now [${SEAL(nc.flexible_category_tags) || 'none'}], was [${SEAL(oc.flexible_category_tags) || 'none'}].`);
  if (reasons.length) { const id = nc.id; rules.course_rules[id] = Object.assign(rules.course_rules[id] || {}, { review: (rules.course_rules[id] && rules.course_rules[id].review || []).concat(reasons) }); }
});
fs.writeFileSync(path.join(root, 'data/rules.json'), JSON.stringify(rules, null, 1));
console.log(JSON.stringify({ carried: report.carried.length, unmatched: report.unmatched.length, icc_changed: report.icc_changed.length }));
fs.writeFileSync(process.env.REPORT || '/dev/null', JSON.stringify(report, null, 1));
