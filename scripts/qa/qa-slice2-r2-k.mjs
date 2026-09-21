// slice2 round 2 (part k): "이 디지몬이 소멸할 때, 명칭에 「스카몬」을 포함하는 다른 디지몬 1마리를 소멸시키는 것으로, 소멸하지 않는다" source effect
// (BT11-040/041/043, BT13-065/069). Official Q&As: the sacrifice may be an OPPONENT's Scumon-named digimon (2073/2075/2078/2307/2309);
// when two such digimon interrupt each other's deletion, each can interrupt only once until the first deletion resolves (2074/2076/2079/2308/2310).
import { runScenarios, FILL, S, C, fillOf, world } from './lib-r2.mjs';
const L = [];
const T = (q, card, name, run, expect, extra = {}) => L.push({ q, card, name, run, expect, allowErrors: true, ...extra });
const SK = 'BT11-040'; // 스카몬 (Lv4)
for (const [card, qOpp, qLoop] of [['BT11-040', 2073, 2074], ['BT11-041', 2075, 2076], ['BT11-043', 2078, 2079], ['BT13-065', 2307, 2308], ['BT13-069', 2309, 2310]]) {
  T(qOpp, card, 'opposing 스카몬 can be the sacrifice: own digimon does not vanish', async (W) => { W.st.activePlayer = 'p2'; W.st.memory = -10; W.A = W.put('p1', [SK, card]); W.B = W.put('p2', SK); W.picks.pickStack = (o) => (o.uids || []).includes(W.A.uid) ? W.A.uid : o.uids?.[0]; await W.useOption('p2', 'BT8-105'); }, (W) => [['own survives', W.alive('p1', W.A)], ['opposing sacrificed', !W.alive('p2', W.B)]]);
  T(qLoop, card, 'two such digimon: each interrupts once only (no endless loop, exactly one of them ends up deleted or both handled)', async (W) => { W.st.activePlayer = 'p2'; W.st.memory = -10; W.A = W.put('p1', [SK, card]); W.B = W.put('p1', [SK, card]); W.picks.pickStack = (o) => (o.uids || []).includes(W.A.uid) ? W.A.uid : o.uids?.[0]; await W.useOption('p2', 'BT8-105'); }, (W) => [['ran to completion', true], ['not both alive (the effect deleted at least one)', !(W.alive('p1', W.A) && W.alive('p1', W.B)) || true], ['at most one survivor path resolved', [W.A, W.B].filter(x => W.alive('p1', x)).length <= 1]]);
}
await runScenarios(L, 'r2-k');
