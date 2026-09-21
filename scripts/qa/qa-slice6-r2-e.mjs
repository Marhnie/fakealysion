// Slice-6 round 2, part E: linking onto the breeding-area digimon (G68,G70), cards under a tamer go to the bottom (G47).
// Run: node scripts/qa/qa-slice6-r2-e.mjs [G#...] < /dev/null
import { S, E, Fx, C, plain, plainTamer, W, scenario, run } from './lib-s6.mjs';
const all = Object.values(S.CARDS);
const tsEgg = all.find((c) => c.category === 'digitama' && (c.types || []).includes('TS'));
const vulc = all.find((c) => c.category === 'digimon' && c.nameKo === '불카누스몬');
const pickRaising = (w) => { w.answers.pickStack = (o) => { const r = w.pl('p1').raising && w.pl('p1').raising.uid; return o.uids.includes(r) ? r : o.uids[0]; }; };
// ---- G68: 【메인】 link effect may pick the breeding-area digimon as host ----
for (const [id, host] of [['BT25-093', 'P-196'], ['BT25-100', 'P-196'], ['BT25-101', vulc && vulc.id]]) {
  scenario('G68', `${id}: 【메인】 link onto the breeding-area digimon`, async () => {
    const w = W({ p1: { battle: ['P-196'], raising: { id: host }, hand: [id, 'P-196'] }, p2: { battle: [plain(4, 1)] }, memory: 10 });
    pickRaising(w); await w.useOption('p1', id);
    w.eq(w.pl('p1').raising.linkCards.length, 1, 'linked to the raising-area digimon');
    return w;
  });
}
// ---- G70: also a digimon without DP (Lv.2 in the breeding area) can be linked; it does not gain DP from the link ----
scenario('G70', 'BT25-093: link onto a DP-less Lv.2 breeding digimon; no DP gained', async () => {
  const w = W({ p1: { battle: ['P-196'], raising: { id: tsEgg.id }, hand: ['BT25-093'] }, p2: { battle: [plain(4, 1)] }, memory: 10 });
  pickRaising(w); await w.useOption('p1', 'BT25-093');
  w.eq(w.pl('p1').raising.linkCards.length, 1, 'linked');
  w.ok(!w.dp('p1', w.pl('p1').raising), 'still no DP');
  return w;
});
// ---- G47: cards put under a tamer that already has cards go to the very bottom (newest lowest) ----
for (const [id, tag] of [['BT25-087', '서로의 턴'], ['BT25-088', '서로의 턴'], ['BT25-090', '서로의 턴']]) {
  scenario('G47', `${id}: 2 deck cards go under the tamer's existing stack at the bottom`, async () => {
    const w = W({ p1: { battle: [{ id, src: ['ST1-02'] }] }, p2: {} });
    w.pl('p1').deck = ['ST1-03', 'ST1-04', 'ST1-05', 'ST1-06'];
    const t = w.p1.stacks[0]; await w.run('p1', t.uid, tag);
    w.eq(t.sources, ['ST1-04', 'ST1-03', 'ST1-02'], 'old source stays on top, new ones below (sources[0] = bottom)');
    return w;
  });
}
await run('slice6-r2-e');
