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
let iccRules = null;

let allCourses = []; // flattened, each tagged with department label
let coursesById = {};
let activeDept = null;
let currentDetailId = null;
let lastSearchQuery = '';

const GRADES = [9, 10, 11, 12];
const JH_KEY = 'JH';
const ALL_YEAR_KEYS = [JH_KEY, 9, 10, 11, 12];
const GRADE_LABELS = { JH: 'Junior High', 9: '9th Grade', 10: '10th Grade', 11: '11th Grade', 12: '12th Grade' };

/* =========================================================
   PROFILES (parent/family support - named local profiles, no accounts/passwords)
   ========================================================= */
function getProfiles() {
  try { return JSON.parse(localStorage.getItem('fchs-profiles') || '[]'); } catch (e) { return []; }
}
function saveProfilesList(list) { try { localStorage.setItem('fchs-profiles', JSON.stringify(list)); } catch (e) {} }
function getActiveProfileId() { return localStorage.getItem('fchs-active-profile') || 'default'; }
function setActiveProfileIdRaw(id) { try { localStorage.setItem('fchs-active-profile', id); } catch (e) {} }
function profileKey(base) {
  const pid = getActiveProfileId();
  return pid === 'default' ? base : `fchs-profile-${pid}-${base}`;
}
function getDefaultProfileName() {
  return localStorage.getItem('fchs-default-profile-name') || 'My Plan';
}
function setDefaultProfileName(name) {
  try { localStorage.setItem('fchs-default-profile-name', name); } catch (e) {}
}
function activeProfileName() {
  const pid = getActiveProfileId();
  if (pid === 'default') return getDefaultProfileName();
  const p = getProfiles().find(p => p.id === pid);
  return p ? p.name : getDefaultProfileName();
}

let mode = localStorage.getItem(profileKey('fchs-mode')); // 'quick' | 'builder' | null (not yet chosen)
let currentGrade = Number(localStorage.getItem(profileKey('fchs-current-grade'))) || 9;
let yearData = loadYearData(); // { JH: {...}, 9: {schedule, alternates, status}, 10: {...}, 11: {...}, 12: {...} }
let activeGrade = mode === 'builder' ? currentGrade : 9;

// `schedule` and `alternates` always point at the ACTIVE year's arrays. All the existing
// schedule-editing logic below reads/writes these two variables directly; switchYear() re-points them.
let schedule = yearData[activeGrade].schedule;
let alternates = yearData[activeGrade].alternates;

