// Analyse the human corpus: node scripts/analyze-human-decks.mjs [corpus.json] < /dev/null  -> scratch/human/analysis.json + scratch/human/human-deck-stats.json (aggregates only)
import * as fs from 'fs';
import * as S from '../src/state.js';
import * as D from '../src/cpudeck.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(String(url).replace(/^\.\//, ''), 'utf8')) });
await S.loadData();
const arg = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'scratch/human/human-decks.json';
const corpus = JSON.parse(fs.readFileSync(arg, 'utf8')).decks;
const cpuFile = process.env.CPU_DECKS || 'data/cpu-decks.json';
const cpu = JSON.parse(fs.readFileSync(cpuFile, 'utf8')); const avoid = new Set(cpu.avoid || []);
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const feat = (d) => {
  const f = { lv: { 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 }, tam: 0, opt: 0, egg: sum(d.digitama), dig: 0, cols: D.deckColors(d), avoid: Object.keys(d.main).some((i) => avoid.has(i)) };
  for (const [id, n] of Object.entries(d.main)) { const c = S.card(id); if (c.category === 'digimon') { f.dig += n; f.lv[c.level] = (f.lv[c.level] || 0) + n; } else if (c.category === 'tamer') f.tam += n; else f.opt += n; }
  const w = {}; for (const [id, n] of Object.entries({ ...d.main, ...d.digitama })) { const c = S.card(id); if (c.category === 'option') continue; for (const x of c.colors || []) w[x] = (w[x] || 0) + n / (c.colors.length); }
  f.dom = Object.entries(w).sort((a, b) => b[1] - a[1]).slice(0, 2).map((x) => x[0]).sort((a, b) => D.COLORS.indexOf(a) - D.COLORS.indexOf(b)); f.pair = f.dom.join('+'); f.nCols = f.cols.length; return f;
};
const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
function summarize(decks) {
  const F = decks.map((d) => ({ d, f: feat(d) }));
  const o = { n: F.length, lv3: mean(F.map((x) => x.f.lv[3])), lv4: mean(F.map((x) => x.f.lv[4])), lv5: mean(F.map((x) => x.f.lv[5])), lv6: mean(F.map((x) => x.f.lv[6])), lv7: mean(F.map((x) => x.f.lv[7])), tam: mean(F.map((x) => x.f.tam)), opt: mean(F.map((x) => x.f.opt)), egg: mean(F.map((x) => x.f.egg)), avoidRate: mean(F.map((x) => +x.f.avoid)) };
  return { o, F };
}
const human = summarize(corpus);
const cpuDecks = summarize(cpu.decks);
const pairs = {}; for (const { f } of human.F) pairs[f.pair] = (pairs[f.pair] || 0) + 1;
const cpuPairs = {}; for (const { f } of cpuDecks.F) cpuPairs[f.pair] = (cpuPairs[f.pair] || 0) + 1;
const nColsDist = {}; for (const { f } of human.F) nColsDist[f.nCols] = (nColsDist[f.nCols] || 0) + 1;
const colorCnt = {}; for (const { f } of human.F) for (const c of f.cols) colorCnt[c] = (colorCnt[c] || 0) + 1;
const staples = {}; const cardStat = {};
for (const { d } of human.F) for (const [id, n] of Object.entries({ ...d.main, ...d.digitama })) { const s = (cardStat[id] = cardStat[id] || { decks: 0, copies: 0 }); s.decks++; s.copies += n; }
const N = human.F.length;
const top = Object.entries(cardStat).map(([id, s]) => ({ id, name: S.card(id).nameKo || S.card(id).name, cat: S.card(id).category, lv: S.card(id).level, cols: S.card(id).colors, rate: s.decks / N, avg: s.copies / s.decks })).sort((a, b) => b.rate - a.rate);
for (const c of ['red', 'blue', 'yellow', 'green', 'black', 'purple', 'white']) {
  const sub = human.F.filter((x) => x.f.cols.includes(c)); if (sub.length < 8) continue;
  const cs = {}; for (const { d } of sub) for (const [id, n] of Object.entries({ ...d.main, ...d.digitama })) { const s = (cs[id] = cs[id] || { d: 0, c: 0 }); s.d++; s.c += n; }
  staples[c] = { decks: sub.length, top: Object.entries(cs).map(([id, s]) => ({ id, name: S.card(id).nameKo, cat: S.card(id).category, rate: +(s.d / sub.length).toFixed(3), avg: +(s.c / s.d).toFixed(2) })).sort((a, b) => b.rate - a.rate).slice(0, 12) };
}
const supportTop = top.filter((c) => c.cat === 'tamer' || c.cat === 'option').slice(0, 20);
// clustering: Jaccard on (main+digitama) sets, k-medoids
const sets = human.F.map((x) => new Set(Object.keys({ ...x.d.main, ...x.d.digitama })));
const jac = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i); };
const K = Math.min(30, Math.max(6, Math.round(Math.sqrt(N / 2))));
const dist = (i, j) => 1 - jac(sets[i], sets[j]);
let rs = 12345; const rnd = () => { rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0; return rs / 4294967296; };
let med = [Math.floor(rnd() * N)];
while (med.length < K) { let bi = -1, bd = -1; for (let i = 0; i < N; i++) { const dm = Math.min(...med.map((m) => dist(i, m))); if (dm > bd) { bd = dm; bi = i; } } med.push(bi); }
const assign = new Array(N).fill(0);
for (let it = 0; it < 12; it++) {
  for (let i = 0; i < N; i++) { let b = 0, bd = 9; med.forEach((m, k) => { const dd = dist(i, m); if (dd < bd) { bd = dd; b = k; } }); assign[i] = b; }
  let changed = false;
  med = med.map((m, k) => { const mem = []; for (let i = 0; i < N; i++) if (assign[i] === k) mem.push(i); if (!mem.length) return m; let bi = m, bs = Infinity; for (const c of mem) { let s = 0; for (const o of mem) s += dist(c, o); if (s < bs) { bs = s; bi = c; } } if (bi !== m) changed = true; return bi; });
  if (!changed) break;
}
const clusters = med.map((m, k) => {
  const mem = []; for (let i = 0; i < N; i++) if (assign[i] === k) mem.push(i); if (!mem.length) return null;
  const cs = {}; for (const i of mem) for (const id of sets[i]) cs[id] = (cs[id] || 0) + 1;
  const core = Object.entries(cs).filter(([id, c]) => c / mem.length >= 0.7 && S.card(id).category === 'digimon').sort((a, b) => S.card(b[0]).level - S.card(a[0]).level).map(([id]) => S.card(id).nameKo + '(' + id + ')');
  const sm = summarize(mem.map((i) => human.F[i].d)).o; const cols = {}; mem.forEach((i) => { cols[human.F[i].f.pair] = (cols[human.F[i].f.pair] || 0) + 1; });
  const place = mem.map((i) => human.F[i].d.place).filter((x) => x); const meanPlace = place.length ? mean(place) : null;
  return { k, size: mem.length, share: +(mem.length / N).toFixed(3), medoid: m, colors: Object.entries(cols).sort((a, b) => b[1] - a[1])[0][0], core: core.slice(0, 6), lv3: +sm.lv3.toFixed(1), lv4: +sm.lv4.toFixed(1), lv5: +sm.lv5.toFixed(1), lv6: +sm.lv6.toFixed(1), lv7: +sm.lv7.toFixed(1), tam: +sm.tam.toFixed(1), opt: +sm.opt.toFixed(1), egg: +sm.egg.toFixed(1), meanPlace: meanPlace && +meanPlace.toFixed(1) };
}).filter(Boolean).sort((a, b) => b.size - a.size);
const r1 = (x) => +x.toFixed(2);
const roundO = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? r1(v) : v]));
const res = { corpusN: N, sources: human.F.reduce((m, x) => { m[x.d.src] = (m[x.d.src] || 0) + 1; return m; }, {}), human: roundO(human.o), cpu: roundO(cpuDecks.o), pairs: Object.entries(pairs).sort((a, b) => b[1] - a[1]), cpuPairs: Object.entries(cpuPairs).sort((a, b) => b[1] - a[1]), colorCnt, nColsDist, staples, supportTop, top30: top.slice(0, 30), clusters, medoids: clusters.map((c) => c.medoid) };
fs.writeFileSync('scratch/human/analysis.json', JSON.stringify(res, null, 1));
const cards = {}; for (const c of top) if (c.rate >= 0.02) cards[c.id] = [+c.rate.toFixed(3), +c.avg.toFixed(2)];
const stats = { version: 1, note: 'aggregates over public human tournament decklists (card numbers only): cards[id]=[inclusion rate, avg copies when included]', decks: N, curve: roundO(human.o), colorPairs: Object.fromEntries(res.pairs.slice(0, 20)), cards };
fs.writeFileSync('scratch/human/human-deck-stats.json', JSON.stringify(stats));
console.log(JSON.stringify({ N, human: res.human, cpu: res.cpu, sources: res.sources, pairs: res.pairs.slice(0, 12), cpuPairs: res.cpuPairs, nColsDist, K, statsBytes: JSON.stringify(stats).length }));
console.log(clusters.slice(0, 12).map((c) => JSON.stringify(c)).join('\n'));
