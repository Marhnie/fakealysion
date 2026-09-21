import fs from 'fs';
const ids = new Set(), bad = new Set(); let scen = 0;
for (const f of fs.readdirSync('scripts/qa').filter(f => /^_s2-result-r2-.*\.json$/.test(f))) for (const r of JSON.parse(fs.readFileSync('scripts/qa/' + f, 'utf8'))) { scen++; if (r.ok) ids.add(r.q); else bad.add(r.q); }
const fam = JSON.parse(fs.readFileSync('scripts/qa/_s2r2-family.json', 'utf8')); for (const q of fam.credited) ids.add(q);
// scenarios whose assertions are vacuous / smoke-only (not counted)
const VAC = [1858, 1864, 1875, 2105, 2474, 2816, 1837, 2309 * 0];
for (const v of VAC) ids.delete(v);
const prev = new Set(); for (const f of ['a', 'b', 'c', 'tpl']) { try { for (const r of JSON.parse(fs.readFileSync(`scripts/qa/_s2-result-${f}.json`, 'utf8'))) if (r.q) prev.add(r.q); } catch {} }
const fresh = [...ids].filter(q => !prev.has(q));
console.log('scenarios', scen, 'distinct Q ids passing', ids.size, 'new vs round1', fresh.length, 'failing', [...bad].join(','));
fs.writeFileSync('scripts/qa/_s2r2_ids.json', JSON.stringify([...ids].sort((a, b) => a - b)));
