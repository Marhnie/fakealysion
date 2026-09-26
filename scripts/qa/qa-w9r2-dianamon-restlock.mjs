// W9 round-2 fix (official Q6294 / Q6295, BT25-028 디아나몬 【등장 시】【진화 시】):
// "상대의 턴 종료까지 진화원이 1장 이하인 상대의 디지몬 전부는 레스트할 수 없다" is a DYNAMIC lock over the whole class:
//  - a digimon that arrives later with <=1 sources is also locked (Q6294)
//  - a locked digimon that later has >=2 sources can rest again (Q6295)
// Before the fix the lock was a one-time snapshot of the digimon present when the effect resolved.
// Run: node scripts/qa/qa-w9r2-dianamon-restlock.mjs < /dev/null
import { S, W, scenario, run } from './lib-s6.mjs';
scenario('W9-6294', 'BT25-028: a digimon with <=1 sources that arrives AFTER the effect resolved cannot rest either', async () => {
  const w = W({ p1: { battle: ['BT25-028'] }, p2: { battle: ['ST1-02'] }, memory: 10 });
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  const late = w.mk('p2', 'ST1-04');
  w.eq(S.canRestByRule(w.st, 'p2', late), false, 'late arrival (0 sources) cannot rest');
  const late1 = w.mk('p2', { id: 'ST1-05', src: ['ST1-02'] });
  w.eq(S.canRestByRule(w.st, 'p2', late1), false, 'late arrival with exactly 1 source cannot rest');
  return w;
});
scenario('W9-6295', 'BT25-028: a locked digimon that gets a 2nd source can rest again', async () => {
  const w = W({ p1: { battle: ['BT25-028'] }, p2: { battle: ['ST1-05'] }, memory: 10 });
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  const d = w.p2.stacks[0];
  w.eq(S.canRestByRule(w.st, 'p2', d), false, 'locked while <=1 sources');
  d.sources.push('ST1-02', 'ST1-02');
  w.eq(S.canRestByRule(w.st, 'p2', d), true, 'released with 2 sources');
  return w;
});
scenario('W9-6294b', 'BT25-028: the lock lasts only until the end of the opponent turn', async () => {
  const w = W({ p1: { battle: ['BT25-028'] }, p2: { battle: ['ST1-05'] }, memory: 10 });
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  w.st.turnNumber += 2;
  w.eq(S.canRestByRule(w.st, 'p2', w.p2.stacks[0]), true, 'expired');
  return w;
});
await run('w9r2-dianamon-restlock');
