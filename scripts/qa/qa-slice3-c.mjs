// Slice3 Q&A conformance part C: EX1 inherited/attack effects, BT19 options, misc.
import { S, E, Fx, C, newState, put, other, drain, playCard, trig, sc, finish, eq, all, FILL } from './s3lib.mjs';
const cards = Object.values(S.CARDS);
const findC = (pred, n = 1) => cards.filter(pred).slice(0, n).map(c => c.id);
const tam = (pred) => findC(c => c.category === 'tamer' && pred(c))[0];

// Q3187/Q3188 EX1-001 source [on attack]: opened tamer + Agumon-named digimon -> only ONE to hand; colour of the tamer is irrelevant.
await sc('Q3187', 'EX1-001 source: tamer AND Agumon-name both opened -> only one added', async () => {
  const st = newState(); const t = tam(c => !c.colors.includes('red')); const ag = findC(c => c.category === 'digimon' && /아구몬/.test(c.nameKo) && c.id !== 'EX1-001')[0];
  const me = put(st, 'p1', ['EX1-004', 'EX1-001']); st.players.p1.deck = [t, ag, FILL[0], ...FILL.slice(1, 6)];
  await trig(st, 'p1', me, 'attack');
  return eq('hand', st.players.p1.hand.length, 1);
});
await sc('Q3188', 'EX1-001 source: non-red tamer can be added', async () => {
  const st = newState(); const t = tam(c => !c.colors.includes('red'));
  const me = put(st, 'p1', ['EX1-004', 'EX1-001']); st.players.p1.deck = [t, FILL[0], FILL[1], ...FILL.slice(2, 6)];
  await trig(st, 'p1', me, 'attack'); return eq('has tamer', st.players.p1.hand.includes(t), true);
});
// Q3191: EX1-004 source: only a card named exactly 신태일 (cost<=3) may be played; a compound-name tamer is not.
await sc('Q3191', 'EX1-004 source: compound-name tamer is NOT playable, plain-name is', async () => {
  const plain = tam(c => c.nameKo === '신태일' && c.cost <= 3); const comp = tam(c => /신태일/.test(c.nameKo) && c.nameKo !== '신태일' && c.cost <= 3);
  if (!plain || !comp) return 'fixtures ' + plain + ' ' + comp;
  let st = newState(); let me = put(st, 'p1', ['EX1-001', 'EX1-004']); st.players.p1.hand = [comp]; await trig(st, 'p1', me, 'attack');
  const a = st.players.p1.battle.length;
  st = newState(); me = put(st, 'p1', ['EX1-001', 'EX1-004']); st.players.p1.hand = [plain]; await trig(st, 'p1', me, 'attack');
  return all(eq('compound not played', a, 1), eq('plain played', st.players.p1.battle.length, 2));
});
// Q3207: EX1-021 evolve: memory +1 per 4 cards in hand (5 cards -> +1)
await sc('Q3207', 'EX1-021 on evolve: 5 cards in hand -> memory +1', async () => {
  const st = newState(); const me = put(st, 'p1', ['EX1-021']); st.players.p1.hand = FILL.slice(0, 5); st.memory = 0;
  await trig(st, 'p1', me, 'digivolve'); return eq('memory', st.memory, 1);
});
// Q3209: EX1-022 DP +1000 per distinct COLOUR among sources (4 blue sources -> +1000 only)
await sc('Q3209', 'EX1-022 DP bonus counts distinct source colours', async () => {
  const blue = findC(c => c.category === 'digimon' && c.colors.length === 1 && c.colors[0] === 'blue', 4);
  const st = newState(); const me = put(st, 'p1', ['EX1-022', ...blue]); const base = C('EX1-022').dp;
  const red = findC(c => c.category === 'digimon' && c.colors.length === 1 && c.colors[0] === 'red')[0];
  const me2 = put(st, 'p1', ['EX1-022', ...blue, red]);
  return all(eq('one colour', S.effectiveDP(st, 'p1', me) - base, 1000), eq('two colours', S.effectiveDP(st, 'p1', me2) - base, 2000));
});
// Q3210/3212/3214: an already-applied security-count-conditioned DP change is not lost when security later drops
await sc('Q3212', 'EX1-028 source DP+1000 stays after security falls below 3', async () => {
  const st = newState(); const me = put(st, 'p1', ['EX1-029', 'EX1-028']); st.players.p1.security = FILL.slice(0, 3);
  await trig(st, 'p1', me, 'attack'); const d1 = S.effectiveDP(st, 'p1', me); st.players.p1.security.pop(); st.players.p1.security.pop();
  const d2 = S.effectiveDP(st, 'p1', me);
  return all(eq('boosted', d1 - C('EX1-029').dp >= 1000, true), eq('still', d2, d1));
});
// Q3168: BT19-094 main: delete opp digimon until count == own security count (0 security -> all opp digimon deleted)
await sc('Q3168', 'BT19-094 main: own security 0 -> all opp digimon deleted', async () => {
  const st = newState(); for (let i = 0; i < 3; i++) put(st, 'p2', [FILL[i]]);
  st.players.p1.security = []; st.players.p1.hand = ['BT19-094']; put(st, 'p1', [findC(c => c.category === 'digimon' && c.colors.includes('yellow') && c.colors.includes('purple'))[0]]);
  S.useOptionCard(st, 'p1', 0); await drain(st);
  return eq('opp digimon', st.players.p2.battle.length, 0);
});
// Q3135: BT19-075 on play: opp discards down to 5 hand cards; each 2 discarded deletes one opp tamer
await sc('Q3135', 'BT19-075 on play: opp hand 9 -> discards 4 -> deletes 2 opp tamers', async () => {
  const st = newState(); const t = tam(c => true);
  put(st, 'p2', [t]); put(st, 'p2', [tam(c => c.id !== t)]); put(st, 'p2', [tam(c => true)]);
  st.players.p2.hand = FILL.slice(0, 9); const nt = st.players.p2.battle.filter(s => S.card(s.cardId).category === 'tamer').length;
  const me = put(st, 'p1', ['BT19-075']); await trig(st, 'p1', me, 'digivolve');
  const left = st.players.p2.battle.filter(s => S.card(s.cardId).category === 'tamer').length;
  return all(eq('hand', st.players.p2.hand.length, 5), eq('tamers deleted', nt - left, 2));
});
finish('slice3-c');
