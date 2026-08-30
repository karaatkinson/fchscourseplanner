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
  'personalized_electives': null // don't badge plain electives, too noisy
};

let allCourses = []; // flattened, each tagged with department label
let coursesById = {};
let activeDept = null;

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
  selectDept(results[0].label);
}

function renderDeptRail(labels) {
  const rail = document.getElementById('deptRail');
  rail.innerHTML = labels.map(label => {
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
  renderCatalog(allCourses.filter(c => c._dept === label));
}

function renderCatalog(list) {
  const el = document.getElementById('catalog');
  if (!list.length) {
    el.innerHTML = `<p class="empty-state">No courses match.</p>`;
    return;
  }
  el.innerHTML = `<h2 class="dept-heading">${activeDept ?? 'Search results'}</h2>` +
    list.map(c => courseRowHTML(c)).join('');
  el.querySelectorAll('.course-row').forEach(row => {
    row.addEventListener('click', () => openDetail(row.dataset.id));
  });
}

function courseRowHTML(c) {
  const badges = [];
  if (c.dual_credit) badges.push('<span class="badge dual">Dual Credit</span>');
  const reqId = c.diploma_requirement_id;
  if (reqId && REQUIREMENT_LABELS[reqId]) badges.push(`<span class="badge req">${REQUIREMENT_LABELS[reqId]}</span>`);
  if (c.diploma_requirement_id_options) badges.push('<span class="badge req">Flexible Requirement</span>');

  const gradeStr = Array.isArray(c.grades) ? `Grades ${c.grades[0]}&ndash;${c.grades[c.grades.length-1]}` : '';
  const creditStr = c.credits ? `${c.credits} cr` : '';

  return `
    <div class="course-row" data-id="${c.id}">
      <div>
        <p class="course-title">${c.title}</p>
        <div class="course-meta">
          <span>${gradeStr}</span>
          <span>${creditStr}</span>
          ${c.state_course_code ? `<span class="course-code">${c.state_course_code}</span>` : ''}
        </div>
      </div>
      <div class="badges">${badges.join('')}</div>
    </div>`;
}

function openDetail(id) {
  const c = coursesById[id];
  if (!c) return;
  const panel = document.getElementById('detailPanel');
  const scrim = document.getElementById('scrim');
  const content = document.getElementById('detailContent');

  let html = `<h2>${c.title}</h2>`;
  html += `<div class="detail-code">${c._dept}${c.state_course_code ? ' &middot; ' + c.state_course_code : ''}</div>`;

  if (c.description) html += `<p>${c.description}</p>`;

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

  if (c.special_notes) {
    html += `<h3>Notes</h3><ul>` + c.special_notes.filter(n => !n.startsWith('CONFIRMED') && !n.startsWith('RESOLVED')).map(n => `<li>${n}</li>`).join('') + `</ul>`;
  }

  content.innerHTML = html;
  panel.classList.add('open');
  scrim.classList.add('open');
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
  const q = e.target.value.trim().toLowerCase();
  if (!q) { selectDept(activeDept); return; }
  document.querySelectorAll('.dept-item').forEach(b => b.classList.remove('active'));
  const matches = allCourses.filter(c => c.title.toLowerCase().includes(q));
  document.getElementById('catalog').innerHTML =
    `<h2 class="dept-heading">Results for &ldquo;${e.target.value}&rdquo;</h2>` +
    (matches.length ? matches.map(c => courseRowHTML(c)).join('') : `<p class="empty-state">No courses match.</p>`);
  document.querySelectorAll('.course-row').forEach(row => {
    row.addEventListener('click', () => openDetail(row.dataset.id));
  });
});

loadAll();
