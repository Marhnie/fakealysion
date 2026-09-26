// W8 recheck: BT24-013/026/045 "이 카드가 패에서 파기 되었을 때, 자신의 패가 5장 이하라면 《1 드로우》" (Q5583/5607/5635):
// exactly ONE draw per discarded copy (BT24-045 had a duplicate hardcoded hook -> drew twice), and the "5장 이하" condition is checked at RESOLUTION
// (two copies discarded at once, hand 5: first draws -> 6, second must not draw).
import { S, E, newBoard, mkChoose, drain, scenario, report, F3 } from './lib5.mjs';
for (const id of ['BT24-013', 'BT24-026', 'BT24-045']) {
  await scenario('5583/5607/5635', id + ': single discard draws exactly once', async (chk) => {
    const st = newBoard({ p1: { battle: [F3[1]], hand: [id, F3[5]], deck: F3.slice(10, 20) }, p2: { battle: [F3[0]] }, memory: 3 });
    S.trashFromHand(st, 'p1', 0); await drain(st, mkChoose(st));
    chk(st.players.p1.hand.length === 2, 'hand must be 1 + 1 draw = 2, got ' + st.players.p1.hand.length);
  });
  await scenario('5583/5607/5635', id + ': two copies discarded, hand 5 -> only the first draws', async (chk) => {
    const st = newBoard({ p1: { battle: [F3[1]], hand: [id, id, F3[5], F3[6], F3[7]], deck: F3.slice(10, 20) }, p2: { battle: [F3[0]] }, memory: 3 });
    S.trashFromHand(st, 'p1', 0); S.trashFromHand(st, 'p1', 0); st.players.p1.hand.push(F3[8], F3[9]);
    await drain(st, mkChoose(st));
    chk(st.players.p1.hand.length === 6, 'hand 5 -> 6 (one draw), got ' + st.players.p1.hand.length);
  });
}
report();
