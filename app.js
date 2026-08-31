const DEPARTMENT_FILES = [
  { file: 'data/courses-math.json', label: 'Mathematics' },
  { file: 'data/courses-ela.json', label: 'English Language Arts' },
  { file: 'data/courses-business.json', label: 'Business' },
  { file: 'data/courses-social-studies.json', label: 'Social Studies' },
  { file: 'data/courses-science.json', label: 'Science' },
  { file: 'data/courses-facs.json', label: 'Family & Consumer Sciences' },
  { file: 'data/courses-ete.json', label: 'Engineering & Technology Education' },
  { file: 'data/courses-performing-arts.json', label: 'Performing Arts' },
  { file: 'data/courses-pe.json', label: 'Physical Education' },
  { file: 'data/courses-world-language.json', label: 'World Language' },
  { file: 'data/courses-visual-arts.json', label: 'Visual Arts' },
  { file: 'data/courses-multidisciplinary.json', label: 'Multidisciplinary' },
];

const REQUIREMENT_LABELS = {
  'english.english9': 'English 9 (required)',
  'english.communications_focused': 'Communications-Focused English',
  'english.additional_english': 'Additional English',
  'math.algebra1_required': 'Algebra I (required)',
  'math.personal_finance': 'Personal Finance (required)',
  'math.additional_credits': 'Additional Math',
  'stem.biology1_required': 'Biology I (required)',
  'stem.computer_science': 'Computer Science (required)',
  'stem.additional_science': 'Additional Science',
  'stem.stem_focused': 'STEM-Focused',
  'ss.us_history': 'U.S. History (required)',
  'ss.us_government': 'U.S. Government (required)',
  'ss.world_perspectives': 'World Perspectives',
  'pe.physical_education': 'Physical Education (required)',
  'pe.health_wellness': 'Health & Wellness (required)',
  'cc.preparing_for_college_careers': 'Preparing for College & Careers (required)',
  'personalized_electives': 'Personalized Elective'
};

let diplomaRules = null;

let allCourses = []; // flattened, each tagged with department label
let coursesById = {};
let activeDept = null;
let currentDetailId = null;
let lastSearchQuery = '';

const GRADES = [9, 10, 11, 12];
const GRADE_LABELS = { 9: '9th Grade', 10: '10th Grade', 11: '11th Grade', 12: '12th Grade' };

let mode = localStorage.getItem('fchs-mode'); // 'quick' | 'builder' | null (not yet chosen)
let currentGrade = Number(localStorage.getItem('fchs-current-grade')) || 9;
let yearData = loadYearData(); // { 9: {schedule, alternates, status}, 10: {...}, 11: {...}, 12: {...} }
let activeGrade = mode === 'builder' ? currentGrade : 9;

// `schedule` and `alternates` always point at the ACTIVE year's arrays. All the existing
// schedule-editing logic below reads/writes these two variables directly; switchYear() re-points them.
let schedule = yearData[activeGrade].schedule;
let alternates = yearData[activeGrade].alternates;

function loadYearData() {
  try {
    const raw = localStorage.getItem('fchs-yeardata');
    if (raw) {
      const parsed = JSON.parse(raw);
      GRADES.forEach(g => { if (!parsed[g]) parsed[g] = { schedule: [], alternates: [], status: 'planned' }; });
      return parsed;
    }
  } catch (e) { /* fall through to migration */ }

  // Migration: earlier versions of this site stored one flat schedule with no year concept.
  let legacySchedule = [], legacyAlternates = [];
  try {
    const rawS = localStorage.getItem('fchs-schedule');
    if (rawS) {
      let p = JSON.parse(rawS);
      if (p.length && typeof p[0] === 'string') p = p.map(id => ({ id, semester: 1 })); // even older flat-array format
      legacySchedule = p;
    }
    const rawA = localStorage.getItem('fchs-alternates');
    if (rawA) legacyAlternates = JSON.parse(rawA);
  } catch (e) { /* ignore */ }

  const data = {};
  GRADES.forEach(g => { data[g] = { schedule: [], alternates: [], status: 'planned' }; });
  if (legacySchedule.length || legacyAlternates.length) {
    data[9].schedule = legacySchedule;
    data[9].alternates = legacyAlternates;
  }
  return data;
}
function persistYearData() {
  yearData[activeGrade] = { schedule, alternates, status: yearData[activeGrade].status };
  try { localStorage.setItem('fchs-yeardata', JSON.stringify(yearData)); } catch (e) {}
}
function saveAll() {
  persistYearData();
  renderScheduleTray();
  updateAddBtn();
  refreshCatalogView();
}

function isFullYear(c) { return c.semesters === 2; }
function hasVariableDuration(c) {
  return typeof c.semesters === 'string' && /1/.test(c.semesters) && /2/.test(c.semesters);
}
function entryIsFullYear(entry, c) { return isFullYear(c) || !!entry.fullYearOverride; }
function inSchedule(id) { return schedule.some(e => e.id === id); }
function inAlternates(id) { return alternates.some(e => e.id === id); }

function semesterCount(sem) {
  return schedule.filter(e => {
    const c = coursesById[e.id];
    if (!c) return false;
    return entryIsFullYear(e, c) || e.semester === sem; // full-year courses occupy a period in both semesters
  }).length;
}

function nextInstanceId() {
  let counter = Number(localStorage.getItem('fchs-instance-counter')) || 1;
  localStorage.setItem('fchs-instance-counter', String(counter + 1));
  return counter;
}
function backfillInstanceIds() {
  let changed = false;
  GRADES.forEach(g => {
    [...yearData[g].schedule, ...yearData[g].alternates].forEach(e => {
      if (!e.instanceId) { e.instanceId = nextInstanceId(); changed = true; }
    });
  });
  if (changed) try { localStorage.setItem('fchs-yeardata', JSON.stringify(yearData)); } catch (e) {}
}

const SHARED_POOLS = { pe_elective: { max_credits: 8, label: 'combined Elective PE courses' } };

function lifetimeCount(id) {
  return allYearsSchedules().filter(e => e.id === id).length;
}
function lifetimeCredits(id) {
  const c = coursesById[id];
  return lifetimeCount(id) * parseCredits(c);
}
function sharedPoolCredits(poolId) {
  return allYearsSchedules().reduce((sum, e) => {
    const c = coursesById[e.id];
    if (c && c.shared_pool === poolId) sum += parseCredits(c);
    return sum;
  }, 0);
}

function canAddInstance(id) {
  const c = coursesById[id];
  if (c.shared_pool && SHARED_POOLS[c.shared_pool]) {
    const pool = SHARED_POOLS[c.shared_pool];
    if (sharedPoolCredits(c.shared_pool) + parseCredits(c) > pool.max_credits) {
      return { allowed: false, reason: `Adding this would exceed the ${pool.max_credits}-credit cap across ${pool.label}.` };
    }
  }
  if (c.single_take_only && lifetimeCount(id) >= 1) {
    return { allowed: false, reason: 'This course can only be taken once during high school.' };
  }
  if (c.repeatable) {
    if (c.repeatable.max_times && lifetimeCount(id) >= c.repeatable.max_times) {
      return { allowed: false, reason: `Already taken the maximum ${c.repeatable.max_times} times.` };
    }
    if (c.repeatable.max_credits && lifetimeCredits(id) + parseCredits(c) > c.repeatable.max_credits) {
      return { allowed: false, reason: `Adding this would exceed the ${c.repeatable.max_credits}-credit cap for this course.` };
    }
    return { allowed: true };
  }
  // Default (no repeatable metadata): only one instance ever, across all years
  if (lifetimeCount(id) >= 1) return { allowed: false, reason: 'Already in your plan for another year.' };
  return { allowed: true };
}

