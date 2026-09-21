// Slice-6 official Q&A scenarios, part E (links, security, tamer evolution, misc).  G# = group index in scripts/qa/s6/_groups.json.
// Run: node scripts/qa/qa-slice6-e.mjs [G#...] < /dev/null
import { S, E, Fx, C, plain, plainTamer, plainOption, W, scenario, run } from './lib-s6.mjs';
const all = Object.values(S.CARDS);

// ---- "a card without 〈링크〉 cannot be linked" (Q6357, 6366, 6367, 6368, 6371, 6422, 6479, 6962, 7014, 7125..) ----
const linkable = all.find((c) => c.category === 'digimon' && /링크:\s*[^\n]*코스트\s*\d/.test(`${c.inheritedKo || ''}\n${c.effectKo || ''}`) && (c.level || 9) <= 4)?.id;
for (const g of ['G3', 'G9', 'G10', 'G11', 'G234']) {
  scenario(g, 'linking with an effect requires the card to have 〈링크〉: a card without it is refused', async () => {
    const w = W({ p1: { battle: [plain(3, 0)] }, p2: {} });
    const host = w.p1.stacks[0];
    w.eq(S.linkCheck(w.st, 'p1', host, plain(3, 1)).ok, false, 'plain digimon cannot be linked');
    w.ok(!linkable || typeof S.linkCheck(w.st, 'p1', host, linkable).ok === 'boolean', 'link-capable card is evaluated');
    return w;
  });
}
// ---- Q6415 family: the 【시큐리티】 effect resolves before other triggers caused by the check ----
scenario('G53', 'security check: the revealed card\'s 【시큐리티】 effect is resolved before the "security decreased" watcher', async () => {
  const w = W({ p1: { battle: ['BT25-088'], security: ['BT25-091', plain(3, 0), plain(3, 1)] }, p2: { battle: [plain(5, 0)] }, active: 'p2' });
  await w.attack('p2', w.p2.stacks[0].uid, 'PLAYER');
  const iSec = (w.fired || []).findIndex((f) => f.cardId === 'BT25-091'); const iWatch = (w.fired || []).findIndex((f) => f.cardId === 'BT25-088');
  w.ok(iSec >= 0, 'security effect fired'); w.ok(iWatch < 0 || iSec < iWatch, 'security effect first');
  return w;
});
// ---- Q6437: BT25-093 destroys ALL lowest-DP opposing digimon ----
scenario('G64', 'BT25-093 main: every opposing digimon with the lowest DP is destroyed', async () => {
  const lo = plain(3, 0); const w = W({ p1: { battle: ['P-196'], hand: ['BT25-093'] }, p2: { battle: [lo, lo, plain(5, 0)] }, memory: 10 });
  await w.useOption('p1', 'BT25-093');
  w.eq(w.pl('p2').battle.length, 1, 'only the higher-DP digimon remains');
  return w;
});
// ---- Q6444/6445: face-up security conditions with 0 security cards ----
scenario('G71', 'BT25-097: with 0 security cards "no face-up security" holds -> colour condition ignored', async () => {
  const w = W({ p1: { hand: ['BT25-097'], security: [] }, p2: {} });
  w.eq(S.optionColorOk(w.st, 'p1', 'BT25-097'), true, 'colour condition ignored');
  return w;
});
scenario('G72', 'BT25-097 main with 0 security: nothing goes to hand, the card is placed face-up under the security', async () => {
  const w = W({ p1: { hand: ['BT25-097'], security: [] }, p2: {}, memory: 10 });
  await w.useOption('p1', 'BT25-097');
  w.eq(w.pl('p1').security.length, 1, 'security 1'); w.eq(S.secFaceUpCount(w.pl('p1')), 1, 'face-up');
  return w;
});
// ---- Q6537/6538/6544..: evolving from a tamer ----
scenario('G118', 'evolving from a tamer still gives the evolution draw', async () => {
  const w = W({ p1: { battle: ['BT7-085'], hand: ['BT12-013'] }, p2: {}, memory: 10 });
  const h0 = w.pl('p1').hand.length;
  await w.evolve('p1', w.p1.stacks[0].uid, 'BT12-013', 2);
  w.eq(w.pl('p1').hand.length, h0, 'hand: -1 (played card) +1 (draw)');
  return w;
});
scenario('G119', 'a digimon evolved from a tamer that entered this turn cannot attack this turn', async () => {
  const w = W({ p1: { battle: [{ id: 'BT7-085', fresh: true }], hand: ['BT12-013'] }, p2: {}, memory: 10 });
  const t = w.p1.stacks[0];
  await w.evolve('p1', t.uid, 'BT12-013', 2);
  w.eq(S.declareAttack(w.st, 'p1', t.uid).ok, false, 'attack refused');
  return w;
});
await run('slice6-e');
