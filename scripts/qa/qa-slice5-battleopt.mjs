// Slice-5 official Q&A: "배틀 에어리어의 옵션 카드 1장을 파기하는 것으로" costs (P-203 Q5197/5198, BT23-047/055/059 Q5314-5323).
// Expected (own words): the discard may take an option from EITHER player's battle area; without any battle-area option the cost cannot be paid so the rest of the effect does not happen.
import { S, E, newBoard, stk, mkChoose, drain, fire, scenario, report, F3, fillerLv, nm, runOn, zoneNames } from './lib5.mjs';
const opt = Object.values(S.CARDS).find(c => c.category === 'option' && /딜레이/.test(c.effectKo || '')).id;
const optInBattle = (st, p) => { st.players[p].trash.push(opt); return S.placeThisInBattle(st, p, opt); };
const kw = (st) => { const s = stk(st, 'p1', 'P-203'); return !!(S.hasKeyword(s, '관통')) ; };
await scenario(5197, 'P-203: no option in the battle area -> cost unpayable -> no 관통', async (chk) => {
  const st = newBoard({ p1: { battle: ['P-203'] }, p2: { battle: [F3[0]] } });
  await runOn(st, 'p1', 'P-203', 'play', {}); chk(!kw(st), 'must not gain 관통 without discarding an option');
});
await scenario(5197, 'P-203: opponent battle-area option can be discarded for the cost', async (chk) => {
  const st = newBoard({ p1: { battle: ['P-203'] }, p2: { battle: [F3[0]] } }); optInBattle(st, 'p2');
  await runOn(st, 'p1', 'P-203', 'play', {});
  chk(kw(st), 'gains 관통'); chk(!st.players.p2.battle.some(s => s.cardId === opt), 'opp option discarded'); chk(st.players.p2.trash.includes(opt), 'in opp trash');
});
await scenario(5197, 'P-203: own battle-area option can be discarded for the cost', async (chk) => {
  const st = newBoard({ p1: { battle: ['P-203'] }, p2: { battle: [F3[0]] } }); optInBattle(st, 'p1');
  await runOn(st, 'p1', 'P-203', 'play', {});
  chk(kw(st), 'gains 관통'); chk(!st.players.p1.battle.some(s => s.cardId === opt), 'own option discarded');
});
await scenario(5198, 'P-203 【서로의 턴】: fires when either player\'s battle-area option is discarded', async (chk) => {
  for (const who of ['p1', 'p2']) {
    const st = newBoard({ p1: { battle: ['P-203'] }, p2: { battle: [F3[0]] } }); const o = optInBattle(st, who); st.pending.length = 0;
    S.deleteStack ? S.deleteStack(st, who, o.uid, 'trash', 'effect') : null;
    chk(st.pending.some(t => t.cardId === 'P-203' && t.tags.includes('서로의 턴')), `trigger when ${who} option discarded; pending=${JSON.stringify(st.pending.map(t => t.cardId + t.tags))}`);
  }
});
const byCost = (n) => Object.values(S.CARDS).find(c => c.category === 'digimon' && c.level <= 5 && !c.effectKo && !c.inheritedKo && c.cost === n).id;
await scenario('5323', 'BT23-059: with a battle-area option (either side) -> discard it and delete the lowest-cost opp digimon; without one nothing happens', async (chk) => {
  let st = newBoard({ p1: { battle: ['BT23-059'] }, p2: { battle: [byCost(3), byCost(5)] } }); optInBattle(st, 'p2');
  await runOn(st, 'p1', 'BT23-059', 'play', {});
  chk(st.players.p2.battle.length === 1 && S.card(st.players.p2.battle[0].cardId).cost === 5, 'lowest-cost deleted: ' + zoneNames(st, 'p2', 'battle'));
  chk(st.players.p2.trash.includes(opt), 'option discarded');
  st = newBoard({ p1: { battle: ['BT23-059'] }, p2: { battle: [byCost(3), byCost(5)] } });
  await runOn(st, 'p1', 'BT23-059', 'play', {});
  chk(st.players.p2.battle.length === 2, 'nothing deleted without a battle-area option');
});
report();
