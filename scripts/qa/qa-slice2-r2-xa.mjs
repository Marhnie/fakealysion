// slice2 round 2 (part xa): "source named 「A」 or 「X항체」" conditions -- a card that merely has the X-antibody TRAIT does not satisfy them
// (official Q&A: name is specified). Each card is exercised with (a) trait-only source (no effect), (b) source literally named 「X항체」 (effect),
// (c) source with the digimon's own name (effect).
import { runScenarios, FILL, S, C, fillOf, byName, XA_TRAIT, XA_NAME } from './lib-r2.mjs';
const L = [];
const RED3 = 'ST1-02', RED4 = 'ST1-05';
const nm = (n) => byName(n, c => c.category === 'digimon' && !(c.types || []).includes('X항체'));
const add = (q, card, base, own, setup, obs, opts = {}) => {
  for (const [tag, src, want] of [['trait-only', XA_TRAIT, false], ['named X항체', XA_NAME, true], ['own name', own, true]]) {
    if (!src) continue;
    L.push({ q, card, name: `${tag} source -> effect ${want ? 'applies' : 'does not apply'}`, run: async (W) => { W.s = W.put('p1', [base, src]); setup(W); await W.evolve('p1', W.s.uid, card, 0); }, expect: (W) => [[`effect ${want ? 'applied' : 'not applied'}`, !!obs(W) === want]], allowErrors: true, ...opts });
  }
};
// BT9-014: after the two -1 memory marks, destroys opposing digimon with total DP <= 6000
add(1807, 'BT9-014', RED4, nm('메가로그라우몬'), (W) => { W.o = W.put('p2', RED3); }, (W) => !W.alive('p2', W.o));
// BT9-028: bounce a Lv4-or-lower opposing digimon
add(1827, 'BT9-028', RED4, nm('워가루몬'), (W) => { W.o = W.put('p2', RED3); }, (W) => !W.alive('p2', W.o) && W.pl('p2').hand.includes(RED3));
// BT9-040: security <=5 -> recovery +1
add(1834, 'BT9-040', RED4, nm('엔젤우몬'), (W) => { W.sec('p1', FILL.slice(20, 24)); W.n0 = 4; }, (W) => W.pl('p1').security.length === 5);
// BT9-043: -1000 DP per own security to all opposing digimon
add(1836, 'BT9-043', RED4, nm('홀리드라몬'), (W) => { W.o = W.put('p2', RED4); W.dp0 = W.dp('p2', W.o); }, (W) => W.dp('p2', W.o) < W.dp0);
// BT9-056 on attack: rest an opposing digimon when a source is named with 레오몬 or X항체
for (const [tag, src, want] of [['trait-only', XA_TRAIT, false], ['named X항체', XA_NAME, true], ['name has 레오몬', 'BT1-035', true]])
  L.push({ q: 1852, card: 'BT9-056', name: `attack: ${tag} source -> rest ${want}`, run: async (W) => { W.s = W.put('p1', [RED4, src]); W.o = W.put('p2', RED3); await W.evolve('p1', W.s.uid, 'BT9-056', 0); W.s.attackEligibleTurn = 0; await W.attack('p1', W.s.uid, null); }, expect: (W) => [['rest state', W.o.suspended === want]], allowErrors: true });
// BT9-055 attack end (once): needs 「그랜쿠가몬」 or X항체 to rest an opposing digimon and untap self
for (const [tag, src, want] of [['trait-only', XA_TRAIT, false], ['named X항체', XA_NAME, true]])
  L.push({ q: 1850, card: 'BT9-055', name: `attack end: ${tag} source -> rest ${want}`, run: async (W) => { W.s = W.put('p1', [RED4, src]); W.o = W.put('p2', RED3); await W.evolve('p1', W.s.uid, 'BT9-055', 0); W.o.suspended = false; W.s.attackEligibleTurn = 0; W.d0 = 1; await W.attack('p1', W.s.uid, null); }, expect: (W) => [['opp rested at attack end', (W.o.suspended === true) === want]], allowErrors: true });
// BT9-016 attack end: delete opposing digimon with DP <= this one, needs source 워그레이몬 or X항체
for (const [tag, src, want] of [['trait-only', XA_TRAIT, false], ['named X항체', XA_NAME, true]])
  L.push({ q: 1810, card: 'BT9-016', name: `attack end: ${tag} source -> delete ${want}`, run: async (W) => { W.s = W.put('p1', [RED4, src]); W.o = W.put('p2', RED3); await W.evolve('p1', W.s.uid, 'BT9-016', 0); W.s.attackEligibleTurn = 0; await W.attack('p1', W.s.uid, null); }, expect: (W) => [['opp deleted', !W.alive('p2', W.o) === want]], allowErrors: true });
await runScenarios(L, 'r2-xa');
