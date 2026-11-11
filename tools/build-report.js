/* Node: run the same build the browser runs and print what needs attention. node tools/build-report.js */
'use strict';
const fs = require('fs'), path = require('path');
const P = require('../guides-parser.js'), B = require('../guides-builder.js');
const root = path.join(__dirname, '..');
const J = f => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const cfg = J('data/guides.json');
const parsed = cfg.departments.map(d => Object.assign({ prefix: d.prefix }, P.parseGuide(fs.readFileSync(path.join(root, 'guides', d.file), 'utf8'), d.file)));
const cov = fs.existsSync(path.join(root, 'data/cov.json')) ? J('data/cov.json') : { credentials: {} };
const res = B.build(parsed, { rules: J('data/rules.json'), base: J('data/diploma-base-rules.json'), cov });
module.exports = { res, parsed, cfg };
if (require.main === module) {
  const r = res.report;
  console.log('courses:', res.courses.length);
  Object.keys(r).forEach(k => { const v = r[k]; console.log('\n== ' + k + ' (' + v.length + ')'); v.forEach(x => console.log('  ', typeof x === 'string' ? x : JSON.stringify(x).slice(0, 300))); });
}
