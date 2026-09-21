// Slice3 Q&A conformance part G: EX3-EX5 cards.
import { S, E, Fx, C, newState, put, other, drain, playCard, trig, sc, finish, eq, all, FILL } from './s3lib.mjs';
const cards = Object.values(S.CARDS);
const findC = (pred, n = 1) => cards.filter(pred).slice(0, n).map(c => c.id);

// Q3440: EX4-006 on play: speed-rush needs the SUM of both trashes >= 20 (12 + 8)
await sc('Q3440', 'EX4-006 on play: trash 12+8=20 -> Rush granted; 12+7 -> not', async () => {
  const run = async (a, b) => { const st = newState(); st.players.p1.trash = Array(a).fill(FILL[0]); st.players.p2.trash = Array(b).fill(FILL[1]); const me = put(st, 'p1', ['EX4-006']); await trig(st, 'p1', me, 'play'); return S.hasKeyword(me, '속공'); };
  return all(eq('20', await run(12, 8), true), eq('19', await run(12, 7), false));
});
// Q3442/Q3443: EX4-008 on evolve: both decks lose 2 no matter what; return-to-hand is optional
await sc('Q3442', 'EX4-008 on evolve: both decks -2; may decline the return', async () => {
  const st = newState(); const me = put(st, 'p1', ['EX4-008']); const gil = findC(c => c.nameKo === '길몬' && c.category === 'digimon')[0]; st.players.p1.trash = [gil];
  const a = st.players.p1.deck.length, b = st.players.p2.deck.length;
  await trig(st, 'p1', me, 'digivolve', (k) => (k === 'confirmEffect' ? false : (k === 'pickFromZoneIndex' ? null : undefined)));
  return all(eq('own', a - st.players.p1.deck.length, 2), eq('opp', b - st.players.p2.deck.length, 2), eq('declined', st.players.p1.hand.includes(gil), false));
});
// Q3455: EX4-014 (has Blue Flare itself) draws when it itself is played
await sc('Q3455', 'EX4-014: its own entry triggers its own draw', async () => {
  const st = newState(); const d0 = st.players.p1.deck.length; await playCard(st, 'p1', 'EX4-014'); return eq('drew', d0 - st.players.p1.deck.length, 1);
});
// Q3461: EX4-021 on play: all Lv<=4 opp digimon cannot attack until end of opp turn (checked at attack time by current Lv)
await sc('Q3461', 'EX4-021 on play: current Lv<=4 opp digimon cannot attack', async () => {
  const st = newState(); const lo = put(st, 'p2', [FILL[0]]); const hi = put(st, 'p2', [findC(c => c.category === 'digimon' && c.level === 5)[0]]);
  const me = put(st, 'p1', ['EX4-021']); await trig(st, 'p1', me, 'play'); st.activePlayer = 'p2'; st.turnNumber++;
  return all(eq('Lv3 blocked', S.declareAttack(st, 'p2', lo.uid).ok, false), eq('Lv5 free', S.declareAttack(st, 'p2', hi.uid).ok, true));
});
// Q3462 / Q3506: after the first bounce raises the opp hand to 8, the following "if hand >= 8" clause still resolves
await sc('Q3462', 'EX4-022 on evolve: hand 7 -> bounce Lv4 -> 8 -> also bounces Lv6+', async () => {
  const st = newState(); st.players.p2.hand = FILL.slice(0, 7); put(st, 'p2', [findC(c => c.category === 'digimon' && c.level === 4)[0]]); put(st, 'p2', [findC(c => c.category === 'digimon' && c.level === 6)[0]]);
  const me = put(st, 'p1', ['EX4-022']); await trig(st, 'p1', me, 'digivolve'); return eq('opp battle', st.players.p2.battle.length, 0);
});
// Q3475: EX4-030 counts as named Sakuyamon (rule name)
await sc('Q3475', 'EX4-030 is treated as containing the name Sakuyamon', async () => eq('name has', S.cardNameHas('EX4-030', '샤크라몬'), true));
// Q3490/Q3491: EX4-040 on play: a card that counts as Nayura (EX4-062) prevents the "when you have no Nayura" effect
await sc('Q3491', 'EX4-040 on play: own EX4-062 (also named Nayura) -> nothing is played', async () => {
  const nay = findC(c => c.category === 'tamer' && c.nameKo === '노유라')[0];
  let st = newState(); put(st, 'p1', ['EX4-062']); st.players.p1.hand = [nay]; const me = put(st, 'p1', ['EX4-040']); const n0 = st.players.p1.battle.length; await trig(st, 'p1', me, 'play'); const blocked = st.players.p1.battle.length === n0;
  st = newState(); st.players.p1.hand = ['EX4-062']; const me2 = put(st, 'p1', ['EX4-040']); const m0 = st.players.p1.battle.length; await trig(st, 'p1', me2, 'play');
  return all(eq('blocked by EX4-062', blocked, true), eq('EX4-062 playable from hand', st.players.p1.battle.length - m0, 1));
});
// Q3507/3509/3510: EX4-068 main: activations = 1 + number of DISTINCT colours among own digimon (R/B + R/K -> 3 colours -> 4 activations)
await sc('Q3510', 'EX4-068 main: distinct colours only (red/blue + red/black -> 4 activations)', async () => {
  const rb = findC(c => c.category === 'digimon' && c.colors.length === 2 && c.colors.includes('red') && c.colors.includes('blue'))[0]; const rk = findC(c => c.category === 'digimon' && c.colors.length === 2 && c.colors.includes('red') && c.colors.includes('black'))[0];
  const st = newState(); put(st, 'p1', [rb]); put(st, 'p1', [rk]); for (const id of findC(c => c.category === 'digimon' && c.dp >= 7000 && c.dp <= 9000, 6)) put(st, 'p2', [id]);
  put(st, 'p1', [findC(c => c.category === 'digimon' && c.colors.includes('green') && c.level === 3)[0]]); st.players.p1.hand = ['EX4-068']; st.memory = 8;
  let k = 0; const r = S.useOptionCard(st, 'p1', 0); await drain(st, (kind, o) => (kind === 'pickStack' ? o.uids[k++ % o.uids.length] : undefined));
  const sum = st.players.p2.battle.reduce((a, s) => a + (s.tempDP || 0), 0); return eq('total DP change (green adds a 4th colour -> 5x)', sum, -6000 * 5);
});
// Q3513: EX4-070 with no Lv.3 target: still placed in the battle area
await sc('Q3513', 'EX4-070 main: no Lv3 target -> option is still placed (not lost)', async () => {
  const st = newState(); put(st, 'p1', [findC(c => c.category === 'digimon' && c.colors.includes('green') && c.level === 3)[0]]); st.players.p1.hand = ['EX4-070']; st.memory = 5;
  S.useOptionCard(st, 'p1', 0); await drain(st); return eq('not in trash', st.players.p1.trash.includes('EX4-070'), false);
});
// Q3533/Q3534: EX5-009 on play: Deva digimon placed into the raising area triggers no on-play; cannot attack that turn after moving
await sc('Q3533', 'EX5-009 on play: digimon put into raising area gets no on-play', async () => {
  const dv = findC(c => c.category === 'digimon' && (c.types || []).includes('데바') && /【등장 시】/.test(c.effectKo || '') && c.id !== 'EX5-009')[0];
  const st = newState(); st.players.p1.hand = [dv]; const me = put(st, 'p1', ['EX5-009']); const d0 = st.players.p1.deck.length; await trig(st, 'p1', me, 'play');
  return all(eq('in raising', st.players.p1.raising && st.players.p1.raising.cardId, dv), eq('no on-play ran (deck only -1 draw)', d0 - st.players.p1.deck.length, 1));
});
finish('slice3-g');
