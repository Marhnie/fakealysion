// Round 2 (slice1) part e: BT6/BT7 rulings (colour aliases, security-decrease sources, memory bans, block/redirect timing). Q ids refer to data/rulings/slice1.json (gitignored); outcomes paraphrased.
// Run: node scripts/qa/qa-slice1-r2-e.mjs < /dev/null
import { S, E, C, FILL, LOW, BIG, body, mk, put, setHand, setSec, secN, setDeck, dp, stackOf, alive, mem, drain, resolved, playCard, useOption, evolve, endTurnFull, atkSec, atkDigi, T, eq, ok, runAll } from './lib-s1.mjs';
const FB = C(FILL).dp; const WB = 'ST5-03';
const blockedAtk = async (st, a) => { put(st, 'p2', WB); secN(st, 'p2', 2); return atkSec(st, 'p1', a.uid, { block: st.players.p2.battle.find(s => s.cardId === WB).uid }); };
const lv6 = (col) => Object.values(S.CARDS).find(c => c.category === 'digimon' && c.level === 6 && c.evoNormal && c.evoNormal.level === 5 && c.evoNormal.colors && c.evoNormal.colors.length === 1 && c.evoNormal.colors[0] === col && !c.isParallel)?.id;
const evoOK = (st, p, stk, tgt) => E.evolutionMethods(stk.cardId, tgt, S.evoExtraArg(st, p, stk), S.evolveTargetRestriction(st, p, stk), { state: st, p, stack: stk }).length > 0;

// ---- "counts as colour X as well" (BT6-013 black own turn, BT6-061 red own turn, BT6-077 black mutual turn, BT4-017 yellow own turn) ----
for (const [q, id, col] of [[1407, 'BT6-013', 'black'], [1455, 'BT6-061', 'red']]) {
  T(q, `${id} counts as ${col} on its own turn for evolution conditions`, async () => { const st = mk(); const s = put(st, 'p1', id); const tg = lv6(col); ok('target', !!tg); ok('allowed', evoOK(st, 'p1', s, tg)); const st2 = mk({ me: 'p2' }); const s2 = put(st2, 'p1', id); ok('not on the opponent turn', !evoOK(st2, 'p1', s2, tg)); });
}
for (const [q, id, col] of [[1408, 'BT6-013', 'black'], [1456, 'BT6-061', 'red'], [1174, 'BT4-017', 'yellow'], [1466, 'BT6-077', 'black']]) {
  T(q, `${id} in the breeding area: the colour alias is inactive`, async () => { const st = mk(); const s = S._s4.makeStack(id, 1); st.players.p1.raising = s; const tg = lv6(col); ok('target', !!tg); ok('not allowed', !evoOK(st, 'p1', s, tg)); });
}
T(1466, 'BT6-077 (mutual turns) on the field counts as black on both turns', async () => { const tg = lv6('black'); const st = mk(); const s = put(st, 'p1', 'BT6-077'); ok('own turn', evoOK(st, 'p1', s, tg)); });
T(1173, 'BT4-017 printed colour stays red outside the battle area', async () => { eq('printed', C('BT4-017').colors, ['red']); const st = mk(); const s = put(st, 'p1', 'BT4-017'); ok('yellow only on the field', S.stackColors(s).includes('yellow')); });

// ---- BT6-021: opposing memory-plus ban also blocks 【시큐리티】 effects ----
T(1415, 'BT6-021 opposing: digimon/option memory gain blocked', async () => { const st = mk(); put(st, 'p2', 'BT6-021'); const a = put(st, 'p1', 'BT1-021'); secN(st, 'p2', 2); await atkSec(st, 'p1', a.uid); eq('memory', mem(st, 'p1'), 0); });
T(1416, 'BT6-021 opposing: security effect memory gain blocked', async () => { const st = mk({ me: 'p2' }); put(st, 'p2', 'BT6-021'); const a = put(st, 'p2', BIG); setSec(st, 'p1', ['ST2-13', LOW]); await atkSec(st, 'p2', a.uid); eq('memory', mem(st, 'p1'), 0); });

// ---- attack declared on the player and blocked (BT6-001 yes / BT6-004 no) ----
T(1398, 'BT6-001 source: "attacks a player" effect still applies after being blocked', async () => { const st = mk(); const a = put(st, 'p1', BIG, { src: ['BT6-001'] }); await blockedAtk(st, a); eq('DP', dp(st, 'p1', stackOf(st, 'p1', a.uid)), C(BIG).dp + 1000); });
T(1400, 'BT6-004 source: "attacks a digimon" effect does not apply to a player attack that got blocked', async () => { const st = mk(); const a = put(st, 'p1', BIG, { src: ['BT6-004'] }); const h = st.players.p1.hand.length; await blockedAtk(st, a); eq('no draw', st.players.p1.hand.length - h, 0); });

