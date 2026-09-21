// Official card Q&A scenarios, slice1 part 3 (BT1, BT2 first cards). Q ids refer to data/rulings/slice1.json (gitignored). Run: node scripts/qa/qa-slice1-bt1.mjs < /dev/null
import { S, E, C, FILL, LOW, BIG, body, vanilla, mk, put, setHand, setSec, secN, setDeck, setTrash, dp, stackOf, alive, mem, drain, resolved, playCard, useOption, evolve, endTurnFull, atkSec, atkDigi, T, eq, ok, runAll } from './lib-s1.mjs';
const FB = C(FILL).dp; const BL = 'ST1-06'; const D2 = 'ST4-04'; // D2: DP2000 digimon

// Q866: BT1-001 inherited +1000 only if the attack was declared against a digimon
T(866, 'BT1-001 blocked player attack: no bonus', async () => {
  const st = mk(); const a = put(st, 'p1', BIG, { src: ['BT1-001'] }); const b = put(st, 'p2', BL); secN(st, 'p2', 3); await atkSec(st, 'p1', a.uid, { block: b.uid }); eq('no bonus', dp(st, 'p1', stackOf(st, 'p1', a.uid)), C(BIG).dp);
});
// Q867: BT1-002 +2000 also when Pierce was granted by another effect
T(867, 'BT1-002 granted Pierce counts', async () => {
  const st = mk(); const s = put(st, 'p1', FILL, { src: ['BT1-002'] }); eq('none before', dp(st, 'p1', s), FB); S.grantKeyword(st, 'p1', s.uid, '관통', undefined, 'turn'); eq('+2000 while it has Pierce', dp(st, 'p1', s), FB + 2000);
});
// Q870: evolving the raising-area digimon does not count as "digivolved this turn"
T(870, 'BT1-007 raising-area evolution not counted', async () => {
  const st = mk(); st.players.p1.raising = S._s4.makeStack(FILL, 1); st.players.p1.raising.attackEligibleTurn = 0; await evolve(st, 'p1', st.players.p1.raising.uid, 'ST1-08'); eq('evo count in battle-area sense', S.digivolvedThisTurn(st, 'p1'), 0);
});
// Q878/Q880: BT1-017 Security Attack +1 granted to another digimon survives the source leaving and the target evolving
T(878, 'BT1-017 grant survives source deletion and target evolution', async () => {
  const st = mk(); const x = put(st, 'p1', FILL); const b = await playCard(st, 'p1', 'BT1-017'); ok('x got it', S.securityAttackBonus(stackOf(st, 'p1', x.uid)) >= 1 || S.securityAttackBonus(b) >= 1);
  const who = S.securityAttackBonus(stackOf(st, 'p1', x.uid)) >= 1 ? x : b; if (who === x) { S.deleteStack(st, 'p1', b.uid, 'trash', 'battle'); await drain(st); ok('kept after source deleted', S.securityAttackBonus(stackOf(st, 'p1', x.uid)) >= 1); await evolve(st, 'p1', x.uid, 'ST1-08'); ok('kept after evolution (Q880)', S.securityAttackBonus(stackOf(st, 'p1', x.uid)) >= 1); }
});
// Q879: may target itself
T(879, 'BT1-017 self target', async () => { const st = mk(); const b = await playCard(st, 'p1', 'BT1-017'); ok('self got sec attack', S.securityAttackBonus(b) >= 1); });
// Q882/Q883: BT1-021 memory +3 on attack, -3 at end of turn even if it was deleted; passing adds on top
T(882, 'BT1-021 deleted after attack: end-of-turn -3 still happens', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT1-021'); setSec(st, 'p2', [BIG]); await atkSec(st, 'p1', a.uid); ok('attacker deleted', !alive(st, 'p1', a)); eq('memory +3 so far', mem(st), 3); await endTurnFull(st); eq('-3 applied at turn end', mem(st, 'p1'), 0);
});
T(883, 'BT1-021 pass after +3: opponent side 3 then -3 more => 6', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT1-021'); secN(st, 'p2', 3); await atkSec(st, 'p1', a.uid); E.declarePass(st); let g = 0; while (st.turnEnding && g++ < 10) { await drain(st); E.settleTurnEnd(st); } eq('memory from p1 view', mem(st, 'p1'), -6);
});
// Q893: BT1-039 cost of discarding 3 cannot be paid partially
T(893, 'BT1-039 needs all 3 cards discarded', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT1-039'); setHand(st, 'p1', [FILL]); secN(st, 'p2', 3); await atkSec(st, 'p1', a.uid); eq('hand untouched', st.players.p1.hand.length, 1); eq('stays rested', stackOf(st, 'p1', a.uid).suspended, true);
});
// Q900/Q901/Q905: BT1-044 only digimon-card sources; comes out active; cannot attack the turn it enters
T(900, 'BT1-044 digitama source cannot be played', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT1-044', { src: ['ST1-01'] }); secN(st, 'p2', 3); const n = st.players.p1.battle.length; await atkSec(st, 'p1', a.uid); eq('no new digimon', st.players.p1.battle.length, n);
});
T(901, 'BT1-044 played source enters active and cannot attack', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT1-044', { src: [FILL] }); secN(st, 'p2', 3); await atkSec(st, 'p1', a.uid); eq('2 digimon', st.players.p1.battle.length, 2); const nw = st.players.p1.battle.find(s => s.uid !== a.uid); eq('active', nw.suspended, false); ok('cannot attack yet', nw.attackEligibleTurn > st.turnNumber);
});
T(903, 'BT1-044 played source triggers its on-play effect immediately', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT1-044', { src: ['ST9-02'] }); secN(st, 'p2', 3); await atkSec(st, 'p1', a.uid); ok('on-play resolved', resolved(st).some(r => r.cardId === 'ST9-02'));
});
// Q909: two opp digimon reduced to DP 0 at once: BT1-049 draws only once
T(909, 'BT1-049 simultaneous DP0 => 1 draw', async () => {
  const st = mk(); put(st, 'p1', FILL, { src: ['BT1-049'] }); put(st, 'p2', D2); put(st, 'p2', D2); const h = st.players.p1.hand.length; await playCard(st, 'p1', 'BT1-061'); eq('both gone', st.players.p2.battle.length, 0); eq('one draw', st.players.p1.hand.length - h, 1);
});
// Q911/Q912: BT1-053 (rested) draws when a Lv3 yellow digimon is played; moving from raising area is not "play"
T(911, 'BT1-053 rested: draw on play of yellow Lv3', async () => {
  const st = mk(); put(st, 'p1', 'BT1-053', { susp: true }); const h = st.players.p1.hand.length; await playCard(st, 'p1', body('yellow', 3)); eq('draw', st.players.p1.hand.length - h, 1);
});
T(912, 'BT1-053: raising -> battle move is not a play', async () => {
  const st = mk(); put(st, 'p1', 'BT1-053', { susp: true }); st.players.p1.raising = S._s4.makeStack(body('yellow', 3), 1); const h = st.players.p1.hand.length; S.moveRaisingToBattle(st, 'p1'); await drain(st); eq('no draw', st.players.p1.hand.length - h, 0);
});
// Q919/Q921: BT1-060 +1000 per 3 security (none below 3); BT1-063 sec attack +1 no matter how many security (>=3)
T(919, 'BT1-060 security 2 => none, 3 => +1000, 6 => +2000', async () => {
  const st = mk(); const s = put(st, 'p1', FILL, { src: ['BT1-060'] }); secN(st, 'p1', 2); eq('2', dp(st, 'p1', s), FB); secN(st, 'p1', 3); eq('3', dp(st, 'p1', s), FB + 1000); secN(st, 'p1', 6); eq('6', dp(st, 'p1', s), FB + 2000);
});
T(921, 'BT1-063 security 6 => sec attack +1 only', async () => { const st = mk(); const a = put(st, 'p1', 'BT1-063'); secN(st, 'p1', 6); secN(st, 'p2', 5); const r = await atkSec(st, 'p1', a.uid); eq('2 checks', r.checks.length, 2); });
// Q927: BT1-076 inherited +1 memory regardless of how many rested opp digimon
T(927, 'BT1-076 memory +1 only', async () => { const st = mk(); const a = put(st, 'p1', FILL, { src: ['BT1-076'] }); for (let i = 0; i < 4; i++) put(st, 'p2', FILL, { susp: true }); secN(st, 'p2', 3); await atkSec(st, 'p1', a.uid); eq('+1', mem(st), 1); });
// Q928/Q929: BT1-077 inherited: not for security digimon battles; yes when a blocker was the only thing deleted
T(928, 'BT1-077 security digimon battle: no', async () => { const st = mk(); const a = put(st, 'p1', BIG, { src: ['BT1-077'] }); setSec(st, 'p2', [LOW, LOW]); await atkSec(st, 'p1', a.uid); eq('no memory', st.memory, 0); });
T(929, 'BT1-077 blocked by a digimon that is deleted: +1', async () => { const st = mk(); const a = put(st, 'p1', BIG, { src: ['BT1-077'] }); const b = put(st, 'p2', BL); secN(st, 'p2', 3); await atkSec(st, 'p1', a.uid, { block: b.uid }); eq('+1', st.memory, 1); });
// Q940-942: BT1-084 evolve: deletes every digimon sharing the chosen name (including the chosen one), exact name only
T(940, 'BT1-084 same-name deletion', async () => {
  const st = mk(); const m = put(st, 'p1', FILL); const a1 = put(st, 'p2', 'ST1-09'), a2 = put(st, 'p2', 'BT1-021'), o = put(st, 'p2', 'ST1-11'); await evolve(st, 'p1', m.uid, 'BT1-084');
  ok('both metalgreymon gone', !alive(st, 'p2', a1) && !alive(st, 'p2', a2)); ok('other name stays', alive(st, 'p2', o));
});
// Q946: two BT1-085 tamers each grant Security Attack +1 => +2 total (3 checks)
T(946, 'BT1-085 x2 stacks', async () => { const st = mk(); put(st, 'p1', 'BT1-085'); put(st, 'p1', 'BT1-085'); const a = put(st, 'p1', body('red', 5), { src: [FILL, FILL, FILL, FILL] }); secN(st, 'p2', 5); const r = await atkSec(st, 'p1', a.uid); eq('3 checks', r.checks.length, 3); });
// Q960: BT1-092 both parts happen
T(960, 'BT1-092 draw 2 and DP+2000', async () => { const st = mk(); const s = put(st, 'p1', FILL); const h = st.players.p1.hand.length; await useOption(st, 'p1', 'BT1-092'); eq('drew 2', st.players.p1.hand.length - h, 2); eq('+2000', dp(st, 'p1', s), FB + 2000); });
// Q964: BT1-099 on a source-less digimon does nothing but the option is still used (goes to trash)
T(964, 'BT1-099 used even with nothing to do', async () => { const st = mk(); put(st, 'p1', body('blue')); put(st, 'p2', FILL); await useOption(st, 'p1', 'BT1-099'); ok('option in trash', st.players.p1.trash.includes('BT1-099')); });
// Q965: BT1-100: a digimon that gains sources later can attack
T(965, 'BT1-100 restriction is on "no sources" state', async () => {
  const st = mk(); put(st, 'p1', body('blue')); const t = put(st, 'p2', FILL); await useOption(st, 'p1', 'BT1-100'); st.activePlayer = 'p2'; st.turnNumber = 4; t.attackEligibleTurn = 0;
  const g1 = S.declareAttack(st, 'p2', t.uid); ok('cannot attack without sources', !g1.ok); t.sources.push(FILL); const g2 = S.declareAttack(st, 'p2', t.uid); ok('can attack after gaining a source', g2.ok);
});
// Q972-976: BT1-105 base DP becomes 3000; later modifiers still apply; survives evolution
T(972, 'BT1-105 original DP 3000, modifiers on top, persists through evolution', async () => {
  const st = mk(); put(st, 'p1', body('yellow')); const t = put(st, 'p2', BIG); await useOption(st, 'p1', 'BT1-105'); eq('DP 3000', dp(st, 'p2', t), 3000);
  S.modifyDP(st, 'p2', t.uid, 1000, 'turn'); eq('+1000 on top', dp(st, 'p2', t), 4000);
  await evolve(st, 'p2', t.uid, 'ST3-04'); eq('after evolution still treated as 3000 (+1000)', dp(st, 'p2', stackOf(st, 'p2', t.uid)), 4000);
});
// Q984: BT1-112 granted re-activation has no per-turn limit
T(984, 'BT1-112 unsuspends after each digimon-only win', async () => {
  const st = mk(); const a = put(st, 'p1', BIG); put(st, 'p1', body('green')); await useOption(st, 'p1', 'BT1-112'); const t1 = put(st, 'p2', LOW, { susp: true }), t2 = put(st, 'p2', LOW, { susp: true });
  await atkDigi(st, 'p1', a.uid, t1.uid); eq('active after 1st', stackOf(st, 'p1', a.uid).suspended, false); await atkDigi(st, 'p1', a.uid, t2.uid); eq('active after 2nd', stackOf(st, 'p1', a.uid).suspended, false);
});
T(985, 'BT1-112 not for security digimon', async () => { const st = mk(); const a = put(st, 'p1', BIG); put(st, 'p1', body('green')); await useOption(st, 'p1', 'BT1-112'); setSec(st, 'p2', [LOW, LOW]); await atkSec(st, 'p1', a.uid); eq('stays rested', stackOf(st, 'p1', a.uid).suspended, true); });
// Q992: BT1-115 two blue tamers => +1000 only
T(992, 'BT1-115 tamers do not stack', async () => { const st = mk(); const s = put(st, 'p1', FILL, { src: ['BT1-115'] }); const bt = Object.values(S.CARDS).find(c => c.category === 'tamer' && c.colors.length === 1 && c.colors[0] === 'blue').id; put(st, 'p1', bt); put(st, 'p1', bt); eq('+1000', dp(st, 'p1', s), FB + 1000); });
// Q1009: two Plotmon deleted together at 3 security: only the first recovers (condition rechecked when the second resolves)
T(1009, 'BT2-034 sequential resolution', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT2-034'), b = put(st, 'p1', 'BT2-034'); secN(st, 'p1', 3); setDeck(st, 'p1', [FILL, FILL, FILL, FILL]);
  S.deleteStack(st, 'p1', a.uid, 'trash', 'battle'); S.deleteStack(st, 'p1', b.uid, 'trash', 'battle'); await drain(st); eq('3 -> 4, second does nothing', st.players.p1.security.length, 4);
});
const { fail } = await runAll('qa-slice1-bt1'); process.exit(fail ? 1 : 0);
