// Round 2 (slice1) part f: "open N cards, add one of A and one of B" template family + a few BT7/BT8 rulings. Q ids refer to data/rulings/slice1.json (gitignored); outcomes paraphrased.
// Run: node scripts/qa/qa-slice1-r2-f.mjs < /dev/null
import { S, E, C, FILL, LOW, BIG, body, mk, put, setHand, setSec, secN, setDeck, dp, stackOf, alive, mem, drain, resolved, playCard, useOption, evolve, endTurnFull, atkSec, atkDigi, T, eq, ok, runAll } from './lib-s1.mjs';
const all = Object.values(S.CARDS).filter(c => !c.id.includes('~') && !c.isParallel);
const f = (pred) => all.find(pred)?.id; const dig = (c) => c.category === 'digimon';
const X = {
  lv5: f(c => dig(c) && c.level === 5 && !c.effectKo && !c.inheritedKo), gtam: 'ST4-14', lv6: f(c => dig(c) && c.level === 6 && !c.effectKo && !c.inheritedKo),
  gray: f(c => dig(c) && c.nameKo.includes('그레이몬') && !c.effectKo), garu: 'ST2-06', omega: 'BT1-084', ragna: 'BT3-019', la: 'BT3-008',
  shout: f(c => dig(c) && c.nameKo.includes('샤우트몬') && !/《진격》/.test(c.effectKo || '')), pierce: 'BT5-017', hack: 'BT6-015', hack2: 'BT6-016',
  menoa: 'BT6-092', eos: 'BT6-083', tri: 'BT6-017', opt7: 'ST2-16', hyb: 'P-030', tamer: 'ST1-12', xab: 'P-070', kota: 'BT7-090', free: 'ST8-04',
  yel: 'ST3-02', pur: 'ST6-02', yang: 'ST3-05', pang: 'ST10-12', angel: 'ST3-05', bird: 'BT1-013', vortex: 'P-131', puppet: 'ST5-04',
};
const fill = Array(12).fill(FILL);
// [card, how, A, B, qPartial, qBoth]. how: play = 【등장 시】; evo:<colour> = 【진화 시】 (evolving from a Lv.4 of that colour); del = 【소멸 시】
const FAM = [
  ['BT2-044', 'evo:green', X.lv5, X.gtam, 1016, 0], ['BT3-008', 'play', X.ragna, X.la, 1048, 1050], ['BT3-062', 'play', X.ragna, X.la, 1089, 1091],
  ['BT3-051', 'play', X.lv5, X.lv6, 1085, 0], ['BT5-007', 'play', X.gray, X.omega, 1284, 0], ['BT5-020', 'play', X.garu, X.omega, 1301, 0],
  ['BT5-009', 'play', X.shout, X.pierce, 1288, 0], ['BT6-047', 'del', X.menoa, X.eos, 1433, 0], ['BT6-060', 'play', X.tri, X.opt7, 1453, 0],
  ['BT7-056', 'play', X.xab, X.kota, 1601, 0], ['BT7-081', 'play', X.hyb, X.tamer, 1645, 0],
  ['ST10-04', 'play', X.yel, X.pur, 0, 728], ['ST10-12', 'evo:purple', X.yang, 'ST6-08', 0, 745], ['ST18-04', 'play', X.bird, X.vortex, 839, 840], ['ST19-03', 'play', X.puppet, X.vortex, 853, 854],
];
const trigger = async (st, how, id) => {
  if (how === 'play') return playCard(st, 'p1', id);
  if (how === 'del') { const s = put(st, 'p1', id); S.deleteStack(st, 'p1', s.uid, 'trash', 'battle'); await drain(st); return; }
  const col = how.split(':')[1]; const m = put(st, 'p1', body(col, 4)); st.players.p1.hand.push(FILL); await evolve(st, 'p1', m.uid, id);
};
for (const [id, how, A, B, qp, qb] of FAM) {
  ok(`fixtures for ${id}`, !!A && !!B);
  if (qp) T(qp, `${id}: opening only one of the two wanted kinds still adds that card`, async () => {
    const st = mk(); setDeck(st, 'p1', [A, ...fill]); await trigger(st, how, id); ok(`${A} in hand`, st.players.p1.hand.includes(A));
    const st2 = mk(); setDeck(st2, 'p1', [B, ...fill]); await trigger(st2, how, id); ok(`${B} in hand`, st2.players.p1.hand.includes(B));
  });
  if (qb) T(qb, `${id}: when both kinds are opened, both must be added`, async () => {
    const st = mk(); setDeck(st, 'p1', [A, B, ...fill]); await trigger(st, how, id); ok('both in hand', st.players.p1.hand.includes(A) && st.players.p1.hand.includes(B));
  });
}
// Q1049/Q1090: two copies of one card that satisfies BOTH criteria are both added
for (const [q, id] of [[1049, 'BT3-008'], [1090, 'BT3-062']]) T(q, `${id}: two copies of a card matching both criteria are both added`, async () => { const st = mk(); ok('fixture matches both criteria', C(X.ragna).nameKo === '라그나로드몬' && (C(X.ragna).types || []).includes('Legend-Arms')); setDeck(st, 'p1', [X.ragna, X.ragna, ...fill]); await trigger(st, 'play', id); eq('copies in hand', st.players.p1.hand.filter(c => c === X.ragna).length, 2); });
T(1289, 'BT5-009: two copies of one name-and-keyword card are both added', async () => { const st = mk(); const both = f(c => dig(c) && c.nameKo.includes('샤우트몬') && /《진격》/.test(c.effectKo || '')); ok('exists', !!both); setDeck(st, 'p1', [both, both, ...fill]); await trigger(st, 'play', 'BT5-009'); eq('added', st.players.p1.hand.filter(c => c === both).length, 2); });
T(1405, 'BT6-009: up to two name-matching digimon, two identical copies allowed', async () => { const st = mk(); setDeck(st, 'p1', [X.hack, X.hack, ...fill]); await trigger(st, 'play', 'BT6-009'); eq('two added', st.players.p1.hand.filter(c => c === X.hack).length, 2); });
T(707, 'ST9-02: a "Free"-trait card among the opened ones must be added', async () => { const st = mk(); setDeck(st, 'p1', [X.free, ...fill]); await trigger(st, 'play', 'ST9-02'); ok('in hand', st.players.p1.hand.includes(X.free)); });
T(740, 'ST10-08: an angel-type card among the opened ones must be added', async () => { const st = mk(); setDeck(st, 'p1', [X.angel, ...fill]); await trigger(st, 'play', 'ST10-08'); ok('in hand', st.players.p1.hand.includes(X.angel)); });

