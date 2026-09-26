// Recheck round 2 / worker 1 (rulings idx 0-666): scenario batch M (BT2/BT3 leftovers). Test labels = ruling idx.
import { S, E, Fx, C, FILL, LOW, BIG, body, vanilla, mk, put, setHand, setSec, secN, setDeck, setTrash, dp, stackOf, alive, mem, drain, resolved, playCard, useOption, evolve, endTurnFull, atkSec, atkDigi, T, eq, ok, runAll } from './lib-s1.mjs';
const FB = C(FILL).dp; const BL = 'ST1-06';

T('i418', 'BT2-053 inherited: same NAME as the holder (top card), not as BT2-053', async () => {
  const st = mk(); put(st, 'p1', FILL, { src: ['BT2-053'] }); setDeck(st, 'p1', [FILL, FILL, FILL]); let h = st.players.p1.hand.length; await playCard(st, 'p1', FILL); eq('same-name digimon appears -> draw 1', st.players.p1.hand.length - h, 1);
  const st2 = mk(); put(st2, 'p1', FILL, { src: ['BT2-053'] }); setDeck(st2, 'p1', [FILL, FILL, FILL]); h = st2.players.p1.hand.length; await playCard(st2, 'p1', 'BT2-053'); eq('BT2-053 itself appearing does not count', st2.players.p1.hand.length - h, 0);
});
T('i454', 'BT3-019: the hand card goes right under BT3-019 (top of its sources)', async () => {
  const st = mk(); const s = put(st, 'p1', body('red', 6)); setHand(st, 'p1', ['ST13-05']); st._qaAns = { confirmEffect: true, pickFromHandIndexes: (o) => (o.eligibleIdxs || []).slice(0, 1) }; st.memory = 0; await evolve(st, 'p1', s.uid, 'BT3-019'); const n = stackOf(st, 'p1', s.uid); eq('top source is the placed card', n.sources[n.sources.length - 1], 'ST13-05'); eq('memory +3', mem(st), 3);
});
T('i459', 'BT3-030: optional; may target its own Lv4- source', async () => {
  const st = mk(); const B4 = body('blue', 4); const s = put(st, 'p1', body('blue', 5), { src: [B4] }); st._qaAns = { confirmEffect: true, pickFromZoneIndex: (o) => o.eligibleIdxs && o.eligibleIdxs[0] }; await evolve(st, 'p1', s.uid, 'BT3-030'); ok('source digimon played as a separate digimon', st.players.p1.battle.some(x => x.cardId === B4));
});
T('i463', 'BT3-034: a card taken from security must go to hand; unpicked => stays on top of security', async () => {
  const st = mk(); setSec(st, 'p1', ['ST1-05', LOW, LOW]); setDeck(st, 'p1', [FILL, FILL]); st._qaAns = { confirmEffect: false }; await playCard(st, 'p1', 'BT3-034'); eq('security untouched (top card same)', st.players.p1.security[0], 'ST1-05');
});
T('i465', 'BT3-034: with 0 security no draw', async () => {
  const st = mk(); secN(st, 'p1', 0); setDeck(st, 'p1', [FILL, FILL]); const h = st.players.p1.hand.length; st._qaAns = { confirmEffect: true }; await playCard(st, 'p1', 'BT3-034'); eq('hand unchanged', st.players.p1.hand.length, h);
});
T('i466', 'BT3-034: deck empty -> security card still to hand', async () => {
  const st = mk(); setSec(st, 'p1', ['ST1-05', LOW]); setDeck(st, 'p1', []); st._qaAns = { confirmEffect: true }; await playCard(st, 'p1', 'BT3-034'); ok('security card taken', st.players.p1.hand.includes('ST1-05'));
});
T('i474', 'BT3-042: DP-6000 stays even if security later rises above 3', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT3-042'); const t = put(st, 'p2', BIG); secN(st, 'p1', 3); secN(st, 'p2', 3); await atkSec(st, 'p1', a.uid); secN(st, 'p1', 6); eq('-6000 kept', dp(st, 'p2', t), C(BIG).dp - 6000);
});
T('i497', 'BT3-086: optional; declining leaves everything unchanged', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT3-086'); setHand(st, 'p1', ['BT3-092']); st.memory = 5; secN(st, 'p2', 3); st._qaAns = { confirmEffect: false }; await atkSec(st, 'p1', a.uid); eq('memory kept', st.memory, 5);
});
T('i509', 'BT3-090: playable from trash even when one/both securities are 0', async () => {
  const st = mk(); const s = put(st, 'p1', body('purple', 5)); const P4 = body('purple', 4); setTrash(st, 'p1', [P4]); secN(st, 'p1', 0); secN(st, 'p2', 3); st._qaAns = { confirmEffect: true, pickFromZoneIndex: (o) => o.eligibleIdxs && o.eligibleIdxs[0] }; await evolve(st, 'p1', s.uid, 'BT3-090'); ok('played', st.players.p1.battle.some(x => x.cardId === P4)); ok('no game over', !st.winner);
});
T('i516', 'BT3-093: takes one blue + one green digimon card', async () => {
  const st = mk(); const B = body('blue', 4), G = body('green', 4); setDeck(st, 'p1', [B, G, LOW, LOW]); await playCard(st, 'p1', 'BT3-093'); ok('both taken', st.players.p1.hand.includes(B) && st.players.p1.hand.includes(G));
});
T('i533', 'BT3-105 security: digimon that arrive later cannot attack the player either', async () => {
  const st = mk(); st.activePlayer = 'p1'; setSec(st, 'p2', ['BT3-105', LOW, LOW]); const a = put(st, 'p1', BIG); await atkSec(st, 'p1', a.uid); const n = put(st, 'p1', FILL); ok('newcomer cannot attack the player this turn', !S.canAttackPlayer(st, 'p1', n.uid));
});
await runAll('qa-w1r2-m');
process.exit(0);
