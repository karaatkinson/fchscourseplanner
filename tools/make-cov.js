/* One-time helper: turns the text of the IDOE "Credentials of Value" list into data/cov.json.
   Usage: pdftotext -layout "<CoV list>.pdf" cov.txt && node tools/make-cov.js cov.txt */
'use strict';
const fs = require('fs'), path = require('path');
const B = require('../guides-builder.js');
const lines = fs.readFileSync(process.argv[2], 'utf8').split('\n');
const out = { source: '2026-2027 Credentials of Value List (FULL COV List), IDOE / Indiana CTE', list_year: '2026-2027', credentials: {} };
let n = 0;
lines.forEach(l => {
  const m = /^(\S.*?)\s{2,}(.+?)\s{2,}(\d\.\d|N\/A)\s+(\d\.\d|N\/A)\s+([YN]|N\/A)\b/.exec(l);
  if (!m) return;
  const name = m[1].trim();
  if (/^(credential|this value|this flag)/i.test(name)) return;
  out.credentials[B.covKey(name)] = { name: name, provider: m[2].trim(), score: m[3] };
  n++;
});
fs.writeFileSync(path.join(__dirname, '..', 'data/cov.json'), JSON.stringify(out, null, 0));
console.log('credentials:', n);