function enforceSemesterCapsFor(schedArr) {
  let count1 = 0, count2 = 0;
  const kept = [], overflow = [];
  schedArr.forEach(entry => {
    const c = coursesById[entry.id];
    if (!c) return;
    if (entryIsFullYear(entry, c)) {
      if (count1 < 7 && count2 < 7) { kept.push(entry); count1++; count2++; }
      else overflow.push(entry);
    } else {
      const sem = entry.semester === 2 ? 2 : 1;
      if (sem === 1 && count1 < 7) { kept.push(entry); count1++; }
      else if (sem === 2 && count2 < 7) { kept.push(entry); count2++; }
      else overflow.push(entry);
    }
  });
  return { kept, overflow };
}
function enforceAllYearCaps() {
  GRADES.forEach(g => {
    const { kept, overflow } = enforceSemesterCapsFor(yearData[g].schedule);
    if (overflow.length) { yearData[g].schedule = kept; yearData[g].alternates = overflow.concat(yearData[g].alternates); }
  });
  schedule = yearData[activeGrade].schedule;
  alternates = yearData[activeGrade].alternates;
  persistYearData();
}

function toggleCourse(id) {
  const c = coursesById[id];
  const repeatableCourse = !!(c.repeatable);

  // Non-repeatable courses: clicking again removes it (original toggle behavior)
  if (!repeatableCourse) {
    if (inSchedule(id)) { schedule = schedule.filter(e => e.id !== id); saveAll(); return; }
    if (inAlternates(id)) { alternates = alternates.filter(e => e.id !== id); saveAll(); return; }
  }

  const check = canAddInstance(id);
  if (!check.allowed) { alert(check.reason); return; }

  const entry = { id, semester: 1, instanceId: nextInstanceId() };
  const full = isFullYear(c);
  if (full) {
    if (semesterCount(1) < 7 && semesterCount(2) < 7) schedule.push(entry);
    else alternates.push(entry);
  } else {
    if (semesterCount(1) < 7) schedule.push(entry);
    else if (semesterCount(2) < 7) { entry.semester = 2; schedule.push(entry); }
    else alternates.push(entry);
  }
  saveAll();
}
function removeInstance(instanceId) {
  const before = schedule.length;
  schedule = schedule.filter(e => e.instanceId !== instanceId);
  if (schedule.length === before) alternates = alternates.filter(e => e.instanceId !== instanceId);
  saveAll();
}
function moveToSchedule(instanceId) {
  const idx = alternates.findIndex(e => e.instanceId === instanceId);
  if (idx === -1) return;
  const c = coursesById[alternates[idx].id];
  const full = entryIsFullYear(alternates[idx], c);
  let targetSem;
  if (full) {
    if (semesterCount(1) >= 7 || semesterCount(2) >= 7) return;
    targetSem = 1;
  } else {
    if (semesterCount(1) < 7) targetSem = 1;
    else if (semesterCount(2) < 7) targetSem = 2;
    else return;
  }
  const [entry] = alternates.splice(idx, 1);
  entry.semester = targetSem;
  schedule.push(entry);
  saveAll();
}
function setSemester(instanceId, sem) {
  const entry = schedule.find(e => e.instanceId === instanceId) || alternates.find(e => e.instanceId === instanceId);
  if (!entry) return;
  if (schedule.includes(entry)) {
    if (entry.semester === sem) return;
    if (semesterCount(sem) >= 7) return;
  }
  entry.semester = sem;
  saveAll();
}
function toggleFullYearOverride(instanceId) {
  const entry = schedule.find(e => e.instanceId === instanceId) || alternates.find(e => e.instanceId === instanceId);
  if (!entry) return;
  entry.fullYearOverride = !entry.fullYearOverride;
  saveAll();
}

/* =========================================================
   FOUR-YEAR BUILDER: mode/grade setup, year switching, aggregation
   ========================================================= */
function allYearsSchedules() {
  yearData[activeGrade] = { schedule, alternates, status: yearData[activeGrade].status }; // sync in-memory edits first
  return GRADES.flatMap(g => yearData[g].schedule);
}

function switchYear(g) {
  persistYearData();
  activeGrade = g;
  schedule = yearData[g].schedule;
  alternates = yearData[g].alternates;
  renderYearTabs();
  updateScheduleTitle();
  renderScheduleTray();
  refreshCatalogView();
  updateAddBtn();
}

function renderYearTabs() {
  const nav = document.getElementById('yearTabs');
  if (mode !== 'builder') { nav.style.display = 'none'; return; }
  nav.style.display = 'flex';
  nav.innerHTML = GRADES.map(g => {
    const status = yearData[g].status === 'completed' ? 'Completed' : 'Planning';
    return `<button class="year-tab ${g === activeGrade ? 'active' : ''}" data-grade="${g}">${GRADE_LABELS[g]} <span class="year-tab-status ${yearData[g].status}">${status}</span></button>`;
  }).join('');
  nav.querySelectorAll('.year-tab').forEach(btn => {
    btn.addEventListener('click', () => switchYear(Number(btn.dataset.grade)));
  });
}

function updateScheduleTitle() {
  document.getElementById('scheduleTitle').textContent = mode === 'builder' ? `My Schedule \u2014 ${GRADE_LABELS[activeGrade]}` : 'My Schedule';
}

function initSetup() {
  const overlay = document.getElementById('setupOverlay');
  overlay.style.display = mode ? 'none' : 'flex';

  document.getElementById('pickQuick').addEventListener('click', () => {
    mode = 'quick'; currentGrade = 9; activeGrade = 9;
    localStorage.setItem('fchs-mode', 'quick'); localStorage.setItem('fchs-current-grade', '9');
    finishSetup();
  });
  document.getElementById('pickBuilder').addEventListener('click', () => {
    document.getElementById('setupModeStep').style.display = 'none';
    document.getElementById('setupGradeStep').style.display = 'block';
  });
  document.querySelectorAll('#setupGradeStep [data-grade]').forEach(btn => {
    btn.addEventListener('click', () => {
      const g = Number(btn.dataset.grade);
      mode = 'builder'; currentGrade = g; activeGrade = g;
      localStorage.setItem('fchs-mode', 'builder'); localStorage.setItem('fchs-current-grade', String(g));
      GRADES.forEach(yr => { yearData[yr].status = yr < g ? 'completed' : 'planned'; });
      persistYearData();
      finishSetup();
    });
  });
  document.getElementById('changePlanBtn').addEventListener('click', () => {
    document.getElementById('setupModeStep').style.display = 'block';
    document.getElementById('setupGradeStep').style.display = 'none';
    overlay.style.display = 'flex';
  });
}
function finishSetup() {
  document.getElementById('setupOverlay').style.display = 'none';
  schedule = yearData[activeGrade].schedule;
  alternates = yearData[activeGrade].alternates;
  renderYearTabs();
  updateScheduleTitle();
  renderScheduleTray();
  refreshCatalogView();
}

