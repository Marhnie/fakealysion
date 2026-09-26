// Unresolved-A (3) BT8-095 (Q4705): the attacker loses a security battle but survives through ≪아머 퍼지≫ -> the remaining ≪S 어택≫ checks still happen.
// Run: node scripts/qa/qa-unres-a-bt8095-armorpurge.mjs < /dev/null
import { S, W, plain, scenario, run } from './lib-s6.mjs';

const strong = plain(6, 0);
const weak = plain(3, 0);
scenario('U3a', 'armor-purge attacker (S 어택+1) loses check 1 (survives via 아머 퍼지) -> check 2 still happens', async () => {
  const w = W({ p1: { battle: [{ id: 'BT8-012', src: [plain(3, 1)] }] }, p2: { security: [strong, weak, weak, weak] }, memory: 3 });
  const a = w.p1.stacks[0]; a.keywords = { ...(a.keywords || {}), '시큐리티어택': 1 };
  const sec0 = w.pl('p2').security.length;
  await w.attack('p1', a.uid, 'PLAYER');
  w.eq(sec0 - w.pl('p2').security.length, 2, 'two security cards checked');
  w.ok(w.pl('p1').battle.some(s => s.uid === a.uid), 'attacker still in the battle area (top card purged)');
  w.eq(w.pl('p1').battle.find(s => s.uid === a.uid)?.sources.length, 0, 'source was trashed by 아머 퍼지');
  return w;
});
scenario('U3b', 'without a survival effect the loser is deleted and the remaining check does NOT happen', async () => {
  const w = W({ p1: { battle: [{ id: 'BT8-012', src: [] }] }, p2: { security: [strong, weak, weak, weak] }, memory: 3 });
  const a = w.p1.stacks[0]; a.keywords = { ...(a.keywords || {}), '시큐리티어택': 1 };
  const sec0 = w.pl('p2').security.length;
  await w.attack('p1', a.uid, 'PLAYER');
  w.eq(sec0 - w.pl('p2').security.length, 1, 'only one check');
  w.ok(!w.pl('p1').battle.some(s => s.uid === a.uid), 'attacker deleted');
  return w;
});
await run('qa-unres-a-bt8095-armorpurge');
