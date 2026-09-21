// Slice-6 official Q&A scenarios, part H (evolution-condition grants, digitama cost cards).  G# = group index in scripts/qa/s6/_groups.json.
// Run: node scripts/qa/qa-slice6-h.mjs [G#...] < /dev/null
import { S, E, Fx, C, plain, plainTamer, plainOption, W, scenario, run } from './lib-s6.mjs';
const methods = (w, st, tgt) => E.evolutionMethods(st.cardId, tgt, S.evoExtraArg(w.st, 'p1', st), S.evolveTargetRestriction(w.st, 'p1', st), { state: w.st, p: 'p1', stack: st });
// ---- Q6388 / Q6389: BT25-082 「evolve ignoring conditions」 works in the battle area only, not in the breeding area ----
scenario('G29', 'BT25-082 in the breeding area: no condition-ignoring evolution', async () => {
  const w = W({ p1: { raising: 'BT25-082', battle: ['BT25-092'], hand: ['ST14-09'] }, p2: {}, memory: 10 });
  w.ok(!methods(w, w.p1.raising, 'ST14-09').some((m) => m.ignoresCondition), 'no ignore-condition method');
  return w;
});
scenario('G30', 'BT25-082 in the battle area with a 3-Musketeers tamer: condition-ignoring evolution for cost 4', async () => {
  const w = W({ p1: { battle: ['BT25-082', 'BT25-092'], hand: ['ST14-09'] }, p2: {}, memory: 10 });
  const m = methods(w, w.p1.stacks[0], 'ST14-09').find((x) => x.ignoresCondition);
  w.ok(!!m, 'ignore-condition method exists'); w.eq(m && m.baseCost, 4, 'evolution cost 4');
  return w;
});
// ---- Q6980 / Q6817: a digitama card counted for a "return N trash cards" cost goes to the digitama deck and still satisfies the cost ----
scenario('G242', 'BT26-016: 3 trash cards incl. a digitama -> recover happens, digitama goes to the digitama deck', async () => {
  const w = W({ p1: { battle: ['BT26-016'], trash: ['BT24-007', plain(3, 1), plain(3, 2)], security: [plain(3, 0), plain(3, 1), plain(3, 2)] }, p2: {} });
  const dd = w.pl('p1').digitamaDeck.length; const s0 = w.pl('p1').security.length;
  w.answers.pickFromZoneIndex = () => undefined;
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  w.eq(w.pl('p1').security.length, s0 + 1, 'security +1'); w.ok(w.pl('p1').digitamaDeck.length >= dd + 1 || w.pl('p1').trash.includes('BT24-007') === false, 'digitama left the trash');
  return w;
});
scenario('G177', 'EX12-047: 2 opposing trash cards incl. a digitama satisfy the cost -> DP effects apply', async () => {
  const w = W({ p1: { battle: ['EX12-047'] }, p2: { battle: [plain(3, 0), plain(6, 0)], trash: ['BT24-007', 'BT8-012'] } });
  const b = w.p1.stacks[0]; const base = w.dp('p1', b);
  await w.run('p1', b.uid, '등장 시');
  w.ok(w.dp('p1', b) > base, 'own DP raised (+6000)');
  return w;
});
await run('slice6-h');