async function loadAll() {
  const results = await Promise.all(
    DEPARTMENT_FILES.map(d => fetch(d.file).then(r => r.json()).then(json => ({ ...d, json })))
  );

  results.forEach(({ label, json }) => {
    (json.courses || []).forEach(c => {
      if (c.active_2026_27 === false) return; // skip inactive/discontinued
      if (c.note && !c.title) return; // skip pure cross-reference stubs
      c._dept = label;
      allCourses.push(c);
      coursesById[c.id] = c;
    });
  });

  renderDeptRail(results.map(r => r.label));
  renderFilterBar();
  backfillInstanceIds();
  enforceAllYearCaps();
  initSetup();
  renderYearTabs();
  updateScheduleTitle();
  renderScheduleTray();
  const sortedLabels = results.map(r => r.label).sort((a, b) => a.localeCompare(b));
  selectDept(sortedLabels[0]);

  diplomaRules = await fetch('data/diploma-base-rules.json').then(r => r.json());
  initViewTabs();
  initManualPanel();
}

function renderDeptRail(labels) {
  const rail = document.getElementById('deptRailButtons');
  const sorted = [...labels].sort((a, b) => a.localeCompare(b));
  rail.innerHTML = sorted.map(label => {
    const count = allCourses.filter(c => c._dept === label).length;
    return `<button class="dept-item" data-dept="${label}">${label}<span class="dept-count">${count}</span></button>`;
  }).join('');
  rail.querySelectorAll('.dept-item').forEach(btn => {
    btn.addEventListener('click', () => selectDept(btn.dataset.dept));
  });
}

function selectDept(label) {
  activeDept = label;
  document.querySelectorAll('.dept-item').forEach(b => b.classList.toggle('active', b.dataset.dept === label));
  document.getElementById('searchInput').value = '';
  renderCatalog(allCourses.filter(c => c._dept === label), label);
}

function renderCatalog(rawList, heading) {
  const el = document.getElementById('catalog');
  const list = applyFilters(rawList);
  const filteredOut = rawList.length - list.length;
  const countNote = filteredOut > 0 ? ` <span class="filter-count">(${filteredOut} hidden by filters)</span>` : '';
  if (!list.length) {
    el.innerHTML = `<h2 class="dept-heading">${heading}${countNote}</h2><p class="empty-state">No courses match${filteredOut ? ' your filters' : ''}.</p>`;
    return;
  }
  el.innerHTML = `<h2 class="dept-heading">${heading}${countNote}</h2>` +
    list.map(c => courseRowHTML(c)).join('');
  el.querySelectorAll('.course-row').forEach(row => {
    row.addEventListener('click', () => openDetail(row.dataset.id));
  });
}

function isAP(c) {
  return /\bAP\b/.test(c.title) || /Advanced Placement/i.test(c.title);
}
function isWBL(c) {
  return (c.flexible_category_tags || []).includes('seal.employment_honors_wbl_hours_source') || /internship|cooperative education|work.?based learning/i.test(c.title);
}
function hasNoPrereqs(c) {
  return !c.prerequisites || c.prerequisites.length === 0;
}

/* =========================================================
   FILTER BAR
   ========================================================= */
let filters = { duration: 'all', ap: false, dual: false, pathway: false, wbl: false, noPrereq: false, repeatable: false };

function courseMatchesFilters(c) {
  if (filters.duration === '1' && parseSemesters(c) != 1) return false;
  if (filters.duration === '2' && !isFullYear(c)) return false;
  if (filters.ap && !isAP(c)) return false;
  if (filters.dual && !c.dual_credit) return false;
  if (filters.pathway && !PATHWAY_INFO[c.id]) return false;
  if (filters.wbl && !isWBL(c)) return false;
  if (filters.noPrereq && !hasNoPrereqs(c)) return false;
  if (filters.repeatable && !c.repeatable) return false;
  return true;
}
function applyFilters(list) { return list.filter(courseMatchesFilters); }

function renderFilterBar() {
  const bar = document.getElementById('filterBar');
  bar.innerHTML = `
    <div class="filter-group">
      <button class="filter-chip ${filters.duration === '1' ? 'active' : ''}" data-duration="1">1 Semester</button>
      <button class="filter-chip ${filters.duration === '2' ? 'active' : ''}" data-duration="2">2 Semesters</button>
    </div>
    <div class="filter-group">
      <button class="filter-chip ${filters.ap ? 'active' : ''}" data-toggle="ap">AP</button>
      <button class="filter-chip ${filters.dual ? 'active' : ''}" data-toggle="dual">Dual Credit</button>
      <button class="filter-chip ${filters.pathway ? 'active' : ''}" data-toggle="pathway">CTE Pathway</button>
      <button class="filter-chip ${filters.wbl ? 'active' : ''}" data-toggle="wbl">Work-Based Learning</button>
      <button class="filter-chip ${filters.noPrereq ? 'active' : ''}" data-toggle="noPrereq">No Prerequisites</button>
      <button class="filter-chip ${filters.repeatable ? 'active' : ''}" data-toggle="repeatable">Repeatable</button>
    </div>
    <button class="filter-clear" id="filterClearBtn">Clear filters</button>
  `;
  bar.querySelectorAll('[data-duration]').forEach(btn => {
    btn.addEventListener('click', () => {
      filters.duration = filters.duration === btn.dataset.duration ? 'all' : btn.dataset.duration;
      renderFilterBar(); refreshCatalogView();
    });
  });
  bar.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.toggle;
      filters[key] = !filters[key];
      renderFilterBar(); refreshCatalogView();
    });
  });
  document.getElementById('filterClearBtn').addEventListener('click', () => {
    filters = { duration: 'all', ap: false, dual: false, pathway: false, wbl: false, noPrereq: false, repeatable: false };
    renderFilterBar(); refreshCatalogView();
  });
}

const SEAL_TAG_LABELS = {
  'seal.enrollment_honors_world_language': 'Enrollment Honors: World Language',
  'seal.enrollment_honors_ss_sixth_credit': 'Enrollment Honors: Social Studies',
  'seal.enrollment_honors_math_base': 'Enrollment Honors: Math',
  'seal.enrollment_honors_advanced_math': 'Enrollment Honors: Advanced Math',
  'seal.enrollment_honors_chemistry_required': 'Enrollment Honors: Chemistry',
  'seal.enrollment_honors_physics_option': 'Enrollment Honors: Physics',
  'seal.enrollment_honors_advanced_lab_science_option': 'Enrollment Honors: Advanced Lab Science',
  'seal.enrollment_honors_stem_pairing': 'Enrollment Honors: STEM Pairing',
  'seal.employment_honors_wbl_hours_source': 'Employment Honors: Work-Based Learning',
  'seal.enlistment_honors_public_service_requirement': 'Enlistment Honors: Public Service'
};

