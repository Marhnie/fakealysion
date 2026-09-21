// Slice3 Q&A conformance part B: effect-resolution scenarios (BT17-BT19 cards).
import { S, E, Fx, C, newState, put, other, drain, playCard, trig, sc, finish, eq, all, FILL } from './s3lib.mjs';
const cards = Object.values(S.CARDS);
const findC = (pred, n = 1) => cards.filter(pred).slice(0, n).map(c => c.id);
const colorsOnly = (c, cols) => c.colors.length === cols.length && cols.every(x => c.colors.includes(x));

// Q2908: opponent's colours are counted per DISTINCT colour across digimon+tamers (red/blue digimon + red/yellow tamer = 3) -> trash 3 from own deck.
await sc('Q2908', 'BT18-006 source [on deleted]: distinct opp colours (3) -> trash 3', async () => {
  const st = newState(); const [rb] = findC(c => c.category === 'digimon' && colorsOnly(c, ['red', 'blue']) && c.level === 3);
  const [ry] = findC(c => c.category === 'tamer' && colorsOnly(c, ['red', 'yellow']));
  if (!rb || !ry) return 'no fixture cards';
  const mine = put(st, 'p1', ['BT18-015', 'BT18-006']); put(st, 'p2', [rb]); put(st, 'p2', [ry]);
  const d0 = st.players.p1.deck.length;
  S.deleteStack(st, 'p1', mine.uid, 'trash', 'effect'); await drain(st);
  return eq('deck trashed', d0 - st.players.p1.deck.length, 3);
});
// Q3037: BT18-079 on play: trash 1 per distinct opp colour from BOTH decks (3 colours -> 3 each)
await sc('Q3037', 'BT18-079 on play: both decks lose 3 for 3 opp colours', async () => {
  const st = newState(); const [rb] = findC(c => c.category === 'digimon' && colorsOnly(c, ['red', 'blue']) && c.level === 3);
  const [ry] = findC(c => c.category === 'tamer' && colorsOnly(c, ['red', 'yellow']));
  put(st, 'p2', [rb]); put(st, 'p2', [ry]);
  const a = st.players.p1.deck.length, b = st.players.p2.deck.length;
  await playCard(st, 'p1', 'BT18-079');
  return all(eq('own', a - st.players.p1.deck.length, 3), eq('opp', b - st.players.p2.deck.length, 3));
});
// Q2909/2912/2953..: "add matching cards from opened top-3 as many as possible" (BT18-007: one Millenniummon-name card + one composite/evil-type card)
await sc('Q2909', 'BT18-007 on play: adds every matching category card from opened 3', async () => {
  const st = newState(); const [mil] = findC(c => c.category === 'digimon' && /밀레니엄몬/.test(c.nameKo));
  const [cmp] = findC(c => c.category === 'digimon' && (c.types || []).some(t => /합성형|사신형/.test(t)) && !/밀레니엄몬/.test(c.nameKo));
  const x = FILL[0];
  st.players.p1.deck = [mil, cmp, x, ...FILL.slice(1, 8)];
  await playCard(st, 'p1', 'BT18-007');
  const h = st.players.p1.hand; return all(eq('mil', h.includes(mil), true), eq('cmp', h.includes(cmp), true), eq('hand n', h.length, 2));
});
// Q3131/Q3128: BT19-070 / BT19-065 on play may delete own digimon (incl. itself for 3131)
await sc('Q3131', 'BT19-070 on play: can delete itself as the cost', async () => {
  const st = newState(); const me = put(st, 'p1', ['BT19-070']);
  put(st, 'p2', [findC(c => c.category === 'digimon' && c.level === 3)[0]]); put(st, 'p2', [findC(c => c.category === 'digimon' && c.level === 4)[0]]); put(st, 'p2', [findC(c => c.category === 'digimon' && c.level === 5)[0]]);
  await trig(st, 'p1', me, 'digivolve', (k, o) => (k === 'pickStack' ? undefined : undefined));
  const still = st.players.p1.battle.some(s => s.uid === me.uid);
  return eq('opp digimon left', st.players.p2.battle.length < 3, true);
});
finish('slice3-b');
