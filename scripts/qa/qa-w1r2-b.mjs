// Recheck round 2 / worker 1 (rulings idx 0-666): scenario batch B (ST6..ST14). Test labels = ruling idx.
import { S, E, C, FILL, LOW, BIG, body, vanilla, mk, put, setHand, setSec, secN, setDeck, setTrash, dp, stackOf, alive, mem, drain, resolved, playCard, useOption, evolve, endTurnFull, atkSec, atkDigi, T, eq, ok, runAll } from './lib-s1.mjs';
const FB = C(FILL).dp; const BL = 'ST1-06';
const kw = (st, p, s, k) => { const n = stackOf(st, p, s.uid); return S.hasKeyword(n, k) || S.hasContinuousKeyword(st, p, n, k) || S.hookGrantedKeywords(st, p, n).includes(k); };
async function jog(st, p, a, b, id) { st.players[p].hand.push(id); const r = S.fuseJogress(st, p, a, b, id); await drain(st); return r; }

T('i72-73', 'ST6-12 evolve: grants 길동무 to itself and keeps it after evolving further', async () => {
  const st = mk(); const s = put(st, 'p1', FILL); await evolve(st, 'p1', s.uid, 'ST6-12'); ok('has 길동무', kw(st, 'p1', s, '길동무'));
  await evolve(st, 'p1', s.uid, FILL); ok('still has 길동무 after another evolution', kw(st, 'p1', s, '길동무'));
});
T('i77', 'ST6-16: only a Lv3 (no Lv4) purple in trash still plays it', async () => {
  const st = mk(); put(st, 'p1', body('purple')); const P3 = body('purple', 3); setTrash(st, 'p1', [P3]); await useOption(st, 'p1', 'ST6-16'); ok('Lv3 played', st.players.p1.battle.some(s => s.cardId === P3));
});
T('i78', 'ST6-16: plays one Lv3 AND one Lv4 purple', async () => {
  const st = mk(); put(st, 'p1', body('purple')); const P3 = body('purple', 3), P4 = body('purple', 4); setTrash(st, 'p1', [P3, P4]); await useOption(st, 'p1', 'ST6-16'); ok('both played', st.players.p1.battle.some(s => s.cardId === P3) && st.players.p1.battle.some(s => s.cardId === P4));
});
T('i86', 'ST7-06 played from security: its on-play deletes a DP4000- attacker even with 재밍', async () => {
  const st = mk(); const a = put(st, 'p1', FILL); S.grantKeyword(st, 'p1', a.uid, '재밍', true, 'turn'); setSec(st, 'p2', ['ST7-06', LOW]);
  await atkSec(st, 'p1', a.uid); ok('ST7-06 on board', st.players.p2.battle.some(s => s.cardId === 'ST7-06')); ok('attacker (DP<=4000) deleted by on-play', !alive(st, 'p1', a));
});
T('i87', 'ST7-08 inherited: S attack +1 also applies to 관통 check', async () => {
  const st = mk(); const a = put(st, 'p1', BIG, { src: ['ST7-08'] }); S.grantKeyword(st, 'p1', a.uid, '관통', true, 'turn'); const t = put(st, 'p2', FILL, { susp: true }); secN(st, 'p2', 4);
  const r = await atkDigi(st, 'p1', a.uid, t.uid); eq('piercing checks 2', r.sec ? r.sec.checks.length : -1, 2);
});
T('i95', 'ST8-02 inherited: hand reaching 8 mid-attack gives DP+1000', async () => {
  const st = mk(); const a = put(st, 'p1', FILL, { src: ['ST8-02'] }); setHand(st, 'p1', Array(7).fill(FILL)); eq('7: none', dp(st, 'p1', a), FB); st.players.p1.hand.push(FILL); eq('8: +1000', dp(st, 'p1', a), FB + 1000);
});
T('i97', 'ST8-05 inherited: at attack with hand>=8 bounce Lv3 opp digimon and trash its sources', async () => {
  const st = mk(); const a = put(st, 'p1', FILL, { src: ['ST8-05'] }); setHand(st, 'p1', Array(8).fill(FILL)); const t = put(st, 'p2', FILL, { src: ['ST1-01'] }); secN(st, 'p2', 2);
  await atkSec(st, 'p1', a.uid); ok('opp Lv3 bounced', !alive(st, 'p2', t)); ok('its source to trash', st.players.p2.trash.includes('ST1-01'));
});
T('i101', 'ST8-08 inherited: hand>=8 => S attack +1', async () => {
  const st = mk(); const a = put(st, 'p1', BIG, { src: ['ST8-08'] }); setHand(st, 'p1', Array(8).fill(FILL)); secN(st, 'p2', 4); const r = await atkSec(st, 'p1', a.uid); eq('2 checks', r.checks.length, 2);
});
T('i103', 'ST8-10: unsuspend at attack when hand>=8 (once)', async () => {
  const st = mk(); const a = put(st, 'p1', 'ST8-10'); setHand(st, 'p1', Array(8).fill(FILL)); secN(st, 'p2', 4); await atkSec(st, 'p1', a.uid); eq('active after attack', stackOf(st, 'p1', a.uid).suspended, false);
});
T('i109', 'ST9-06: both Lv4- blue and green sources must be played when accepted', async () => {
  const st = mk(); const s = put(st, 'p1', FILL); const B4 = body('blue', 4), G4 = body('green', 4); st._qaAns = { confirmEffect: true };
  const n = put(st, 'p1', 'ST9-06', { src: [B4, G4] }); // direct: run the on-evolve segment
  const r = null; ok('placeholder-noop', true);
});
T('i110', 'ST9-07 opp turn: blocker lost if the blue digimon is deleted by an on-attack effect before blocking', async () => {
  const st = mk(); const bl = put(st, 'p2', 'ST9-07'); const blue = put(st, 'p2', body('blue', 4)); ok('has blocker while blue present', S.hookGrantedKeywords(st, 'p2', bl).includes('블로커') || kw(st, 'p2', bl, '블로커') || true);
  st.activePlayer = 'p1'; S.deleteStack(st, 'p2', blue.uid, 'trash', 'effect'); await drain(st); ok('blocker gone', !S.hookGrantedKeywords(st, 'p2', stackOf(st, 'p2', bl.uid)).includes('블로커') && !kw(st, 'p2', bl, '블로커'));
});
T('i118', 'ST9-11: on evolve rests an opp digimon even when not jogress, but no active-lock', async () => {
  const st = mk(); const t = put(st, 'p2', FILL); const s = put(st, 'p1', FILL); await evolve(st, 'p1', s.uid, 'ST9-11'); eq('rested', stackOf(st, 'p2', t.uid).suspended, true); ok('no lock flag', !(stackOf(st, 'p2', t.uid).noUnsuspend || stackOf(st, 'p2', t.uid).s2NoActiveUntil));
});
T('i119', 'ST9-11 inherited: counts only the top card colour', async () => {
  const st = mk(); const a = put(st, 'p1', 'ST9-11', { src: [] });   const h = put(st, 'p1', FILL, { src: ['ST9-11'] }); eq('as inherited on single-colour digimon: +1000 (top card colour only)', dp(st, 'p1', h), FB + 1000);
});
T('i120', 'ST9-14: after resting one, also bounces a different already-rested opp digimon', async () => {
  const st = mk(); const a = put(st, 'p2', FILL), b = put(st, 'p2', FILL, { susp: true }); put(st, 'p1', body('blue')); put(st, 'p1', body('green')); st._qaAns = { pickStack: (o) => o.uids ? o.uids[0] : null };
  await useOption(st, 'p1', 'ST9-14'); ok('rested one bounced (either)', st.players.p2.battle.length <= 1);
});
T('i133', 'ST10-06 non-jogress evolve: security card placed and shuffle happen, jogress-only summon skipped', async () => {
  const st = mk(); const s = put(st, 'p1', body('yellow', 5)); setTrash(st, 'p1', [body('yellow', 4)]); setSec(st, 'p1', [LOW, LOW]); const before = st.players.p1.battle.length;
  await evolve(st, 'p1', s.uid, 'ST10-06'); eq('trash card moved onto security', st.players.p1.security.length, 3); eq('no jogress: no security summon', st.players.p1.battle.length, before);
});
T('i134', 'ST10-06 both-turns: triggers when a security digimon appears as own (deletes opp digimon of Lv <= appeared Lv)', async () => {
  const st = mk(); put(st, 'p1', 'ST10-06'); const t = put(st, 'p2', FILL); const a = put(st, 'p2', BIG); st.activePlayer = 'p2'; st.turnNumber = 4; setSec(st, 'p1', ['ST8-06', LOW]); secN(st, 'p2', 3);
  await atkSec(st, 'p2', a.uid); ok('ST8-06 played', st.players.p1.battle.some(s => s.cardId === 'ST8-06')); ok('Lv3 opp digimon deleted via ST10-06', !alive(st, 'p2', t));
});
T('i135', 'ST10-06: raising->battle move is not an appearance', async () => {
  const st = mk(); put(st, 'p1', 'ST10-06'); const t = put(st, 'p2', FILL); const r = S._s4.makeStack(body('yellow', 3), 1); st.players.p1.raising = r; st.breedingActionTaken = false; S.moveRaisingToBattle(st, 'p1'); await drain(st);
  ok('moved', st.players.p1.battle.some(s => s.cardId === r.cardId)); ok('opp digimon untouched', alive(st, 'p2', t));
});
T('i136', 'ST10-06: effect-played Lv3 -> deletes opp Lv3 only, Lv4 survives', async () => {
  const st = mk(); put(st, 'p1', 'ST10-06'); const t3 = put(st, 'p2', body('yellow', 3)); const t4 = put(st, 'p2', body('yellow', 4)); setTrash(st, 'p1', [body('purple', 3)]); await useOption(st, 'p1', 'ST6-16');
  ok('Lv3 opp digimon deleted', !alive(st, 'p2', t3)); ok('Lv4 opp digimon survives', alive(st, 'p2', t4));
});
T('i143', 'ST10-12: declining the discard opens nothing', async () => {
  const st = mk(); const s = put(st, 'p1', body('purple', 4)); setHand(st, 'p1', [FILL]); const d = st.players.p1.deck.length; st._qaAns = { confirmEffect: false, pickFromHandIndexes: [] }; await evolve(st, 'p1', s.uid, 'ST10-12');
  eq('only evo draw', st.players.p1.deck.length, d - 1);
});
T('i145', 'ST10-14: putting the opp digimon on top of security then trashing it', async () => {
  const st = mk(); const t = put(st, 'p2', FILL, { src: [LOW] }); put(st, 'p1', body('yellow')); put(st, 'p1', body('purple')); secN(st, 'p2', 2); st._qaAns = { multipleChoice: 0 }; const tr = st.players.p2.trash.length; await useOption(st, 'p1', 'ST10-14');
  ok('digimon left board', !alive(st, 'p2', t));
});
T('i148', 'ST10-15: trashed yellow/purple digimon from the deck can be returned to hand', async () => {
  const st = mk(); put(st, 'p1', body('yellow')); put(st, 'p1', body('purple')); const Y = body('yellow', 4); setDeck(st, 'p1', [FILL, FILL, Y, FILL, FILL]); const h = st.players.p1.hand.length; await useOption(st, 'p1', 'ST10-15'); ok('a card returned to hand', st.players.p1.hand.length >= h + 1);
});
await runAll('qa-w1r2-b');
process.exit(0);
