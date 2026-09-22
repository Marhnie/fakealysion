// Audit g5/tier2-batch3: EX9-074 키메라몬 (official ruling ids 5004/5005) — with 6+ evolution-source
// colours, "이 디지몬의 진화원과 같은 색의 상대 디지몬 1마리씩을 소멸시킨다" (color the different digimon) is
// mandatory and must destroy the MAXIMUM number of opponent Digimon achievable by assigning each a distinct
// colour (a colour used by one Digimon can't also cover another). The FAQ's own example: a red-only Digimon
// and a red+blue Digimon must BOTH be destroyed (red -> the red-only one, blue -> the other) — a naive
// "mark every colour the destroyed Digimon has as used" implementation can instead burn both colours on the
// red+blue pick first and wrongly spare the red-only one. Fixed in src/cards/shard13.js (EX9-074) with a
// bipartite max-matching (Kuhn's algorithm) instead of a pick-order-dependent greedy colour reservation.
// Run: node scripts/qa/qa-audit-g5-t2b3-ex9-074-color-match.mjs < /dev/null
import { S, C, mk, body, drain, T, eq, ok, runAll } from './lib-s1.mjs';

function setup() {
  const st = mk();
  const h = S._s4.makeStack('EX9-074', 1);
  const srcColors = ['red', 'blue', 'green', 'black', 'purple', 'yellow']; // 6 distinct colours -> triggers the "6+" branch
  h.sources = srcColors.map(col => body(col, 3));
  st.players.p1.battle.push(h); S.recomputeStackGrants(h);
  const redOnly = body('red', 4);
  const rb = S._s4.makeStack(body('red', 5), 1); rb.extraColors = ['blue']; // synthetic red+blue target, no printed abilities to interfere
  const ra = S._s4.makeStack(redOnly, 1);
  st.players.p2.battle.push(rb, ra); S.recomputeStackGrants(rb); S.recomputeStackGrants(ra);
  st._qaAns = { pickStack: (o) => o.uids[0] }; // pick greedily in offered order (matches how the OLD buggy loop would be driven)
  return { st, h, rb, ra };
}

T('g5t2b3-ex9074-1', 'EX9-074: red-only + red&blue opponents are BOTH destroyed (order: red&blue picked first internally)', async () => {
  const { st, h, rb, ra } = setup();
  S.queueTriggersForStack(st, 'p1', h, 'play');
  await drain(st);
  ok('red&blue destroyed', !st.players.p2.battle.includes(rb));
  ok('red-only ALSO destroyed', !st.players.p2.battle.includes(ra));
});

T('g5t2b3-ex9074-2', 'EX9-074: fewer than 6 evolution-source colours uses the single-target branch, not the multi-colour match', async () => {
  const st = mk();
  const h = S._s4.makeStack('EX9-074', 1);
  h.sources = ['red', 'blue'].map(col => body(col, 3)); // only 2 colours
  st.players.p1.battle.push(h); S.recomputeStackGrants(h);
  const redOnly = body('red', 4);
  const ra = S._s4.makeStack(redOnly, 1);
  st.players.p2.battle.push(ra); S.recomputeStackGrants(ra);
  st._qaAns = { pickStack: (o) => o.uids[0] };
  S.queueTriggersForStack(st, 'p1', h, 'play');
  await drain(st);
  ok('the single same-colour opponent is destroyed', !st.players.p2.battle.includes(ra));
});
await runAll('qa-audit-g5-t2b3-ex9-074-color-match');
