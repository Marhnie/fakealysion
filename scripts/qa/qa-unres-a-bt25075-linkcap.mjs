// Unresolved-A (4) BT25-075 (Q6370): when the 《링크 +1》 grant is lost the excess link cards are discarded at the rule check, and the PLAYER chooses which one.
// Run: node scripts/qa/qa-unres-a-bt25075-linkcap.mjs < /dev/null
import { S, W, scenario, run } from './lib-s6.mjs';

const setup = async (pickIdx) => {
  const w = W({ p1: { battle: ['BT25-075', 'BT25-009'], hand: ['BT25-100', 'BT25-093'] }, p2: {}, memory: 10 });
  const host = w.p1.stacks[1];
  S.linkCardTo(w.st, 'p1', host.uid, 'BT25-100', 'BT25-100', 0, 'hand'); S.linkCardTo(w.st, 'p1', host.uid, 'BT25-093', 'BT25-093', 0, 'hand'); await w.drain();
  w.answers.pickLinkCard = (o) => { w.asked = o; return typeof pickIdx === 'function' ? pickIdx(o) : pickIdx; };
  S.deleteStack(w.st, 'p1', w.p1.stacks[0].uid, 'trash', 'effect'); await w.drain();
  return { w, host };
};
scenario('U4a', 'player picks the OLDER link card (index 0) -> the newer one stays', async () => {
  const { w, host } = await setup(0);
  w.ok(!!w.asked, 'the player was asked'); w.eq(w.asked?.ids, ['BT25-100', 'BT25-093'], 'both link cards offered');
  w.eq((host.linkCards || []).map(l => l.cardId), ['BT25-093'], 'newest kept, chosen (oldest) discarded');
  w.ok(w.pl('p1').trash.includes('BT25-100'), 'discarded card in trash');
  return w;
});
scenario('U4b', 'player picks the NEWER link card (index 1) -> the older one stays (used to always discard the newest)', async () => {
  const { w, host } = await setup(1);
  w.eq((host.linkCards || []).map(l => l.cardId), ['BT25-100'], 'oldest kept');
  w.ok(w.pl('p1').trash.includes('BT25-093'), 'discarded card in trash');
  return w;
});
await run('qa-unres-a-bt25075-linkcap');
