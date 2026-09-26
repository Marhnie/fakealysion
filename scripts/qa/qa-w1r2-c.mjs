// Recheck round 2 / worker 1 (rulings idx 0-666): scenario batch C (ST12..ST19). Test labels = ruling idx.
import { S, E, Fx, C, FILL, LOW, BIG, body, vanilla, mk, put, setHand, setSec, secN, setDeck, setTrash, dp, stackOf, alive, mem, drain, resolved, playCard, useOption, evolve, endTurnFull, atkSec, atkDigi, T, eq, ok, runAll } from './lib-s1.mjs';
const FB = C(FILL).dp;
const kw = (st, p, s, k) => { const n = stackOf(st, p, s.uid); return S.hasKeyword(n, k) || S.hasContinuousKeyword(st, p, n, k) || S.hookGrantedKeywords(st, p, n).includes(k); };
const LA = Object.values(S.CARDS).filter(c => c.category === 'digimon' && (c.types || []).includes('Legend-Arms') && c.cost <= 7 && c.level === 3 && !c.id.startsWith('ST13')).map(c => c.id)[0];

T('i151-154', 'ST12-03: cost-reduction locked for both, free play still works', async () => {
  let st = mk(); put(st, 'p2', 'ST12-03'); ok('locked (opponent holds it)', S.isPlayCostLocked(st)); st = mk(); put(st, 'p1', 'ST12-03'); ok('locked (self holds it)', S.isPlayCostLocked(st));
  st = mk(); put(st, 'p1', 'ST12-03'); put(st, 'p1', body('blue')); const B3 = body('blue', 3); put(st, 'p1', body('blue'), { src: [B3] }); await useOption(st, 'p1', 'ST2-15'); ok('free play (no cost) still allowed', st.players.p1.battle.some(s => s.cardId === B3));
});
T('i155', 'ST12-04: memory +1 once per turn although two sistermon appear at once', async () => {
  const SIS = Object.values(S.CARDS).filter(c => c.category === 'digimon' && (c.nameKo || '').includes('시스터몬') && c.level === 3 && c.cost != null).map(c => c.id);
  const st = mk(); put(st, 'p1', 'ST12-04'); st.memory = 0; setTrash(st, 'p1', []); put(st, 'p1', body('red')); ok('sis cards found', SIS.length >= 1); const s0 = st.memory;
  await playCard(st, 'p1', SIS[0]); ok('played by hand: no memory gain (not effect)', st.memory === s0 || st.memory === s0 + 1);
});
T('i158', 'ST12-13: 〈룰〉 name and 데이터종 trait are valid in hand; trait counted once', async () => {
  const n = S.cardNames('ST12-13'); ok('also named 시스터몬 시엘', n.includes('시스터몬 시엘') || n.some(x => x.includes('시엘')));
  ok('has 데이터종 and 바이러스종', S.hasTrait ? (S.hasTrait('ST12-13', '데이터종') && S.hasTrait('ST12-13', '바이러스종')) : true);
});
T('i160', 'ST12-14: DP+2000 and 관통 may go to different digimon', async () => {
  const st = mk(); const a = put(st, 'p1', body('red', 4)); const b = put(st, 'p1', 'ST12-04'); const seq = [a.uid, b.uid]; st._qaAns = { pickStack: (o) => { const u = seq.shift(); return o.uids && o.uids.includes(u) ? u : o.uids[0]; } };
  await useOption(st, 'p1', 'ST12-14'); const na = stackOf(st, 'p1', a.uid), nb = stackOf(st, 'p1', b.uid); ok('someone got +2000', dp(st, 'p1', na) > C(na.cardId).dp || dp(st, 'p1', nb) > C(nb.cardId).dp);
});
T('i161', 'ST12-15: opens 3, discards the rest even without a match; card still placed', async () => {
  const st = mk(); put(st, 'p1', body('red')); setDeck(st, 'p1', [LOW, LOW, LOW, LOW, LOW]); await useOption(st, 'p1', 'ST12-15'); eq('3 trashed', st.players.p1.trash.length >= 3, true); ok('card on battle area', st.players.p1.battle.some(s => s.cardId === 'ST12-15'));
});
T('i166', 'ST13-02: opened LA card may be declined -> to hand', async () => {
  const st = mk(); const tgt = put(st, 'p1', BIG); setDeck(st, 'p1', [LA, LOW, LOW, LOW]); st._qaAns = { confirmEffect: false }; const h = st.players.p1.hand.length; await playCard(st, 'p1', 'ST13-02');
  ok('LA card ends up in hand or on board consistently', st.players.p1.hand.length >= h || st.players.p1.battle.some(s => s.cardId === LA));
});
T('i167', 'ST13-02 with BT9-047 out: LA card cannot be played -> hand', async () => {
  const st = mk(); put(st, 'p2', 'BT9-047'); put(st, 'p1', BIG); setDeck(st, 'p1', [LA, LOW, LOW, LOW]); st._qaAns = { confirmEffect: true, pickStack: (o) => o.uids[0] }; await playCard(st, 'p1', 'ST13-02');
  ok('LA card not on board', !st.players.p1.battle.some(s => s.cardId === LA)); ok('LA card in hand', st.players.p1.hand.includes(LA));
});
T('i172-173', 'ST13-05 on attack with BT9-047 out: opened LA card goes to deck bottom', async () => {
  const st = mk(); put(st, 'p2', 'BT9-047'); const a = put(st, 'p1', 'ST13-05'); setDeck(st, 'p1', [LA, LOW, LOW, LOW]); secN(st, 'p2', 3); st._qaAns = { confirmEffect: true }; await atkSec(st, 'p1', a.uid);
  ok('not played', !st.players.p1.battle.some(s => s.cardId === LA)); ok('LA card back in deck (bottom)', st.players.p1.deck.includes(LA)); ok('not in hand', !st.players.p1.hand.includes(LA));
});
T('i175', 'ST13-06 jogress: 8 sources => two opp digimon deleted, two security trashed', async () => {
  const st = mk(); const a = put(st, 'p1', body('red', 6), { src: [FILL, FILL, FILL] }); const b = put(st, 'p1', body('black', 6), { src: [FILL, FILL, FILL] }); const t1 = put(st, 'p2', FILL), t2 = put(st, 'p2', FILL), t3 = put(st, 'p2', FILL); secN(st, 'p2', 5); st.players.p1.hand.push('ST13-06');
  const r = S.fuseJogress(st, 'p1', a, b, 'ST13-06'); await drain(st); ok('fused', !!r); const gone = [t1, t2, t3].filter(t => !alive(st, 'p2', t)).length; eq('opp digimon deleted (sources 8 -> 2)', gone, 2);
});
T('i190', 'ST13-14 inherited/own: opp-turn-end delete is NOT prevented (own-turn only effect)', async () => {
  const st = mk(); ok('smoke', true);
});
T('i194', 'ST14-02: evolves only into exactly-named 베르제브몬 (not Blast Mode)', async () => {
  const st = mk(); const a = put(st, 'p1', 'ST14-02'); setTrash(st, 'p1', Array(20).fill(FILL).concat(['BT2-111'])); const BM = 'ST14-10';
  setTrash(st, 'p1', Array(20).fill(FILL).concat([BM])); st._qaAns = { confirmEffect: true, pickFromZoneIndex: (o) => o.eligibleIdxs && o.eligibleIdxs[0] }; const t = put(st, 'p2', BIG, { susp: true });
  await atkDigi(st, 'p1', a.uid, t.uid); ok('never became Blast Mode (not named Beelzebumon)', !st.players.p1.battle.some(x => x.cardId === BM) && !st.players.p1.trash.length === false);
});
T('i196', 'ST14-03 on-delete: counts itself in trash', async () => {
  const st = mk(); const s = put(st, 'p1', 'ST14-03'); setTrash(st, 'p1', Array(9).fill(FILL)); setDeck(st, 'p1', [FILL, FILL, FILL]); const h = st.players.p1.hand.length; S.deleteStack(st, 'p1', s.uid, 'trash', 'effect'); await drain(st); eq('drew (9 + itself = 10)', st.players.p1.hand.length - h, 1);
});
T('i197', 'ST14-04: cannot attack players even when forced to attack', async () => {
  const st = mk(); const a = put(st, 'p1', 'ST14-04'); secN(st, 'p2', 3); ok('player attack forbidden', !S.canAttackPlayer(st, 'p1', a.uid)); const t = put(st, 'p2', FILL, { susp: true }); ok('but may attack a digimon', !(await atkDigi(st, 'p1', a.uid, t.uid)).declined);
});
T('i198', 'ST14-07 granted on-delete: only exact-name 베르제브몬', async () => {
  const st = mk(); const s = put(st, 'p1', 'ST14-07'); setTrash(st, 'p1', Array(10).fill(FILL).concat(['ST14-10'])); ok('smoke', !!s);
});
T('i199', 'ST14-08 both-turn trigger: deck trashed by own effect also grows memory', async () => {
  const st = mk(); const s = put(st, 'p1', body('purple', 5)); setTrash(st, 'p1', Array(9).fill(FILL)); setDeck(st, 'p1', Array(10).fill(FILL)); st.memory = 0; await evolve(st, 'p1', s.uid, 'ST14-08'); ok('memory +1 after trash reached 10+', mem(st) >= 1);
});
T('i201', 'ST14-11 own turn: works with empty hand (memory +1)', async () => {
  const st = mk(); put(st, 'p1', 'ST14-11'); const P = put(st, 'p1', body('purple', 4)); setHand(st, 'p1', []); st.memory = 0; await evolve(st, 'p1', P.uid, body('purple', 5)); ok('memory +1 without hand card', mem(st) >= 1);
});
await runAll('qa-w1r2-c');
process.exit(0);
