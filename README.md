# FCHS Course Planner

A static website (no login, nothing stored on a server). Students browse the course catalog, build a four-year plan,
and see diploma, Readiness Seal and Indiana College Core progress. Plans are saved only in the visitor's own browser.

## Where the course information comes from

**The department course guides are the source of truth.** Every time the page loads it reads the 14 guide files in
the `guides/` folder (the Markdown downloads of the "Course Description Guide" Google Docs) and builds the catalog from them.

| File in `guides/` | Department |
|---|---|
| business.md | Business |
| engineering-technology.md | Engineering and Technology Education |
| english.md | English Language Arts |
| family-consumer-sciences.md | Family and Consumer Sciences |
| math.md | Mathematics |
| multidisciplinary.md | Multidisciplinary |
| multilingual-learners.md | Multilingual Learners (ML) |
| performing-arts.md | Performing Arts |
| physical-education.md | Physical Education |
| science.md | Science |
| social-studies.md | Social Studies |
| special-education.md | Special Education |
| visual-arts.md | Visual Arts |
| world-languages.md | World Languages |

### Updating for a new school year
1. In Google Docs: File → Download → Markdown (.md) for each guide.
2. Rename each file to the name in the table above and upload it to the `guides/` folder on GitHub (replacing the old one).
3. If the year changed, edit `schoolYear` in `data/guides.json`.
4. Wait a minute or two, then hard refresh the site.

That is all for ordinary changes: new courses, renamed courses, new prerequisites, credits, grades, dual-credit and
certification details are all picked up from the guides. If a guide is missing or cannot be read, the site shows a
yellow **Not shown yet** notice and the rest keeps working.

## What the site works out for itself
- **Diploma requirement / Readiness Seal categories**: from the *state course code* printed in each guide's
  "FC / State Course Code" row, matched against the IDOE eligibility memo lists (`data/diploma-base-rules.json`
  and `seal_codes` in `data/rules.json`). If a code in a guide changes, the course re-maps automatically.
- **Prerequisites**: the guide's prerequisite text is read automatically. A level of a course (regular/Honors/Early College)
  satisfies a prerequisite when the guide's department note says so. Conditions the planner cannot check
  (audition, teacher approval, test scores, grades, middle-school work) are shown as text and never block a student.
  Recommendations ("Recommended: …") are never treated as requirements.
- **CTE pathways**: from each guide's "Pathway / Sequence" row.
- **Credentials of Value**: certifications in the guides are looked up in `data/cov.json` (2026–2027 IDOE list).

## What lives outside the guides: `data/rules.json`
Things no guide states: Indiana College Core placement of dual-credit/AP courses, the 8-credit shared Elective PE cap,
reviewed prerequisite readings, and the IDOE code lists for seals. Rules are tied to the course's generated id
(`<department>-<course-title>`), so if a course is **renamed** in a guide its rules need to move to the new id.
Courses that look wrong or unverified show a yellow **Needs review** badge with the reason.

## Keeping it honest
This is a planning aid, not the student information system. It never says a student *will* graduate; counselor review is
still required. Nothing is invented: if a guide leaves something blank, the site says it is not listed.

## Files
- `index.html`, `styles.css`, `app.js` – the site
- `guides-parser.js` – reads a guide's Markdown tables
- `guides-builder.js` – builds courses (requirements, prerequisites, pathways, certifications)
- `data/guides.json` – list of guide files, school year
- `data/rules.json`, `data/diploma-base-rules.json`, `data/icc-rules.json`, `data/cov.json` – rules and official lists
- `tools/` – maintenance scripts used by Claude (not needed to run the site); `tools/legacy-2026-27/` is the previous year's data, kept for reference

## Checking a new guide set (optional)
`node tools/build-report.js` prints anything that could not be read, prerequisites kept as text only, courses missing
Indiana College Core placement, and certifications not found on the Credentials of Value list.