// Sequence position within each CTE pathway, built from FCHS's own department tables.
const PATHWAY_INFO = {
  'business-principles-mgmt': [
    { pathway: 'Finance and Investment', position: 1, total: 3 },
    { pathway: 'Business Management & Administration', position: 1, total: 3 },
    { pathway: 'Marketing & Sales', position: 1, total: 3 }
  ],
  'business-accounting-fundamentals': [{ pathway: 'Finance and Investment', position: 2, total: 3 }],
  'business-finance-investment': [{ pathway: 'Finance and Investment', position: 3, total: 3 }],
  'business-management-fundamentals-dc': [{ pathway: 'Business Management & Administration', position: 2, total: 3 }],
  'business-admin-capstone-dc': [{ pathway: 'Business Management & Administration', position: 3, total: 3 }],
  'business-marketing-fundamentals-dc': [{ pathway: 'Marketing & Sales', position: 2, total: 3 }],
  'business-digital-marketing-dc': [{ pathway: 'Marketing & Sales', position: 3, total: 3 }],
  'business-principles-computing-dc': [{ pathway: 'Software Development', position: 1, total: 3 }],
  'business-software-dev-dc': [{ pathway: 'Software Development', position: 2, total: 3 }],
  'business-website-db-dev': [{ pathway: 'Software Development', position: 2, total: 3 }],
  'business-software-dev-capstone': [{ pathway: 'Software Development', position: 3, total: 3 }],
  'business-digital-design-principles': [{ pathway: 'Digital Design', position: 1, total: 3 }],
  'business-digital-design-graphics': [{ pathway: 'Digital Design', position: 2, total: 3 }],
  'business-interactive-media': [{ pathway: 'Digital Design', position: 3, total: 3 }],

  'ete-construction-principles': [
    { pathway: 'Architecture & Construction \u2013 Carpentry', position: 1, total: 3 },
    { pathway: 'Architecture & Construction \u2013 Civil Construction', position: 1, total: 3 }
  ],
  'ete-construction-general-carpentry': [{ pathway: 'Architecture & Construction \u2013 Carpentry', position: 2, total: 3 }],
  'ete-construction-framing-finishing': [{ pathway: 'Architecture & Construction \u2013 Carpentry', position: 3, total: 3 }],
  'ete-civil-construction-fundamentals': [{ pathway: 'Architecture & Construction \u2013 Civil Construction', position: 2, total: 3 }],
  'ete-advanced-civil-construction': [{ pathway: 'Architecture & Construction \u2013 Civil Construction', position: 3, total: 3 }],
  'ete-ied-dc': [{ pathway: 'Engineering (Project Lead the Way)', position: 1, total: 3 }],
  'ete-poe-dc': [{ pathway: 'Engineering (Project Lead the Way)', position: 2, total: 3 }],
  'ete-cea-dc': [{ pathway: 'Engineering (Project Lead the Way)', position: 3, total: 3 }],
  'ete-aerospace-engineering': [{ pathway: 'Engineering (Project Lead the Way)', position: 3, total: 3 }],
  'ete-cim': [{ pathway: 'Engineering (Project Lead the Way)', position: 3, total: 3 }],

  'facs-culinary-principles': [{ pathway: 'Culinary Arts & Hospitality', position: 1, total: 3 }],
  'facs-nutrition': [{ pathway: 'Culinary Arts & Hospitality', position: 2, total: 3 }],
  'facs-culinary-arts': [{ pathway: 'Culinary Arts & Hospitality', position: 3, total: 3 }],
  'facs-ece-principles': [{ pathway: 'Early Childhood Education', position: 1, total: 3 }],
  'facs-ece-curriculum': [{ pathway: 'Early Childhood Education', position: 2, total: 3 }],
  'facs-ece-guidance': [{ pathway: 'Early Childhood Education', position: 3, total: 3 }],
  'facs-principles-teaching-dc': [{ pathway: 'Education Careers', position: 1, total: 3 }],
  'facs-child-adolescent-dev-dc': [{ pathway: 'Education Careers', position: 2, total: 3 }],
  'facs-teaching-learning-dc': [{ pathway: 'Education Careers', position: 3, total: 3 }],
  'facs-fashion-textiles-principles': [{ pathway: 'Fashion & Textiles', position: 1, total: 3 }],
  'facs-textiles-apparel-merch': [{ pathway: 'Fashion & Textiles', position: 2, total: 3 }],
  'facs-advanced-textiles': [{ pathway: 'Fashion & Textiles', position: 3, total: 3 }],
  'facs-human-services-principles': [{ pathway: 'Social & Community Services', position: 1, total: 3 }],
  'facs-fundamentals-human-services': [{ pathway: 'Social & Community Services', position: 2, total: 3 }],
  'facs-community-health-worker': [{ pathway: 'Social & Community Services', position: 3, total: 3 }]
};
function pathwayBadges(c) {
  const info = PATHWAY_INFO[c.id];
  if (!info) return [];
  return info.map(p => `<span class="badge pathway">${p.pathway} \u00b7 Step ${p.position}/${p.total}</span>`);
}

function parseSemesters(c) {
  if (typeof c.semesters === 'number') return c.semesters;
  if (typeof c.semesters === 'string') {
    const m = c.semesters.match(/\d+/);
    return m ? m[0] : c.semesters;
  }
  return '';
}

function courseRowHTML(c) {
  const badges = [];
  const times = lifetimeCount(c.id);
  if (c.repeatable && times > 0) {
    const cap = c.repeatable.max_times ? `${times}/${c.repeatable.max_times}\u00d7 taken` : `Taken ${times}\u00d7`;
    badges.push(`<span class="badge inschedule">${cap}</span>`);
  } else if (inSchedule(c.id)) badges.push('<span class="badge inschedule">In Schedule</span>');
  else if (inAlternates(c.id)) badges.push('<span class="badge alt">Alternate</span>');
  if (isAP(c)) badges.push('<span class="badge ap">AP</span>');
  if (c.dual_credit) badges.push('<span class="badge dual">Dual Credit</span>');
  const reqId = c.diploma_requirement_id;
  if (reqId && REQUIREMENT_LABELS[reqId]) badges.push(`<span class="badge req">${REQUIREMENT_LABELS[reqId]}</span>`);
  if (c.diploma_requirement_id_options) badges.push('<span class="badge req">Flexible Requirement</span>');
  (c.flexible_category_tags || []).forEach(tag => {
    if (SEAL_TAG_LABELS[tag]) badges.push(`<span class="badge seal">${SEAL_TAG_LABELS[tag]}</span>`);
  });
  badges.push(...pathwayBadges(c));

  const grades = c.grades;
  const gradeStr = Array.isArray(grades)
    ? (grades[0] === grades[grades.length - 1] ? `Grade ${grades[0]}` : `Grades ${grades[0]}&ndash;${grades[grades.length - 1]}`)
    : '';
  const semStr = c.semesters ? `${parseSemesters(c)} Semester${parseSemesters(c) == 1 ? '' : 's'}` : '';
  const creditStr = c.credits ? `${c.credits} Credit${c.credits == 1 ? '' : 's'}` : '';
  const metaLine = [gradeStr, semStr, creditStr].filter(Boolean).join(' &nbsp;|&nbsp; ');

  return `
    <div class="course-row" data-id="${c.id}">
      <div>
        <p class="course-title">${c.title}</p>
        <div class="course-meta"><span>${metaLine}</span></div>
      </div>
      <div class="badges">${badges.join('')}</div>
    </div>`;
}