// ---- security decrease sources (BT6-032/034/040, own turn, once per turn per digimon) ----
const decSec = async (st, p) => { S.trashTopSecurityByEffect(st, p); await drain(st); };
T(1421, 'BT6-032 source on two digimon: one security loss => both draw (2 cards)', async () => { const st = mk(); put(st, 'p1', FILL, { src: ['BT6-032'] }); put(st, 'p1', FILL, { src: ['BT6-032'] }); secN(st, 'p1', 3); await decSec(st, 'p1'); eq('drew 2', st.players.p1.hand.length, 2); });
T(1425, 'BT6-034 source: works when the security was reduced by my own effect', async () => { const st = mk(); put(st, 'p1', FILL, { src: ['BT6-034'] }); secN(st, 'p1', 3); await decSec(st, 'p1'); eq('memory +1', mem(st, 'p1'), 1); });
T(1426, 'BT6-040 source: works when the security was reduced by my own effect', async () => { const st = mk(); put(st, 'p1', FILL, { src: ['BT6-040'] }); const t = put(st, 'p2', BIG); secN(st, 'p1', 3); await decSec(st, 'p1'); eq('DP-2000', dp(st, 'p2', t), C(BIG).dp - 2000); });

// ---- BT6-062 / BT6-067: security attack +1 lasts only while an ACTIVE opposing digimon exists ----
T(1457, 'BT6-062 source: security attack +1 disappears the moment the last active opposing digimon rests', async () => {
  const st = mk(); const h = put(st, 'p1', FILL, { src: ['BT6-062'] }); const o = put(st, 'p2', FILL); ok('with an active opponent', S.securityAttackBonus(h) >= 1); S.restStack(st, 'p2', o.uid); S.recomputeStackGrants(h); eq('after it rests', S.securityAttackBonus(stackOf(st, 'p1', h.uid)), 0);
});
T(1461, 'BT6-067: security attack +1 disappears the moment the last active opposing digimon rests', async () => {
  const st = mk(); const h = put(st, 'p1', 'BT6-067'); const o = put(st, 'p2', FILL); ok('with an active opponent', S.securityAttackBonus(h) >= 1); S.restStack(st, 'p2', o.uid); S.recomputeStackGrants(h); eq('after it rests', S.securityAttackBonus(stackOf(st, 'p1', h.uid)), 0);
});

// ---- BT6-089 / BT6-091 turn-start effects ----
T(1479, 'BT6-089 tamer: equal security counts do not trigger the memory +2', async () => { const st = mk(); put(st, 'p1', 'BT6-089'); secN(st, 'p1', 3); secN(st, 'p2', 3); st.phase = 'unsuspend'; E.nextPhase(st); await drain(st); eq('memory', mem(st, 'p1'), 0); });
// ---- BT6-097: attack/block prohibition applied to a sourceless digimon persists after it gains sources ----
T(1483, 'BT6-097: the attack ban on a sourceless digimon remains after it gains sources', async () => {
  const st = mk(); const t = put(st, 'p2', FILL); for (const col of C('BT6-097').colors) put(st, 'p1', body(col, 4)); await useOption(st, 'p1', 'BT6-097'); await endTurnFull(st); ok('p2 turn', st.activePlayer === 'p2');
  const s = stackOf(st, 'p2', t.uid); await evolve(st, 'p2', s.uid, body('red', 4)); const s2 = stackOf(st, 'p2', t.uid); s2.attackEligibleTurn = 0; secN(st, 'p1', 2); const r = await atkSec(st, 'p2', t.uid); ok('attack declined', !!r.declined);
});
// ---- BT7-005 / BT7-013 sources ----
T(1515, 'BT7-013 source: several opposing digimon deleted at once => memory +1 only', async () => { const st = mk(); put(st, 'p1', FILL, { src: ['BT7-013'] }); const a = put(st, 'p2', 'ST4-04'), b = put(st, 'p2', 'ST4-04'); S.deleteStack(st, 'p2', a.uid, 'trash', 'effect'); S.deleteStack(st, 'p2', b.uid, 'trash', 'effect'); await drain(st); eq('memory', mem(st, 'p1'), 1); });
T(1514, 'BT7-013: with no tamer, playing a red tamer from hand is offered but memory +2 does not follow', async () => { const st = mk(); setHand(st, 'p1', ['ST1-12']); await playCard(st, 'p1', 'BT7-013'); eq('no memory (tamer arrived after the check)', mem(st, 'p1'), 0); });
const { fail } = await runAll('qa-slice1-r2-e'); process.exit(fail ? 1 : 0);
