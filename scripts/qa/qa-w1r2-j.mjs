// Recheck round 2 / worker 1 (rulings idx 0-666): scenario batch J (BT1 leftovers). Test labels = ruling idx.
import { S, E, Fx, C, FILL, LOW, BIG, body, vanilla, mk, put, setHand, setSec, secN, setDeck, setTrash, dp, stackOf, alive, mem, drain, resolved, playCard, useOption, evolve, endTurnFull, atkSec, atkDigi, T, eq, ok, runAll } from './lib-s1.mjs';
const FB = C(FILL).dp; const BL = 'ST1-06';

T('i282', 'BT1-022 inherited: draw when blocked (own turn), not on an unblocked attack', async () => {
  let st = mk(); const a = put(st, 'p1', FILL, { src: ['BT1-022'] }); const b = put(st, 'p2', BL); secN(st, 'p2', 2); setDeck(st, 'p1', [FILL, FILL, FILL]); let h = st.players.p1.hand.length; await atkSec(st, 'p1', a.uid, { block: b.uid }); eq('drew 1', st.players.p1.hand.length - h, 1);
  st = mk(); const a2 = put(st, 'p1', FILL, { src: ['BT1-022'] }); const t = put(st, 'p2', FILL, { susp: true }); setDeck(st, 'p1', [FILL, FILL, FILL]); h = st.players.p1.hand.length; await atkDigi(st, 'p1', a2.uid, t.uid); eq('no draw', st.players.p1.hand.length - h, 0);
});
T('i287', 'BT1-033 inherited: bonus gone the moment the last unsourced opp digimon leaves', async () => {
  const st = mk(); const a = put(st, 'p1', FILL, { src: ['BT1-033'] }); const t = put(st, 'p2', FILL); eq('with target: +1000', dp(st, 'p1', a), FB + 1000); S.deleteStack(st, 'p2', t.uid, 'trash', 'effect'); await drain(st); eq('gone', dp(st, 'p1', a), FB);
});
T('i288', 'BT1-033 inherited: raising-area unsourced digimon ignored', async () => {
  const st = mk(); const a = put(st, 'p1', FILL, { src: ['BT1-033'] }); st.players.p2.raising = S._s4.makeStack(FILL, 1); eq('none', dp(st, 'p1', a), FB);
});
T('i326', 'BT1-078: may decline evolving; opened cards go to deck bottom', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT1-078'); const G6 = body('green', 6); setDeck(st, 'p1', [G6, LOW, LOW, LOW, LOW]); secN(st, 'p2', 3); st._qaAns = { confirmEffect: false, pickFromRevealed: [] }; await atkSec(st, 'p1', a.uid); eq('still Lv5', stackOf(st, 'p1', a.uid).cardId, 'BT1-078');
  ok('G6 back in deck', st.players.p1.deck.includes(G6));
});
T('i327', 'BT1-078: evolving draws from the UNopened deck (evolution draw) and then continues', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT1-078'); const G6 = body('green', 6); setDeck(st, 'p1', [G6, 'ST1-05', 'ST2-05', 'ST2-02', 'ST3-06', 'ST3-02']); secN(st, 'p2', 3); st._qaAns = { confirmEffect: true, pickFromRevealed: (o) => (o.eligible || []).slice(0, 1).map(x => x.i) }; const h = st.players.p1.hand.length; await atkSec(st, 'p1', a.uid);
  const n = stackOf(st, 'p1', a.uid); ok('evolved', n && n.cardId === G6); eq('evo draw = 1 card from the unopened deck (4th card)', st.players.p1.hand.slice(h), ['ST2-02']); ok('opened leftovers went to the bottom', st.players.p1.deck.slice(-2).join() === 'ST1-05,ST2-05');
});
T('i329', 'BT1-078: deck of 2 opens what exists', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT1-078'); setDeck(st, 'p1', [LOW, LOW]); secN(st, 'p2', 3); st._qaAns = { confirmEffect: true, pickFromRevealed: [] }; await atkSec(st, 'p1', a.uid); ok('no crash', !(st._qaErr || []).length);
});
T('i331', 'BT1-081: memory -3 payment optional; turn passes only after attack ends', async () => {
  const st = mk(); st.memory = 1; const a = put(st, 'p1', 'BT1-081'); secN(st, 'p2', 3); st._qaAns = { confirmEffect: false }; await atkSec(st, 'p1', a.uid); eq('memory untouched', st.memory, 1);
});
T('i333', 'BT1-082: if it became rested before its trigger resolved it may still use it', async () => {
  const st = mk(); st.activePlayer = 'p2'; st.turnNumber = 4; const d = put(st, 'p1', 'BT1-082'); const t = put(st, 'p2', FILL); const a = put(st, 'p2', BIG); secN(st, 'p1', 3); st._qaAns = { confirmEffect: true, pickStack: t.uid }; d.suspended = true; await atkSec(st, 'p2', a.uid);
  eq('opp digimon (not attacker necessarily) rested by the rested Lv6', stackOf(st, 'p2', t.uid).suspended, true);
});
T('i336', 'BT1-084 on evolve: same-name digimon incl. the chosen one and different card numbers all deleted; others survive', async () => {
  const st = mk(); const m1 = put(st, 'p2', 'ST1-09'), m2 = put(st, 'p2', 'BT1-021'), m3 = put(st, 'p2', 'BT1-114'); const other = put(st, 'p2', 'BT1-022'); const s = put(st, 'p1', body('red', 6)); st._qaAns = { pickStack: m1.uid }; await evolve(st, 'p1', s.uid, 'BT1-084');
  ok('all 메탈그레이몬 deleted', !alive(st, 'p2', m1) && !alive(st, 'p2', m2) && !alive(st, 'p2', m3)); ok('differently named digimon survives', alive(st, 'p2', other));
});
T('i339', 'BT1-084 on attack: optional, returns the Lv6 source to hand', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT1-084', { src: [body('red', 6)] }); secN(st, 'p2', 3); st._qaAns = { confirmEffect: false }; await atkSec(st, 'p1', a.uid); eq('still rested (declined)', stackOf(st, 'p1', a.uid).suspended, true);
});
T('i343', 'BT1-085: SA+1 lost when a 1st-check security effect drops the sources below 4', async () => {
  const st = mk(); put(st, 'p1', 'BT1-085'); const a = put(st, 'p1', body('red', 5), { src: [FILL, FILL, FILL, FILL] }); setSec(st, 'p2', [LOW, LOW, LOW]); const r = await atkSec(st, 'p1', a.uid); ok('sanity: 2 checks with 4 sources', r.checks.length === 2);
  const st2 = mk(); put(st2, 'p1', 'BT1-085'); const a2 = put(st2, 'p1', body('red', 5), { src: [FILL, FILL, FILL, FILL] }); a2.sources.pop(); eq('3 sources -> 1 check', (await atkSec(st2, 'p1', a2.uid, {})).checks.length, 1);
});
T('i355', 'BT1-089 hatched digimon evolved and moved to battle can attack at once (not "played")', async () => {
  const st = mk(); const r = S._s4.makeStack(body('green', 3), 1); r.attackEligibleTurn = 1; st.players.p1.raising = r; st.breedingActionTaken = false; S.moveRaisingToBattle(st, 'p1'); ok('can attack', S.canAttackPlayer(st, 'p1', r.uid));
});
T('i362', 'BT1-102: with <=1 security it just draws per 2 (0)', async () => {
  const st = mk(); put(st, 'p1', body('yellow')); secN(st, 'p1', 1); setDeck(st, 'p1', [FILL, FILL]); const h = st.players.p1.hand.length; const r = await useOption(st, 'p1', 'BT1-102'); ok('used', !!r); eq('no draw', st.players.p1.hand.length - h, 0);
});
T('i364', 'BT1-104 checked as security: discarded, no effect', async () => {
  const st = mk(); setSec(st, 'p2', ['BT1-104', LOW]); const a = put(st, 'p1', BIG); await atkSec(st, 'p1', a.uid); ok('trashed', st.players.p2.trash.includes('BT1-104'));
});
T('i365', 'BT1-104: granted on-attack still available after evolving mid-attack', async () => {
  const st = mk(); put(st, 'p1', body('yellow')); const a = put(st, 'p1', BIG); const t = put(st, 'p2', BIG); await useOption(st, 'p1', 'BT1-104'); secN(st, 'p2', 2); st._qaAns = { pickStack: t.uid }; await atkSec(st, 'p1', a.uid); eq('-2000', dp(st, 'p2', t), C(BIG).dp - 2000);
});
T('i370', 'BT1-105 + ST1-13 style +3000: base 3000 + 3000 = 6000', async () => {
  const st = mk(); put(st, 'p1', body('yellow')); const t = put(st, 'p2', BIG); await useOption(st, 'p1', 'BT1-105'); S.modifyDP(st, 'p2', t.uid, 3000, 'turn'); eq('6000', dp(st, 'p2', stackOf(st, 'p2', t.uid)), 6000);
});
T('i371', 'BT1-105: digimon with its own +1000 => 4000', async () => {
  const st = mk(); put(st, 'p1', body('yellow')); const t = put(st, 'p2', 'BT1-060', { src: [] }); const t2 = put(st, 'p2', FILL, { src: ['BT1-060'] }); secN(st, 'p2', 6); st._qaAns = { pickStack: t2.uid }; await useOption(st, 'p1', 'BT1-105'); eq('base 3000; the inherited +DP is an own-turn effect of p2 so none now', dp(st, 'p2', stackOf(st, 'p2', t2.uid)), 3000);
});
T('i373', 'BT1-105: evolving keeps the base 3000', async () => {
  const st = mk(); put(st, 'p1', body('yellow')); const t = put(st, 'p2', FILL); await useOption(st, 'p1', 'BT1-105'); st.activePlayer = 'p2'; st.turnNumber = 4; await evolve(st, 'p2', t.uid, body('red', 4)); eq('still 3000', dp(st, 'p2', stackOf(st, 'p2', t.uid)), 3000);
});
T('i379', 'BT1-111: one DP<=5000 digimon can be targeted alone via the 1-digimon branch', async () => {
  const st = mk(); put(st, 'p1', body('green')); const a = put(st, 'p2', LOW); await useOption(st, 'p1', 'BT1-111'); eq('rested', stackOf(st, 'p2', a.uid).suspended, true);
});
T('i383', 'BT1-112: deleting a non-battling digimon by effect during the attack does not re-activate', async () => {
  const st = mk(); const a = put(st, 'p1', BIG); put(st, 'p1', body('green')); await useOption(st, 'p1', 'BT1-112'); const t = put(st, 'p2', FILL, { susp: true }); const o = put(st, 'p2', FILL); S.deleteStack(st, 'p2', o.uid, 'trash', 'effect'); await drain(st); eq('attacker stays as-is (active)', stackOf(st, 'p1', a.uid).suspended, false);
});
await runAll('qa-w1r2-j');
process.exit(0);
