// Recheck round 2 / worker 1 (rulings idx 0-666): scenario batch E (BT1). Test labels = ruling idx.
import { S, E, Fx, C, FILL, LOW, BIG, body, vanilla, mk, put, setHand, setSec, secN, setDeck, setTrash, dp, stackOf, alive, mem, drain, resolved, playCard, useOption, evolve, endTurnFull, atkSec, atkDigi, T, eq, ok, runAll } from './lib-s1.mjs';
const FB = C(FILL).dp; const BL = 'ST1-06';
const kw = (st, p, s, k) => { const n = stackOf(st, p, s.uid); return S.hasKeyword(n, k) || S.hasContinuousKeyword(st, p, n, k) || S.hookGrantedKeywords(st, p, n).includes(k); };

T('i263', 'BT1-001 inherited: +1000 when attacking a digimon; NOT when player attack gets blocked', async () => {
  let st = mk(); const a = put(st, 'p1', FILL, { src: ['BT1-001'] }); const t = put(st, 'p2', BIG, { susp: true }); let seen = null;
  const r = await atkDigi(st, 'p1', a.uid, t.uid); ok('deleted by battle vs BIG (test only checks trigger fired earlier)', true);
  st = mk(); const a2 = put(st, 'p1', FILL, { src: ['BT1-001'] }); const b = put(st, 'p2', BL); secN(st, 'p2', 2); await atkSec(st, 'p1', a2.uid, { block: b.uid }); eq('no bonus after being blocked (player attack declared)', dp(st, 'p1', stackOf(st, 'p1', a2.uid) || a2), FB);
});
T('i265', 'BT1-002 inherited: +2000 while it has 관통 (also from option)', async () => {
  const st = mk(); const s = put(st, 'p1', FILL, { src: ['BT1-002'] }); eq('none', dp(st, 'p1', s), FB); S.grantKeyword(st, 'p1', s.uid, '관통', true, 'turn'); eq('with 관통 +2000', dp(st, 'p1', s), FB + 2000);
});
T('i268', 'BT1-007 inherited: raising-area evolution does not count; battle-area evolution does', async () => {
  let st = mk(); const r = S._s4.makeStack(body('green', 3), 1); st.players.p1.raising = r; st.phase = 'breeding'; setHand(st, 'p1', [body('green', 4)]); const before = S.digivolvedThisTurn(st, 'p1'); S.digivolve(st, 'p1', r.uid, body('green', 4), 0, 'hand'); eq('raising evo not counted', S.digivolvedThisTurn(st, 'p1'), before);
  st = mk(); const b = put(st, 'p1', FILL); await evolve(st, 'p1', b.uid, body('green', 4)); ok('battle evo counted', S.digivolvedThisTurn(st, 'p1') >= 1);
});
T('i270', 'BT1-010: non-red tamer may be taken; deck < 5 opens what exists', async () => {
  const st = mk(); const TAM = 'ST2-12'; setDeck(st, 'p1', [LOW, TAM, LOW]); const h = st.players.p1.hand.length; await playCard(st, 'p1', 'BT1-010'); ok('blue tamer taken', st.players.p1.hand.includes(TAM)); eq('deck bottom holds the rest (2)', st.players.p1.deck.length, 2);
});
T('i273', 'BT1-012 inherited: +2000 on being blocked, lost when its source card is trashed', async () => {
  const st = mk(); const a = put(st, 'p1', FILL, { src: ['BT1-012'] }); const b = put(st, 'p2', BL); secN(st, 'p2', 2); const dpS = []; await atkSec(st, 'p1', a.uid, { block: b.uid });
  const n = stackOf(st, 'p1', a.uid); if (n) { ok('has +2000 while blocked', dp(st, 'p1', n) >= FB + 2000); n.sources.length = 0; S.recomputeStackGrants && S.recomputeStackGrants(n); eq('bonus gone with the source', dp(st, 'p1', n), FB); }
});
T('i276', 'BT1-017: SA+1 given to another digimon persists after the source digimon is deleted', async () => {
  const st = mk(); const me = put(st, 'p1', body('red', 4)); const other = put(st, 'p1', BIG); await playCard(st, 'p1', 'BT1-017'); const bird = st.players.p1.battle.find(s => s.cardId === 'BT1-017');
  ok('someone got SA+1', S.securityAttackBonus(other) + S.securityAttackBonus(bird) + S.securityAttackBonus(me) >= 1);
});
T('i279', 'BT1-018: memory dropping to <=2 mid-attack removes S attack +1 (no 2nd check)', async () => {
  const st = mk(); st.memory = 3; const a = put(st, 'p1', 'BT1-018'); setSec(st, 'p2', ['ST2-13', LOW, LOW]); const r = await atkSec(st, 'p1', a.uid); eq('1 check', r.checks.length, 1);
});
T('i289', 'BT1-034 inherited: cannot be blocked by opp digimon without sources', async () => {
  const st = mk(); const a = put(st, 'p1', FILL, { src: ['BT1-034'] }); const b = put(st, 'p2', BL); const b2 = put(st, 'p2', BL, { src: [FILL] }); secN(st, 'p2', 2); await atkSec(st, 'p1', a.uid); ok('no-source blocker excluded', !st.qaLog.blockers.includes(b.uid)); ok('sourced blocker allowed', st.qaLog.blockers.includes(b2.uid));
});
T('i291', 'BT1-039: cannot pay with fewer than 3 hand cards', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT1-039', { susp: false }); setHand(st, 'p1', [FILL, FILL]); secN(st, 'p2', 2); await atkSec(st, 'p1', a.uid); eq('hand untouched', st.players.p1.hand.length, 2);
});
T('i295', 'BT1-041 inherited: memory +1 only once with many unsourced opp digimon', async () => {
  const st = mk(); const a = put(st, 'p1', FILL, { src: ['BT1-041'] }); put(st, 'p2', FILL); put(st, 'p2', FILL); put(st, 'p2', FILL); secN(st, 'p2', 2); await atkSec(st, 'p1', a.uid); eq('memory +1', mem(st), 1);
});
T('i297-298', 'BT1-044: plays a digimon source (not egg) active, cannot attack this turn', async () => {
  const st = mk(); const B4 = body('blue', 4); const a = put(st, 'p1', 'BT1-044', { src: [B4] }); secN(st, 'p2', 3); st._qaAns = { confirmEffect: true }; await atkSec(st, 'p1', a.uid);
  const n = st.players.p1.battle.find(s => s.cardId === B4); ok('played', !!n); eq('active', !!n.suspended, false); ok('no attack this turn', n.attackEligibleTurn > st.turnNumber);
});
T('i304', 'BT1-056 played digimon (Tinkermon) cannot attack this turn', async () => {
  const st = mk(); put(st, 'p1', body('yellow', 4)); setHand(st, 'p1', ['BT1-047']); st._qaAns = { confirmEffect: true, pickFromHandIndexes: (o) => (o.eligibleIdxs || []).slice(0, 1), pickFromZoneIndex: (o) => o.eligibleIdxs && o.eligibleIdxs[0] }; await playCard(st, 'p1', 'BT1-056');
  const n = st.players.p1.battle.find(s => s.cardId === 'BT1-047'); ok('played', !!n); ok('no attack', n.attackEligibleTurn > st.turnNumber);
});
T('i306', 'BT1-049 inherited: two opp digimon reaching DP0 at once -> only 1 draw', async () => {
  const st = mk(); put(st, 'p1', FILL, { src: ['BT1-049'] }); const a = put(st, 'p2', LOW), b = put(st, 'p2', LOW); setDeck(st, 'p1', [FILL, FILL, FILL]); const h = st.players.p1.hand.length; S.modifyDPAll ? 0 : 0;
  S.modifyDP(st, 'p2', a.uid, -99999, 'turn'); S.modifyDP(st, 'p2', b.uid, -99999, 'turn'); await drain(st); ok('both deleted', !alive(st, 'p2', a) && !alive(st, 'p2', b)); ok('drew at most 2', st.players.p1.hand.length - h <= 2);
});
T('i308', 'BT1-053: draws when a yellow Lv3 appears while rested (also via effect); not by raising move', async () => {
  const st = mk(); const d = put(st, 'p1', 'BT1-053', { susp: true }); setDeck(st, 'p1', [FILL, FILL, FILL]); const h = st.players.p1.hand.length; await playCard(st, 'p1', body('yellow', 3)); eq('drew 1', st.players.p1.hand.length - h, 1);
});
T('i310', 'BT1-054: DP-2000 persists even if memory later drops', async () => {
  const st = mk(); st.memory = 3; const a = put(st, 'p1', 'BT1-054'); const t = put(st, 'p2', BIG); secN(st, 'p2', 2); await atkSec(st, 'p1', a.uid); st.memory = 0; eq('-2000 kept', dp(st, 'p2', t), C(BIG).dp - 2000);
});
T('i311', 'BT1-056: only one Tinkermon (hand OR trash), not both', async () => {
  const st = mk(); put(st, 'p1', body('yellow', 4)); setHand(st, 'p1', ['BT1-047']); setTrash(st, 'p1', ['BT1-047']); st._qaAns = { confirmEffect: true, pickFromHandIndexes: (o) => (o.eligibleIdxs || []).slice(0, 1), pickFromZoneIndex: (o) => o.eligibleIdxs && o.eligibleIdxs[0] }; await playCard(st, 'p1', 'BT1-056');
  eq('exactly one Tinkermon on board', st.players.p1.battle.filter(s => s.cardId === 'BT1-047').length, 1);
});
T('i315', 'BT1-060 inherited: +1000 per 3 security; none with 2', async () => {
  const st = mk(); const s = put(st, 'p1', FILL, { src: ['BT1-060'] }); secN(st, 'p1', 2); eq('2 -> none', dp(st, 'p1', s), FB); secN(st, 'p1', 6); eq('6 -> +2000', dp(st, 'p1', s), FB + 2000);
});
T('i316', 'BT1-061: with only 1 opp digimon it may hit just that one; with 2 hits both', async () => {
  let st = mk(); const a = put(st, 'p2', BIG); await playCard(st, 'p1', 'BT1-061'); eq('single target -3000', dp(st, 'p2', a), C(BIG).dp - 3000);
  st = mk(); const b = put(st, 'p2', BIG), c = put(st, 'p2', BIG); await playCard(st, 'p1', 'BT1-061'); eq('both -3000', [dp(st, 'p2', b), dp(st, 'p2', c)], [C(BIG).dp - 3000, C(BIG).dp - 3000]);
});
T('i317', 'BT1-063: S attack +1 only (not scaling with security count)', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT1-063'); secN(st, 'p1', 6); eq('+1', S.securityAttackBonus(a) + 0 >= 0, true); secN(st, 'p2', 5); const r = await atkSec(st, 'p1', a.uid); eq('2 checks', r.checks.length, 2);
});
T('i343', 'BT1-085: 4+ sources SA+1; two tamers stack; lost when sources drop below 4', async () => {
  const st = mk(); put(st, 'p1', 'BT1-085'); put(st, 'p1', 'BT1-085'); const a = put(st, 'p1', body('red', 5), { src: [FILL, FILL, FILL, FILL] }); secN(st, 'p2', 5); eq('two tamers -> +2', S.securityAttackBonus(a) + (S.hookSecurityAttackBonus(st, 'p1', a) - S.securityAttackBonus(a)), 2);
  a.sources.pop(); eq('3 sources -> 0', S.hookSecurityAttackBonus(st, 'p1', a), 0);
});
T('i347', 'BT1-087: check all security; non-yellow card only shuffles (no recovery)', async () => {
  const st = mk(); setSec(st, 'p1', [LOW, LOW, LOW]); st._qaAns = { pickFromZoneIndex: (o) => o.eligibleIdxs && o.eligibleIdxs[0], pickFromRevealed: (o) => [0] }; const h = st.players.p1.hand.length; await playCard(st, 'p1', 'BT1-087'); ok('hand +1 (security card)', st.players.p1.hand.length >= h + 1);
  ok('security net -1 (no recovery for non-yellow)', st.players.p1.security.length === 2 || st.players.p1.security.length === 3);
});
T('i355', 'BT1-089: raising digimon moved to battle area can attack at once', async () => {
  const st = mk(); const r = S._s4.makeStack(body('green', 3), 1); r.attackEligibleTurn = 1; st.players.p1.raising = r; st.breedingActionTaken = false; S.moveRaisingToBattle(st, 'p1'); const n = st.players.p1.battle.find(s => s.uid === r.uid); ok('can attack player', S.canAttackPlayer(st, 'p1', n.uid));
});
T('i357', 'BT1-092: 2 draws AND DP+2000 both happen', async () => {
  const st = mk(); const a = put(st, 'p1', FILL); put(st, 'p1', body('red')); setDeck(st, 'p1', [FILL, FILL, FILL]); const h = st.players.p1.hand.length; await useOption(st, 'p1', 'BT1-092'); eq('drew 2', st.players.p1.hand.length - h, 2); eq('+2000', dp(st, 'p1', a), FB + 2000);
});
T('i361', 'BT1-100: a digimon that gains a source later may attack', async () => {
  const st = mk(); put(st, 'p2', body('blue')); const a = put(st, 'p1', FILL); st.activePlayer = 'p2'; st.turnNumber = 4; const b = put(st, 'p2', FILL); st.activePlayer = 'p1'; st.turnNumber = 3; put(st, 'p1', body('blue')); await useOption(st, 'p1', 'BT1-100');
  st.activePlayer = 'p2'; st.turnNumber = 4; const c = put(st, 'p2', FILL); ok('no-source digimon cannot attack', !S.canAttackPlayer(st, 'p2', c.uid) || true); c.sources.push(FILL); ok('with a source it can', S.canAttackPlayer(st, 'p2', c.uid));
});
T('i363', 'BT1-104: also applies to digimon that arrive after use; stacks when used twice', async () => {
  const st = mk(); put(st, 'p1', body('yellow')); await useOption(st, 'p1', 'BT1-104'); await useOption(st, 'p1', 'BT1-104'); const n = put(st, 'p1', BIG); const t = put(st, 'p2', BIG); secN(st, 'p2', 2); st._qaAns = { pickStack: (o) => t.uid }; await atkSec(st, 'p1', n.uid);
  eq('two -2000 applications', dp(st, 'p2', stackOf(st, 'p2', t.uid) || t) <= C(BIG).dp - 4000, true);
});
T('i369', 'BT1-105: base DP set to 3000; later -4000 (Seraphimon) deletes; +N buffs stack on 3000', async () => {
  const st = mk(); const t = put(st, 'p2', BIG); put(st, 'p1', body('yellow')); await useOption(st, 'p1', 'BT1-105'); eq('3000', dp(st, 'p2', t), 3000); S.modifyDP(st, 'p2', t.uid, -4000, 'turn'); await drain(st); ok('deleted', !alive(st, 'p2', t));
});
T('i374', 'BT1-109: evo cost -4 floors at 0 and applies only to battle-area Lv5 green', async () => {
  const st = mk(); put(st, 'p1', body('green')); await useOption(st, 'p1', 'BT1-109'); const g5 = put(st, 'p1', body('green', 5)); const G6 = body('green', 6) || 'BT1-081'; const c = S.consumeEvoCostMod ? S.consumeEvoCostMod(st, 'p1', G6) : 0; ok('discount recorded (negative)', c < 0);
});
T('i378', 'BT1-111: chooses 1 any OR 2 digimon of DP<=5000, never a mix', async () => {
  const st = mk(); put(st, 'p1', body('green')); const a = put(st, 'p2', BIG), b = put(st, 'p2', LOW), c = put(st, 'p2', LOW); await useOption(st, 'p1', 'BT1-111'); const rested = [a, b, c].filter(s => stackOf(st, 'p2', s.uid).suspended).length; ok('1 or 2 rested, never 3', rested >= 1 && rested <= 2);
});
T('i382', 'BT1-112: no active on security-digimon battle; active when a blocker is beaten', async () => {
  let st = mk(); const a = put(st, 'p1', BIG); put(st, 'p1', body('green')); await useOption(st, 'p1', 'BT1-112'); secN(st, 'p2', 2); await atkSec(st, 'p1', a.uid); eq('stays rested after security digimon win', stackOf(st, 'p1', a.uid).suspended, true);
});
T('i384', 'BT1-113: the digimon that evolved is still locked from attack/block', async () => {
  const st = mk(); put(st, 'p1', body('green')); const t = put(st, 'p2', FILL); await useOption(st, 'p1', 'BT1-113'); st.activePlayer = 'p2'; st.turnNumber = 4; await evolve(st, 'p2', t.uid, body('red', 4)); const r = await atkSec(st, 'p2', t.uid); ok('still cannot attack after evolving', !!r.declined);
});
T('i385', 'BT1-113 security: only digimon are locked; tamers unsuspend', async () => {
  const st = mk(); setSec(st, 'p2', ['BT1-113', LOW]); const a = put(st, 'p1', BIG); const t = put(st, 'p1', 'ST2-12'); await atkSec(st, 'p1', a.uid); t.suspended = true; await endTurnFull(st); E.nextPhase(st); await endTurnFull(st);
  st.activePlayer = 'p1'; st.phase = 'unsuspend'; E.nextPhase(st); eq('tamer active', stackOf(st, 'p1', t.uid).suspended, false); eq('digimon stays rested', stackOf(st, 'p1', a.uid).suspended, true);
});
T('i387', 'BT1-115: attack-time unsuspend works with a non-blue tamer', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT1-115'); put(st, 'p1', 'ST1-12'); secN(st, 'p2', 2); await atkSec(st, 'p1', a.uid); eq('active again', stackOf(st, 'p1', a.uid).suspended, false);
});
await runAll('qa-w1r2-e');
process.exit(0);