function openDetail(id) {
  const c = coursesById[id];
  if (!c) return;
  currentDetailId = id;
  const panel = document.getElementById('detailPanel');
  const scrim = document.getElementById('scrim');
  const content = document.getElementById('detailContent');

  let html = `<h2>${c.title}</h2>`;
  html += `<div class="detail-code">${c._dept}${c.state_course_code ? ' &middot; ' + c.state_course_code : ''}${isAP(c) ? ' &middot; Advanced Placement' : ''}</div>`;

  if (c.description) {
    html += `<h3>Description</h3><p>${c.description}</p>`;
  } else {
    html += `<p style="color:var(--paper-dim);font-style:italic;">Full course description not yet added.</p>`;
  }

  if (c.prerequisites && c.prerequisites.length) {
    html += `<h3>Prerequisites</h3><ul>` + c.prerequisites.map(p => prereqLine(p)).join('') + `</ul>`;
  }

  if (c.pathways) {
    html += `<h3>Leads to</h3><ul>` + c.pathways.map(p =>
      `<li><strong>${p.pathway_name}:</strong> ${p.leads_to.map(id => coursesById[id]?.title || id).join(', ')}</li>`
    ).join('') + `</ul>`;
  }

  if (c.dual_credit) {
    html += `<h3>Dual Credit</h3><div class="dc-block">`;
    if (c.dual_credit.institution) html += `<strong>${c.dual_credit.institution}</strong><br>`;
    if (c.dual_credit.college_course) html += `${c.dual_credit.college_course}<br>`;
    if (c.dual_credit.semesters) {
      c.dual_credit.semesters.forEach(s => {
        html += `<br><strong>Semester ${s.semester}</strong> (${s.college_course || ''}): ${eligibilityText(s.eligibility_paths)}`;
      });
    } else if (c.dual_credit.eligibility_paths) {
      html += eligibilityText(c.dual_credit.eligibility_paths);
    }
    html += `</div>`;
  }

  if (c.certifications) {
    html += `<h3>Certifications</h3><ul>` + c.certifications.map(cert =>
      `<li>${cert.name}${cert.requires_prior_certification ? ' (requires ' + cert.requires_prior_certification + ')' : ''}</li>`
    ).join('') + `</ul>`;
  }

  if (c.flexible_category_tags && c.flexible_category_tags.some(t => SEAL_TAG_LABELS[t])) {
    html += `<h3>Counts Toward</h3><ul>` + c.flexible_category_tags.filter(t => SEAL_TAG_LABELS[t]).map(t => `<li>${SEAL_TAG_LABELS[t]}</li>`).join('') + `</ul>`;
  }

  if (PATHWAY_INFO[c.id]) {
    html += `<h3>CTE Pathway</h3><ul>` + PATHWAY_INFO[c.id].map(p => `<li>${p.pathway} \u2014 Step ${p.position} of ${p.total}</li>`).join('') + `</ul>`;
  }

  if (c.special_notes) {
    html += `<h3>Notes</h3><ul>` + c.special_notes.filter(n => !n.startsWith('CONFIRMED') && !n.startsWith('RESOLVED')).map(n => `<li>${n}</li>`).join('') + `</ul>`;
  }

  content.innerHTML = html;
  updateAddBtn();
  panel.classList.add('open');
  scrim.classList.add('open');
}

function updateAddBtn() {
  const btn = document.getElementById('addBtn');
  const c = coursesById[currentDetailId];
  if (!c) return;

  if (c.repeatable) {
    const times = lifetimeCount(currentDetailId);
    const capText = c.repeatable.max_times ? `${times}/${c.repeatable.max_times} taken` : `${times} taken so far`;
    const check = canAddInstance(currentDetailId);
    btn.textContent = check.allowed ? `Add Another \u2014 ${capText}` : `Can't add \u2014 ${check.reason}`;
    btn.classList.toggle('added', times > 0);
    btn.classList.remove('alternate');
    return;
  }

  if (inSchedule(currentDetailId)) {
    btn.textContent = 'In Schedule \u2713 (click to remove)';
    btn.classList.add('added'); btn.classList.remove('alternate');
  } else if (inAlternates(currentDetailId)) {
    btn.textContent = 'In Alternates \u2713 (click to remove)';
    btn.classList.add('added', 'alternate');
  } else {
    const full = isFullYear(c);
    const noRoom = full ? (semesterCount(1) >= 7 || semesterCount(2) >= 7) : (semesterCount(1) >= 7 && semesterCount(2) >= 7);
    btn.textContent = noRoom ? 'Add to Alternates (semester full)' : 'Add to Schedule';
    btn.classList.remove('added', 'alternate');
  }
}

document.getElementById('addBtn').addEventListener('click', () => {
  if (!currentDetailId) return;
  toggleCourse(currentDetailId);
});

function keyDetails(c) {
  const bits = [];
  if (c.special_notes) {
    c.special_notes.forEach(n => {
      if (n.startsWith('CONFIRMED') || n.startsWith('RESOLVED') || n.startsWith('State code') || n.includes('FLAG')) return;
      bits.push(n);
    });
  }
  if (c.dual_credit) bits.push('Dual credit available' + (c.dual_credit.institution ? ' through ' + c.dual_credit.institution : ''));
  if (c.certifications) bits.push('Certifications: ' + c.certifications.map(x => x.name).join(', '));
  return bits;
}

