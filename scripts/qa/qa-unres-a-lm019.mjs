// Unresolved-A (2) LM-019 보코몬 (Q4002/4268): one activation of 「…벗어날 때, 이 디지몬을 소멸시키는 것으로, 벗어나지 않는다」 protects ALL the digimon that were leaving.
// Run: node scripts/qa/qa-unres-a-lm019.mjs < /dev/null
import { S, W, plain, scenario, run } from './lib-s6.mjs';

const gamma = ['P-059', 'BT8-008', 'BT8-013'];
const ids = (w) => w.pl('p1').battle.map((s) => s.cardId);
scenario('U2a', 'single destroy: the hit 감마몬 survives, 보코몬 is the cost', async () => {
  const w = W({ p1: { battle: ['LM-019', gamma[0]] }, p2: { battle: [plain(3, 1)] }, active: 'p2' });
  await w.exec('p2', '상대의 디지몬 1마리를 소멸시킨다.', plain(3, 0));
  w.eq(ids(w), [gamma[0]], 'gamma stays, vokomon paid');
  return w;
});
scenario('U2b', 'wipe (destroy all, incl. 보코몬): both 감마몬 survive, only 보코몬 goes (paid once)', async () => {
  const w = W({ p1: { battle: ['LM-019', gamma[0], gamma[1]] }, p2: { battle: [plain(3, 1)] }, active: 'p2' });
  await w.exec('p2', '상대의 디지몬 전부를 소멸시킨다.', plain(3, 0));
  w.eq(ids(w), [gamma[0], gamma[1]], 'both gamma stay');
  return w;
});
scenario('U2c', 'a digimon that does not qualify (no 「감마몬」 in its text) is still destroyed in the same wipe', async () => {
  const w = W({ p1: { battle: ['LM-019', gamma[0], plain(3, 2)] }, p2: { battle: [plain(3, 1)] }, active: 'p2' });
  await w.exec('p2', '상대의 디지몬 전부를 소멸시킨다.', plain(3, 0));
  w.eq(ids(w), [gamma[0]], 'only the qualifying gamma stays');
  return w;
});
scenario('U2d', 'the cause is the OWN effect -> no survive at all (자신의 효과 이외로)', async () => {
  const w = W({ p1: { battle: ['LM-019', gamma[0], gamma[1]] }, p2: {}, active: 'p1' });
  await w.exec('p1', '자신의 디지몬 전부를 소멸시킨다.', plain(3, 0));
  w.eq(ids(w), [], 'everything destroyed by own effect');
  return w;
});
await run('qa-unres-a-lm019');
