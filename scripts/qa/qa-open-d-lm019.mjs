// open-d (4): LM-019 보코몬 group protection also holds when the digimon are deleted together by a RULE CHECK (DP 0 sweep) instead of an effect wipe (orderSimulDelete).
// Run: node scripts/qa/qa-open-d-lm019.mjs < /dev/null
import { S, W, plain, scenario, run } from './lib-s6.mjs';
const gamma = ['P-059', 'BT8-008', 'BT8-013'];
const ids = (w) => w.pl('p1').battle.map((s) => s.cardId);
scenario('D1', 'DP<=0 rule-check sweep: 보코몬 first in the battle order, both 감마몬 hit -> both survive, only 보코몬 goes', async () => {
  const w = W({ p1: { battle: ['LM-019', gamma[0], gamma[1]] }, p2: { battle: [plain(3, 1)] }, active: 'p2' });
  const st = w.st; const stacks = st.players.p1.battle.slice();
  st._rcDepth = 1; for (const s of stacks) S.modifyDP(st, 'p1', s.uid, -99999, 'turn'); st._rcDepth = 0;
  S.flushRuleChecks(st);
  w.eq(ids(w), [gamma[0], gamma[1]], 'gammas stay (DP still <= 0 survivors are checked again but replaced)');
  return w;
});
scenario('D2', 'S.deleteSimul (bespoke wipes): 보코몬 listed first -> still protects both 감마몬, only 보코몬 goes', async () => {
  const w = W({ p1: { battle: ['LM-019', gamma[0], gamma[1]] }, p2: { battle: [plain(3, 1)] }, active: 'p2' });
  const st = w.st; S.beginCause(st);
  S.deleteSimul(st, 'p1', st.players.p1.battle.map((s) => s.uid), 'effect');
  w.eq(ids(w), [gamma[0], gamma[1]], 'gammas stay');
  return w;
});
await run('qa-open-d-lm019');
