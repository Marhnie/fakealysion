// W8 recheck (Q5823 EX11-027 リンク効果): moving the link card under the sources ("링크 카드를 진화원 아래에 놓는 것으로 벗어나지 않는다")
// DOES count as the sources increasing -> a 「이 디지몬의 진화원이 효과로 늘어났을 때」 effect (EX11-045 inherited 【서로의 턴】) triggers.
import { S, E, newBoard, stk, mkChoose, drain, scenario, report, F3 } from './lib5.mjs';
await scenario('5823', 'EX11-027 link effect saves the digimon and fires EX11-045 inherited "진화원이 효과로 늘어났을 때"', async (chk) => {
  const st = newBoard({ p1: { battle: [{ id: F3[1], src: ['EX11-045'] }] }, p2: { battle: [F3[0]] }, memory: 3, active: 'p2', turn: 4 });
  const h = st.players.p1.battle[0];
  h.linkCards = [{ cardId: 'EX11-027', grantedBy: 'EX11-027' }]; S.recomputeStackGrants(h);
  st.pending.length = 0;
  S.deleteStack(st, 'p1', h.uid, 'trash', 'effect');
  chk(st.players.p1.battle.includes(h), 'digimon must stay (link card placed under sources)');
  chk(h.sources[0] === 'EX11-027', 'link card is now the bottom source');
  chk(st.pending.some(t => !t.resolved && t.cardId === 'EX11-045'), 'EX11-045 inherited trigger must be queued: ' + st.pending.map(t => t.cardId).join(','));
});
report();
