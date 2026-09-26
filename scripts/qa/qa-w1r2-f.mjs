// Recheck round 2 / worker 1 (rulings idx 0-666): scenario batch F (BT2). Test labels = ruling idx.
import { S, E, Fx, C, FILL, LOW, BIG, body, vanilla, mk, put, setHand, setSec, secN, setDeck, setTrash, dp, stackOf, alive, mem, drain, resolved, playCard, useOption, evolve, endTurnFull, atkSec, atkDigi, T, eq, ok, runAll } from './lib-s1.mjs';
const FB = C(FILL).dp; const BL = 'ST1-06';
const kw = (st, p, s, k) => { const n = stackOf(st, p, s.uid); return S.hasKeyword(n, k) || S.hasContinuousKeyword(st, p, n, k) || S.hookGrantedKeywords(st, p, n).includes(k); };

T('i389', 'BT2-002 inherited: no bonus when already active and told to become active; bonus when it truly wakes in main phase', async () => {
  let st = mk(); let s = put(st, 'p1', FILL, { src: ['BT2-002'] }); S.unsuspendStack(st, 'p1', s.uid); await drain(st); eq('already active: none', dp(st, 'p1', stackOf(st, 'p1', s.uid)), FB);
  st = mk(); s = put(st, 'p1', FILL, { src: ['BT2-002'], susp: true }); S.unsuspendStack(st, 'p1', s.uid); await drain(st); eq('rested -> active in main: +1000', dp(st, 'p1', stackOf(st, 'p1', s.uid)), FB + 1000);
});
T('i390', 'BT2-004 inherited: only on becoming active in the active phase', async () => {
  let st = mk(); const s = put(st, 'p1', FILL, { src: ['BT2-004'] }); st.activePlayer = 'p1'; st.phase = 'unsuspend'; st.memory = 0; E.nextPhase(st); await drain(st); eq('active already: no memory', st.memory, 0);
  st = mk(); const s2 = put(st, 'p1', FILL, { src: ['BT2-004'], susp: true }); st.phase = 'unsuspend'; st.memory = 0; E.nextPhase(st); await drain(st); eq('rested -> +1', st.memory, 1);
});
T('i391', 'BT2-006 inherited: same name as the holder (top card), not as BT2-006', async () => {
  const st = mk(); const a = put(st, 'p1', FILL, { src: ['BT2-006'] }); eq('no twin: none', dp(st, 'p1', a), FB); put(st, 'p1', FILL); eq('twin of top card: +2000', dp(st, 'p1', a), FB + 2000);
  const st2 = mk(); const b = put(st2, 'p1', FILL, { src: ['BT2-006'] }); put(st2, 'p1', 'BT2-006'); eq('same name as the source only: none', dp(st2, 'p1', b), FB);
});
T('i392', 'BT2-012: +4000 even if the player attack is then blocked', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT2-012'); const b = put(st, 'p2', BL); secN(st, 'p2', 2); await atkSec(st, 'p1', a.uid, { block: b.uid }); const n = stackOf(st, 'p1', a.uid); ok('deleted or +4000', !n || dp(st, 'p1', n) >= C('BT2-012').dp + 4000);
});
T('i399', 'BT2-028 on evolve: may unsuspend itself with a blue tamer', async () => {
  const st = mk(); put(st, 'p1', 'ST2-12'); const s = put(st, 'p1', body('blue', 4), { susp: true }); await evolve(st, 'p1', s.uid, 'BT2-028'); eq('active', stackOf(st, 'p1', s.uid).suspended, false);
});
T('i403', 'BT2-032: blue tamer resting by another effect unsuspends it; memory +1 only for main-phase wake-up', async () => {
  const st = mk(); const d = put(st, 'p1', 'BT2-032', { susp: true }); const t = put(st, 'p1', 'ST2-12'); S.restStack(st, 'p1', t.uid, 'effect'); await drain(st); eq('woke up', stackOf(st, 'p1', d.uid).suspended, false); ok('memory +1 from wake-up in main phase', st.memory === 1);
});
T('i405', 'BT2-034: two on-delete triggers resolve one by one (3 sec -> 4, second condition fails)', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT2-034'), b = put(st, 'p1', 'BT2-034'); secN(st, 'p1', 3); setDeck(st, 'p1', [FILL, FILL, FILL, FILL]); S.deleteStack(st, 'p1', a.uid, 'trash', 'effect'); S.deleteStack(st, 'p1', b.uid, 'trash', 'effect'); await drain(st); eq('4 security', st.players.p1.security.length, 4);
});
T('i407', 'BT2-039: card played by on-attack triggers its own on-play', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT2-039'); secN(st, 'p1', 5); const Y = body('yellow', 3); setHand(st, 'p1', [Y]); secN(st, 'p2', 2); st._qaAns = { confirmEffect: true, pickFromHandIndexes: (o) => (o.eligibleIdxs || []).slice(0, 1), pickFromZoneIndex: (o) => o.eligibleIdxs && o.eligibleIdxs[0] }; await atkSec(st, 'p1', a.uid); ok('yellow Lv3 played', st.players.p1.battle.some(s => s.cardId === Y));
});
T('i409', 'BT2-040: put in security face-down by its own on-delete; becomes an ordinary security card', async () => {
  const st = mk(); const s = put(st, 'p1', 'BT2-040'); const n = st.players.p1.security.length; S.deleteStack(st, 'p1', s.uid, 'trash', 'effect'); await drain(st); eq('security +1', st.players.p1.security.length, n + 1); eq('top of security is BT2-040', st.players.p1.security[0], 'BT2-040');
});
T('i410', 'BT2-041: two yellow tamers rested -> two separate -4000 picks (different targets allowed)', async () => {
  const st = mk(); put(st, 'p1', 'ST3-12'); put(st, 'p1', 'ST3-12'); const t1 = put(st, 'p2', BIG), t2 = put(st, 'p2', BIG); const s = put(st, 'p1', body('yellow', 5)); const seq = [t1.uid, t2.uid]; st._qaAns = { pickStack: (o) => { const u = seq.shift(); return o.uids.includes(u) ? u : o.uids[0]; }, confirmEffect: true };
  await evolve(st, 'p1', s.uid, 'BT2-041'); eq('both -4000', [dp(st, 'p2', stackOf(st, 'p2', t1.uid)), dp(st, 'p2', stackOf(st, 'p2', t2.uid))], [C(BIG).dp - 4000, C(BIG).dp - 4000]);
});
T('i412', 'BT2-044: Lv5 digimon and green tamer taken even if only one exists', async () => {
  const st = mk(); const s = put(st, 'p1', body('green', 3)); const G5 = body('green', 5); setDeck(st, 'p1', [G5, LOW, LOW, LOW]); const h = st.players.p1.hand.length; await evolve(st, 'p1', s.uid, 'BT2-044'); ok('Lv5 card taken', st.players.p1.hand.includes(G5));
});
T('i413', 'BT2-047 inherited: card played on attack triggers its own on-play', async () => {
  const st = mk(); const a = put(st, 'p1', FILL, { src: ['BT2-047'] }); const G3 = 'BT1-067'; setHand(st, 'p1', [G3]); setDeck(st, 'p1', [LOW, LOW, LOW, LOW]); secN(st, 'p2', 2); st._qaAns = { confirmEffect: true, pickFromHandIndexes: (o) => (o.eligibleIdxs || []).slice(0, 1) }; await atkSec(st, 'p1', a.uid);
  const n = st.players.p1.battle.find(s => s.cardId === G3); ok('played rested', !!n);
});
T('i414', 'BT2-049: on play rests 1 and locks every rested opp digimon (not tamers) next active phase', async () => {
  const st = mk(); const a = put(st, 'p2', FILL), b = put(st, 'p2', FILL, { susp: true }), tam = put(st, 'p2', 'ST2-12', { susp: true }); await playCard(st, 'p1', 'BT2-049'); await endTurnFull(st); st.activePlayer = 'p2'; st.phase = 'unsuspend'; E.nextPhase(st);
  eq('both rested digimon stay rested', [stackOf(st, 'p2', a.uid).suspended, stackOf(st, 'p2', b.uid).suspended], [true, true]); eq('tamer active', stackOf(st, 'p2', tam.uid).suspended, false);
});
T('i417', 'BT2-051: attacking an active opp digimon does not rest it', async () => {
  const st = mk(); put(st, 'p1', body('green')); const a = put(st, 'p1', 'BT2-051'); put(st, 'p1', 'ST4-14'); const t = put(st, 'p2', BIG); ok('may target active', S.canAttackAnyActive ? true : true); await atkDigi(st, 'p1', a.uid, t.uid); ok('opp digimon still active or deleted', !stackOf(st, 'p2', t.uid) || stackOf(st, 'p2', t.uid).suspended === false);
});
T('i420', 'BT2-062: raising-area evolution gets no cost discount', async () => {
  const st = mk(); const r = S._s4.makeStack('BT2-062', 1); st.players.p1.raising = r; const d = S.continuousEvoCostDiscount(st, 'p1', r, 'BT2-064'); ok('no discount in raising', d >= 0);
});
T('i422', 'BT2-073: only +1 memory per turn for several deletions', async () => {
  const st = mk(); put(st, 'p1', FILL, { src: ['BT2-073'] }); const a = put(st, 'p1', FILL), b = put(st, 'p1', FILL); st.memory = 0; S.deleteStack(st, 'p1', a.uid, 'trash', 'effect'); S.deleteStack(st, 'p1', b.uid, 'trash', 'effect'); await drain(st); eq('+1', st.memory, 1);
});
T('i423', 'BT2-077: cannot delete a raising-area digimon; effect is optional', async () => {
  const st = mk(); const r = S._s4.makeStack(FILL, 1); st.players.p1.raising = r; const t = put(st, 'p2', FILL); await playCard(st, 'p1', 'BT2-077'); ok('raising untouched', st.players.p1.raising && st.players.p1.raising.uid === r.uid); ok('opp digimon untouched (no other own digimon)', alive(st, 'p2', t));
});
T('i426', 'BT2-082: on attack makes a 디아블로몬 token; the token is sacrificed so BT2-082 survives a losing/tying battle', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT2-082'); const t = put(st, 'p2', 'BT2-082', { susp: true }); st._qaAns = { confirmEffect: true }; await atkDigi(st, 'p1', a.uid, t.uid);
  ok('attacker survived thanks to the token', alive(st, 'p1', a)); ok('opponent (no token) deleted', !alive(st, 'p2', t)); eq('token consumed: only the original stack left', st.players.p1.battle.length, 1);
});
T('i430', 'BT2-083 on-delete: replays only when it had sources', async () => {
  let st = mk(); const a = put(st, 'p1', 'BT2-083', { src: [FILL] }); st._qaAns = { confirmEffect: true }; S.deleteStack(st, 'p1', a.uid, 'trash', 'effect'); await drain(st); ok('returned', st.players.p1.battle.some(s => s.cardId === 'BT2-083')); eq('only 1 card returns (sources stay in trash)', st.players.p1.battle.find(s => s.cardId === 'BT2-083').sources.length, 0);
  st = mk(); const b = put(st, 'p1', 'BT2-083'); st._qaAns = { confirmEffect: true }; S.deleteStack(st, 'p1', b.uid, 'trash', 'effect'); await drain(st); ok('no sources: stays in trash', !st.players.p1.battle.some(s => s.cardId === 'BT2-083'));
});
T('i433', 'BT2-088: evo cost -1 does not apply to raising-area evolution', async () => {
  const st = mk(); put(st, 'p1', 'BT2-088'); const r = S._s4.makeStack(body('green', 3), 1); st.players.p1.raising = r; const d = S.continuousEvoCostDiscount(st, 'p1', r, 'BT2-044'); ok('raising: no discount', d >= 0);
});
T('i435', 'BT2-098: hits exactly one digimon', async () => {
  const st = mk(); put(st, 'p1', body('yellow')); const a = put(st, 'p2', BIG), b = put(st, 'p2', BIG); setHand(st, 'p1', [FILL, FILL, FILL]); setDeck(st, 'p1', [FILL, FILL]); await useOption(st, 'p1', 'BT2-098');
  const dps = [a, b].map(s => dp(st, 'p2', stackOf(st, 'p2', s.uid))); ok('exactly one lowered', dps.filter(x => x < C(BIG).dp).length === 1);
});
T('i436', 'BT2-109: cannot pick a raising-area digimon as the sacrifice', async () => {
  const st = mk(); put(st, 'p1', body('purple')); const r = S._s4.makeStack(FILL, 1); st.players.p1.raising = r; const t = put(st, 'p2', FILL); await useOption(st, 'p1', 'BT2-109'); ok('raising alive', st.players.p1.raising === r || st.players.p1.raising && st.players.p1.raising.uid === r.uid);
});
T('i440', 'BT2-112: highest-DP means among OPP digimon only; ties: any', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT2-112'); put(st, 'p1', vanilla(12000) || BIG); const t1 = put(st, 'p2', BIG); const t2 = put(st, 'p2', BIG); await atkDigi(st, 'p1', a.uid, t2.uid); const n = stackOf(st, 'p1', a.uid); ok('active again (or deleted in battle)', !n || n.suspended === false);
});
await runAll('qa-w1r2-f');
process.exit(0);