function rowHTML(c, entry, opts) {
  if (!c) return '';
  const prereqText = (c.prerequisites && c.prerequisites.length)
    ? c.prerequisites.map(p => typeof p === 'string' ? (coursesById[p]?.title || p) : (p.note || (p.courses || []).map(x => coursesById[x]?.title || x).join(' or '))).join(', ')
    : 'None';
  const details = keyDetails(c);
  const tags = [c._dept, isAP(c) ? 'AP' : null, c.dual_credit ? 'Dual Credit' : null, opts.tagFull ? 'Full Year' : null].filter(Boolean).join(' \u00b7 ');
  const semToggle = opts.showSemToggle
    ? `<div class="sem-toggle">
         <button class="sem-btn ${entry.semester === 1 ? 'active' : ''}" data-semtoggle="${entry.instanceId}" data-sem="1" ${entry.semester !== 1 && semesterCount(1) >= 7 ? 'disabled' : ''}>S1</button>
         <button class="sem-btn ${entry.semester === 2 ? 'active' : ''}" data-semtoggle="${entry.instanceId}" data-sem="2" ${entry.semester !== 2 && semesterCount(2) >= 7 ? 'disabled' : ''}>S2</button>
       </div>`
    : '';
  const fullYearToggle = opts.showFullYearToggle
    ? `<div class="sem-toggle"><button class="sem-btn full-year-btn ${entry.fullYearOverride ? 'active' : ''}" data-fyoverride="${entry.instanceId}">${entry.fullYearOverride ? '\u2713 ' : ''}Span Both Semesters</button></div>`
    : '';
  const moveBtn = opts.showMove === true ? `<button class="move-btn" data-move="${entry.instanceId}">\u2192 Add to Schedule</button>`
    : opts.showMove === false ? `<span class="move-disabled">No room this semester &mdash; remove a class first</span>` : '';
  return `
    <div class="schedule-row" data-id="${c.id}">
      <div class="schedule-row-main">
        <p class="schedule-row-title">${c.title}</p>
        <p class="schedule-row-meta">${tags} &nbsp;&mdash;&nbsp; Prerequisites: ${prereqText}</p>
        ${details.length ? `<p class="schedule-row-details">${details.join(' &middot; ')}</p>` : ''}
        ${semToggle}${fullYearToggle}${moveBtn}
      </div>
      <button class="schedule-chip-remove" data-remove="${entry.instanceId}" aria-label="Remove">&times;</button>
    </div>`;
}

function renderScheduleTray() {
  const sem1El = document.getElementById('sem1Items');
  const sem2El = document.getElementById('sem2Items');
  const altEl = document.getElementById('alternateItems');
  const countEl = document.getElementById('scheduleCount');
  const s1Count = semesterCount(1), s2Count = semesterCount(2);
  countEl.textContent = `Sem 1: ${s1Count}/7 \u00b7 Sem 2: ${s2Count}/7`;

  const sem1Rows = [], sem2Rows = [];
  schedule.forEach(entry => {
    const c = coursesById[entry.id];
    if (!c) return;
    if (entryIsFullYear(entry, c)) {
      sem1Rows.push(rowHTML(c, entry, { showSemToggle: false, showFullYearToggle: hasVariableDuration(c), tagFull: true }));
      sem2Rows.push(rowHTML(c, entry, { showSemToggle: false, showFullYearToggle: hasVariableDuration(c), tagFull: true }));
    } else if (entry.semester === 2) {
      sem2Rows.push(rowHTML(c, entry, { showSemToggle: true, showFullYearToggle: hasVariableDuration(c) }));
    } else {
      sem1Rows.push(rowHTML(c, entry, { showSemToggle: true, showFullYearToggle: hasVariableDuration(c) }));
    }
  });

  sem1El.innerHTML = sem1Rows.length ? sem1Rows.join('') : `<p class="schedule-empty">No courses yet.</p>`;
  sem2El.innerHTML = sem2Rows.length ? sem2Rows.join('') : `<p class="schedule-empty">No courses yet.</p>`;

  altEl.innerHTML = alternates.length
    ? alternates.map(entry => {
        const c = coursesById[entry.id];
        if (!c) return '';
        const full = entryIsFullYear(entry, c);
        const canMove = full ? (s1Count < 7 && s2Count < 7) : (s1Count < 7 || s2Count < 7);
        return rowHTML(c, entry, { showMove: canMove, showFullYearToggle: hasVariableDuration(c) });
      }).join('')
    : `<p class="schedule-empty">None yet &mdash; courses beyond your 7-per-semester limit will land here.</p>`;

  wireScheduleRowButtons();
}

function wireScheduleRowButtons() {
  document.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); removeInstance(Number(btn.dataset.remove)); });
  });
  document.querySelectorAll('[data-semtoggle]').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); setSemester(Number(btn.dataset.semtoggle), Number(btn.dataset.sem)); });
  });
  document.querySelectorAll('[data-move]').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); moveToSchedule(Number(btn.dataset.move)); });
  });
  document.querySelectorAll('[data-fyoverride]').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); toggleFullYearOverride(Number(btn.dataset.fyoverride)); });
  });
  document.querySelectorAll('.schedule-row').forEach(row => {
    row.addEventListener('click', () => openDetail(row.dataset.id));
  });
}

function prereqLine(p) {
  if (typeof p === 'string') return `<li>${coursesById[p]?.title || p}</li>`;
  if (p.type === 'any_of') return `<li>${p.courses.map(id => coursesById[id]?.title || id).join(' OR ')}</li>`;
  if (p.type === 'requirement') return `<li>${p.note}</li>`;
  return '';
}

function eligibilityText(paths) {
  if (!paths) return '';
  return paths.map(p => {
    if (p.type === 'gpa_and_class') return `${p.min_grade_level}+ with ${p.min_gpa}+ unweighted GPA${p.and_also ? ', ' + p.and_also : ''}`;
    if (p.type === 'test_score') return 'OR ' + p.options.map(o => o.min_score ? `${o.test.replace(/_/g,' ')} ${o.min_score}+` : o.test.replace(/_/g,' ')).join(' / ');
    if (p.type === 'prior_course_grade') return `${p.min_grade}+ in ${p.course}`;
    if (p.type === 'requirement') return p.note;
    return '';
  }).join(' &nbsp;'); 
}

document.getElementById('detailClose').addEventListener('click', closeDetail);
document.getElementById('scrim').addEventListener('click', closeDetail);
function closeDetail() {
  document.getElementById('detailPanel').classList.remove('open');
  document.getElementById('scrim').classList.remove('open');
}

document.getElementById('searchInput').addEventListener('input', (e) => {
  lastSearchQuery = e.target.value.trim();
  runSearch(lastSearchQuery);
});

function runSearch(q) {
  if (!q) { selectDept(activeDept); return; }
  document.querySelectorAll('.dept-item').forEach(b => b.classList.remove('active'));
  const matches = allCourses.filter(c => c.title.toLowerCase().includes(q.toLowerCase()));
  renderCatalog(matches, `Results for &ldquo;${q}&rdquo;`);
}

function refreshCatalogView() {
  if (lastSearchQuery) runSearch(lastSearchQuery); else if (activeDept) selectDept(activeDept);
}

loadAll();

/* =========================================================
   VIEW SWITCHING
   ========================================================= */
function initViewTabs() {
  document.querySelectorAll('.view-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.view-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const view = tab.dataset.view;
      document.getElementById('catalogView').style.display = view === 'catalog' ? '' : 'none';
      document.getElementById('progressView').style.display = view === 'progress' ? '' : 'none';
      if (view === 'progress') renderProgressView();
    });
  });
}

/* =========================================================
   MANUAL INPUT PANEL (things no course list can tell us)
   ========================================================= */
const MANUAL_DEFAULTS = {
  bAverage: false, allCGrades: false, rigorMet: false,
  wblHours: 0, employmentSkillDev: false, employmentAttendance: false, credentialOfValue: false,
  jrotc: false, asvabScore: '', careerExploration: false, enlistmentSkillDev: false, enlistmentAttendance: false
};
function loadManual() {
  try {
    const raw = localStorage.getItem('fchs-manual-inputs');
    return raw ? { ...MANUAL_DEFAULTS, ...JSON.parse(raw) } : { ...MANUAL_DEFAULTS };
  } catch (e) { return { ...MANUAL_DEFAULTS }; }
}
function saveManual() {
  try { localStorage.setItem('fchs-manual-inputs', JSON.stringify(manual)); } catch (e) {}
}
let manual = loadManual();

