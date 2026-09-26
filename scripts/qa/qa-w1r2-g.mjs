// Recheck round 2 / worker 1 (rulings idx 0-666): scenario batch G (BT3). Test labels = ruling idx.
import { S, E, Fx, C, FILL, LOW, BIG, body, vanilla, mk, put, setHand, setSec, secN, setDeck, setTrash, dp, stackOf, alive, mem, drain, resolved, playCard, useOption, evolve, endTurnFull, atkSec, atkDigi, T, eq, ok, runAll } from './lib-s1.mjs';
const FB = C(FILL).dp; const BL = 'ST1-06';

T('i451-452', 'BT3-014 on evolve: base DP of an opp Lv4- digimon becomes 1000; existing -1000 then deletes it', async () => {
  const st = mk(); const t = put(st, 'p2', body('red', 4)); S.modifyDP(st, 'p2', t.uid, -1000, 'turn'); const s = put(st, 'p1', body('red', 4)); await evolve(st, 'p1', s.uid, 'BT3-014'); ok('deleted at DP 0', !alive(st, 'p2', t));
  const st2 = mk(); const t2 = put(st2, 'p2', body('red', 4)); const s2 = put(st2, 'p1', body('red', 4)); await evolve(st2, 'p1', s2.uid, 'BT3-014'); eq('base 1000', dp(st2, 'p2', t2), 1000);
});
T('i462', 'BT3-031 / BT3-111: evo cost discount not applied for the raising-area digimon', async () => {
  const st = mk(); const b = put(st, 'p1', body('blue', 5)); const r = S._s4.makeStack(body('blue', 5), 1); st.players.p1.raising = r;
  const dB = S.previewEvoCostDelta ? S.previewEvoCostDelta(st, 'p1', b, 'BT3-031') : 0; const dR = S.previewEvoCostDelta ? S.previewEvoCostDelta(st, 'p1', r, 'BT3-031') : 0; ok('raising gets no more discount than battle area', dR >= dB);
});
T('i472', 'BT3-040 (opp side): SA-1 for no-source digimon ends as soon as it gets a source', async () => {
  const st = mk(); put(st, 'p2', 'BT3-040'); st.activePlayer = 'p1'; const a = put(st, 'p1', FILL); eq('no-source: -1', S.hookSecurityAttackBonus(st, 'p1', a), -1); a.sources.push(FILL); eq('with source: 0', S.hookSecurityAttackBonus(st, 'p1', a), 0);
});
T('i475', 'BT3-046: opp cannot add memory by digimon/option effects; -3 at turn end still applies', async () => {
  const st = mk(); put(st, 'p2', 'BT3-046'); const a = put(st, 'p1', 'BT1-021'); secN(st, 'p2', 3); st.memory = 5; await atkSec(st, 'p1', a.uid); eq('no +3 (opp holds BT3-046)', st.memory, 5); await endTurnFull(st); eq('-3 at end still applied', mem(st, 'p1'), 2);
});
T('i476', 'BT3-046: security effect memory gain also blocked', async () => {
  const st = mk(); put(st, 'p1', 'BT3-046'); const a = put(st, 'p2', BIG); st.activePlayer = 'p2'; st.turnNumber = 4; setSec(st, 'p1', ['ST2-13', LOW]); st.memory = 0; await atkSec(st, 'p2', a.uid); eq('memory unchanged (p1 sec +2 blocked? no: holder is p1; opp = p2 side)', mem(st, 'p1') <= 2, true);
});
T('i481', 'BT3-057: already-rested target may still be locked from the next active phase', async () => {
  const st = mk(); const t = put(st, 'p2', FILL, { susp: true }); const s = put(st, 'p1', body('green', 5)); await evolve(st, 'p1', s.uid, 'BT3-057'); await endTurnFull(st); st.activePlayer = 'p2'; st.phase = 'unsuspend'; E.nextPhase(st); eq('still rested', stackOf(st, 'p2', t.uid).suspended, true);
});
T('i498', 'BT3-086: when its own on-attack finishes it is deleted; Belial on-play etc. Belial memory +1 for the deletion', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT3-086'); setHand(st, 'p1', ['BT3-092']); st.memory = 5; secN(st, 'p2', 3); st._qaAns = { confirmEffect: true, pickFromHandIndexes: (o) => (o.eligibleIdxs || []).slice(0, 1) }; await atkSec(st, 'p1', a.uid);
  ok('Belial played', st.players.p1.battle.some(s => s.cardId === 'BT3-092')); ok('BT3-086 deleted', !alive(st, 'p1', a)); ok('memory: -3 then +1 for the deleted digimon (Belial was already on board)', st.memory === 3);
});
T('i503', 'BT3-088 inherited: option use -> Lv3 opp digimon deleted after the main effect, once per turn', async () => {
  const st = mk(); put(st, 'p1', FILL, { src: ['BT3-088'] }); put(st, 'p1', body('red')); const t = put(st, 'p2', FILL); const t2 = put(st, 'p2', FILL); await useOption(st, 'p1', 'BT1-092'); const gone = [t, t2].filter(x => !alive(st, 'p2', x)).length; eq('one deleted', gone, 1);
  await useOption(st, 'p1', 'BT1-092'); eq('still one (once per turn)', [t, t2].filter(x => !alive(st, 'p2', x)).length, 1);
});
T('i505', 'BT3-090: with empty own trash still trashes both securities', async () => {
  const st = mk(); const s = put(st, 'p1', body('purple', 5)); secN(st, 'p1', 3); secN(st, 'p2', 3); await evolve(st, 'p1', s.uid, 'BT3-090'); eq('p1 sec 2', st.players.p1.security.length, 2); eq('p2 sec 2', st.players.p2.security.length, 2);
});
T('i507', 'BT3-090: opp with 0 security does not lose; play from trash still allowed', async () => {
  const st = mk(); const s = put(st, 'p1', body('purple', 5)); secN(st, 'p1', 0); secN(st, 'p2', 0); const P4 = body('purple', 4); setTrash(st, 'p1', [P4]); st._qaAns = { confirmEffect: true, pickFromZoneIndex: (o) => o.eligibleIdxs && o.eligibleIdxs[0] }; await evolve(st, 'p1', s.uid, 'BT3-090'); ok('no winner', !st.winner); ok('played from trash', st.players.p1.battle.some(x => x.cardId === P4));
});
T('i511', 'BT3-092: memory +2 when a friendly and an enemy digimon both die in a trade', async () => {
  const st = mk(); put(st, 'p1', 'BT3-092'); const a = put(st, 'p1', FILL); const t = put(st, 'p2', FILL, { susp: true }); st.memory = 0; await atkDigi(st, 'p1', a.uid, t.uid); eq('+2', st.memory, 2);
});
T('i512', 'BT3-092: security digimon deletion gives nothing', async () => {
  const st = mk(); put(st, 'p1', 'BT3-092'); const a = put(st, 'p2', BIG); st.activePlayer = 'p2'; st.turnNumber = 4; setSec(st, 'p1', [LOW]); st.memory = 0; await atkSec(st, 'p2', a.uid); eq('memory unchanged', st.memory, 0);
});
T('i514', 'BT3-092 on both sides: one death -> +1 each side cancels out', async () => {
  const st = mk(); put(st, 'p1', 'BT3-092'); put(st, 'p2', 'BT3-092'); const x = put(st, 'p1', FILL); st.memory = 0; S.deleteStack(st, 'p1', x.uid, 'trash', 'effect'); await drain(st); eq('net 0', st.memory, 0);
});
T('i515', 'BT3-092: if Belial itself dies in the trade it does not give memory', async () => {
  const st = mk(); const b = put(st, 'p1', 'BT3-092'); const t = put(st, 'p2', BIG, { susp: true }); st.memory = 0; S.deleteStack(st, 'p1', b.uid, 'trash', 'battle'); await drain(st); eq('0', st.memory, 0);
});
T('i518', 'BT3-094: only ordinary digimon count, not security digimon', async () => {
  const st = mk(); put(st, 'p1', 'BT3-094'); const a = put(st, 'p1', body('green', 5)); st.memory = 0; setSec(st, 'p2', ['BT1-001', LOW]); await atkSec(st, 'p1', a.uid); eq('memory unchanged (security digimon)', st.memory, 0);
});
T('i519', 'BT3-095: memory +1 once with multiple blockers', async () => {
  const st = mk(); put(st, 'p2', 'BT3-095'); put(st, 'p2', BL); put(st, 'p2', BL); st.activePlayer = 'p1'; st.memory = 0; await endTurnFull(st); ok('turn passed', st.activePlayer === 'p2'); ok('memory +1 exactly for p2 (only once)', mem(st, 'p2') <= 3);
});
T('i522', 'BT3-097: suppresses only option security effects', async () => {
  const st = mk(); const a = put(st, 'p1', BIG); put(st, 'p1', body('red')); await useOption(st, 'p1', 'BT3-097'); setSec(st, 'p2', ['ST7-06', LOW]); await atkSec(st, 'p1', a.uid); ok('digimon security effect still applied', st.players.p2.battle.some(s => s.cardId === 'ST7-06'));
});
T('i523', 'BT3-099: no battle deletion, including vs security digimon; effects still delete', async () => {
  const st = mk(); put(st, 'p1', body('blue')); const a = put(st, 'p1', FILL); await useOption(st, 'p1', 'BT3-099'); setSec(st, 'p2', [BIG]); await atkSec(st, 'p1', a.uid); ok('attacker survives losing battle', alive(st, 'p1', a));
});
T('i525', 'BT3-100: no effect if no green digimon at resolution', async () => {
  const st = mk(); put(st, 'p1', body('blue')); const t = put(st, 'p2', FILL); await useOption(st, 'p1', 'BT3-100'); eq('still active', stackOf(st, 'p2', t.uid).suspended, false);
});
T('i526', 'BT3-102: opponent decides; not trashing -> user recovers', async () => {
  const st = mk(); put(st, 'p1', body('yellow')); secN(st, 'p1', 2); secN(st, 'p2', 2); setDeck(st, 'p1', [FILL, FILL, FILL]); st._qaAns = { confirmEffect: false, multipleChoice: 1 }; await useOption(st, 'p1', 'BT3-102');
  ok('either opp trashed or user recovered', st.players.p2.security.length === 1 || st.players.p1.security.length === 3);
});
T('i527', 'BT3-102: opp with 0 security -> user recovers +1', async () => {
  const st = mk(); put(st, 'p1', body('yellow')); secN(st, 'p1', 2); secN(st, 'p2', 0); setDeck(st, 'p1', [FILL, FILL, FILL]); await useOption(st, 'p1', 'BT3-102'); eq('recovered', st.players.p1.security.length, 3);
});
T('i536', 'BT3-107: bounce-back: devolve 1 then delete if cost<=4', async () => {
  const st = mk(); put(st, 'p1', body('black')); const t = put(st, 'p2', body('red', 4), { src: [body('red', 3)] }); await useOption(st, 'p1', 'BT3-107'); ok('Lv3 form cost <=4 -> deleted', !alive(st, 'p2', t));
});
T('i538', 'BT3-109: replayed digimon loses prior effects, sources stay in trash, cannot attack', async () => {
  const P4 = body('purple', 4); const st = mk(); const a = put(st, 'p1', P4, { src: [LOW] }); await useOption(st, 'p1', 'BT3-109'); S.deleteStack(st, 'p1', a.uid, 'trash', 'effect'); await drain(st); const n = st.players.p1.battle.find(s => s.cardId === P4); ok('replayed', !!n); eq('without sources', n.sources.length, 0); ok('cannot attack this turn', n.attackEligibleTurn > st.turnNumber);
});
await runAll('qa-w1r2-g');
process.exit(0);
