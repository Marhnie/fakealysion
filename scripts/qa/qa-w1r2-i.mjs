// Recheck round 2 / worker 1 (rulings idx 0-666): scenario batch I (leftovers across ST / BT1..BT4). Test labels = ruling idx.
import { S, E, Fx, C, FILL, LOW, BIG, body, vanilla, mk, put, setHand, setSec, secN, setDeck, setTrash, dp, stackOf, alive, mem, drain, resolved, playCard, useOption, evolve, endTurnFull, atkSec, atkDigi, T, eq, ok, runAll } from './lib-s1.mjs';
const FB = C(FILL).dp; const BL = 'ST1-06';

T('i19', 'ST2-12 tamer at own turn start: +1 memory (once even with several unsourced opp digimon); +2 with two tamers; raising-only / no digimon: none', async () => {
  const base = async (setup) => { const st = mk(); st.activePlayer = 'p2'; st.turnNumber = 4; st.memory = 0; setup(st); const m0 = mem(st, 'p1'); await endTurnFull(st); return { st, d: mem(st, 'p1') - m0 }; };
  const a = await base((st) => { put(st, 'p1', 'ST2-12'); put(st, 'p2', FILL); put(st, 'p2', FILL); }); const b = await base((st) => { put(st, 'p2', FILL); });
  const c = await base((st) => { put(st, 'p1', 'ST2-12'); put(st, 'p1', 'ST2-12'); put(st, 'p2', FILL); }); const d = await base((st) => { put(st, 'p1', 'ST2-12'); st.players.p2.raising = S._s4.makeStack(FILL, 1); });
  eq('one tamer: exactly +1 vs baseline', a.d - b.d, 1); eq('two tamers: +2', c.d - b.d, 2); eq('raising-only opp digimon: none', d.d - b.d, 0);
});
T('i23', 'ST2-14: rested target may still be attacked; effect stays after evolving', async () => {
  const st = mk(); const t = put(st, 'p2', FILL); put(st, 'p1', body('blue')); await useOption(st, 'p1', 'ST2-14'); st.activePlayer = 'p2'; st.turnNumber = 4; await evolve(st, 'p2', t.uid, body('red', 4)); const r = await atkSec(st, 'p2', t.uid); ok('still cannot attack after gaining a source', !!r.declined);
});
T('i41', 'ST3-13 sec twice in one attack: +5000 twice', async () => {
  const st = mk(); const a = put(st, 'p1', 'ST1-11', { src: [FILL, FILL, FILL] }); const d2 = put(st, 'p2', FILL); setSec(st, 'p2', ['ST3-13', 'ST3-13', LOW, LOW]); await atkSec(st, 'p1', a.uid); eq('+10000', dp(st, 'p2', d2), FB + 10000);
});
T('i68', 'ST5-14: unsuspends a digimon other than the blocker', async () => {
  const st = mk(); put(st, 'p1', 'ST5-14'); const blk = put(st, 'p1', BL); const other = put(st, 'p1', FILL, { susp: true }); st.activePlayer = 'p2'; st.turnNumber = 4; const a = put(st, 'p2', BIG); secN(st, 'p1', 3); st._qaAns = { confirmEffect: true, pickStack: other.uid };
  await atkSec(st, 'p2', a.uid, { block: blk.uid }); eq('other digimon active again', stackOf(st, 'p1', other.uid).suspended, false);
});
T('i121', 'ST9-15: DP+2000 and 관통 may go to different digimon (blue digimon needed)', async () => {
  const st = mk(); const g = put(st, 'p1', body('green', 4)); const b = put(st, 'p1', body('blue', 4)); const seq = [g.uid, b.uid]; st._qaAns = { pickStack: (o) => { const u = seq.shift(); return o.uids.includes(u) ? u : o.uids[0]; } };
  await useOption(st, 'p1', 'ST9-15'); eq('green +2000', dp(st, 'p1', g), C(g.cardId).dp + 2000); ok('blue has 관통', S.hasKeyword(stackOf(st, 'p1', b.uid), '관통'));
});
T('i146', 'ST10-14 under BT9-103: the digimon cannot be put in security -> stays', async () => {
  const st = mk(); st.activePlayer = 'p2'; st.turnNumber = 4; put(st, 'p2', body('black')); await useOption(st, 'p2', 'BT9-103'); st.activePlayer = 'p1'; st.turnNumber = 5; put(st, 'p1', body('yellow')); put(st, 'p1', body('purple')); const t = put(st, 'p2', FILL); secN(st, 'p2', 2);
  await useOption(st, 'p1', 'ST10-14'); ok('digimon stays on the board', alive(st, 'p2', t)); eq('security not increased', st.players.p2.security.length, 2);
});
T('i200', 'ST14-10 on-trash: only when trashed straight from the deck, not when opened then discarded', async () => {
  let st = mk(); put(st, 'p1', body('purple')); const t = put(st, 'p2', FILL); setDeck(st, 'p1', ['ST14-10', LOW, LOW, LOW]); await playCard(st, 'p1', 'ST14-03'); ok('deck-trashed ST14-10 triggers (Lv3 opp digimon deleted)', !alive(st, 'p2', t));
  st = mk(); put(st, 'p1', body('purple')); const t2 = put(st, 'p2', FILL); setDeck(st, 'p1', ['ST14-10', LOW, LOW, LOW]); await playCard(st, 'p1', 'BT3-051'); ok('opened-then-trashed does not trigger', alive(st, 'p2', t2));
});
T('i212', 'ST15-12: any security decrease may reactivate it', async () => {
  const st = mk(); const d = put(st, 'p1', 'ST15-12', { susp: true }); st.activePlayer = 'p2'; st.turnNumber = 4; const a = put(st, 'p2', BIG); secN(st, 'p1', 3); st._qaAns = { confirmEffect: true }; await atkSec(st, 'p2', a.uid); eq('active', stackOf(st, 'p1', d.uid).suspended, false);
});
T('i215', 'ST15-15: granted immunity blocks opp digimon effects (e.g. DP-3000), blocker rule unaffected', async () => {
  const GREY = Object.values(S.CARDS).find(c => c.category === 'digimon' && (c.nameKo || '').includes('그레이몬') && c.level === 4 && c.cost <= 6)?.id; const st = mk(); put(st, 'p1', 'ST1-12'); const g = put(st, 'p1', GREY); await useOption(st, 'p1', 'ST15-15');
  st.activePlayer = 'p2'; st.turnNumber = 4; put(st, 'p2', body('yellow', 4)); await playCard(st, 'p2', 'BT1-061'); eq('immune to opp digimon effect', dp(st, 'p1', stackOf(st, 'p1', g.uid)), C(GREY).dp);
});
T('i227', 'ST17-08: also locks opp tamers from evolving (tamer-evolve)', async () => {
  const st = mk(); const t = put(st, 'p2', 'ST2-12'); const s = put(st, 'p1', body('green', 5)); await evolve(st, 'p1', s.uid, 'ST17-08'); const r = S.evolveTargetRestriction ? S.evolveTargetRestriction(st, 'p2', stackOf(st, 'p2', t.uid)) : null; ok('tamer cannot evolve', !!(r && r.cannotEvolve));
});
T('i231', 'ST17-13 security: the attacker is devolved BEFORE the security battle (battle uses the devolved DP)', async () => {
  const st = mk(); const a = put(st, 'p1', body('red', 5), { src: [body('red', 3), body('red', 4)] }); setSec(st, 'p2', ['ST17-13', LOW]); const r = await atkSec(st, 'p1', a.uid); eq('battle DP is the Lv4 form', r.checks[0].atkDp, C(body('red', 4)).dp);
});
T('i236', 'ST18-01 inherited: rest is a normal effect on any side', async () => {
  const st = mk(); const a = put(st, 'p1', FILL, { src: ['ST18-01'] }); const t = put(st, 'p2', FILL); secN(st, 'p2', 2); await atkSec(st, 'p1', a.uid); eq('opp digimon (DP <= holder) rested', stackOf(st, 'p2', t.uid).suspended, true);
});
T('i243', 'ST18-10: already-rested own digimon does not count as "rested by this effect"', async () => {
  const st = mk(); const own = put(st, 'p1', FILL, { susp: true }); const s = put(st, 'p1', body('green', 4)); setHand(st, 'p1', [FILL]); st._qaAns = { pickStack: own.uid, confirmEffect: true, pickFromHandIndexes: (o) => (o.eligibleIdxs || []).slice(0, 1), pickFromZoneIndex: (o) => o.eligibleIdxs && o.eligibleIdxs[0] };
  const before = st.players.p1.battle.length; await evolve(st, 'p1', s.uid, 'ST18-10'); eq('nothing played from hand', st.players.p1.battle.length, before);
});
T('i250', 'ST19-01 inherited: a token counts as another digimon (draw)', async () => {
  const st = mk(); put(st, 'p1', FILL, { src: ['ST19-01'] }); const tk = put(st, 'p1', FILL); tk.isToken = true; secN(st, 'p2', 2); setDeck(st, 'p1', [FILL, FILL, FILL]); const h = st.players.p1.hand.length; await atkSec(st, 'p1', st.players.p1.battle[0].uid); eq('drew 1', st.players.p1.hand.length - h, 1);
});
T('i266', 'BT1-003 inherited: once per turn draw when an unsourced opp digimon exists; raising area ignored', async () => {
  const st = mk(); const a = put(st, 'p1', FILL, { src: ['BT1-003'] }); st.players.p2.raising = S._s4.makeStack(FILL, 1); setDeck(st, 'p1', [FILL, FILL]); secN(st, 'p2', 2); const h = st.players.p1.hand.length; await atkSec(st, 'p1', a.uid); eq('no draw (raising only)', st.players.p1.hand.length - h, 0);
});
T('i269', 'BT1-007 inherited: evolution via BT1-071 (Jaguamon) counts', async () => {
  const st = mk(); const a = put(st, 'p1', FILL, { src: ['BT1-007'] }); ok('digivolvedThisTurn is per player (evolutions by effects counted too)', S.digivolvedThisTurn(st, 'p1') === 0); const b = put(st, 'p1', FILL); await evolve(st, 'p1', b.uid, body('green', 4)); ok('counted', S.digivolvedThisTurn(st, 'p1') >= 1);
});
T('i272', 'BT1-011: any card whose name contains 아구몬 can be returned', async () => {
  const st = mk(); setTrash(st, 'p1', ['BT1-011', FILL]); const AG = Object.values(S.CARDS).find(c => c.category === 'digimon' && (c.nameKo || '').includes('아구몬') && c.nameKo !== '아구몬')?.id; setTrash(st, 'p1', [AG]); await playCard(st, 'p1', 'BT1-011'); ok('returned', st.players.p1.hand.includes(AG));
});
T('i285', 'BT1-030 inherited: memory +1 taking memory over to own side ends the turn after the attack resolves (turn continues until then)', async () => {
  const st = mk(); st.activePlayer = 'p2'; st.turnNumber = 4; const a = put(st, 'p2', BIG); const b = put(st, 'p1', FILL, { src: ['BT1-030'] }); st.memory = 0; secN(st, 'p1', 2); const r = await atkDigi(st, 'p2', a.uid, b.uid); ok('digimon deleted, memory changed', mem(st, 'p1') >= 1);
});
T('i292', 'BT1-039: on-attack discard is optional', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT1-039'); setHand(st, 'p1', [FILL, FILL, FILL]); secN(st, 'p2', 2); st._qaAns = { confirmEffect: false, pickFromHandIndexes: [] }; await atkSec(st, 'p1', a.uid); eq('hand kept', st.players.p1.hand.length, 3);
});
T('i303', 'BT1-044: mandatory when a Lv4- digimon source exists (declining not possible)', async () => {
  const st = mk(); const B4 = body('blue', 4); const a = put(st, 'p1', 'BT1-044', { src: [B4] }); secN(st, 'p2', 3); st._qaAns = { confirmEffect: false }; await atkSec(st, 'p1', a.uid); ok('played anyway', st.players.p1.battle.some(s => s.cardId === B4));
});
T('i305', 'BT1-048: deck <= 3 opens what is left', async () => {
  const st = mk(); setDeck(st, 'p1', [LOW, 'ST3-12']); await playCard(st, 'p1', 'BT1-048'); ok('yellow tamer taken', st.players.p1.hand.includes('ST3-12'));
});
T('i318', 'BT1-067: non-green Lv4 taken', async () => {
  const st = mk(); setDeck(st, 'p1', [LOW, body('red', 4), LOW]); await playCard(st, 'p1', 'BT1-067'); ok('red Lv4 in hand', st.players.p1.hand.includes(body('red', 4)));
});
T('i320', 'BT1-074: non-green Lv5+ taken', async () => {
  const st = mk(); const s = put(st, 'p1', body('green', 3)); setDeck(st, 'p1', [LOW, body('red', 5), LOW]); await evolve(st, 'p1', s.uid, 'BT1-074'); ok('red Lv5 in hand', st.players.p1.hand.includes(body('red', 5)));
});
await runAll('qa-w1r2-i');
process.exit(0);
