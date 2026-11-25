// Compares data/diploma-base-rules.json + rules.json seal codes with the IDOE 2026-27 eligibility memo (Jan 16 2026), transcribed below.
const b=require('../data/diploma-base-rules.json'),R=require('../data/rules.json');
const M={
'english.communications_focused':'1064 1070 1074 1076 1078 1080 1084 2188 1124 2422 7306 7307 7308 1086 1096 1104 8234 8236 4790 4086 5364 0560 0553 0554 7144 4508',
'english.additional_english':'1064 1070 1074 1076 1078 1080 1084 1086 0551 1004 1006 1008 1012 1014 1020 1022 1024 1026 1028 1030 1032 1034 1036 1038 1040 1042 1044 1046 1048 1050 1052 1054 1060 1063 1090 1092 1094 1096 1098 1104 1056 1058 1124',
'math.algebra1_required':'2520','math.personal_finance':'4540 4519 7150',
'math.additional_credits':'2532 2522 2524 2530 2550 2564 2566 2527 2546 2543 7218 4512 2595 2570 2562 2572 2563 2544',
'stem.biology1_required':'3024 3020 3032 3034',
'stem.computer_science':'4565 4568 4570 8116 8118 4584 4586 7183',
'stem.additional_science':'3026 3030 3044 3046 3108 3064 3066 3060 3084 3086 3080 3081 3087 3089 3008 3010 3012 3102 5276 3090 3092 5216 5217 5219 7323 7321 5008 5070 5072 5074 7351 7352 7178 7179 7180 7181 7182 7184 7185',
'stem.stem_focused':'4818 5518 5534 5538 5644 5650 5698 7223 7100 7222 7106 7224 7107 7219 5170 5274 7113 5132 7232 7115 7234 7238 5229 7271 7270 5180 7322 7228 7167 7165 7166 7170 7253 7281 7282 7353 7262 7243 7247 7484 4590 4592 7488 7490 7485 7249 7112 7119 7163 7164 7263 7316 7317 7341 7343 7342 7344 7376 7378',
'ss.us_history':'1542 1562 8144 8146','ss.us_government':'1540 1560',
'ss.world_perspectives':'1570 1548 1612 1502 1520 1528 1574 1590 1592',
'pe.physical_education':'3542 3544 3560','pe.health_wellness':'3506 3500','cc.preparing_for_college_careers':'5394'};
const have={};
for(const cat of Object.values(b.base_diploma_requirements)) for(const k of ['required','flexible']) (cat[k]||[]).forEach(r=>have[r.id]=r.satisfied_by_state_course_codes||[]);
let bad=0;
for(const [id,s] of Object.entries(M)){const m=new Set(s.split(' ')),h=new Set(have[id]||[]);
 const missing=[...m].filter(x=>!h.has(x)),extra=[...h].filter(x=>!m.has(x));
 if(missing.length||extra.length){bad++;console.log(id,'| in memo, not in rules:',missing.join(',')||'-','| in rules, not in memo:',extra.join(',')||'-')}}
const S={'seal.enrollment_honors_math_base':'2532 2522','seal.enrollment_honors_advanced_math':'2530 2550 2564 2566 2527 2546 2595 2570 2543 2562 2572 2563 2544','seal.enrollment_honors_chemistry_required':'3064 3066 3060','seal.enrollment_honors_physics_option':'3084 3086 3080 3081 3087 3089','seal.enrollment_honors_ss_sixth_credit':'1514 1564 1566 4558 1572 1518 1532 1534 1556 1558'};
for(const [id,s] of Object.entries(S)){const m=new Set(s.split(' ')),h=new Set(R.seal_codes[id]||[]);const missing=[...m].filter(x=>!h.has(x)),extra=[...h].filter(x=>!m.has(x));if(missing.length||extra.length){bad++;console.log(id,'| in memo, not in rules:',missing.join(',')||'-','| in rules, not in memo:',extra.join(',')||'-')}}
console.log(bad?'DIFFERENCES FOUND':'rules match memo transcription');