// ---- BT8-010 / BT8-028 / BT8-029 / BT7-086 ----
T(1700, 'BT8-010: two yellow digimon still only give -1 to the play cost', async () => { const st = mk(); put(st, 'p1', body('yellow', 4)); put(st, 'p1', body('yellow', 4)); eq('discount', S.handSelfPlayDiscount(st, 'p1', 'BT8-010'), -1); });
T(1718, 'BT8-028: moving an opposing Lv.5+ digimon from the breeding area to battle is not a play', async () => { const st = mk({ me: 'p2' }); put(st, 'p1', 'BT8-028'); const r = S._s4.makeStack(body('red', 5), 1); r.attackEligibleTurn = 0; st.players.p2.raising = r; S.moveRaisingToBattle(st, 'p2'); await drain(st); eq('no memory', mem(st, 'p1'), 0); });
T(1719, 'BT8-029: an opposing breeding-area digimon with sources does not stop it attacking', async () => { const st = mk(); const a = put(st, 'p1', 'BT8-029'); const r = S._s4.makeStack(FILL, 1); r.sources = [FILL]; st.players.p2.raising = r; secN(st, 'p2', 2); const res = await atkSec(st, 'p1', a.uid); ok('attack declared', !res.declined); });
T(1656, 'BT7-086 source: the attack/block ban on a sourceless opposing digimon stays after it gains sources', async () => {
  const st = mk(); const a = put(st, 'p1', BIG, { src: ['BT7-086'] }); const t = put(st, 'p2', FILL); secN(st, 'p2', 3); await atkSec(st, 'p1', a.uid); await endTurnFull(st); ok('p2 turn', st.activePlayer === 'p2');
  const s = stackOf(st, 'p2', t.uid); await evolve(st, 'p2', s.uid, body('red', 4)); const s2 = stackOf(st, 'p2', t.uid); s2.attackEligibleTurn = 0; secN(st, 'p1', 2); const r = await atkSec(st, 'p2', t.uid); ok('still banned', !!r.declined);
});
const { fail } = await runAll('qa-slice1-r2-f'); process.exit(fail ? 1 : 0);