function initManualPanel() {
  document.addEventListener('change', (e) => {
    if (!e.target.dataset.manualKey) return;
    const key = e.target.dataset.manualKey;
    manual[key] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    saveManual();
    renderProgressView();
  });
}

/* =========================================================
   CREDIT MATH HELPERS
   ========================================================= */
function parseCredits(c) {
  if (typeof c.credits === 'number') return c.credits;
  if (typeof c.credits === 'string') {
    const m = c.credits.match(/\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : 0;
  }
  return 0;
}

function buildBuckets() {
  const buckets = {}; // id -> { credits_needed, category, required, label, earned }
  const cats = diplomaRules.base_diploma_requirements;
  Object.entries(cats).forEach(([catKey, cat]) => {
    if (cat.required) cat.required.forEach(r => {
      buckets[r.id] = { credits_needed: r.credits, category: catKey, required: true, label: REQUIREMENT_LABELS[r.id] || r.id, earned: 0 };
    });
    if (cat.flexible) cat.flexible.forEach(f => {
      buckets[f.id] = { credits_needed: f.credits, category: catKey, required: false, label: REQUIREMENT_LABELS[f.id] || f.id, earned: 0 };
    });
  });
  buckets['personalized_electives'] = { credits_needed: cats.personalized_electives.total_credits, category: 'personalized_electives', required: false, label: 'Personalized Electives', earned: 0 };
  return buckets;
}

function computeDiplomaProgress() {
  const buckets = buildBuckets();
  const scheduleCourses = allYearsSchedules().map(e => coursesById[e.id]).filter(Boolean);

  scheduleCourses.forEach(c => {
    const credits = parseCredits(c);
    let targetId = null;
    if (c.diploma_requirement_id_options) {
      const viable = c.diploma_requirement_id_options.filter(id => buckets[id] && buckets[id].earned < buckets[id].credits_needed);
      if (viable.length) {
        // Prefer the option with the smallest remaining need - fills scarcer/smaller requirements first
        targetId = viable.reduce((best, id) => {
          const remaining = buckets[id].credits_needed - buckets[id].earned;
          const bestRemaining = buckets[best].credits_needed - buckets[best].earned;
          return remaining < bestRemaining ? id : best;
        }, viable[0]);
      } else {
        targetId = 'personalized_electives'; // all named options already full - fall through to electives
      }
    } else if (c.diploma_requirement_id && c.diploma_requirement_id !== 'personalized_electives' && buckets[c.diploma_requirement_id]) {
      targetId = c.diploma_requirement_id;
    } else {
      targetId = 'personalized_electives';
    }

    const bucket = buckets[targetId];
    if (targetId === 'personalized_electives') {
      bucket.earned += credits;
    } else {
      // Cap what this bucket can absorb; anything beyond what the requirement needs rolls into Personalized Electives
      // instead of being lost, so a course worth more credits than a requirement needs still counts toward graduation.
      const remainingNeed = Math.max(bucket.credits_needed - bucket.earned, 0);
      const applied = Math.min(credits, remainingNeed);
      bucket.earned += applied;
      const leftover = credits - applied;
      if (leftover > 0) buckets['personalized_electives'].earned += leftover;
    }
  });

  // category totals (capped at each bucket's need, so category can't over-fill from one flexible source alone beyond its own bucket cap)
  const catTotals = {};
  Object.entries(diplomaRules.base_diploma_requirements).forEach(([catKey, cat]) => {
    catTotals[catKey] = { earned: 0, needed: cat.total_credits, label: catKey, buckets: [] };
  });
  Object.entries(buckets).forEach(([id, b]) => {
    const capped = Math.min(b.earned, b.credits_needed);
    catTotals[b.category].earned += capped;
    catTotals[b.category].buckets.push({ id, ...b, capped });
  });

  return catTotals;
}

const CATEGORY_LABELS = {
  english: 'English', math: 'Mathematics', science_tech_engineering: 'Science, Technology & Engineering',
  social_studies: 'Social Studies', pe_health: 'PE & Health', personalized_electives: 'Personalized Electives',
  college_careers: 'College & Careers'
};

/* =========================================================
   SEAL COMPUTATION (Honors tier only - Plus tier coming soon)
   ========================================================= */
function creditsByTag(scheduleCourses, tag) {
  return scheduleCourses.filter(c => (c.flexible_category_tags || []).includes(tag)).reduce((sum, c) => sum + parseCredits(c), 0);
}
function creditsByReqPrefix(scheduleCourses, prefix) {
  return scheduleCourses.filter(c => (c.diploma_requirement_id || '').startsWith(prefix)).reduce((sum, c) => sum + parseCredits(c), 0);
}
function hasTag(scheduleCourses, tag) {
  return scheduleCourses.some(c => (c.flexible_category_tags || []).includes(tag));
}
function pathwayCounts(scheduleCourses) {
  const counts = {};
  scheduleCourses.forEach(c => (c.flexible_category_tags || []).forEach(t => {
    if (t.startsWith('cte_pathway.')) counts[t] = (counts[t] || 0) + 1;
  }));
  return counts;
}

function computeSeals() {
  const sc = allYearsSchedules().map(e => coursesById[e.id]).filter(Boolean);

  // ---- Enrollment Honors ----
  const wlCredits = creditsByTag(sc, 'seal.enrollment_honors_world_language');
  const ssCredits = creditsByReqPrefix(sc, 'ss.') + creditsByTag(sc, 'seal.enrollment_honors_ss_sixth_credit');
  const mathCredits = creditsByReqPrefix(sc, 'math.');
  const bioTaken = sc.some(c => c.diploma_requirement_id === 'stem.biology1_required');
  const chemTaken = hasTag(sc, 'seal.enrollment_honors_chemistry_required');
  const physicsOrLab = hasTag(sc, 'seal.enrollment_honors_physics_option') || creditsByTag(sc, 'seal.enrollment_honors_advanced_lab_science_option') >= 2;
  const scienceCredits = creditsByReqPrefix(sc, 'stem.biology1_required') + creditsByReqPrefix(sc, 'stem.additional_science');

  const enrollmentHonors = {
    name: 'Enrollment Honors Seal',
    items: [
      { label: `World Language: ${wlCredits} / 4 credits`, met: wlCredits >= 4 },
      { label: `Social Studies: ${ssCredits} / 6 credits`, met: ssCredits >= 6 },
      { label: `Math: ${mathCredits} / 8 credits`, met: mathCredits >= 8 },
      { label: `Science: Biology I, Chemistry, + Physics or Adv. Lab (${scienceCredits} cr.)`, met: bioTaken && chemTaken && physicsOrLab },
      { label: 'C or higher in all courses + cumulative B average', met: manual.bAverage, manual: true },
      { label: 'AP/IB/Cambridge credits, 6 college credits, or 1250 SAT / 26 ACT', met: manual.rigorMet, manual: true },
    ]
  };

  // ---- Employment Honors ----
  const pathways = pathwayCounts(sc);
  const pathway3 = Object.values(pathways).some(n => n >= 3);
  const employmentHonors = {
    name: 'Employment Honors Seal',
    items: [
      { label: pathway3 ? '3+ courses in one CTE pathway \u2713' : 'Complete 3 courses in one CTE pathway, or a Credential of Value', met: pathway3 || manual.credentialOfValue },
      { label: `Work-based learning hours: ${manual.wblHours || 0} / 150`, met: Number(manual.wblHours) >= 150, manual: true },
      { label: 'Skill development in Communication, Collaboration, Work Ethic', met: manual.employmentSkillDev, manual: true },
      { label: 'Attendance goal met (\u22643 unexcused absences)', met: manual.employmentAttendance, manual: true },
    ]
  };

  // ---- Enlistment & Service Honors ----
  const publicServiceCourse = hasTag(sc, 'seal.enlistment_honors_public_service_requirement');
  const enlistmentHonors = {
    name: 'Enlistment & Service Honors Seal',
    items: [
      { label: publicServiceCourse ? 'Introduction to Public Service taken \u2713' : 'Introduction to Public Service, or 1 year JROTC/Civil Air Patrol', met: publicServiceCourse || manual.jrotc },
      { label: `ASVAB score: ${manual.asvabScore || '\u2014'} (need 31+)`, met: Number(manual.asvabScore) >= 31, manual: true },
      { label: 'Completed Career Exploration Program component', met: manual.careerExploration, manual: true },
      { label: 'Attendance goal met (\u22643 unexcused absences)', met: manual.enlistmentAttendance, manual: true },
      { label: 'Skill development, verified through military/veteran/public-safety mentorship', met: manual.enlistmentSkillDev, manual: true },
    ]
  };

  return [enrollmentHonors, employmentHonors, enlistmentHonors];
}

/* =========================================================
   RENDER
   ========================================================= */
function renderProgressView() {
  const el = document.getElementById('progressView');
  const catTotals = computeDiplomaProgress();
  const seals = computeSeals();

  let html = `<p class="progress-intro">This is an estimate based on the courses in your schedule${mode === 'builder' ? ' across all four years' : ''}. Credit-based items update automatically as you add or remove courses; a few things (GPA, test scores, attendance, work hours) can't be read from a course list, so enter those yourself below. Always confirm your final plan with your counselor.</p>`;

  html += `<h2 class="progress-section-title">Indiana Diploma Requirements</h2>`;
  html += `<div class="diploma-grid">`;
  Object.entries(catTotals).forEach(([catKey, cat]) => {
    const pct = Math.min(100, Math.round((cat.earned / cat.needed) * 100));
    const complete = cat.earned >= cat.needed;
    html += `
      <div class="prog-card">
        <p class="prog-card-title">${CATEGORY_LABELS[catKey]}<span class="prog-card-count">${cat.earned} / ${cat.needed} cr.</span></p>
        <div class="prog-bar-track"><div class="prog-bar-fill${complete ? ' complete' : ''}" style="width:${pct}%;"></div></div>
        ${cat.buckets.length ? `<p class="prog-subitems">${cat.buckets.map(b => `<span class="${b.capped >= b.credits_needed ? 'met' : 'unmet'}">${b.capped >= b.credits_needed ? '\u2713' : '\u2013'} ${b.label} (${b.capped}/${b.credits_needed})</span>`).join('<br>')}</p>` : ''}
      </div>`;
  });
  html += `</div>`;

  html += `<h2 class="progress-section-title">Readiness Seals <span class="coming-soon">(Honors tier shown &mdash; Honors Plus coming soon)</span></h2>`;
  seals.forEach(seal => {
    const allMet = seal.items.every(i => i.met);
    html += `
      <div class="seal-card">
        <div class="seal-card-header">
          <p class="seal-card-title">${seal.name}</p>
          <span class="seal-status${allMet ? ' complete' : ''}">${allMet ? 'On track' : 'In progress'}</span>
        </div>
        <ul class="seal-criteria">
          ${seal.items.map(i => `<li><span class="check ${i.met ? 'yes' : 'no'}">${i.met ? '\u2713' : '\u2013'}</span>${i.label}${i.manual ? '<span class="manual-tag">enter below</span>' : ''}</li>`).join('')}
        </ul>
      </div>`;
  });

  html += `
    <div class="manual-panel">
      <h3>Self-reported information</h3>
      <p>These can't be determined from your course selection &mdash; fill in what applies. Saved automatically on this device.</p>
      <div class="manual-grid">
        <div class="manual-field checkbox"><input type="checkbox" id="m1" data-manual-key="bAverage" ${manual.bAverage ? 'checked' : ''}><label for="m1">Cumulative B average, C or higher in all courses</label></div>
        <div class="manual-field checkbox"><input type="checkbox" id="m2" data-manual-key="rigorMet" ${manual.rigorMet ? 'checked' : ''}><label for="m2">Met AP/IB/college-credit or SAT/ACT rigor requirement</label></div>
        <div class="manual-field checkbox"><input type="checkbox" id="m3" data-manual-key="credentialOfValue" ${manual.credentialOfValue ? 'checked' : ''}><label for="m3">Earned a Credential of Value</label></div>
        <div class="manual-field"><label for="m4">Work-based learning hours</label><input type="number" id="m4" data-manual-key="wblHours" value="${manual.wblHours}" min="0"></div>
        <div class="manual-field checkbox"><input type="checkbox" id="m5" data-manual-key="employmentSkillDev" ${manual.employmentSkillDev ? 'checked' : ''}><label for="m5">Employment skill development verified</label></div>
        <div class="manual-field checkbox"><input type="checkbox" id="m6" data-manual-key="employmentAttendance" ${manual.employmentAttendance ? 'checked' : ''}><label for="m6">Employment attendance goal met</label></div>
        <div class="manual-field checkbox"><input type="checkbox" id="m7" data-manual-key="jrotc" ${manual.jrotc ? 'checked' : ''}><label for="m7">Completed 1 year JROTC / Civil Air Patrol</label></div>
        <div class="manual-field"><label for="m8">ASVAB score</label><input type="number" id="m8" data-manual-key="asvabScore" value="${manual.asvabScore}" min="0" max="99"></div>
        <div class="manual-field checkbox"><input type="checkbox" id="m9" data-manual-key="careerExploration" ${manual.careerExploration ? 'checked' : ''}><label for="m9">Career Exploration Program component completed</label></div>
        <div class="manual-field checkbox"><input type="checkbox" id="m10" data-manual-key="enlistmentAttendance" ${manual.enlistmentAttendance ? 'checked' : ''}><label for="m10">Enlistment attendance goal met</label></div>
        <div class="manual-field checkbox"><input type="checkbox" id="m11" data-manual-key="enlistmentSkillDev" ${manual.enlistmentSkillDev ? 'checked' : ''}><label for="m11">Enlistment skill development verified</label></div>
      </div>
    </div>`;

  el.innerHTML = html;
}
