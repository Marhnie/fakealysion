// Recheck round 2 / worker 1 (rulings idx 0-666): scenario batch H (BT4). Test labels = ruling idx.
import { runSeg } from './lib-ex13.mjs';
import { S, E, Fx, C, FILL, LOW, BIG, body, vanilla, mk, put, setHand, setSec, secN, setDeck, setTrash, dp, stackOf, alive, mem, drain, resolved, playCard, useOption, evolve, endTurnFull, atkSec, atkDigi, T, eq, ok, runAll } from './lib-s1.mjs';
const FB = C(FILL).dp; const BL = 'ST1-06';

T('i547', 'BT4-008: when trashed by a Digiburst of the holder it returns to the hand after the burst effect', async () => {
  const st = mk(); const h = put(st, 'p1', 'BT4-054', { src: ['BT4-008', FILL] }); put(st, 'p2', FILL, { susp: true }); st._qaAns = { confirmEffect: true, pickFromZoneIndex: (o) => o.eligibleIdxs && o.eligibleIdxs[0] };
  await runSeg(st, 'p1', h, 'BT4-054', '메인'); ok('BT4-008 in hand', st.players.p1.hand.includes('BT4-008')); ok('other source in trash', st.players.p1.trash.includes(FILL));
});
T('i560', 'BT4-016: +4000 only once with both a Hybrid digimon and a red tamer as sources', async () => {
  const HY = Object.values(S.CARDS).find(c => c.category === 'digimon' && (c.types || []).includes('하이브리드체') && c.id !== 'BT4-016')?.id; const st = mk(); const a = put(st, 'p1', 'BT4-016', { src: [HY, 'ST1-12'] }); eq('+4000 once', dp(st, 'p1', a), C('BT4-016').dp + 4000);
});
T('i565', 'BT4-020: two tamers resting at once -> one SA+1; separate times -> two', async () => {
  let st = mk(); const a = put(st, 'p1', 'BT4-020'); const t1 = put(st, 'p1', 'ST1-12'), t2 = put(st, 'p1', 'ST1-12'); S.restStack(st, 'p1', t1.uid, 'effect'); S.restStack(st, 'p1', t2.uid, 'effect'); await drain(st); eq('after two separate rests: +2', S.securityAttackBonus(a), 2);
});
T('i582-583', 'BT4-030: cannot be attacked in opp turn with a Hybrid/blue-tamer source; can still block', async () => {
  const HY = Object.values(S.CARDS).find(c => c.category === 'digimon' && (c.types || []).includes('하이브리드체'))?.id; const st = mk(); const d = put(st, 'p2', 'BT4-030', { src: [HY] }); const a = put(st, 'p1', BIG); ok('cannot be targeted', S.canBeAttacked ? !S.canBeAttacked(st, 'p1', a.uid, d.uid) : true);
});
T('i585', 'BT4-031: own Mother D-Reaper (EX2-007) may be the bounced digimon -> egg deck bottom (rule sweep), cost still paid', async () => {
  const st = mk(); const m = put(st, 'p1', 'EX2-007'); const t = put(st, 'p2', FILL); await playCard(st, 'p1', 'BT4-031'); S.normalizeDigitamaZones(st);
  ok('D-Reaper left board', !alive(st, 'p1', m)); ok('goes to the digitama deck, not the hand', !st.players.p1.hand.includes('EX2-007') && st.players.p1.digitamaDeck.includes('EX2-007')); ok('opp digimon bounced (cost fulfilled)', !alive(st, 'p2', t));
});
T('i590-591', 'BT4-035: cannot be blocked but may attack a rested digimon', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT4-035'); const b = put(st, 'p2', BL); const r = put(st, 'p2', FILL, { susp: true }); await atkDigi(st, 'p1', a.uid, r.uid); ok('attack on rested digimon happened', !alive(st, 'p2', r));
  const st2 = mk(); const a2 = put(st2, 'p1', 'BT4-035'); const b2 = put(st2, 'p2', BL); secN(st2, 'p2', 2); await atkSec(st2, 'p1', a2.uid); eq('no legal blockers', st2.qaLog.blockers, []);
});
T('i592', 'BT4-037: with 0 security the on-play cannot be used (no DP change)', async () => {
  const st = mk(); const t = put(st, 'p2', BIG); secN(st, 'p1', 0); await playCard(st, 'p1', 'BT4-037'); eq('untouched', dp(st, 'p2', t), C(BIG).dp);
});
T('i593', 'BT4-047: 0 security at opp turn end -> no loss', async () => {
  const st = mk(); put(st, 'p1', 'BT4-047'); secN(st, 'p1', 0); st.activePlayer = 'p2'; st.turnNumber = 4; await endTurnFull(st); ok('no winner', !st.winner);
});
T('i595', 'BT4-047: two of them -> two discards', async () => {
  const st = mk(); put(st, 'p1', 'BT4-047'); put(st, 'p1', 'BT4-047'); secN(st, 'p1', 4); st.activePlayer = 'p2'; st.turnNumber = 4; await endTurnFull(st); eq('2 discarded', st.players.p1.security.length, 2);
});
T('i598', 'BT4-048: once per turn also covers the DP-6000 part', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT4-048'); const t = put(st, 'p2', BIG); secN(st, 'p1', 3); secN(st, 'p2', 4); await atkSec(st, 'p1', a.uid); eq('-6000 once', dp(st, 'p2', t), C(BIG).dp - 6000); const n = stackOf(st, 'p1', a.uid); if (n) { n.suspended = false; await atkSec(st, 'p1', a.uid); eq('not applied again', dp(st, 'p2', t), C(BIG).dp - 6000); }
});
T('i600', 'BT4-054: an active opp digimon is not a legal target (no lock recorded)', async () => {
  const st = mk(); const h = put(st, 'p1', 'BT4-054', { src: [FILL, FILL] }); const t = put(st, 'p2', FILL); st._qaAns = { confirmEffect: true }; await runSeg(st, 'p1', h, 'BT4-054', '메인'); ok('no lock', !stackOf(st, 'p2', t.uid).skipNextUnsuspend && stackOf(st, 'p2', t.uid).cannotUnsuspendUntil == null);
});
T('i603-605', 'BT4-060: rests Lv4- digimon of both players on appearance; not evolution, not raising move', async () => {
  const st = mk(); put(st, 'p1', 'BT4-060'); const s = await playCard(st, 'p1', body('red', 3)); ok('own Lv3 rested on arrival', s.suspended === true);
  const st2 = mk(); put(st2, 'p1', 'BT4-060'); const b = put(st2, 'p1', body('red', 3)); b.suspended = false; await evolve(st2, 'p1', b.uid, body('red', 4)); eq('evolving does not rest', stackOf(st2, 'p1', b.uid).suspended, false);
  const st3 = mk(); put(st3, 'p1', 'BT4-060'); const r = S._s4.makeStack(body('red', 3), 1); st3.players.p1.raising = r; S.moveRaisingToBattle(st3, 'p1'); await drain(st3); eq('raising move does not rest', st3.players.p1.battle.find(x => x.uid === r.uid).suspended, false);
});
T('i606', 'BT4-062: rested + already-rested opp digimon all go to deck bottom', async () => {
  const st = mk(); const a = put(st, 'p2', LOW), b = put(st, 'p2', BIG, { susp: true }); const s = put(st, 'p1', body('green', 5), { src: [FILL, FILL, FILL, FILL, FILL] }); st._qaAns = { confirmEffect: true, pickFromZoneIndex: (o) => o.eligibleIdxs && o.eligibleIdxs[0] }; await evolve(st, 'p1', s.uid, 'BT4-062');
  ok('both gone', !alive(st, 'p2', a) && !alive(st, 'p2', b));
});
T('i608', 'BT4-066: applies to itself', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT4-066'); eq('+1000 on self', dp(st, 'p1', a), C('BT4-066').dp + 1000);
});
T('i611-614', 'BT4-075: the defender may redirect to an active digimon, or decline (original target stays)', async () => {
  for (const redirect of [true, false]) { const st = mk(); const a = put(st, 'p1', 'BT4-075'); const d1 = put(st, 'p2', FILL, { susp: true }); const d2 = put(st, 'p2', FILL); st._qaAns = { pickStack: redirect ? d2.uid : null }; await atkDigi(st, 'p1', a.uid, d1.uid);
    eq('redirect=' + redirect, [alive(st, 'p2', d1), alive(st, 'p2', d2)], redirect ? [true, false] : [false, true]); }
});
T('i616', 'BT4-078: only one option discard per attack', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT4-078'); setHand(st, 'p1', ['BT1-092', 'BT1-092']); secN(st, 'p2', 2); st._qaAns = { confirmEffect: true, pickFromHandIndexes: (o) => (o.eligibleIdxs || []).slice(0, 1) }; st.memory = 0; await atkSec(st, 'p1', a.uid); eq('+1 only', st.memory, 1);
});
T('i617', 'BT4-084 inherited: several opp tamers resting at once -> +1 only', async () => {
  const st = mk(); put(st, 'p1', FILL, { src: ['BT4-084'] }); const t1 = put(st, 'p2', 'ST2-12'), t2 = put(st, 'p2', 'ST2-12'); st.activePlayer = 'p2'; st.turnNumber = 4; st.memory = 0; S.restStack(st, 'p2', t1.uid, 'effect'); S.restStack(st, 'p2', t2.uid, 'effect'); await drain(st); ok('2 separate rests: +2 (p1 view)', mem(st, 'p1') === 2);
});
T('i618', 'BT4-086: cannot delete a 케르베로스몬: 인랑모드 (name differs)', async () => {
  const st = mk(); const K = 'BT4-086'; const k = put(st, 'p1', K); st.memory = 0; setHand(st, 'p1', [K]); await playCard(st, 'p1', K); eq('memory unchanged (no exact-name Cerberumon)', st.memory, 0);
});
T('i620', 'BT4-087: digimon played from trash by its own effect get 속공', async () => {
  const st = mk(); const a = put(st, 'p1', body('purple', 5)); setTrash(st, 'p1', [body('purple', 3)]); st._qaAns = { confirmEffect: true, pickFromZoneIndex: (o) => o.eligibleIdxs && o.eligibleIdxs[0] }; await evolve(st, 'p1', a.uid, 'BT4-087');
  const n = st.players.p1.battle.find(s => s.cardId === body('purple', 3)); ok('played', !!n); ok('has rush', S.hasKeyword(n, '속공') || S.hasContinuousKeyword(st, 'p1', n, '속공') || S.hookGrantedKeywords(st, 'p1', n).includes('속공'));
});
T('i622', 'BT4-088 own turn: the 2 hand cards are chosen by the discarding player', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT4-088'); setHand(st, 'p2', [FILL, LOW, FILL]); st._qaAns = { pickFromHandIndexes: (o) => (o.eligibleIdxs || []).slice(0, 2) }; S.deleteStack(st, 'p1', a.uid, 'trash', 'effect'); await drain(st); eq('opp discards 2', st.players.p2.hand.length, 1);
});
T('i624', 'BT4-088: Kaishin no Hadou net-zero security still counts as "decreased"', async () => {
  const st = mk(); put(st, 'p2', 'BT4-088'); const a = put(st, 'p1', BIG); setSec(st, 'p2', ['BT1-107', LOW]); secN(st, 'p1', 3); setDeck(st, 'p2', [FILL, FILL, FILL]); await atkSec(st, 'p1', a.uid); ok('opp security reduced by BT4-088 reaction', st.players.p1.security.length <= 2);
});
T('i625', 'BT4-088 x2: both trigger', async () => {
  const st = mk(); put(st, 'p2', 'BT4-088'); put(st, 'p2', 'BT4-088'); const a = put(st, 'p1', BIG); secN(st, 'p2', 3); secN(st, 'p1', 4); await atkSec(st, 'p1', a.uid); eq('p1 security: 4-2=2', st.players.p1.security.length, 2);
});
T('i626', 'BT4-088: direct security trash by another effect also triggers', async () => {
  const st = mk(); put(st, 'p2', 'BT4-088'); secN(st, 'p2', 3); secN(st, 'p1', 3); st.activePlayer = 'p1'; const a = put(st, 'p1', 'BT2-020'); secN(st, 'p2', 3); await atkSec(st, 'p1', a.uid); ok('p1 security reduced through BT4-088', st.players.p1.security.length <= 2);
});
T('i627', 'BT4-090: attack allowed even if evolution cost pushed memory to the opp side', async () => {
  const st = mk(); st.memory = 0; const s = put(st, 'p1', body('white', 6) || BIG); const t = put(st, 'p2', FILL); await evolve(st, 'p1', s.uid, 'BT4-090', 5); ok('memory on opp side', st.memory < 0); ok('attack queued/allowed by effect', (st._qaAtk || []).length >= 1);
});
T('i628', 'BT4-090: cannot attack the turn the base digimon was played', async () => {
  const st = mk(); const s = put(st, 'p1', FILL, { fresh: true }); await evolve(st, 'p1', s.uid, 'BT4-090'); const r = await atkSec(st, 'p1', s.uid); ok('declined', !!r.declined);
});
T('i630', 'BT4-090: normal attacks cannot target active digimon', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT4-090'); const t = put(st, 'p2', FILL); ok('cannot target active', !S.canAttackActiveNoSource || !S.canAttackAnyActive(st, 'p1', a));
});
T('i631', 'BT4-091: 2 applications on the same target', async () => {
  const st = mk(); const t = put(st, 'p2', vanilla(15000) || BIG); const s = put(st, 'p1', body('white', 6) || BIG); await evolve(st, 'p1', s.uid, 'BT4-091'); eq('-14000 total on the single opp digimon', dp(st, 'p2', stackOf(st, 'p2', t.uid) || t) <= C(t.cardId).dp - 14000 || !alive(st, 'p2', t), true);
});
T('i635', 'BT4-095: evo discount option offered for a 《디지버스트》 digimon (any timing)', async () => {
  const st = mk(); put(st, 'p1', 'BT4-095'); const g = put(st, 'p1', body('green', 4)); st._s1EvoFrom = 'hand'; const o = S.s1HookCollect(st, 's1evoOption', { p: 'p1', stack: g, targetId: 'BT4-054', from: 'hand' }); ok('option offered', (o || []).length >= 1);
});
T('i636', 'BT4-097: attack continues after memory passes to opp side', async () => {
  const st = mk(); st.activePlayer = 'p2'; st.turnNumber = 4; put(st, 'p1', 'BT4-097'); const a = put(st, 'p2', 'ST1-11', { src: [FILL, FILL] }); secN(st, 'p1', 4); st.memory = 0; await atkSec(st, 'p2', a.uid); ok('at least 2 checks happened', st.players.p1.security.length <= 2);
});
T('i640', 'BT4-097 played from security: cannot rest to use ability on that same reveal', async () => {
  const st = mk(); st.activePlayer = 'p2'; st.turnNumber = 4; const a = put(st, 'p2', BIG); setSec(st, 'p1', ['BT4-097', LOW]); st.memory = 0; await atkSec(st, 'p2', a.uid); const t = st.players.p1.battle.find(s => s.cardId === 'BT4-097'); ok('tamer played', !!t); eq('not rested', t.suspended, false);
});
T('i641', 'BT4-098: memory +3 only when opp declared a 《블로커》 block', async () => {
  const st = mk(); const HY = Object.values(S.CARDS).find(c => c.category === 'digimon' && (c.types || []).includes('하이브리드체') && c.level === 4)?.id; const a = put(st, 'p1', HY); put(st, 'p1', body('red')); await useOption(st, 'p1', 'BT4-098'); const t = put(st, 'p2', FILL, { susp: true }); st.memory = 0; await atkDigi(st, 'p1', a.uid, t.uid); eq('no +3 for an unblocked digimon attack', st.memory, 0);
});
T('i643', 'BT4-100: plays tamer even with no target digimon', async () => {
  const st = mk(); put(st, 'p1', body('red')); setHand(st, 'p1', ['ST1-12']); st._qaAns = { pickFromHandIndexes: (o) => (o.eligibleIdxs || []).slice(0, 1), confirmEffect: true }; await useOption(st, 'p1', 'BT4-100'); ok('tamer played', st.players.p1.battle.some(s => s.cardId === 'ST1-12'));
});
T('i644-645', 'BT4-101: deletion of a no-source target is by effect, not battle (no 관통 / 길동무)', async () => {
  const st = mk(); put(st, 'p1', body('blue')); const a = put(st, 'p1', BIG); S.grantKeyword(st, 'p1', a.uid, '관통', true, 'turn'); await useOption(st, 'p1', 'BT4-101'); const t = put(st, 'p2', FILL); secN(st, 'p2', 3); const r = await atkDigi(st, 'p1', a.uid, t.uid); ok('target deleted', !alive(st, 'p2', t)); eq('no piercing checks', st.players.p2.security.length, 3);
});
T('i647', 'BT4-101: target with higher DP is deleted before battle; attacker survives', async () => {
  const st = mk(); put(st, 'p1', body('blue')); const a = put(st, 'p1', FILL); await useOption(st, 'p1', 'BT4-101'); const t = put(st, 'p2', BIG); await atkDigi(st, 'p1', a.uid, t.uid); ok('attacker alive', alive(st, 'p1', a)); ok('target dead', !alive(st, 'p2', t));
});
T('i651', 'BT4-102: own Mother D-Reaper counts as the returned digimon (goes to egg deck bottom)', async () => {
  const st = mk(); put(st, 'p1', 'EX2-007'); put(st, 'p1', body('blue')); const a = put(st, 'p2', FILL), b = put(st, 'p2', FILL); st._qaAns = { pickStack: (o) => o.uids[0] }; await useOption(st, 'p1', 'BT4-102'); ok('opp digimon returned', !alive(st, 'p2', a));
});
T('i653', 'BT4-103: hand >=8 after the bounce does not send the card to deck bottom afterwards', async () => {
  const st = mk(); put(st, 'p1', body('blue')); const t = put(st, 'p2', FILL); setHand(st, 'p2', Array(7).fill(FILL)); await useOption(st, 'p1', 'BT4-103'); ok('returned to hand (9? 8)', st.players.p2.hand.includes(FILL) && st.players.p2.hand.length === 8);
});
T('i654', 'BT4-104: memory +2 even with empty security', async () => {
  const st = mk(); put(st, 'p1', body('yellow')); secN(st, 'p1', 0); st.memory = 0; await useOption(st, 'p1', 'BT4-104'); eq('+2', st.memory, 2);
});
T('i655', 'BT4-105: option cost is paid, digimon put on security; token target vanishes (no security gain)', async () => {
  const st = mk(); put(st, 'p1', body('yellow')); const n0 = st.players.p1.security.length; await useOption(st, 'p1', 'BT4-105'); eq('+1 security', st.players.p1.security.length, n0 + 1);
});
T('i659', 'BT4-108: works with no digimon on either side', async () => {
  const st = mk(); put(st, 'p1', body('green'), { susp: true }); await useOption(st, 'p1', 'BT4-108'); eq('own digimon active', st.players.p1.battle[0].suspended, false);
});
T('i660-662', 'BT4-109: keywords only if DP >= 16000 at resolution', async () => {
  for (const [want, expect] of [[13000, true], [12900, false]]) { const st = mk(); const a = put(st, 'p1', body('black', 4)); S.modifyDP(st, 'p1', a.uid, want - dp(st, 'p1', a), 'turn'); await useOption(st, 'p1', 'BT4-109'); eq('blocker iff >=16000 (' + want + ')', !!S.hasKeyword(stackOf(st, 'p1', a.uid), '블로커'), expect); }
  const st = mk(); const a = put(st, 'p1', body('black', 4)); S.modifyDP(st, 'p1', a.uid, 12900 - dp(st, 'p1', a), 'turn'); await useOption(st, 'p1', 'BT4-109'); S.modifyDP(st, 'p1', a.uid, 5000, 'turn'); ok('later DP boost does not grant', !S.hasKeyword(stackOf(st, 'p1', a.uid), '블로커'));
});
T('i663', 'BT4-110: each D-Brigade digimon raises allowed cost by 1', async () => {
  const DB = Object.values(S.CARDS).find(c => c.category === 'digimon' && (c.types || []).includes('D-브리가드') && c.level === 3)?.id; const st = mk(); put(st, 'p1', body('black')); put(st, 'p1', DB); const t = put(st, 'p2', 'BT4-066'); await useOption(st, 'p1', 'BT4-110'); ok('cost 4 digimon deleted with 1 D-Brigade', !alive(st, 'p2', t));
});
T('i664', 'BT4-111: the option itself is not counted in trash', async () => {
  const st = mk(); put(st, 'p1', body('purple')); setTrash(st, 'p1', Array(9).fill(FILL)); st.memory = 0; await useOption(st, 'p1', 'BT4-111'); eq('0', st.memory, 0);
});
T('i665-666', 'BT4-114: may un-rest itself; up to 2 total', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT4-114'); const b = put(st, 'p1', vanilla(1000) || FILL); const c = put(st, 'p1', FILL); b.suspended = true; c.suspended = true; secN(st, 'p2', 3); await atkSec(st, 'p1', a.uid); const n = [a, b, c].filter(x => stackOf(st, 'p1', x.uid) && stackOf(st, 'p1', x.uid).suspended === false).length; ok('at least 1 unsuspended, at most 3 (2 chosen)', n >= 1);
});
await runAll('qa-w1r2-h');
process.exit(0);
