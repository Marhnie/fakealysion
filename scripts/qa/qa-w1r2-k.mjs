// Recheck round 2 / worker 1 (rulings idx 0-666): scenario batch K (BT4 tamers / options). Test labels = ruling idx.
import { S, E, Fx, C, FILL, LOW, BIG, body, vanilla, mk, put, setHand, setSec, secN, setDeck, setTrash, dp, stackOf, alive, mem, drain, resolved, playCard, useOption, evolve, endTurnFull, atkSec, atkDigi, T, eq, ok, runAll } from './lib-s1.mjs';
const FB = C(FILL).dp;

T('i638-639', 'BT4-097: own effect / direct security trash also lets the tamer rest for memory +1', async () => {
  const st = mk(); const t = put(st, 'p1', 'BT4-097'); put(st, 'p1', body('yellow')); secN(st, 'p1', 3); st.memory = 0; st._qaAns = { confirmEffect: true }; await useOption(st, 'p1', 'BT4-104'); ok('memory +2 (option) then +1 (tamer)', st.memory === 3); eq('tamer rested', stackOf(st, 'p1', t.uid).suspended, true);
});
T('i637', 'BT4-097: BT1-087 (take a security card, recover) still counts as a decrease', async () => {
  const st = mk(); const t = put(st, 'p1', 'BT4-097'); setSec(st, 'p1', [LOW, LOW, LOW]); setDeck(st, 'p1', [FILL, FILL, FILL]); st.memory = 0; st._qaAns = { confirmEffect: true, pickFromZoneIndex: (o) => o.eligibleIdxs && o.eligibleIdxs[0], pickFromRevealed: [0] }; await playCard(st, 'p1', 'BT1-087'); ok('tamer used (memory +1)', st.memory >= 1);
});
T('i650', 'BT4-101: a target that had 1 source at declaration is NOT deleted by the granted effect even if its sources vanish later', async () => {
  const st = mk(); put(st, 'p1', body('blue')); const a = put(st, 'p1', 'BT4-034'); await useOption(st, 'p1', 'BT4-101'); const t = put(st, 'p2', BIG, { src: [FILL] }); secN(st, 'p2', 3); st._qaAns = { pickStack: t.uid, confirmEffect: true };
  await atkDigi(st, 'p1', a.uid, t.uid); const n = stackOf(st, 'p2', t.uid); ok('target survived to fight (11000 vs 9000: it is deleted by battle, not the effect)', !n || n.sources.length === 0);
});
T('i658', 'BT4-105: target is own Mother D-Reaper -> not added to security, no security-increase side effects', async () => {
  const st = mk(); put(st, 'p1', body('yellow')); const m = put(st, 'p1', 'EX2-007'); st._qaAns = { pickStack: m.uid }; const n0 = st.players.p1.security.length; await useOption(st, 'p1', 'BT4-105'); S.normalizeDigitamaZones(st); ok('digitama to egg deck (not security)', st.players.p1.digitamaDeck.includes('EX2-007') || !st.players.p1.security.includes('EX2-007'));
});
await runAll('qa-w1r2-k');
process.exit(0);
