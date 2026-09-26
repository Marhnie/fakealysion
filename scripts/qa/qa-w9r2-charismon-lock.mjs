// W9 round-2 fix (official Q6345, BT25-058 칼리스몬 【등장 시】【진화 시】【어택 시】):
// "상대의 디지몬/테이머 1마리(명)를 레스트시킬 수 있다. 그 후, 그 …1마리(명)는 상대의 턴 종료까지 액티브되지 않는다" — the official answer:
// the 「액티브되지 않는다」 may be given to a card OTHER than the one that was rested. Before: the lock always went onto the rested one.
// Run: node scripts/qa/qa-w9r2-charismon-lock.mjs < /dev/null
import { S, W, scenario, run } from './lib-s6.mjs';
scenario('W9-6345', 'BT25-058: rest opponent A, give "does not become active" to a different card B', async () => {
  const w = W({ p1: { battle: ['BT25-058'] }, p2: { battle: ['ST1-04', 'ST1-05'] }, memory: 10 });
  const [a, b] = w.p2.stacks;
  const seq = [a.uid, b.uid]; let i = 0;
  w.answers.pickStack = (o) => (o.uids || []).includes(seq[i]) ? seq[i++] : undefined;
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  w.eq(a.suspended, true, 'A rested');
  w.eq(!!a.cannotUnsuspendUntil, false, 'A is not locked');
  w.eq(!!b.cannotUnsuspendUntil, true, 'B got the lock');
  return w;
});
scenario('W9-6345b', 'BT25-058: default flow (same card) still rests and locks it', async () => {
  const w = W({ p1: { battle: ['BT25-058'] }, p2: { battle: ['ST1-04'] }, memory: 10 });
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  w.eq(w.p2.stacks[0].suspended, true, 'rested'); w.eq(!!w.p2.stacks[0].cannotUnsuspendUntil, true, 'locked');
  return w;
});
await run('w9r2-charismon-lock');
