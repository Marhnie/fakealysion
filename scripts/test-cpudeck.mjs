// Tests for src/cpudeck.js:  node scripts/test-cpudeck.mjs < /dev/null
//  * every shipped deck in data/cpu-decks.json is legal (S.deckLegality), passes the checkup (no error-level finding), has 3..5 digitama, only card ids + counts
//  * the generator produces legal, checkup-clean decks over 300 random seeds (proper Lv curve / evolution lines / colour rule)
//  * runtime API: loadCpuDecks / pickCpuDeck / buildDeckFromCollection (pool restriction by sets and by an owned collection)
import * as fs from 'fs';
import * as S from '../src/state.js';
import * as E from '../src/engine.js';
import * as D from '../src/cpudeck.js';
import { makeEnv, deckCheckup } from '../src/decktools.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(String(url).replace(/^\.\//, ''), 'utf8')) });
await S.loadData();
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } };
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const env = makeEnv(S, E);
const errorsOf = (d) => [...S.deckLegality(d).errors, ...deckCheckup(d, env).filter((f) => f.level === 'error').map((f) => f.code + ':' + f.title)];

// ---- shipped decks
const decks = await D.loadCpuDecks('./data/cpu-decks.json');
ok(Array.isArray(decks) && decks.length > 0, 'data/cpu-decks.json has decks');
const raw = JSON.parse(fs.readFileSync('./data/cpu-decks.json', 'utf8'));
for (const d of decks) {
  const e = errorsOf(d); ok(e.length === 0, `${d.name}: ${e.join('; ')}`);
  ok(sum(d.main) === 50, `${d.name}: main ${sum(d.main)}`); ok(sum(d.digitama) >= 3 && sum(d.digitama) <= 5, `${d.name}: digitama ${sum(d.digitama)}`);
  ok(d.colors.length >= 1 && d.colors.length <= 2, `${d.name}: colours ${d.colors}`);
  ok(typeof d.winrate === 'number' && d.games > 0 && Number.isInteger(d.generation), `${d.name}: meta`);
  ok(Object.keys(d).every((k) => ['name', 'colors', 'main', 'digitama', 'winrate', 'games', 'generation', 'source'].includes(k)), `${d.name}: unexpected keys ${Object.keys(d)}`);
  for (const id of Object.keys({ ...d.main, ...d.digitama })) ok(!!S.CARDS[id] && !(raw.avoid || []).includes(id), `${d.name}: card ${id} unknown or manual-fallback`);
}
console.log(`shipped decks: ${decks.length}, colour sets: ${new Set(decks.map((d) => d.colors.join('+'))).size}`);

// ---- generator over 300 seeds
let made = 0; const agg = { 3: 0, 4: 0, 5: 0, 6: 0, t: 0, o: 0, e: 0 }; const bad = {};
for (let seed = 1; seed <= 300; seed++) {
  const rng = D.mulberry32(seed * 7919);
  const g = D.genGenome(rng); ok(!!g, `seed ${seed}: genome`); if (!g) continue;
  const d = D.compile(g, rng); ok(!!d, `seed ${seed}: compile`); if (!d) continue;
  made++;
  const e = errorsOf(d); if (e.length) { ok(false, `seed ${seed}: ${e.join('; ')}`); }
  ok(sum(d.main) === 50 && sum(d.digitama) >= 3 && sum(d.digitama) <= 5, `seed ${seed}: sizes`);
  ok(d.colors.length >= 1 && d.colors.length <= 2, `seed ${seed}: colours ${d.colors}`);
  for (const [id, n] of Object.entries(d.main)) { const c = S.card(id); ok(!D.getAvoid().has(id), `seed ${seed}: avoid ${id}`); if (c.category === 'digimon') agg[c.level] += n; else if (c.category === 'tamer') agg.t += n; else agg.o += n; }
  agg.e += sum(d.digitama);
  const g2 = D.mutate(g, rng); const dm = D.compile(g2, rng); if (dm) { const em = errorsOf(dm); ok(em.length === 0, `seed ${seed} (mutant): ${em.join('; ')}`); }
}
for (const k of Object.keys(agg)) agg[k] = +(agg[k] / Math.max(1, made)).toFixed(2);
console.log('generated', made, 'decks; mean composition', JSON.stringify(agg));
ok(agg[3] >= 9 && agg[3] <= 18 && agg[4] >= 8 && agg[5] >= 4 && agg[5] <= 12 && agg[6] >= 1.5 && agg[6] <= 5, 'Lv curve in range');

// ---- runtime API
const st = D.pickCpuDeck({ rng: D.mulberry32(3) }); ok(st && errorsOf(st).length === 0, 'pickCpuDeck strong');
const red = D.pickCpuDeck({ colors: ['red'], rng: D.mulberry32(4) }); ok(red && red.colors.every((c) => c === 'red') || !decks.some((d) => d.colors.every((c) => c === 'red')), 'pickCpuDeck colour filter');
for (const style of ['random', 'aggro', 'control', 'midrange', 'ramp']) ok(!!D.pickCpuDeck({ style, rng: D.mulberry32(5) }), 'style ' + style);
const bs = D.buildDeckFromCollection({ sets: ['ST1', 'ST2', 'BT1', 'BT2', 'BT3'], rng: D.mulberry32(9), forceGenerate: true });
ok(bs.ok && bs.deck && errorsOf(bs.deck).length === 0, 'buildDeckFromCollection(sets): ' + JSON.stringify(bs.errors || bs.reason));
if (bs.deck) for (const id of Object.keys({ ...bs.deck.main, ...bs.deck.digitama })) ok(['ST1', 'ST2', 'BT1', 'BT2', 'BT3'].includes(id.split('-')[0]), 'set restriction violated: ' + id);
const owned = {}; for (const c of Object.values(S.CARDS)) if (/^(BT4|EX1|ST5)-/.test(c.id) && !c.isParallel) owned[c.id] = 2;
const bo = D.buildDeckFromCollection({ owned, rng: D.mulberry32(10) });
ok(bo.ok && bo.deck && errorsOf(bo.deck).length === 0, 'buildDeckFromCollection(owned): ' + JSON.stringify(bo.errors || bo.reason));
if (bo.deck) for (const [id, n] of Object.entries({ ...bo.deck.main, ...bo.deck.digitama })) ok(n <= (owned[id] || 0), 'owned copies violated ' + id);
const none = D.buildDeckFromCollection({ owned: { 'BT1-010': 4 }, rng: D.mulberry32(1) }); ok(none.ok === false, 'impossible pool is reported');
const mono = D.buildDeckFromCollection({ colors: ['green'], rng: D.mulberry32(11) }); ok(mono.ok && mono.deck.colors.every((c) => c === 'green'), 'colour-restricted build');

console.log(fail ? `FAILED (${fail})` : 'ALL OK');
process.exit(fail ? 1 : 0);
