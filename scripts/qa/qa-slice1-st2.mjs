// Official card Q&A scenarios, slice1 part 2 (ST3..ST17). Q ids refer to data/rulings/slice1.json (gitignored). Run: node scripts/qa/qa-slice1-st2.mjs < /dev/null
import { S, E, C, FILL, LOW, BIG, body, vanilla, mk, put, setHand, setSec, secN, setDeck, setTrash, dp, stackOf, alive, mem, drain, resolved, playCard, useOption, evolve, endTurnFull, atkSec, atkDigi, T, eq, ok, runAll } from './lib-s1.mjs';
const DUALYP = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.colors.includes('yellow') && c.colors.includes('purple') && c.level === 4)?.id;
const FB = C(FILL).dp; const V4 = vanilla(4000); const BL = 'ST1-06'; // BL: a 《Blocker》 digimon

// Q641: ST3-12 tamer: +2000 only for security digimon (not for ordinary digimon)
T(641, 'ST3-12 no bonus for ordinary digimon', async () => { const st = mk(); st.activePlayer = 'p2'; put(st, 'p1', 'ST3-12'); const d = put(st, 'p1', FILL); eq('DP unchanged', dp(st, 'p1', d), FB); });
// Q644: security attack -3 on a digimon with 1 check => 0 checks: no security check, battle ends, attacker survives
T(644, 'ST3-15 0 checks', async () => {
  const st = mk(); const a = put(st, 'p1', FILL); secN(st, 'p2', 3); await S.useOptionCard && 0; st.activePlayer = 'p2'; put(st, 'p2', body('yellow'));
  await useOption(st, 'p2', 'ST3-15'); st.activePlayer = 'p1'; st.turnNumber = 4;
  const r = await atkSec(st, 'p1', a.uid); eq('no checks made', (r.checks || []).length, 0); eq('security untouched', st.players.p2.security.length, 3); ok('attacker alive', alive(st, 'p1', a));
});
// Q645: sec attack -3 then +1 gained later: still 0 checks (needs +3 to reach 1)
T(645, 'ST3-15 later +1 does not undo', async () => {
  const st = mk(); const a = put(st, 'p1', FILL); secN(st, 'p2', 3); st.activePlayer = 'p2'; put(st, 'p2', body('yellow')); await useOption(st, 'p2', 'ST3-15'); st.activePlayer = 'p1'; st.turnNumber = 4;
  S.grantKeyword(st, 'p1', a.uid, '시큐리티어택', 1, 'turn'); const r = await atkSec(st, 'p1', a.uid); eq('still 0 checks', (r.checks || []).length, 0);
});
// Q643/Q646: DP -2000 / -10000 on a digimon with DP <= that amount => DP 0 => deleted
T(643, 'ST3-14 -2000 on DP2000 deletes', async () => { const st = mk(); const t = put(st, 'p2', 'ST4-04'); put(st, 'p1', body('yellow')); await useOption(st, 'p1', 'ST3-14'); ok('deleted', !alive(st, 'p2', t)); });
T(646, 'ST3-16 -10000 on DP<=10000 deletes', async () => { const st = mk(); const t = put(st, 'p2', BIG); put(st, 'p1', body('yellow')); await useOption(st, 'p1', 'ST3-16'); ok('deleted', !alive(st, 'p2', t)); });
// Q647/Q649: inherited +2000 only when the attack was declared on a digimon; blocked player-attack does not qualify
for (const [q, src] of [[647, 'ST4-04'], [649, 'ST4-06']]) T(q, src + ' blocked player attack: no bonus', async () => {
  const st = mk(); const a = put(st, 'p1', BIG, { src: [src] }); const b = put(st, 'p2', BL); secN(st, 'p2', 3);
  const r = await atkSec(st, 'p1', a.uid, { block: b.uid }); ok('blocked', st.qaLog.blocked); eq('no DP bonus', dp(st, 'p1', stackOf(st, 'p1', a.uid)), C(BIG).dp);
});
for (const [q, src] of [[648, 'ST4-04'], [650, 'ST4-06']]) T(q, src + ' attack on digimon: bonus', async () => {
  const st = mk(); const a = put(st, 'p1', BIG, { src: [src] }); const t = put(st, 'p2', LOW, { susp: true }); await atkDigi(st, 'p1', a.uid, t.uid); eq('+2000', dp(st, 'p1', stackOf(st, 'p1', a.uid)), C(BIG).dp + 2000);
});
// Q652/Q653: ST4-11 inherited: security trashed by effect does not fire its 【Security】; no win when security is empty
T(652, 'ST4-11 trashed security has no effect', async () => {
  const st = mk(); const a = put(st, 'p1', BIG, { src: ['ST4-11'] }); const t = put(st, 'p2', LOW, { susp: true }); setSec(st, 'p2', ['ST2-13', LOW]); await atkDigi(st, 'p1', a.uid, t.uid);
  eq('security -1', st.players.p2.security.length, 1); eq('memory untouched (no security effect)', st.memory, 0);
});
T(653, 'ST4-11 empty security: no win', async () => { const st = mk(); const a = put(st, 'p1', BIG, { src: ['ST4-11'] }); const t = put(st, 'p2', LOW, { susp: true }); await atkDigi(st, 'p1', a.uid, t.uid); ok('no winner', !st.winner); });
// Q654/Q655: ST4-12 restricted digimon: still a legal attack target when rested; keeps the restriction after evolving
T(654, 'ST4-12 restricted rested digimon can be attacked', async () => {
  const st = mk(); const t = put(st, 'p2', FILL, { susp: true }); const a = put(st, 'p1', FILL); const my = put(st, 'p1', 'ST4-12'); // apply via evolve
  st.players.p1.battle.pop(); const m = put(st, 'p1', FILL); await evolve(st, 'p1', m.uid, 'ST4-12');
  ok('legal target', S.legalDigimonTargets(st, 'p1', a.uid).some(x => (x.uid ?? x) === t.uid));
});
T(655, 'ST4-12 restriction survives evolution of the target', async () => {
  const st = mk(); const t = put(st, 'p2', FILL); const m = put(st, 'p1', FILL); await evolve(st, 'p1', m.uid, 'ST4-12');
  const t2 = stackOf(st, 'p2', t.uid); ok('restricted', t2.cannotAttackUntil != null && t2.cannotAttackUntil !== 0);
  await evolve(st, 'p2', t.uid, 'ST3-04'); ok('still restricted after evolution', stackOf(st, 'p2', t.uid).cannotAttackUntil != null);
});
// Q658/Q660 (and 661/663): ST5-04 inherited draw at opponent's turn end only if no opp digimon attacked this turn
T(658, 'ST5-04 no opp digimon at all: draws', async () => {
  const st = mk({ me: 'p2' }); put(st, 'p1', FILL, { src: ['ST5-04'] }); const h = st.players.p1.hand.length; await endTurnFull(st); eq('drew 1', st.players.p1.hand.length - h, 1);
});
T(660, 'ST5-04 attacker deleted in battle: still counts as attacked (no draw)', async () => {
  const st = mk({ me: 'p2' }); put(st, 'p1', FILL, { src: ['ST5-04'] }); const a = put(st, 'p2', FILL); const t = put(st, 'p1', BIG, { susp: true }); await atkDigi(st, 'p2', a.uid, t.uid);
  const h = st.players.p1.hand.length; await endTurnFull(st); eq('no draw', st.players.p1.hand.length - h, 0);
});
T(663, 'ST5-06 attacker deleted in battle: no draw', async () => {
  const st = mk({ me: 'p2' }); put(st, 'p1', FILL, { src: ['ST5-06'] }); const a = put(st, 'p2', FILL); const t = put(st, 'p1', BIG, { susp: true }); await atkDigi(st, 'p2', a.uid, t.uid);
  const h = st.players.p1.hand.length; await endTurnFull(st); eq('no draw', st.players.p1.hand.length - h, 0);
});
T(662, 'ST5-06 opp digimon could not attack: draws', async () => {
  const st = mk({ me: 'p2' }); put(st, 'p1', FILL, { src: ['ST5-06'] }); put(st, 'p2', FILL); const h = st.players.p1.hand.length; await endTurnFull(st); eq('drew 1', st.players.p1.hand.length - h, 1);
});
// Q665/Q666/Q667/Q668: on-evolve keyword grants may target the digimon itself and persist across further evolution
T(665, 'ST5-09 gives itself Blocker; persists after evolving', async () => {
  const st = mk(); const m = put(st, 'p1', FILL); await evolve(st, 'p1', m.uid, 'ST5-09'); ok('has blocker', S.hasKeyword(stackOf(st, 'p1', m.uid), '블로커'));
  await evolve(st, 'p1', m.uid, 'ST5-12'); ok('blocker kept after further evolution (Q666)', S.hasKeyword(stackOf(st, 'p1', m.uid), '블로커'));
});
T(667, 'ST5-12 gives itself Reboot', async () => { const st = mk(); const m = put(st, 'p1', FILL); await evolve(st, 'p1', m.uid, 'ST5-12'); ok('has reboot', S.hasKeyword(stackOf(st, 'p1', m.uid), '재기동')); });
// Q670: ST6-01: deck emptied by its effect is not an immediate loss
T(670, 'ST6-01 deck 0 no immediate loss', async () => {
  const st = mk(); const s = put(st, 'p1', FILL, { src: ['ST6-01'] }); setDeck(st, 'p1', [FILL, FILL]); S.deleteStack(st, 'p1', s.uid, 'trash', 'battle'); await drain(st);
  eq('deck empty', st.players.p1.deck.length, 0); ok('no winner yet', !st.winner);
});
// Q671: ST6-04 may return only purple options of cost 1 or 7 (not cost 2, not other colour)
T(671, 'ST6-04 eligible trash cards', async () => {
  const pOpt = (c) => Object.values(S.CARDS).find(x => x.category === 'option' && x.colors.length === 1 && x.colors[0] === 'purple' && x.cost === c)?.id;
  const oOpt = Object.values(S.CARDS).find(x => x.category === 'option' && x.colors.length === 1 && x.colors[0] === 'red' && x.cost === 1)?.id;
  const st = mk(); setTrash(st, 'p1', [pOpt(1), pOpt(2), pOpt(7), oOpt]); let seen = null; st._qaAns = { pickFromZoneIndex: (o) => { seen = o.eligibleIdxs; return o.eligibleIdxs?.[0] ?? null; } };
  await playCard(st, 'p1', 'ST6-04'); eq('eligible idx', seen, [0, 2]);
});
// Q677: simultaneous 【On Deletion】: turn player's effect resolves first
T(677, 'ST6-15 both sides have on-deletion: turn player first', async () => {
  const st = mk(); const mine = put(st, 'p1', FILL, { src: ['ST6-01'] }); put(st, 'p1', body('purple')); const theirs = put(st, 'p2', FILL, { src: ['ST6-01'] }); setDeck(st, 'p1', [FILL, FILL, FILL]); setDeck(st, 'p2', [FILL, FILL, FILL]);
  await useOption(st, 'p1', 'ST6-15'); const seq = resolved(st).filter(r => r.cardId === 'ST6-01').map(r => r.player); eq('order', seq, ['p1', 'p2']);
});
// Q681/Q683: holder and an opposing digimon deleted at the same time (tie): the holder's inherited deletion trigger does not fire
for (const [q, src] of [[681, 'ST7-03'], [683, 'ST7-05']]) T(q, src + ' simultaneous delete: no inherited trigger', async () => {
  const st = mk(); const a = put(st, 'p1', vanilla(5000), { src: [src] }); const t = put(st, 'p2', vanilla(5000), { susp: true }); await atkDigi(st, 'p1', a.uid, t.uid);
  ok('both gone', !alive(st, 'p1', a) && !alive(st, 'p2', t)); eq('no memory / draw effect', [st.memory, st.players.p1.hand.length], [0, 0]);
});
// Q685: ST7-06 security effect plays after the battle even if it lost/won
T(685, 'ST7-06 plays at battle end even when the attacker wins', async () => {
  const st = mk(); const a = put(st, 'p1', BIG); setSec(st, 'p2', ['ST7-06', LOW]); await atkSec(st, 'p1', a.uid);
  ok('ST7-06 in p2 battle area', st.players.p2.battle.some(s => s.cardId === 'ST7-06'));
});
T(685, 'ST7-06 plays even when the attacker loses', async () => {
  const st = mk(); const a = put(st, 'p1', Object.values(S.CARDS).find(c => c.category === 'digimon' && c.dp === 2000).id); setSec(st, 'p2', ['ST7-06', LOW]); /* 아무 DP 2000 디지몬 */ await atkSec(st, 'p1', a.uid);
  ok('ST7-06 in p2 battle area', st.players.p2.battle.some(s => s.cardId === 'ST7-06'));
});
// Q686: the security digimon appears before the next check of the same attack
T(686, 'ST7-06 appears before the second check', async () => {
  const st = mk(); const a = put(st, 'p1', 'ST1-11', { src: [FILL, FILL] }); setSec(st, 'p2', ['ST7-06', LOW, LOW]); await atkSec(st, 'p1', a.uid);
  const msgs = st.log.map(l => l.msg).reverse(); const iPlay = msgs.findIndex(m => /지오그레이몬.*등장/.test(m)); const iChk2 = msgs.findIndex(m => /시큐리티 체크\(2\//.test(m)); ok('both logged', iPlay >= 0 && iChk2 >= 0); ok('play before 2nd check', iPlay < iChk2);
});
// Q689/Q691: ST7-09: no DP<=4000 digimon => +3000; if one exists it is deleted and no bonus
T(689, 'ST7-09 no target => +3000', async () => { const st = mk(); const a = put(st, 'p1', 'ST7-09'); put(st, 'p2', BIG); secN(st, 'p2', 3); await atkSec(st, 'p1', a.uid); eq('DP', dp(st, 'p1', stackOf(st, 'p1', a.uid)), C('ST7-09').dp + 3000); });
T(690, 'ST7-09 target exists => deleted, no bonus', async () => { const st = mk(); const a = put(st, 'p1', 'ST7-09'); const t = put(st, 'p2', V4); secN(st, 'p2', 3); await atkSec(st, 'p1', a.uid); ok('deleted', !alive(st, 'p2', t)); eq('no bonus', dp(st, 'p1', stackOf(st, 'p1', a.uid)), C('ST7-09').dp); });
// Q695: ST8-01 hand >= 8 -> +1000 (also mid-attack)
T(695, 'ST8-01 hand 8 => +1000', async () => { const st = mk(); const s = put(st, 'p1', FILL, { src: ['ST8-01'] }); setHand(st, 'p1', Array(7).fill(FILL)); eq('7 -> none', dp(st, 'p1', s), FB); st.players.p1.hand.push(FILL); eq('8 -> +1000', dp(st, 'p1', s), FB + 1000); });
// Q703: ST8-09: cannot be blocked during own turn
T(703, 'ST8-09 unblockable', async () => { const st = mk(); const a = put(st, 'p1', 'ST8-09'); put(st, 'p2', BL); secN(st, 'p2', 3); await atkSec(st, 'p1', a.uid); eq('no legal blockers', st.qaLog.blockers, []); });
// Q706/Q707: ST9-02 must open 3 and must take a matching card
T(706, 'ST9-02 opens 3, takes the Free card', async () => {
  const fr = Object.values(S.CARDS).find(x => x.category === 'digimon' && (x.types || []).includes('프리') && x.id !== 'ST9-02')?.id; const st = mk(); setDeck(st, 'p1', [LOW, fr, LOW, LOW, LOW]); const h = st.players.p1.hand.length; await playCard(st, 'p1', 'ST9-02');
  eq('hand +1', st.players.p1.hand.length - h, 1); eq('took the Free card', st.players.p1.hand[st.players.p1.hand.length - 1], fr); eq('deck 5-3+2 = 4 back at bottom', st.players.p1.deck.length, 4);
});
// Q709: ST9-05: on-evolve delete-to-deck-bottom only when jogress evolved
T(709, 'ST9-05 normal evolution: no jogress effect', async () => {
  const st = mk(); const t = put(st, 'p2', 'ST4-04'); const m = put(st, 'p1', FILL); await evolve(st, 'p1', m.uid, 'ST9-05'); ok('opp digimon still here', alive(st, 'p2', t));
});
// Q744: ST10-12 optional discard: declining => nothing opened
T(744, 'ST10-12 may decline the discard', async () => {
  const st = mk(); const m = put(st, 'p1', FILL); setHand(st, 'p1', [FILL]); const d = st.players.p1.deck.length; st._qaAns = { confirmEffect: false, pickFromHandIndexes: [] }; await evolve(st, 'p1', m.uid, 'ST10-12');
  eq('deck only lost the evolution draw', st.players.p1.deck.length, d - 1); eq('nothing discarded', st.players.p1.trash.length, 0);
});
// Q748: ST10-14: digimon put into security is not deleted: no on-deletion effects
T(748, 'ST10-14 not a deletion', async () => {
  const st = mk(); const t = put(st, 'p2', FILL, { src: ['ST6-01'] }); setDeck(st, 'p2', [FILL, FILL, FILL]); put(st, 'p1', DUALYP); await useOption(st, 'p1', 'ST10-14'); eq('no ST6-01 deletion trigger (deck intact)', st.players.p2.deck.length >= 3, true);
  ok('digimon left the battle area', !alive(st, 'p2', t));
});
// Q750/Q751: ST12-01 counts itself; more digimon do not add more
T(750, 'ST12-01 counts itself; max +1000', async () => {
  let st = mk(); let s = put(st, 'p1', FILL, { src: ['ST12-01'] }); eq('alone: none', dp(st, 'p1', s), FB); put(st, 'p1', FILL); eq('2 digimon: +1000', dp(st, 'p1', s), FB + 1000); put(st, 'p1', FILL); put(st, 'p1', FILL); eq('4 digimon: still +1000', dp(st, 'p1', s), FB + 1000);
});
// Q793: ST13-15: only ONE of several highest-DP opponent digimon is deleted
T(793, 'ST13-15 deletes exactly one highest-DP digimon', async () => {
  const st = mk(); put(st, 'p1', FILL); const a = put(st, 'p2', BIG), b = put(st, 'p2', BIG); await useOption(st, 'p1', 'ST13-15'); eq('one left', [alive(st, 'p2', a), alive(st, 'p2', b)].filter(Boolean).length, 1);
});
// Q826: ST17-04: with no opposing Lv3-, the own Lv3- digimon must be deleted
T(826, 'ST17-04 must delete own Lv3', async () => {
  const st = mk(); const mine = put(st, 'p1', FILL); const m4 = put(st, 'p1', body('green', 4)); put(st, 'p2', BIG); await evolve(st, 'p1', m4.uid, 'ST17-04'); ok('own Lv3 deleted', !alive(st, 'p1', mine));
});
const { fail } = await runAll('qa-slice1-st2'); process.exit(fail ? 1 : 0);