function loadYearData() {
  try {
    const raw = localStorage.getItem(profileKey('fchs-yeardata'));
    if (raw) {
      const parsed = JSON.parse(raw);
      ALL_YEAR_KEYS.forEach(g => { if (!parsed[g]) parsed[g] = { schedule: [], alternates: [], status: g === JH_KEY ? 'completed' : 'planned' }; });
      return parsed;
    }
  } catch (e) { /* fall through to migration */ }

  const data = {};
  ALL_YEAR_KEYS.forEach(g => { data[g] = { schedule: [], alternates: [], status: g === JH_KEY ? 'completed' : 'planned' }; });

  // Migration: earlier versions of this site (before the profile system existed) stored one flat
  // schedule with no year concept. Only the default profile can ever have this old data - a newly
  // created child profile never existed before profiles did, so it has nothing to migrate.
  if (getActiveProfileId() === 'default') {
    let legacySchedule = [], legacyAlternates = [];
    try {
      const rawS = localStorage.getItem('fchs-schedule');
      if (rawS) {
        let p = JSON.parse(rawS);
        if (p.length && typeof p[0] === 'string') p = p.map(id => ({ id, semester: 1 }));
        legacySchedule = p;
      }
      const rawA = localStorage.getItem('fchs-alternates');
      if (rawA) legacyAlternates = JSON.parse(rawA);
    } catch (e) { /* ignore */ }
    if (legacySchedule.length || legacyAlternates.length) {
      data[9].schedule = legacySchedule;
      data[9].alternates = legacyAlternates;
    }
  }
  return data;
}
function persistYearData() {
  yearData[activeGrade] = { schedule, alternates, status: yearData[activeGrade].status };
  try { localStorage.setItem(profileKey('fchs-yeardata'), JSON.stringify(yearData)); } catch (e) {}
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
function semesterCap() {
  // Junior High is just a log of credits already earned, not a real 7-period schedule - no cap applies.
  return activeGrade === JH_KEY ? Infinity : 7;
}

// Grade-parameterized versions, for checking capacity in a year OTHER than the currently active one (used by moveToYear)
function semesterCountForYear(grade, sem) {
  return yearData[grade].schedule.filter(e => {
    const c = coursesById[e.id];
    return c && (entryIsFullYear(e, c) || e.semester === sem);
  }).length;
}
function semesterCapForYear(grade) {
  return grade === JH_KEY ? Infinity : 7;
}

function moveToYear(instanceId, targetGrade) {
  yearData[activeGrade] = { schedule, alternates, status: yearData[activeGrade].status }; // sync in-memory edits first
  const fromGrade = activeGrade;
  if (String(targetGrade) === String(fromGrade)) return;

  let entry = yearData[fromGrade].schedule.find(e => e.instanceId === instanceId);
  let fromAlternates = false;
  if (!entry) { entry = yearData[fromGrade].alternates.find(e => e.instanceId === instanceId); fromAlternates = true; }
  if (!entry) return;
  const c = coursesById[entry.id];

  if (!fromAlternates && !confirmRemoval(entry.id, 'Moving')) return;

  const unmet = unmetPrerequisites(entry.id, targetGrade);
  if (unmet.length) {
    alert(`Can't move ${c.title} to ${GRADE_LABELS[targetGrade]} because you haven't taken this by then: ${unmet.join(', ')}.`);
    return;
  }

  // Remove from source year
  if (fromAlternates) yearData[fromGrade].alternates = yearData[fromGrade].alternates.filter(e => e.instanceId !== instanceId);
  else yearData[fromGrade].schedule = yearData[fromGrade].schedule.filter(e => e.instanceId !== instanceId);

  // Place into target year: schedule if there's room, otherwise alternates
  const full = isFullYear(c);
  const cap = semesterCapForYear(targetGrade);
  if (full) {
    if (semesterCountForYear(targetGrade, 1) < cap && semesterCountForYear(targetGrade, 2) < cap) yearData[targetGrade].schedule.push(entry);
    else yearData[targetGrade].alternates.push(entry);
  } else {
    if (semesterCountForYear(targetGrade, 1) < cap) { entry.semester = 1; yearData[targetGrade].schedule.push(entry); }
    else if (semesterCountForYear(targetGrade, 2) < cap) { entry.semester = 2; yearData[targetGrade].schedule.push(entry); }
    else yearData[targetGrade].alternates.push(entry);
  }

  schedule = yearData[activeGrade].schedule;
  alternates = yearData[activeGrade].alternates;
  saveAll();
}

function nextInstanceId() {
  let counter = Number(localStorage.getItem(profileKey('fchs-instance-counter'))) || 1;
  localStorage.setItem(profileKey('fchs-instance-counter'), String(counter + 1));
  return counter;
}
function backfillInstanceIds() {
  let changed = false;
  ALL_YEAR_KEYS.forEach(g => {
    [...yearData[g].schedule, ...yearData[g].alternates].forEach(e => {
      if (!e.instanceId) { e.instanceId = nextInstanceId(); changed = true; }
    });
  });
  if (changed) try { localStorage.setItem(profileKey('fchs-yeardata'), JSON.stringify(yearData)); } catch (e) {}
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

const YEAR_ORDER = { JH: 0, 9: 1, 10: 2, 11: 3, 12: 4 };
function coursesTakenThroughYear(uptoGrade) {
  yearData[activeGrade] = { schedule, alternates, status: yearData[activeGrade].status }; // sync in-memory edits first
  const maxOrder = YEAR_ORDER[uptoGrade];
  const ids = new Set();
  ALL_YEAR_KEYS.forEach(g => {
    if (YEAR_ORDER[g] <= maxOrder) yearData[g].schedule.forEach(e => ids.add(e.id));
  });
  return ids;
}
function unmetPrerequisites(courseId, targetGrade) {
  const c = coursesById[courseId];
  if (!c || !c.prerequisites || !c.prerequisites.length) return [];
  const taken = coursesTakenThroughYear(targetGrade);
  const unmet = [];
  c.prerequisites.forEach(p => {
    if (typeof p === 'string') {
      if (!taken.has(p)) unmet.push(coursesById[p] ? coursesById[p].title : p);
    } else if (p.type === 'any_of') {
      const satisfied = (p.courses || []).some(pid => taken.has(pid));
      if (!satisfied) unmet.push((p.courses || []).map(pid => coursesById[pid] ? coursesById[pid].title : pid).join(' or '));
    }
    // type 'requirement' (audition, teacher recommendation, application, etc.) can't be verified from course data - skipped, never blocks
  });
  return unmet;
}

// Retroactive check: which currently-scheduled courses would lose their only source of a prerequisite if courseId were removed?
function coursesThatWouldBreak(courseId) {
  yearData[activeGrade] = { schedule, alternates, status: yearData[activeGrade].status }; // sync in-memory edits first
  const broken = [];
  ALL_YEAR_KEYS.forEach(g => {
    const takenInYear = coursesTakenThroughYear(g); // includes courseId itself, since it hasn't been removed yet
    yearData[g].schedule.forEach(e => {
      if (e.id === courseId) return;
      const dep = coursesById[e.id];
      if (!dep || !dep.prerequisites) return;
      dep.prerequisites.forEach(p => {
        if (typeof p === 'string' && p === courseId) {
          broken.push({ id: e.id, title: dep.title, year: g });
        } else if (p.type === 'any_of' && (p.courses || []).includes(courseId)) {
          const otherCourseSatisfies = p.courses.some(pid => pid !== courseId && takenInYear.has(pid));
          if (!otherCourseSatisfies) broken.push({ id: e.id, title: dep.title, year: g });
        }
      });
    });
  });
  return broken;
}
function confirmRemoval(courseId, actionWord) {
  actionWord = actionWord || 'Removing';
  const broken = coursesThatWouldBreak(courseId);
  if (!broken.length) return true;
  const c = coursesById[courseId];
  const list = broken.map(b => `${b.title} (${GRADE_LABELS[b.year]})`).join(', ');
  return confirm(`${actionWord} ${c.title} will leave these courses without their required prerequisite: ${list}. Continue anyway?`);
}

function canAddInstance(id) {
  const c = coursesById[id];
  const unmet = unmetPrerequisites(id, activeGrade);
  if (unmet.length) {
    return { allowed: false, reason: `Can't enroll in ${c.title} because you haven't yet taken: ${unmet.join(', ')}.` };
  }
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

function enforceSemesterCapsFor(schedArr, cap) {
  cap = cap === undefined ? 7 : cap;
  let count1 = 0, count2 = 0;
  const kept = [], overflow = [];
  schedArr.forEach(entry => {
    const c = coursesById[entry.id];
    if (!c) return;
    if (entryIsFullYear(entry, c)) {
      if (count1 < cap && count2 < cap) { kept.push(entry); count1++; count2++; }
      else overflow.push(entry);
    } else {
      const sem = entry.semester === 2 ? 2 : 1;
      if (sem === 1 && count1 < cap) { kept.push(entry); count1++; }
      else if (sem === 2 && count2 < cap) { kept.push(entry); count2++; }
      else overflow.push(entry);
    }
  });
  return { kept, overflow };
}
function enforceAllYearCaps() {
  ALL_YEAR_KEYS.forEach(g => {
    const cap = g === JH_KEY ? Infinity : 7;
    const { kept, overflow } = enforceSemesterCapsFor(yearData[g].schedule, cap);
    if (overflow.length) { yearData[g].schedule = kept; yearData[g].alternates = overflow.concat(yearData[g].alternates); }
  });
  schedule = yearData[activeGrade].schedule;
  alternates = yearData[activeGrade].alternates;
  persistYearData();
}

// Used only for the toggle-off case: clicking "In Schedule" / "In Alternates" again to remove it
function toggleCourse(id) {
  const c = coursesById[id];
  const repeatableCourse = !!(c.repeatable);
  if (repeatableCourse) return; // repeatable courses use addToSchedule/addToAlternates to add another; removal happens via each row's own remove button
  if (inSchedule(id)) {
    if (!confirmRemoval(id)) return;
    schedule = schedule.filter(e => e.id !== id); saveAll(); return;
  }
  if (inAlternates(id)) { alternates = alternates.filter(e => e.id !== id); saveAll(); return; }
}

// Explicitly add to the main schedule (this semester's 7-course limit applies)
function addToSchedule(id) {
  const c = coursesById[id];
  const check = canAddInstance(id);
  if (!check.allowed) { alert(check.reason); return; }
  const entry = { id, semester: 1, instanceId: nextInstanceId() };
  const full = isFullYear(c);
  if (full) {
    if (semesterCount(1) < semesterCap() && semesterCount(2) < semesterCap()) { schedule.push(entry); }
    else { alert(`Your schedule is full this semester. Remove a course first, or add ${c.title} as an alternate instead.`); return; }
  } else {
    if (semesterCount(1) < semesterCap()) schedule.push(entry);
    else if (semesterCount(2) < semesterCap()) { entry.semester = 2; schedule.push(entry); }
    else { alert(`Your schedule is full this semester. Remove a course first, or add ${c.title} as an alternate instead.`); return; }
  }
  saveAll();
}

// Explicitly add to Alternates - no semester cap, works even if the schedule still has room
function addToAlternates(id) {
  const check = canAddInstance(id);
  if (!check.allowed) { alert(check.reason); return; }
  alternates.push({ id, semester: 1, instanceId: nextInstanceId() });
  saveAll();
}
function removeInstance(instanceId) {
  const entry = schedule.find(e => e.instanceId === instanceId);
  if (entry && !confirmRemoval(entry.id)) return; // only warn for real schedule entries - alternates aren't "taken" by anyone
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
    if (semesterCount(1) >= semesterCap() || semesterCount(2) >= semesterCap()) return;
    targetSem = 1;
  } else {
    if (semesterCount(1) < semesterCap()) targetSem = 1;
    else if (semesterCount(2) < semesterCap()) targetSem = 2;
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
    if (semesterCount(sem) >= semesterCap()) return;
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
  return ALL_YEAR_KEYS.flatMap(g => yearData[g].schedule.map(e => ({ ...e, _year: g })));
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
  nav.innerHTML = ALL_YEAR_KEYS.map(g => {
    const status = yearData[g].status === 'completed' ? 'Completed' : 'Planning';
    return `<button class="year-tab ${g === activeGrade ? 'active' : ''}" data-grade="${g}">${GRADE_LABELS[g]} <span class="year-tab-status ${yearData[g].status}">${status}</span></button>`;
  }).join('');
  nav.querySelectorAll('.year-tab').forEach(btn => {
    btn.addEventListener('click', () => switchYear(btn.dataset.grade === JH_KEY ? JH_KEY : Number(btn.dataset.grade)));
  });
}

function updateScheduleTitle() {
  document.getElementById('scheduleTitle').textContent = mode === 'builder' ? `My Schedule | ${GRADE_LABELS[activeGrade]}` : 'My Schedule';
}

function initSetup() {
  const overlay = document.getElementById('setupOverlay');

  // Quick Build has been retired - migrate anyone who previously picked it into Builder mode
  if (mode === 'quick') {
    mode = 'builder';
    localStorage.setItem(profileKey('fchs-mode'), 'builder');
  }

  if (!mode) {
    overlay.style.display = 'flex';
  } else {
    overlay.style.display = 'none';
    showHelpPopup(); // returning visit - show the how-to-use reminder every time
  }

  document.querySelectorAll('#setupGradeStep [data-grade]').forEach(btn => {
    btn.addEventListener('click', () => {
      const g = Number(btn.dataset.grade);
      mode = 'builder'; currentGrade = g; activeGrade = g;
      localStorage.setItem(profileKey('fchs-mode'), 'builder'); localStorage.setItem(profileKey('fchs-current-grade'), String(g));
      GRADES.forEach(yr => { yearData[yr].status = yr < g ? 'completed' : 'planned'; });
      persistYearData();
      finishSetup();
    });
  });
  document.getElementById('changePlanBtn').addEventListener('click', () => {
    overlay.style.display = 'flex';
  });
  document.getElementById('helpCloseBtn').addEventListener('click', () => {
    document.getElementById('helpOverlay').style.display = 'none';
  });
}
function showHelpPopup() {
  document.getElementById('helpOverlay').style.display = 'flex';
}
function finishSetup() {
  document.getElementById('setupOverlay').style.display = 'none';
  schedule = yearData[activeGrade].schedule;
  alternates = yearData[activeGrade].alternates;
  renderYearTabs();
  updateScheduleTitle();
  renderScheduleTray();
  refreshCatalogView();
  showHelpPopup(); // also show right after finishing first-time setup
}

/* =========================================================
   PROFILES (parent/family support)
   ========================================================= */
function updateWhoButtonLabel() {
  document.getElementById('whoBtnLabel').textContent = activeProfileName();
}

function loadActiveProfileState() {
  mode = localStorage.getItem(profileKey('fchs-mode'));
  currentGrade = Number(localStorage.getItem(profileKey('fchs-current-grade'))) || 9;
  yearData = loadYearData();
  activeGrade = mode === 'builder' ? currentGrade : 9;
  schedule = yearData[activeGrade].schedule;
  alternates = yearData[activeGrade].alternates;
  manual = loadManual();

  backfillInstanceIds();
  enforceAllYearCaps();

  // Always reset to the Course Catalog tab when switching who's plan is showing
  currentView = 'catalog';
  document.querySelectorAll('.view-tab').forEach(t => t.classList.remove('active'));
  const catalogTab = document.querySelector('.view-tab[data-view="catalog"]');
  if (catalogTab) catalogTab.classList.add('active');
  document.getElementById('catalogView').style.display = '';
  document.getElementById('progressView').style.display = 'none';
  document.getElementById('iccView').style.display = 'none';

  updateWhoButtonLabel();
  closeProfilePanel();

  if (!mode) {
    document.getElementById('setupOverlay').style.display = 'flex'; // fresh profile - needs the grade picker
  } else {
    document.getElementById('setupOverlay').style.display = 'none';
  }
  renderYearTabs();
  updateScheduleTitle();
  renderScheduleTray();
  refreshCatalogView();
  updateScheduleCollapseUI();
}

function switchProfile(newId, skipPersistCurrent) {
  if (!skipPersistCurrent) { persistYearData(); saveManual(); }
  setActiveProfileIdRaw(newId);
  loadActiveProfileState();
}

function addChildProfile(name) {
  name = name.trim();
  if (!name) return;
  const id = 'p' + Date.now() + Math.floor(Math.random() * 1000);
  const profiles = getProfiles();
  profiles.push({ id, name, createdAt: new Date().toISOString() });
  saveProfilesList(profiles);
  document.getElementById('newChildName').value = '';
  switchProfile(id);
}

function renameProfile(id) {
  if (id === 'default') {
    const newName = window.prompt('Rename to:', getDefaultProfileName());
    if (!newName || !newName.trim()) return;
    setDefaultProfileName(newName.trim());
    if (getActiveProfileId() === 'default') updateWhoButtonLabel();
    renderProfilePanel();
    return;
  }
  const profiles = getProfiles();
  const p = profiles.find(p => p.id === id);
  if (!p) return;
  const newName = window.prompt('Rename to:', p.name);
  if (!newName || !newName.trim()) return;
  p.name = newName.trim();
  saveProfilesList(profiles);
  if (getActiveProfileId() === id) updateWhoButtonLabel();
  renderProfilePanel();
}

function deleteProfile(id) {
  const wasActive = getActiveProfileId() === id;

  if (id === 'default') {
    if (!confirm(`Delete "${getDefaultProfileName()}"? This clears all its schedule data and can't be undone.`)) return;
    ['fchs-mode', 'fchs-current-grade', 'fchs-yeardata', 'fchs-manual-inputs', 'fchs-instance-counter'].forEach(base => localStorage.removeItem(base));
    localStorage.removeItem('fchs-default-profile-name');
  } else {
    const profiles = getProfiles();
    const p = profiles.find(p => p.id === id);
    if (!p) return;
    if (!confirm(`Delete ${p.name}'s plan? This can't be undone.`)) return;
    saveProfilesList(profiles.filter(p => p.id !== id));
    ['fchs-mode', 'fchs-current-grade', 'fchs-yeardata', 'fchs-manual-inputs', 'fchs-instance-counter'].forEach(base => {
      localStorage.removeItem(`fchs-profile-${id}-${base}`);
    });
  }

  if (wasActive) {
    const remaining = getProfiles();
    // skipPersistCurrent=true: the profile we're leaving was just deleted on purpose - don't save its state back
    switchProfile(remaining.length ? remaining[0].id : 'default', true);
  } else {
    renderProfilePanel();
  }
}

function renderProfilePanel() {
  const list = document.getElementById('profileList');
  const activeId = getActiveProfileId();
  const profiles = getProfiles();
  const rows = [{ id: 'default', name: getDefaultProfileName() }, ...profiles];
  list.innerHTML = rows.map(p => `
    <div class="profile-row ${p.id === activeId ? 'active' : ''}">
      <button class="profile-row-name" data-switchto="${p.id}">${p.name}${p.id === activeId ? ' (current)' : ''}</button>
      <button class="profile-row-icon-btn" data-renameprofile="${p.id}" aria-label="Rename">&#9998;</button>
      <button class="profile-row-icon-btn danger" data-deleteprofile="${p.id}" aria-label="Delete">&#128465;</button>
    </div>`).join('');
  list.querySelectorAll('[data-switchto]').forEach(btn => {
    btn.addEventListener('click', () => { if (btn.dataset.switchto !== activeId) switchProfile(btn.dataset.switchto); });
  });
  list.querySelectorAll('[data-renameprofile]').forEach(btn => {
    btn.addEventListener('click', () => renameProfile(btn.dataset.renameprofile));
  });
  list.querySelectorAll('[data-deleteprofile]').forEach(btn => {
    btn.addEventListener('click', () => deleteProfile(btn.dataset.deleteprofile));
  });
}
function openProfilePanel() {
  renderProfilePanel();
  document.getElementById('profileOverlay').style.display = 'flex';
}
function closeProfilePanel() {
  document.getElementById('profileOverlay').style.display = 'none';
}
function initProfiles() {
  updateWhoButtonLabel();
  document.getElementById('whoBtn').addEventListener('click', openProfilePanel);
  document.getElementById('profilePanelCloseBtn').addEventListener('click', closeProfilePanel);
  document.getElementById('addChildBtn').addEventListener('click', () => {
    addChildProfile(document.getElementById('newChildName').value);
  });
  document.getElementById('newChildName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addChildProfile(document.getElementById('newChildName').value);
  });
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
  iccRules = await fetch('data/icc-rules.json').then(r => r.json());
  initViewTabs();
  initManualPanel();
  initScheduleCollapse();
  initFiltersToggle();
  initPrint();
  initProfiles();
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

function activeFilterCount() {
  let n = 0;
  if (filters.duration !== 'all') n++;
  ['ap', 'dual', 'pathway', 'wbl', 'noPrereq', 'repeatable'].forEach(k => { if (filters[k]) n++; });
  return n;
}
function updateFiltersToggleLabel() {
  const btn = document.getElementById('filtersToggleBtn');
  if (!btn) return;
  const n = activeFilterCount();
  btn.textContent = n > 0 ? `Filters (${n})` : 'Filters';
  btn.classList.toggle('active', n > 0);
}

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
  updateFiltersToggleLabel();
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
  if (iccRules && c.icc) badges.push(`<span class="badge icc">ICC: ${iccRules.categories[c.icc.category].label}</span>`);

  const visibleBadges = badges.slice(0, 3);
  const hiddenCount = badges.length - visibleBadges.length;
  if (hiddenCount > 0) visibleBadges.push(`<span class="badge more">+${hiddenCount}</span>`);

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
      <div class="badges">${visibleBadges.join('')}</div>
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

  const dependents = coursesThatRequire(c.id);
  if (dependents.length) {
    html += `<h3>This course is a prerequisite for</h3><ul>` + dependents.map(d => `<li>${d.title}</li>`).join('') + `</ul>`;
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
      `<li>${cert.name}${cert.requires_prior_certification ? ' (requires ' + cert.requires_prior_certification + ')' : ''}${cert.credential_of_value ? `<br><span style="color:var(--ink-dim);font-size:0.82rem;">Credential of Value \u2014 ${cert.credential_of_value}</span>` : ''}</li>`
    ).join('') + `</ul>`;
  }

  if (c.flexible_category_tags && c.flexible_category_tags.some(t => SEAL_TAG_LABELS[t])) {
    html += `<h3>Counts Toward</h3><ul>` + c.flexible_category_tags.filter(t => SEAL_TAG_LABELS[t]).map(t => `<li>${SEAL_TAG_LABELS[t]}</li>`).join('') + `</ul>`;
  }

  if (PATHWAY_INFO[c.id]) {
    html += `<h3>CTE Pathway</h3><ul>` + PATHWAY_INFO[c.id].map(p => `<li>${p.pathway} | Step ${p.position} of ${p.total}</li>`).join('') + `</ul>`;
  }

  if (c.icc && iccRules) {
    const cat = iccRules.categories[c.icc.category];
    html += `<h3>Indiana College Core</h3><div class="dc-block">${cat.label} | ${c.icc.credit_hours} credit hours${c.icc.vincennes_sourced ? ' (counts toward the 15-credit Vincennes minimum)' : ''}${c.icc.requires_ap_score ? ` | requires a score of ${c.icc.min_ap_score}+ on the AP exam` : ''}${c.icc.is_estimate ? ' <em>(estimate)</em>' : ''}</div>`;
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
  const altBtn = document.getElementById('addAltBtn');
  const c = coursesById[currentDetailId];
  if (!c) return;

  if (c.repeatable) {
    const times = lifetimeCount(currentDetailId);
    const capText = c.repeatable.max_times ? `${times}/${c.repeatable.max_times} taken` : `${times} taken so far`;
    const check = canAddInstance(currentDetailId);
    btn.textContent = check.allowed ? `Add Another to Schedule | ${capText}` : `Can't add | ${check.reason}`;
    altBtn.textContent = `Add Another as Alternate | ${capText}`;
    altBtn.style.display = check.allowed ? '' : 'none';
    btn.classList.toggle('added', times > 0);
    btn.classList.remove('alternate');
    return;
  }

  if (inSchedule(currentDetailId)) {
    btn.textContent = 'In Schedule \u2713 (click to remove)';
    btn.classList.add('added'); btn.classList.remove('alternate');
    altBtn.style.display = 'none';
  } else if (inAlternates(currentDetailId)) {
    btn.textContent = 'In Alternates \u2713 (click to remove)';
    btn.classList.add('added', 'alternate');
    altBtn.style.display = 'none';
  } else {
    const full = isFullYear(c);
    const noRoom = full ? (semesterCount(1) >= semesterCap() || semesterCount(2) >= semesterCap()) : (semesterCount(1) >= semesterCap() && semesterCount(2) >= semesterCap());
    btn.textContent = 'Add to Schedule';
    btn.disabled = noRoom;
    btn.title = noRoom ? 'No room in this semester' : '';
    btn.classList.remove('added', 'alternate');
    altBtn.textContent = 'Add as Alternate';
    altBtn.style.display = '';
  }
}

document.getElementById('addBtn').addEventListener('click', () => {
  if (!currentDetailId) return;
  const c = coursesById[currentDetailId];
  if (c.repeatable || (!inSchedule(currentDetailId) && !inAlternates(currentDetailId))) addToSchedule(currentDetailId);
  else toggleCourse(currentDetailId);
});
document.getElementById('addAltBtn').addEventListener('click', () => {
  if (!currentDetailId) return;
  addToAlternates(currentDetailId);
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
         <button class="sem-btn ${entry.semester === 1 ? 'active' : ''}" data-semtoggle="${entry.instanceId}" data-sem="1" ${entry.semester !== 1 && semesterCount(1) >= semesterCap() ? 'disabled' : ''}>S1</button>
         <button class="sem-btn ${entry.semester === 2 ? 'active' : ''}" data-semtoggle="${entry.instanceId}" data-sem="2" ${entry.semester !== 2 && semesterCount(2) >= semesterCap() ? 'disabled' : ''}>S2</button>
       </div>`
    : '';
  const fullYearToggle = opts.showFullYearToggle
    ? `<div class="sem-toggle"><button class="sem-btn full-year-btn ${entry.fullYearOverride ? 'active' : ''}" data-fyoverride="${entry.instanceId}">${entry.fullYearOverride ? '\u2713 ' : ''}Span Both Semesters</button></div>`
    : '';
  const moveBtn = opts.showMove === true ? `<button class="move-btn" data-move="${entry.instanceId}">\u2192 Add to Schedule</button>`
    : opts.showMove === false ? `<span class="move-disabled">No room this semester | remove a class first</span>` : '';
  const warning = (opts.unmetPrereqs && opts.unmetPrereqs.length)
    ? `<p class="schedule-row-warning">\u26a0 Missing prerequisite: ${opts.unmetPrereqs.join(', ')}</p>` : '';
  const moveYearSelect = `
    <select class="move-year-select" data-moveyear="${entry.instanceId}">
      <option value="">Move to year&hellip;</option>
      ${ALL_YEAR_KEYS.filter(g => String(g) !== String(activeGrade)).map(g => `<option value="${g}">${GRADE_LABELS[g]}</option>`).join('')}
    </select>`;
  return `
    <div class="schedule-row${warning ? ' has-warning' : ''}" data-id="${c.id}">
      <div class="schedule-row-top">
        <p class="schedule-row-title">${c.title}</p>
        ${moveYearSelect}
        <button class="schedule-chip-remove" data-remove="${entry.instanceId}" aria-label="Remove">&times;</button>
      </div>
      <div class="schedule-row-main">
        <p class="schedule-row-meta">${tags} &nbsp;|&nbsp; Prerequisites: ${prereqText}</p>
        ${warning}
        ${details.length ? `<p class="schedule-row-details">${details.join(' &middot; ')}</p>` : ''}
        ${semToggle}${fullYearToggle}${moveBtn}
      </div>
    </div>`;
}

function renderScheduleTray() {
  const sem1El = document.getElementById('sem1Items');
  const sem2El = document.getElementById('sem2Items');
  const altEl = document.getElementById('alternateItems');
  const countEl = document.getElementById('scheduleCount');
  const s1Count = semesterCount(1), s2Count = semesterCount(2);
  countEl.textContent = activeGrade === JH_KEY ? `${schedule.length} course${schedule.length === 1 ? '' : 's'} logged` : `Sem 1: ${s1Count}/7 \u00b7 Sem 2: ${s2Count}/7`;

  const sem1Rows = [], sem2Rows = [];
  schedule.forEach(entry => {
    const c = coursesById[entry.id];
    if (!c) return;
    const unmetPrereqs = unmetPrerequisites(entry.id, activeGrade);
    if (entryIsFullYear(entry, c)) {
      sem1Rows.push(rowHTML(c, entry, { showSemToggle: false, showFullYearToggle: hasVariableDuration(c), tagFull: true, unmetPrereqs }));
      sem2Rows.push(rowHTML(c, entry, { showSemToggle: false, showFullYearToggle: hasVariableDuration(c), tagFull: true, unmetPrereqs }));
    } else if (entry.semester === 2) {
      sem2Rows.push(rowHTML(c, entry, { showSemToggle: true, showFullYearToggle: hasVariableDuration(c), unmetPrereqs }));
    } else {
      sem1Rows.push(rowHTML(c, entry, { showSemToggle: true, showFullYearToggle: hasVariableDuration(c), unmetPrereqs }));
    }
  });

  sem1El.innerHTML = sem1Rows.length ? sem1Rows.join('') : `<p class="schedule-empty">No courses yet.</p>`;
  sem2El.innerHTML = sem2Rows.length ? sem2Rows.join('') : `<p class="schedule-empty">No courses yet.</p>`;

  altEl.innerHTML = alternates.length
    ? alternates.map(entry => {
        const c = coursesById[entry.id];
        if (!c) return '';
        const full = entryIsFullYear(entry, c);
        const canMove = full ? (s1Count < semesterCap() && s2Count < semesterCap()) : (s1Count < semesterCap() || s2Count < semesterCap());
        return rowHTML(c, entry, { showMove: canMove, showFullYearToggle: hasVariableDuration(c) });
      }).join('')
    : `<p class="schedule-empty">None yet | courses beyond your 7-per-semester limit will land here.</p>`;

  wireScheduleRowButtons();
  updateScheduleCollapseUI();
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
  document.querySelectorAll('[data-moveyear]').forEach(sel => {
    sel.addEventListener('click', (e) => e.stopPropagation());
    sel.addEventListener('change', (e) => {
      e.stopPropagation();
      const val = sel.value;
      if (!val) return;
      moveToYear(Number(sel.dataset.moveyear), val === 'JH' ? 'JH' : Number(val));
    });
  });
  document.querySelectorAll('.schedule-row').forEach(row => {
    row.addEventListener('click', () => openDetail(row.dataset.id));
  });
}

function coursesThatRequire(courseId) {
  return allCourses.filter(c => {
    if (!c.prerequisites) return false;
    return c.prerequisites.some(p => {
      if (typeof p === 'string') return p === courseId;
      if (p.type === 'any_of') return (p.courses || []).includes(courseId);
      return false;
    });
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
let currentView = 'catalog';
function initViewTabs() {
  document.querySelectorAll('.view-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.view-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const view = tab.dataset.view;
      currentView = view;
      document.getElementById('catalogView').style.display = view === 'catalog' ? '' : 'none';
      document.getElementById('progressView').style.display = view === 'progress' ? '' : 'none';
      document.getElementById('iccView').style.display = view === 'icc' ? '' : 'none';
      if (view === 'progress') renderProgressView();
      if (view === 'icc') renderICCView();
      updateScheduleCollapseUI();
    });
  });
}

/* =========================================================
   SCHEDULE TRAY COLLAPSE
   ========================================================= */
let scheduleCollapsedOverride = null; // null = follow the automatic default; true/false = user manually toggled it
function computeDefaultCollapse() {
  const isEmpty = schedule.length === 0;
  return !(isEmpty || currentView === 'catalog'); // expanded when empty or on the Catalog tab, collapsed otherwise
}
function isScheduleCollapsed() {
  return scheduleCollapsedOverride !== null ? scheduleCollapsedOverride : computeDefaultCollapse();
}
function updateScheduleCollapseUI() {
  const tray = document.getElementById('scheduleTray');
  const btn = document.getElementById('scheduleCollapseBtn');
  const collapsed = isScheduleCollapsed();
  tray.classList.toggle('collapsed', collapsed);
  btn.classList.toggle('collapsed', collapsed);
  btn.setAttribute('aria-label', collapsed ? 'Expand schedule' : 'Collapse schedule');
}
function initScheduleCollapse() {
  document.getElementById('scheduleCollapseBtn').addEventListener('click', () => {
    scheduleCollapsedOverride = !isScheduleCollapsed();
    updateScheduleCollapseUI();
  });
}

/* =========================================================
   FILTERS TOGGLE
   ========================================================= */
function initFiltersToggle() {
  document.getElementById('filtersToggleBtn').addEventListener('click', () => {
    const bar = document.getElementById('filterBar');
    const btn = document.getElementById('filtersToggleBtn');
    const isOpen = bar.style.display !== 'none';
    bar.style.display = isOpen ? 'none' : 'flex';
    btn.classList.toggle('active', !isOpen);
  });
}

/* =========================================================
   MANUAL INPUT PANEL (things no course list can tell us)
   ========================================================= */
const MANUAL_DEFAULTS = {
  bAverage: false, allCGrades: false, rigorMet: false,
  wblHours: 0, employmentSkillDev: false, employmentAttendance: false, credentialOfValue: false,
  jrotc: false, asvabScore: '', careerExploration: false, enlistmentSkillDev: false, enlistmentAttendance: false,
  apScores: {}, iccGpaOk: false
};
function loadManual() {
  try {
    const raw = localStorage.getItem(profileKey('fchs-manual-inputs'));
    return raw ? { ...MANUAL_DEFAULTS, ...JSON.parse(raw) } : { ...MANUAL_DEFAULTS };
  } catch (e) { return { ...MANUAL_DEFAULTS }; }
}
function saveManual() {
  try { localStorage.setItem(profileKey('fchs-manual-inputs'), JSON.stringify(manual)); } catch (e) {}
}
let manual = loadManual();

function initManualPanel() {
  document.addEventListener('change', (e) => {
    if (e.target.dataset.apScore) {
      const courseId = e.target.dataset.apScore;
      const val = e.target.value === '' ? undefined : Number(e.target.value);
      if (val === undefined) delete manual.apScores[courseId]; else manual.apScores[courseId] = val;
      saveManual();
      renderICCView();
      return;
    }
    if (!e.target.dataset.manualKey) return;
    const key = e.target.dataset.manualKey;
    manual[key] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    saveManual();
    if (key === 'iccGpaOk') renderICCView(); else renderProgressView();
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
  const buckets = {}; // id -> { credits_needed, category, required, label, earned, contributions }
  const cats = diplomaRules.base_diploma_requirements;
  Object.entries(cats).forEach(([catKey, cat]) => {
    if (cat.required) cat.required.forEach(r => {
      buckets[r.id] = { credits_needed: r.credits, category: catKey, required: true, label: REQUIREMENT_LABELS[r.id] || r.id, earned: 0, contributions: [] };
    });
    if (cat.flexible) cat.flexible.forEach(f => {
      buckets[f.id] = { credits_needed: f.credits, category: catKey, required: false, label: REQUIREMENT_LABELS[f.id] || f.id, earned: 0, contributions: [] };
    });
  });
  buckets['personalized_electives'] = { credits_needed: cats.personalized_electives.total_credits, category: 'personalized_electives', required: false, label: 'Personalized Electives', earned: 0, contributions: [] };
  return buckets;
}

function computeDiplomaProgress() {
  const buckets = buildBuckets();
  const entries = allYearsSchedules().filter(e => coursesById[e.id]);

  entries.forEach(entry => {
    const c = coursesById[entry.id];
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
      if (credits > 0) bucket.contributions.push({ title: c.title, credits, year: entry._year });
    } else {
      // Cap what this bucket can absorb; anything beyond what the requirement needs rolls into Personalized Electives
      // instead of being lost, so a course worth more credits than a requirement needs still counts toward graduation.
      const remainingNeed = Math.max(bucket.credits_needed - bucket.earned, 0);
      const applied = Math.min(credits, remainingNeed);
      bucket.earned += applied;
      if (applied > 0) bucket.contributions.push({ title: c.title, credits: applied, year: entry._year });
      const leftover = credits - applied;
      if (leftover > 0) {
        buckets['personalized_electives'].earned += leftover;
        buckets['personalized_electives'].contributions.push({ title: c.title, credits: leftover, year: entry._year, note: `overflow from ${bucket.label}` });
      }
    }
  });

  // category totals (capped at each bucket's need, so category can't over-fill from one flexible source alone beyond its own bucket cap)
  const catTotals = {};
  Object.entries(diplomaRules.base_diploma_requirements).forEach(([catKey, cat]) => {
    catTotals[catKey] = { earned: 0, needed: cat.total_credits, label: catKey, buckets: [], contributions: [] };
  });
  Object.entries(buckets).forEach(([id, b]) => {
    const capped = Math.min(b.earned, b.credits_needed);
    catTotals[b.category].earned += capped;
    catTotals[b.category].buckets.push({ id, ...b, capped });
    catTotals[b.category].contributions.push(...b.contributions);
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
      { label: `ASVAB score: ${manual.asvabScore || 'Not entered'} (need 31+)`, met: Number(manual.asvabScore) >= 31, manual: true },
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
/* =========================================================
   INDIANA COLLEGE CORE
   ========================================================= */
function computeICCProgress() {
  const allCourses = allYearsSchedules().map(e => coursesById[e.id]).filter(c => c && c.icc);
  const categoryTotals = {};
  Object.entries(iccRules.categories).forEach(([k, v]) => { categoryTotals[k] = { earned: 0, label: v.label, min: v.min_credits, max: v.max_credits }; });

  let totalCredits = 0, vincennesCredits = 0;
  const apCoursesNeedingScore = [];
  const countedCourses = [];

  allCourses.forEach(c => {
    const icc = c.icc;
    if (icc.requires_ap_score) {
      apCoursesNeedingScore.push({ id: c.id, title: c.title, score: manual.apScores[c.id], minScore: icc.min_ap_score });
      const score = manual.apScores[c.id];
      if (score === undefined || score < icc.min_ap_score) return; // doesn't count yet
    }
    const cat = categoryTotals[icc.category];
    const applied = Math.min(icc.credit_hours, Math.max(cat.max - cat.earned, 0));
    cat.earned += applied;
    totalCredits += applied;
    if (icc.vincennes_sourced) vincennesCredits += applied;
    countedCourses.push({ id: c.id, title: c.title, credits: applied, vincennes: icc.vincennes_sourced, isEstimate: icc.is_estimate });
  });

  return { categoryTotals, totalCredits, vincennesCredits, apCoursesNeedingScore, countedCourses };
}

function renderICCView() {
  const el = document.getElementById('iccView');
  if (!iccRules) { el.innerHTML = `<p class="progress-intro">Loading&hellip;</p>`; return; }
  const r = computeICCProgress();

  let html = `<p class="progress-intro">The Indiana College Core is a 30-credit-hour block of college coursework guaranteed to transfer between Indiana public colleges and universities. This is an estimate based on your dual-credit and AP courses.</p>
  <p class="progress-intro">At least 15 of the 30 credits must come directly through Vincennes University dual credit. Ivy Tech and AP credits don't count toward that 15-credit minimum, even though they can count toward the overall 30. Vincennes University requires a 2.7 GPA in your dual credit courses in order to receive the ICC.</p>
  <p class="progress-intro">Always confirm your final plan with your counselor.</p>`;

  const totalPct = Math.min(100, Math.round((r.totalCredits / 30) * 100));
  const vinPct = Math.min(100, Math.round((r.vincennesCredits / 15) * 100));
  html += `<h2 class="progress-section-title">Overall Progress</h2><div class="diploma-grid">
    <div class="prog-card">
      <p class="prog-card-title">Total ICC Credits<span class="prog-card-count">${r.totalCredits} / 30 cr.</span></p>
      <div class="prog-bar-track"><div class="prog-bar-fill${r.totalCredits >= 30 ? ' complete' : ''}" style="width:${totalPct}%;"></div></div>
    </div>
    <div class="prog-card">
      <p class="prog-card-title">Vincennes-Sourced (need 15+)<span class="prog-card-count">${r.vincennesCredits} / 15 cr.</span></p>
      <div class="prog-bar-track"><div class="prog-bar-fill${r.vincennesCredits >= 15 ? ' complete' : ''}" style="width:${vinPct}%;"></div></div>
      <p class="prog-subitems">${r.vincennesCredits >= 15 ? '<span class="met">\u2713 Vincennes minimum met</span>' : '<span class="unmet">\u2013 Ivy Tech / AP credits don\u2019t count here</span>'}</p>
    </div>
  </div>`;

  html += `<h2 class="progress-section-title">By Category</h2><div class="diploma-grid">`;
  Object.values(r.categoryTotals).forEach(cat => {
    const pct = Math.min(100, Math.round((cat.earned / cat.max) * 100));
    const meetsMin = cat.earned >= cat.min;
    html += `<div class="prog-card">
      <p class="prog-card-title">${cat.label}<span class="prog-card-count">${cat.earned} cr.</span></p>
      <div class="prog-bar-track"><div class="prog-bar-fill${meetsMin ? ' complete' : ''}" style="width:${pct}%;"></div></div>
      <p class="prog-subitems">${meetsMin ? '<span class="met">\u2713 3-credit minimum met</span>' : `<span class="unmet">\u2013 Need ${cat.min - cat.earned} more credit${cat.min - cat.earned === 1 ? '' : 's'}</span>`} <span style="opacity:0.7;">(max ${cat.max} counted)</span></p>
    </div>`;
  });
  html += `</div>`;

  if (r.apCoursesNeedingScore.length) {
    html += `<div class="manual-panel">
      <h3>AP Exam Scores</h3>
      <p>These AP courses are in your schedule but only count toward the Core once you enter a qualifying score. Leave blank if not yet taken.</p>
      <div class="manual-grid">
        ${r.apCoursesNeedingScore.map(c => `
          <div class="manual-field">
            <label for="ap-${c.id}">${c.title} (need ${c.minScore}+)</label>
            <input type="number" id="ap-${c.id}" data-ap-score="${c.id}" min="1" max="5" value="${manual.apScores[c.id] ?? ''}">
          </div>`).join('')}
      </div>
    </div>`;
  }

  html += `<div class="manual-panel">
    <h3>Dual Credit GPA</h3>
    <p>Vincennes University requires at least a 2.7 GPA across your Vincennes dual-credit courses for those credits to count toward the certificate.</p>
    <div class="manual-field checkbox"><input type="checkbox" id="iccgpa" data-manual-key="iccGpaOk" ${manual.iccGpaOk ? 'checked' : ''}><label for="iccgpa">I have at least a 2.7 GPA across my Vincennes dual-credit courses</label></div>
  </div>`;

  if (r.countedCourses.some(c => c.isEstimate)) {
    html += `<p class="progress-intro"><em>Some credit-hour values above are estimates for AP-only courses without a confirmed Vincennes pairing. Actual credit depends on your receiving institution's policy.</em></p>`;
  }

  el.innerHTML = html;
}

function renderProgressView() {
  const el = document.getElementById('progressView');
  const catTotals = computeDiplomaProgress();
  const seals = computeSeals();

  let html = `<p class="progress-intro">This is an estimate based on the courses in your schedule${mode === 'builder' ? ' across all four years' : ''}. Credit-based items update automatically as you add or remove courses; a few things (GPA, test scores, attendance, work hours) can't be read from a course list, so enter those yourself below. Always confirm your final plan with your counselor.</p>`;

  html += `<h2 class="progress-section-title">Indiana Diploma Requirements <span class="coming-soon">(click a card to see which courses count)</span></h2>`;
  html += `<div class="diploma-grid">`;
  Object.entries(catTotals).forEach(([catKey, cat]) => {
    const pct = Math.min(100, Math.round((cat.earned / cat.needed) * 100));
    const complete = cat.earned >= cat.needed;
    html += `
      <div class="prog-card" data-reqcat="${catKey}" style="cursor:pointer;">
        <p class="prog-card-title">${CATEGORY_LABELS[catKey]}<span class="prog-card-count">${cat.earned} / ${cat.needed} cr.</span></p>
        <div class="prog-bar-track"><div class="prog-bar-fill${complete ? ' complete' : ''}" style="width:${pct}%;"></div></div>
        ${cat.buckets.length ? `<p class="prog-subitems">${cat.buckets.map(b => `<span class="${b.capped >= b.credits_needed ? 'met' : 'unmet'}">${b.capped >= b.credits_needed ? '\u2713' : '\u2013'} ${b.label} (${b.capped}/${b.credits_needed})</span>`).join('<br>')}</p>` : ''}
      </div>`;
  });
  html += `</div>`;

  html += `<h2 class="progress-section-title">Readiness Seals <span class="coming-soon">(Honors tier shown | Honors Plus coming soon)</span></h2>`;
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
      <p>These can't be determined from your course selection | fill in what applies. Saved automatically on this device.</p>
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
  Object.keys(catTotals).forEach(catKey => {
    const cardEl = el.querySelector(`[data-reqcat="${catKey}"]`);
    if (cardEl) cardEl.addEventListener('click', () => openRequirementTray(CATEGORY_LABELS[catKey], catTotals[catKey]));
  });
}

function openRequirementTray(catLabel, cat) {
  const panel = document.getElementById('reqTrayPanel');
  const scrim = document.getElementById('reqScrim');
  const content = document.getElementById('reqTrayContent');
  let html = `<h2>${catLabel}</h2><div class="detail-code">${cat.earned} / ${cat.needed} credits</div>`;
  if (!cat.contributions.length) {
    html += `<p style="color:var(--ink-dim);font-size:0.9rem;">No courses in your plan are currently counting toward this requirement.</p>`;
  } else {
    html += `<ul>` + cat.contributions.map(c =>
      `<li><strong>${c.title}</strong> | ${c.credits} credit${c.credits === 1 ? '' : 's'} | ${GRADE_LABELS[c.year] || c.year}${c.note ? ` <em style="color:var(--ink-dim);">(${c.note})</em>` : ''}</li>`
    ).join('') + `</ul>`;
  }
  content.innerHTML = html;
  panel.classList.add('open');
  scrim.classList.add('open');
}
document.getElementById('reqTrayClose').addEventListener('click', closeReqTray);
document.getElementById('reqScrim').addEventListener('click', closeReqTray);
function closeReqTray() {
  document.getElementById('reqTrayPanel').classList.remove('open');
  document.getElementById('reqScrim').classList.remove('open');
}

/* =========================================================
   PRINT / SAVE
   ========================================================= */
function initPrint() {
  document.getElementById('printOpenBtn').addEventListener('click', () => {
    populatePrintYears();
    document.getElementById('printOverlay').style.display = 'flex';
  });
  document.getElementById('printCancelBtn').addEventListener('click', () => {
    document.getElementById('printOverlay').style.display = 'none';
  });
  document.getElementById('printGenerateBtn').addEventListener('click', generatePrintDoc);
}

function populatePrintYears() {
  yearData[activeGrade] = { schedule, alternates, status: yearData[activeGrade].status }; // sync in-memory edits
  const list = document.getElementById('printYearsList');
  list.innerHTML = ALL_YEAR_KEYS.map(g => {
    const count = yearData[g].schedule.length;
    return `<label><input type="checkbox" class="print-year-cb" value="${g}" ${count > 0 ? 'checked' : ''}> ${GRADE_LABELS[g]} (${count} course${count === 1 ? '' : 's'})</label>`;
  }).join('');
}

function printHeaderHTML() {
  const name = document.getElementById('printStudentName').value.trim();
  return `<div class="print-header">
    <img src="assets/logo.png" alt="FCHS">
    <div>
      <h1>Franklin Central High School &mdash; Course Plan</h1>
      <p>${name ? 'Student: ' + name : 'Student: _______________________________'} &nbsp;&nbsp;|&nbsp;&nbsp; Generated: ${new Date().toLocaleDateString()}</p>
    </div>
  </div>`;
}

function buildPrintSchedulePage(grade) {
  const yd = grade === activeGrade ? { schedule, alternates, status: yearData[grade].status } : yearData[grade];
  const sem1 = [], sem2 = [], alt = [];
  yd.schedule.forEach(entry => {
    const c = coursesById[entry.id];
    if (!c) return;
    const notes = [isAP(c) ? 'AP' : null, c.dual_credit ? 'Dual Credit' : null].filter(Boolean).join(', ');
    const row = `<tr><td>${c.title}</td><td>${c.state_course_code || ''}</td><td>${c.credits}</td><td>${notes}</td></tr>`;
    if (entryIsFullYear(entry, c)) { sem1.push(row); sem2.push(row); }
    else if (entry.semester === 2) sem2.push(row); else sem1.push(row);
  });
  yd.alternates.forEach(entry => {
    const c = coursesById[entry.id];
    if (c) alt.push(`<li>${c.title}</li>`);
  });
  return `<div class="print-page">
    ${printHeaderHTML()}
    <p class="print-meta-line"><strong>${GRADE_LABELS[grade]}</strong> &nbsp;&mdash;&nbsp; ${yd.status === 'completed' ? 'Completed' : 'Planning'}</p>
    <p class="print-section-title">Semester 1</p>
    <table class="print-table"><thead><tr><th>Course</th><th>Code</th><th>Credits</th><th>Notes</th></tr></thead><tbody>${sem1.join('') || '<tr><td colspan="4">No courses</td></tr>'}</tbody></table>
    <p class="print-section-title">Semester 2</p>
    <table class="print-table"><thead><tr><th>Course</th><th>Code</th><th>Credits</th><th>Notes</th></tr></thead><tbody>${sem2.join('') || '<tr><td colspan="4">No courses</td></tr>'}</tbody></table>
    ${alt.length ? `<p class="print-section-title">Alternatives</p><ul>${alt.join('')}</ul>` : ''}
  </div>`;
}

function buildPrintDiplomaPage() {
  const catTotals = computeDiplomaProgress();
  const seals = computeSeals();
  const rows = Object.entries(catTotals).map(([k, cat]) =>
    `<tr><td>${CATEGORY_LABELS[k]}</td><td>${cat.earned} / ${cat.needed}</td><td>${cat.earned >= cat.needed ? 'Met' : 'Not yet met'}</td></tr>`
  ).join('');
  const sealRows = seals.map(seal => {
    const allMet = seal.items.every(i => i.met);
    return `<tr><td>${seal.name}</td><td>${allMet ? 'On track' : 'In progress'}</td><td style="font-size:0.78rem;">${seal.items.map(i => `${i.met ? '\u2713' : '\u2013'} ${i.label}`).join('; ')}</td></tr>`;
  }).join('');
  return `<div class="print-page">
    ${printHeaderHTML()}
    <p class="print-section-title">Indiana Diploma Requirements</p>
    <table class="print-table"><thead><tr><th>Requirement</th><th>Credits</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="print-section-title">Readiness Seals (Honors tier)</p>
    <table class="print-table"><thead><tr><th>Seal</th><th>Status</th><th>Criteria</th></tr></thead><tbody>${sealRows}</tbody></table>
    <p class="print-note">This is an estimate based on courses in the student's plan, not an official credit audit. Confirm with your school counselor.</p>
  </div>`;
}

function buildPrintICCPage() {
  if (!iccRules) return '';
  const r = computeICCProgress();
  const catRows = Object.values(r.categoryTotals).map(cat =>
    `<tr><td>${cat.label}</td><td>${cat.earned} cr.</td><td>min ${cat.min}, max ${cat.max}</td></tr>`
  ).join('');
  return `<div class="print-page">
    ${printHeaderHTML()}
    <p class="print-section-title">Indiana College Core Progress</p>
    <p class="print-meta-line">Total: ${r.totalCredits} / 30 credits &nbsp;|&nbsp; Vincennes-sourced: ${r.vincennesCredits} / 15 credits (required)</p>
    <table class="print-table"><thead><tr><th>Category</th><th>Earned</th><th>Requirement</th></tr></thead><tbody>${catRows}</tbody></table>
    <p class="print-note">Vincennes University requires a 2.7 GPA in dual credit courses for these credits to count toward the certificate. This is an estimate; confirm with your school counselor.</p>
  </div>`;
}

function signatureBlockHTML() {
  return `<div class="print-page">
    ${printHeaderHTML()}
    <p class="print-section-title">Approval Signatures</p>
    <div class="print-sig-block">
      <div class="print-sig-line"><span class="line"></span><span class="sig-label">Student Signature</span><span class="line" style="max-width:100px;"></span><span class="sig-label">Date</span></div>
      <div class="print-sig-line"><span class="line"></span><span class="sig-label">Parent/Guardian Signature</span><span class="line" style="max-width:100px;"></span><span class="sig-label">Date</span></div>
      <div class="print-sig-line"><span class="line"></span><span class="sig-label">Counselor Signature</span><span class="line" style="max-width:100px;"></span><span class="sig-label">Date</span></div>
    </div>
  </div>`;
}

function generatePrintDoc() {
  const includeSchedule = document.getElementById('printSchedule').checked;
  const includeDiploma = document.getElementById('printDiploma').checked;
  const includeICC = document.getElementById('printICC').checked;
  const includeSig = document.getElementById('printSignatures').checked;
  const selectedYears = Array.from(document.querySelectorAll('.print-year-cb:checked')).map(cb => cb.value === 'JH' ? 'JH' : Number(cb.value));

  let pages = '';
  if (includeSchedule) selectedYears.forEach(g => { pages += buildPrintSchedulePage(g); });
  if (includeDiploma) pages += buildPrintDiplomaPage();
  if (includeICC && iccRules) pages += buildPrintICCPage();
  if (includeSig) pages += signatureBlockHTML();

  if (!pages) { alert('Select at least one thing to include.'); return; }

  document.getElementById('printDoc').innerHTML = pages;
  document.getElementById('printOverlay').style.display = 'none';
  document.body.classList.add('printing');
  window.onafterprint = () => { document.body.classList.remove('printing'); };
  // Small delay so the browser finishes laying out the newly-injected content before pagination is calculated
  setTimeout(() => {
    window.print();
    setTimeout(() => document.body.classList.remove('printing'), 1000); // fallback in case onafterprint doesn't fire
  }, 50);
}
