// Slice3 Q&A conformance part H: EX5 cards.
import { S, E, Fx, C, newState, put, other, drain, playCard, trig, sc, finish, eq, all, FILL } from './s3lib.mjs';
const cards = Object.values(S.CARDS);
const findC = (pred, n = 1) => cards.filter(pred).slice(0, n).map(c => c.id);

// Q3554: EX5-015 on play: two Garurumon-name cards + one X-antibody card opened -> takes both Garurumon cards (2 cards)
await sc('Q3554', 'EX5-015: takes up to 2 matching cards, both may be the same category', async () => {
  const g = findC(c => /가루몬/.test(c.nameKo) && c.category === 'digimon', 2); const st = newState();
  st.players.p1.deck = [g[0], g[1], FILL[0], FILL[1], FILL[2], ...FILL.slice(3, 9)]; await playCard(st, 'p1', 'EX5-015');
  const added = [g[0], g[1]].filter(x => st.players.p1.hand.includes(x) || st.players.p1.trash.includes(x)); return all(eq('both added (then 1 discarded by the follow-up clause)', added.length, 2), eq('hand after discard', st.players.p1.hand.length, 1));
});
// Q3583: EX5-023 on evolve: hand 2 cards cannot be paid -> rest stays (whole "by discarding" clause skipped)
await sc('Q3583', 'EX5-023 on evolve: cannot pay 2 hand cards -> stays rested', async () => {
  const st = newState(); const me = put(st, 'p1', ['EX5-023'], { rest: true }); st.players.p1.hand = [FILL[0]]; await trig(st, 'p1', me, 'digivolve');
  return all(eq('rested', me.suspended, true), eq('hand kept', st.players.p1.hand.length, 1));
});
// Q3584: EX5-025 "once per turn" is shared by on-evolve and on-attack (second one does not resolve)
await sc('Q3584', 'EX5-025: evolve then attack same turn -> second trigger does not fire', async () => {
  const st = newState(); const me = put(st, 'p1', ['EX5-025', FILL[1]]); const t = put(st, 'p2', [FILL[2], FILL[3]]);
  const r1 = await trig(st, 'p1', me, 'digivolve'); const r2 = await trig(st, 'p1', me, 'attack');
  return all(eq('first ran', r1.some(x => x.startsWith('EX5-025')), true), eq('second did not', r2.some(x => x.startsWith('EX5-025')), false));
});
// Q3586/Q3587: EX5-025: opp digimon without sources can't rest (also ones entering later); once it gets a source it can
await sc('Q3586', 'EX5-025: later-entering source-less opp digimon cannot rest; with a source it can', async () => {
  const st = newState(); const me = put(st, 'p1', ['EX5-025', FILL[1]]); const t = put(st, 'p2', [FILL[2], FILL[3]]); await trig(st, 'p1', me, 'digivolve');
  const late = put(st, 'p2', [FILL[4]]); S.restStack(st, 'p2', late.uid, 'effect'); const bare = late.suspended;
  late.sources.push(FILL[5]); S.restStack(st, 'p2', late.uid, 'effect');
  return all(eq('bare cannot rest', bare, false), eq('with source can', late.suspended, true));
});
// Q3590: EX5-026 on evolve (with Metalgarurumon source): digimon that enter later also get "on attack: memory -4"
await sc('Q3590', 'EX5-026: later-entering opp digimon also carry the granted attack effect', async () => {
  const mg = findC(c => c.nameKo === '메탈가루몬' && c.category === 'digimon')[0]; const st = newState(); const me = put(st, 'p1', ['EX5-026', mg]); await trig(st, 'p1', me, 'digivolve');
  st.activePlayer = 'p2'; st.turnNumber++; const late = put(st, 'p2', [FILL[2]]); const m0 = st.memory; await trig(st, 'p2', late, 'attack'); return eq('memory moved toward p1 by 4', st.memory - m0, 4);
});
// Q3592/Q3593: EX5-028 on play: plays a yellow tamer only if the SUM of both security stacks <= 6
await sc('Q3592', 'EX5-028 on play: security sum 6 -> yellow tamer played; 7 -> not', async () => {
  const yt = findC(c => c.category === 'tamer' && c.colors.length === 1 && c.colors[0] === 'yellow' && c.cost <= 20)[0];
  const run = async (a, b) => { const st = newState(); st.players.p1.security = FILL.slice(0, a); st.players.p2.security = FILL.slice(0, b); st.players.p1.hand = [yt]; const me = put(st, 'p1', ['EX5-028']); const n0 = st.players.p1.battle.length; await trig(st, 'p1', me, 'play'); return st.players.p1.battle.length - n0; };
  return all(eq('3+3', await run(3, 3), 1), eq('3+4', await run(3, 4), 0));
});
// Q3595: EX5-031 on evolve while ACTIVE: may still trash own top security
await sc('Q3595', 'EX5-031 on evolve: active digimon can still pay the security discard', async () => {
  const st = newState(); const me = put(st, 'p1', ['EX5-031']); st.players.p1.security = FILL.slice(0, 3); await trig(st, 'p1', me, 'digivolve'); return eq('security', st.players.p1.security.length, 2);
});
// Q3597/Q3599: EX5-033 (opp turn): opp digimon with Lv >= combined security count get Security Attack -2; drops as count drops
await sc('Q3597', 'EX5-033: Lv >= combined security -> S Attack -2, threshold follows the count', async () => {
  const lv6 = findC(c => c.category === 'digimon' && c.level === 6)[0]; const st = newState(); put(st, 'p1', ['EX5-033']); st.players.p1.security = FILL.slice(0, 3); st.players.p2.security = FILL.slice(0, 3);
  const o = put(st, 'p2', [lv6]); st.activePlayer = 'p2'; const a = S.hookSecurityAttackBonus(st, 'p2', o); st.players.p2.security = FILL.slice(0, 4); const b = S.hookSecurityAttackBonus(st, 'p2', o);
  return all(eq('sum 6 -> -2', a, -2), eq('sum 7 -> 0', b, 0));
});
// Q3666: EX5-063 on play: even if the "opp count >= own count" condition fails, the following "lowest Lv" deletion still resolves
await sc('Q3666', 'EX5-063 on play: first clause condition false -> second clause still deletes lowest Lv', async () => {
  const st = newState(); const me = put(st, 'p1', ['EX5-063']); put(st, 'p1', [FILL[0]]); put(st, 'p1', [FILL[1]]); put(st, 'p2', [FILL[2]]);
  await trig(st, 'p1', me, 'play'); return eq('opp deleted', st.players.p2.battle.length, 0);
});
finish('slice3-h');
