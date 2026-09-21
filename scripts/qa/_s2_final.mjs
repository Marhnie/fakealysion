import * as fs from 'fs';
const a = JSON.parse(fs.readFileSync('data/rulings/slice2.json', 'utf8'));
const cls = JSON.parse(fs.readFileSync('scripts/qa/_s2_cls.json', 'utf8'));
const manual = Object.keys(cls).length;
const def = /どういった|どのような|固有のルール|とは、|とはどう|どういう意味|意味ですか|どういう|何ですか|何とは/;
let heur = 0;
for (const e of a) if (!cls[e.id]) { cls[e.id] = def.test(e.q) ? 'R' : 'T'; heur++; }
const out = {}; for (const e of a) out[e.id] = cls[e.id];
fs.writeFileSync('docs/qa-slice2-classification.json', JSON.stringify(out));
const cnt = (k) => Object.values(out).filter(v => v === k).length;
const res = []; for (const f of ['a', 'b', 'c']) res.push(...JSON.parse(fs.readFileSync(`scripts/qa/_s2-result-${f}.json`, 'utf8')));
const built = new Set(res.map(r => r.q)); const pass = res.filter(r => r.ok).length;
const tpl = JSON.parse(fs.readFileSync('scripts/qa/_s2-result-tpl.json', 'utf8')); const tplCards = new Set(tpl.filter(r => r.ok).map(r => r.card));
const tplRe = /どちらか片方のみ|両方ないと|1枚しかなかった場合|両方があった場合|しかなかったとき/;
let tplQ = 0; for (const e of a) { const id = e.card.split(' ')[0]; if (out[e.id] === 'T' && !built.has(e.id) && tplRe.test(e.q) && tplCards.has(id)) { tplQ++; built.add(e.id); } }
console.log(JSON.stringify({ total: a.length, T: cnt('T'), R: cnt('R'), N: cnt('N'), manualClassified: manual, heuristic: heur, scenarios: res.length, scenarioPass: pass, builtQids: built.size, viaTemplate: tplQ, tplCards: tpl.length, tplPass: tpl.filter(r => r.ok).length }));
