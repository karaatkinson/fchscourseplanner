// Prerequisite audit: lists courses whose guide prerequisite text names a catalog course that the planner is NOT enforcing.
// Run from the site folder:  node tools/prereq-audit.js   (expected false positives are listed in README)
const fs=require('fs');const P=require(__dirname+'/../guides-parser.js'),B=require(__dirname+'/../guides-builder.js');
const cfg=JSON.parse(fs.readFileSync(__dirname+'/../data/guides.json'));
const parsed=cfg.departments.map(d=>{const g=P.parseGuide(fs.readFileSync(__dirname+'/../guides/'+d.file,'utf8'));g.prefix=d.prefix;return g;});
const R=JSON.parse(fs.readFileSync(__dirname+'/../data/rules.json')),base=JSON.parse(fs.readFileSync(__dirname+'/../data/diploma-base-rules.json')),cov=JSON.parse(fs.readFileSync(__dirname+'/../data/cov.json'));
const out=B.build(parsed,{rules:R,base,cov});
const by=Object.fromEntries(out.courses.map(c=>[c.id,c]));
// audit: mentions of catalog course titles in prereq text vs resolved structure
const titles=out.courses.map(c=>({id:c.id,t:c.title})).sort((a,b)=>b.t.length-a.t.length);
function mentions(txt,self){const l=txt.toLowerCase();const ids=new Set();for(const x of titles){if(x.id===self||x.t.length<4)continue;const k=x.t.toLowerCase();let i=-1;while((i=l.indexOf(k,i+1))>=0){const a=l[i-1],b=l[i+k.length];if((!a||!/[a-z0-9]/.test(a))&&(!b||!/[a-z0-9]/.test(b))){ids.add(x.id);}}}return [...ids]}
function resolvedIds(c){const s=new Set();(c.prerequisites||[]).forEach(p=>{if(typeof p==='string')s.add(p);else if(p.courses)p.courses.forEach(x=>s.add(x))});return s}
const rows=[];
for(const c of out.courses){const raw=c._rec.prereq_raw||'';if(!raw||/^(none|n\/a)/i.test(raw))continue;
 // drop recommended clause
 const req=raw.split(/;?\s*Recommended:?/i)[0];
 const m=mentions(req,c.id);const r=resolvedIds(c);
 const missing=m.filter(x=>!r.has(x));
 if(missing.length)rows.push({title:c.title,status:c._prereq_status,raw:req.slice(0,140),missing:missing.map(x=>by[x].title),resolved:[...r].map(x=>by[x]?.title)});}
console.log('flagged',rows.length);rows.forEach(r=>console.log('-',r.title,'['+r.status+']','|',r.raw,'| missing:',r.missing.join(', '),'| resolved:',r.resolved.join(', ')));
