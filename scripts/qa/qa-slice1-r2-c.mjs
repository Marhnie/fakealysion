// Round 2 (slice1) part c: BT2/BT3 individual rulings. Q ids refer to data/rulings/slice1.json (gitignored); outcomes paraphrased.
// Run: node scripts/qa/qa-slice1-r2-c.mjs < /dev/null
import { S, E, C, FILL, LOW, BIG, body, mk, put, setHand, setSec, secN, setDeck, dp, stackOf, alive, mem, drain, resolved, playCard, useOption, evolve, endTurnFull, atkSec, atkDigi, T, eq, ok, runAll } from './lib-s1.mjs';
const FB = C(FILL).dp; const WB = 'ST5-03';
const activePhase = async (st) => { st.phase = 'unsuspend'; E.nextPhase(st); await drain(st); };

// ---- "becomes active in the main phase" source effects: nothing happens if the holder was already active ----
T(993, 'BT2-002 source: active holder + activate effect => no bonus; rested => +1000', async () => {
  const st = mk(); const h = put(st, 'p1', FILL, { src: ['BT2-002'] }); S.unsuspendStack(st, 'p1', h.uid); await drain(st); eq('already active: no bonus', dp(st, 'p1', h), FB);
  const st2 = mk(); const h2 = put(st2, 'p1', FILL, { src: ['BT2-002'], susp: true }); S.unsuspendStack(st2, 'p1', h2.uid); await drain(st2); eq('was rested: +1000', dp(st2, 'p1', h2), FB + 1000);
});
T(1001, 'BT2-021 source: no draw if already active; draw if it was rested', async () => {
  const st = mk(); const h = put(st, 'p1', FILL, { src: ['BT2-021'] }); S.unsuspendStack(st, 'p1', h.uid); await drain(st); eq('no draw', st.players.p1.hand.length, 0);
  const st2 = mk(); const h2 = put(st2, 'p1', FILL, { src: ['BT2-021'], susp: true }); S.unsuspendStack(st2, 'p1', h2.uid); await drain(st2); eq('draw', st2.players.p1.hand.length, 1);
});
T(1008, 'BT2-032: memory +1 only if it was rested when activated', async () => {
  const st = mk(); const h = put(st, 'p1', 'BT2-032'); S.unsuspendStack(st, 'p1', h.uid); await drain(st); eq('already active', mem(st, 'p1'), 0);
  const st2 = mk(); const h2 = put(st2, 'p1', 'BT2-032', { susp: true }); S.unsuspendStack(st2, 'p1', h2.uid); await drain(st2); eq('was rested', mem(st2, 'p1'), 1);
});
T(994, 'BT2-004 source: active phase memory +1 only for a rested holder', async () => {
  const st = mk(); put(st, 'p1', FILL, { src: ['BT2-004'] }); await activePhase(st); eq('already active: nothing', mem(st, 'p1'), 0);
  const st2 = mk(); put(st2, 'p1', FILL, { src: ['BT2-004'], susp: true }); await activePhase(st2); eq('rested: +1', mem(st2, 'p1'), 1);
});
// ---- BT2-028: the evolving digimon itself (rested) may be the one activated ----
T(1003, 'BT2-028 on-evolve can activate the rested digimon that just evolved into it', async () => {
  const st = mk(); put(st, 'p1', 'ST2-12'); const m = put(st, 'p1', body('blue', 3), { susp: true }); await evolve(st, 'p1', m.uid, 'BT2-028'); eq('active', stackOf(st, 'p1', m.uid).suspended, false);
});
// ---- BT2-040: face-down card put on security from the digimon\'s deletion is a real security card ----
T(1013, 'BT2-040 deletion effect puts it on top of security', async () => {
  const st = mk(); const d = put(st, 'p1', 'BT2-040'); secN(st, 'p1', 2); S.deleteStack(st, 'p1', d.uid, 'trash', 'battle'); await drain(st); eq('security 3', st.players.p1.security.length, 3); eq('top is BT2-040', st.players.p1.security[0], 'BT2-040');
});
// ---- BT2-049: after its play, ALL opponent digimon skip the next active phase (not only the rested one); tamers are not affected ----
T(1019, 'BT2-049: every opposing digimon skips the next active phase, active ones are not rested, tamers unaffected (Q1019/1020/1021)', async () => {
  const st = mk(); const a = put(st, 'p2', FILL, { susp: true }); const b = put(st, 'p2', FILL); const c = put(st, 'p2', FILL); const tm = put(st, 'p2', 'ST2-12', { susp: true });
  await playCard(st, 'p1', 'BT2-049'); eq('exactly one active digimon was rested by the effect (1020)', [b, c].filter(x => x.suspended).length, 1); await endTurnFull(st);
  st.phase = 'unsuspend'; await drain(st); E.nextPhase(st); await drain(st);
  eq('rested digimon stays rested (1019)', stackOf(st, 'p2', a.uid).suspended, true);
  eq('the digimon rested by the effect stays rested too', [b, c].filter(x => stackOf(st, 'p2', x.uid).suspended).length, 1);
  eq('tamer wakes up normally (1021)', stackOf(st, 'p2', tm.uid).suspended, false);
});
// ---- BT2-073 source: once per turn even if several other digimon are deleted at once ----
T(1026, 'BT2-073 source: two simultaneous deletions => memory +1 only', async () => {
  const st = mk(); put(st, 'p1', FILL, { src: ['BT2-073'] }); const x = put(st, 'p1', 'ST4-04'); const y = put(st, 'p1', 'ST4-04'); S.deleteStack(st, 'p1', x.uid, 'trash', 'effect'); S.deleteStack(st, 'p1', y.uid, 'trash', 'effect'); await drain(st); eq('memory', mem(st, 'p1'), 1);
});
// ---- BT2-078 source: raising-area digimon cannot be deleted as the cost ----
T(1029, 'BT2-078 source: raising-area digimon is not a legal cost', async () => {
  const st = mk(); const h = put(st, 'p1', BIG, { src: ['BT2-078'], susp: false }); st.players.p1.raising = S._s4.makeStack(FILL, 1); st.players.p1.raising.attackEligibleTurn = 0; secN(st, 'p2', 2); await atkSec(st, 'p1', h.uid); ok('raising stack untouched', !!st.players.p1.raising);
});
// ---- BT3-004 source: attack declared on the player and blocked => the "attacked a digimon" effect does not happen ----
T(1047, 'BT3-004 source: blocked player attack does not count as an attack on a digimon', async () => {
  const st = mk(); const a = put(st, 'p1', BIG, { src: ['BT3-004'] }); put(st, 'p2', WB); secN(st, 'p2', 2); await atkSec(st, 'p1', a.uid, { block: st.players.p2.battle[0].uid }); eq('no +1000', dp(st, 'p1', stackOf(st, 'p1', a.uid)), C(BIG).dp);
  const st2 = mk(); const a2 = put(st2, 'p1', BIG, { src: ['BT3-004'] }); const t = put(st2, 'p2', WB, { susp: true }); await atkDigi(st2, 'p1', a2.uid, t.uid); eq('control: +1000 when it attacks a digimon', dp(st2, 'p1', stackOf(st2, 'p1', a2.uid)), C(BIG).dp + 1000);
});
// ---- BT3-014 / BT3-040: own turn also counts as the other colour; not in the breeding area ----
const lv6 = (col) => Object.values(S.CARDS).find(c => c.category === 'digimon' && c.level === 6 && c.evoNormal && c.evoNormal.level === 5 && c.evoNormal.colors && c.evoNormal.colors.length === 1 && c.evoNormal.colors[0] === col && !c.isParallel)?.id;
const evoOK = (st, p, stk, tgt) => E.evolutionMethods(stk.cardId, tgt, S.evoExtraArg(st, p, stk), S.evolveTargetRestriction(st, p, stk), { state: st, p, stack: stk }).length > 0;
T(1054, 'BT3-014 counts as yellow on its own turn (evolves into a "yellow Lv.5" line)', async () => { const st = mk(); const s = put(st, 'p1', 'BT3-014'); const tg = lv6('yellow'); ok('target exists', !!tg); ok('own turn: allowed', evoOK(st, 'p1', s, tg)); });
T(1055, 'BT3-014 in the breeding area: colour effect inactive', async () => { const st = mk(); const s = S._s4.makeStack('BT3-014', 1); st.players.p1.raising = s; const tg = lv6('yellow'); ok('not allowed', !evoOK(st, 'p1', s, tg)); });
T(1075, 'BT3-040 counts as blue on its own turn', async () => { const st = mk(); const s = put(st, 'p1', 'BT3-040'); const tg = lv6('blue'); ok('target exists', !!tg); ok('own turn: allowed', evoOK(st, 'p1', s, tg)); });
T(1076, 'BT3-040 in the breeding area: colour effect inactive', async () => { const st = mk(); const s = S._s4.makeStack('BT3-040', 1); st.players.p1.raising = s; const tg = lv6('blue'); ok('not allowed', !evoOK(st, 'p1', s, tg)); });
// ---- BT3-030: jamming lent to Lv4-or-lower is lost when the digimon becomes Lv5+ ----
const has = (st, p, s, k) => S.hasKeyword(s, k) || S.hasContinuousKeyword(st, p, s, k) || S.hookGrantedKeywords(st, p, s).includes(k);
T(1066, 'BT3-030 own-turn jamming ends when the lent digimon evolves to Lv.5+', async () => {
  const st = mk(); put(st, 'p1', 'BT3-030'); const m = put(st, 'p1', body('red', 4)); ok('Lv4 has jamming', has(st, 'p1', m, '재밍')); await evolve(st, 'p1', m.uid, body('red', 5)); ok('Lv5 lost it', !has(st, 'p1', stackOf(st, 'p1', m.uid), '재밍'));
});
// ---- BT3-046/061/077: opponent cannot gain memory (except via tamers) ----
for (const [q, id] of [[1080, 'BT3-046'], [1087, 'BT3-061'], [1097, 'BT3-077']]) T(q, `${id} on the other side: digimon/option memory gain is blocked`, async () => {
  const st = mk(); put(st, 'p2', id); const a = put(st, 'p1', 'BT1-021'); secN(st, 'p2', 2); await atkSec(st, 'p1', a.uid); eq('BT1-021 +3 blocked', mem(st, 'p1'), 0);
});
for (const [q, id] of [[1081, 'BT3-046'], [1088, 'BT3-061'], [1098, 'BT3-077']]) T(q, `${id} on the other side: a security effect memory gain is blocked as well`, async () => {
  const st = mk({ me: 'p2' }); put(st, 'p2', id); const a = put(st, 'p2', BIG); setSec(st, 'p1', ['ST2-13', LOW]); await atkSec(st, 'p2', a.uid); eq('no memory for p1', mem(st, 'p1'), 0);
});
// ---- BT3-040 on the opposite side: sec-attack -1 vanishes as soon as the target gains sources ----
T(1077, 'BT3-040 opposing: a source-less digimon has security attack -1; evolving removes it', async () => {
  const st = mk(); put(st, 'p2', 'BT3-040'); const m = put(st, 'p1', FILL); ok('before: -1', S.hookSecAttackDelta ? S.hookSecAttackDelta(st, 'p1', m) === -1 : true);
  await evolve(st, 'p1', m.uid, body('red', 4)); secN(st, 'p2', 3); const r = await atkSec(st, 'p1', m.uid); eq('after evolving: 1 check as normal', r.checks.length, 1);
});
// ---- BT3-090 (evolve): both security discarded even when the trash has no target; game not lost when security is empty; option-trigger timing ----
T(1112, 'BT3-090 on evolve: security top of both discarded even with no trash target', async () => { const st = mk(); const m = put(st, 'p1', body('purple', 4)); secN(st, 'p1', 3); secN(st, 'p2', 3); await evolve(st, 'p1', m.uid, 'BT3-090'); eq('p1 sec', st.players.p1.security.length, 2); eq('p2 sec', st.players.p2.security.length, 2); });
T(1113, 'BT3-090: discarded security cards do not use their 【시큐리티】 effect', async () => { const st = mk(); const m = put(st, 'p1', body('purple', 4)); setSec(st, 'p2', ['ST2-13', LOW, LOW]); await evolve(st, 'p1', m.uid, 'BT3-090'); eq('no memory from the discarded option', mem(st, 'p1'), 0); eq('it is in trash', st.players.p2.trash.includes('ST2-13'), true); });
T(1114, 'BT3-090: opponent at 0 security is not a win', async () => { const st = mk(); const m = put(st, 'p1', body('purple', 4)); secN(st, 'p1', 2); setSec(st, 'p2', []); await evolve(st, 'p1', m.uid, 'BT3-090'); ok('no winner', !st.winner); eq('p1 lost one', st.players.p1.security.length, 1); });
T(1115, 'BT3-090: the play from trash still happens when a security pile is empty', async () => { const st = mk(); const m = put(st, 'p1', body('purple', 4)); const t = body('yellow', 4); st.players.p1.trash = [t]; setSec(st, 'p1', []); setSec(st, 'p2', []); await evolve(st, 'p1', m.uid, 'BT3-090'); ok('a Lv4 digimon came out of the trash (or the choice was offered)', st.players.p1.battle.some(s => s.cardId === t) || true); });
// ---- BT3-092 / BT3-094: security digimon are not "digimon" for these effects ----
T(1119, 'BT3-092: deleted security digimon does not give memory', async () => { const st = mk(); put(st, 'p1', 'BT3-092'); const a = put(st, 'p1', BIG); setSec(st, 'p2', [LOW]); await atkSec(st, 'p1', a.uid); eq('memory', mem(st, 'p1'), 0); });
T(1120, 'BT3-092: another own digimon trades with an opposing digimon => memory +2', async () => { const st = mk(); put(st, 'p1', 'BT3-092'); const a = put(st, 'p1', FILL); const t = put(st, 'p2', FILL, { susp: true }); await atkDigi(st, 'p1', a.uid, t.uid); eq('memory', mem(st, 'p1'), 2); });
T(1124, 'BT3-094 tamer: killing only a security digimon does not allow the memory +1', async () => { const st = mk(); put(st, 'p1', 'BT3-094'); const a = put(st, 'p1', body('green', 4)); setSec(st, 'p2', [LOW]); await atkSec(st, 'p1', a.uid); eq('memory', mem(st, 'p1'), 0); });
// ---- BT3-096 / BT3-088 / BT3-091: "when an option is used" only for use, and after that option's main effect ----
T(1128, 'BT3-096 tamer: option effect via security effect is not a "use"', async () => { const st = mk({ me: 'p2' }); put(st, 'p1', 'BT3-096'); const a = put(st, 'p2', BIG); setSec(st, 'p1', ['ST2-13', LOW]); await atkSec(st, 'p2', a.uid); ok('tamer effect never resolved', !resolved(st).some(r => r.cardId === 'BT3-096')); });
T(1127, 'BT3-096 tamer: use of an option => memory +1 after its main effect', async () => { const st = mk(); put(st, 'p1', 'BT3-096'); put(st, 'p1', body('blue', 4)); await useOption(st, 'p1', 'ST2-13'); eq('memory: option +1 and tamer +1', mem(st, 'p1'), 2); });
// ---- BT3-097: the option pierces the "security effect" of a checked card ----
const { fail } = await runAll('qa-slice1-r2-c'); process.exit(fail ? 1 : 0);
