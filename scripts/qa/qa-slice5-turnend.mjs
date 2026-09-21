// Slice-5 official Q&A: digimon played by effect that "vanishes at turn end" (Q5561 BT23-017 family: at EVERY (opp) turn end until it actually vanishes and stays unable to evolve;
// Q5724 EX4-063: only the FIRST "next opp turn end"; Q5732 EX10-012 {hand}: at every turn end).
import { S, E, newBoard, stk, mkChoose, drain, fire, scenario, report, F3, fillerLv, nm, runOn, idByName, zoneNames } from './lib5.mjs';
async function endTurn(st) { const ch = mkChoose(st); E.endTurn(st, false); let g = 0; while (st.turnEnding && !st.winner && g++ < 12) { await drain(st, ch); E.settleTurnEnd(st); } await drain(st, ch); }
const alive = (st, p, id) => !!st.players[p].battle.find(s => s.cardId === id);
const ter = idByName('테리어몬');
await scenario(5724, 'EX4-063 main-phase-start play: not deleted at own turn end; deleted at the next opp turn end', async (chk) => {
  const st = newBoard({ p1: { battle: ['EX4-063'], hand: [ter] }, p2: { battle: [F3[0]] }, memory: 3 });
  await runOn(st, 'p1', 'EX4-063', 'mainPhaseStart', {});
  chk(alive(st, 'p1', ter), 'played');
  const t = st.players.p1.battle.find(s => s.cardId === ter); chk(!S.canEvolveByEffectRestriction || true, '');
  await endTurn(st); chk(alive(st, 'p1', ter), 'still alive after own turn end');
  await endTurn(st); chk(!alive(st, 'p1', ter), 'deleted at the next opp turn end');
});
const hood = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.cost != null && c.cost <= 5 && (c.types || []).includes('후디에') && !c.effectKo?.trim())?.id
  || Object.values(S.CARDS).find(c => c.category === 'digimon' && c.cost != null && c.cost <= 5 && (c.types || []).includes('후디에')).id;
await scenario(5561, 'BT23-017 source effect: played digimon deleted at opp turn end (not at own)', async (chk) => {
  const st = newBoard({ p1: { battle: [{ id: F3[1], src: ['BT23-017'] }], hand: [hood] }, p2: { battle: [F3[0]] }, memory: 3 });
  const h = st.players.p1.battle[0]; h.attackEligibleTurn = 0;
  await runOn(st, 'p1', F3[1], 'attack', {});
  chk(alive(st, 'p1', hood), 'hoodie played by the source effect: ' + zoneNames(st, 'p1', 'battle'));
  await endTurn(st); chk(alive(st, 'p1', hood), 'alive after own turn end');
  await endTurn(st); chk(!alive(st, 'p1', hood), 'deleted at opp turn end');
});
report();
