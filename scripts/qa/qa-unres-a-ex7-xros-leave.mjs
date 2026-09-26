// Unresolved-A (5) EX7-014 / EX7-049 (Q6718/6719): a battle-area copy chosen as a DigiXros material may use its 【서로의 턴】 「벗어날 때 …등장시킬 수 있다」 effect.
// Run: node scripts/qa/qa-unres-a-ex7-xros-leave.mjs < /dev/null
import { S, W, plain, scenario, run } from './lib-s6.mjs';

for (const [q, mat, zone, want] of [['6718', 'EX7-014', 'hand', 'ST5-07'], ['6719', 'EX7-049', 'trash', 'BT2-011']]) {
  for (const accept of [true, false]) {
    scenario(q + (accept ? 'y' : 'n'), `${mat} as a DigiXros material (Dorbickmon): the ${zone} play is ${accept ? 'used' : 'declined'}`, async () => {
      const w = W({ p1: { battle: [mat], hand: ['EX3-014', want].filter((x) => zone === 'hand' || x !== want), trash: zone === 'trash' ? [want] : [] }, p2: {}, memory: 10 });
      w.answers.confirmEffect = () => accept;
      const mUid = w.p1.stacks[0].uid;
      const hi = w.pl('p1').hand.indexOf('EX3-014');
      const st = S.playDigimonFresh(w.st, 'p1', hi, { materials: [{ kind: 'battle', uid: mUid, cardId: mat }] });
      await w.drain();
      w.ok(!!st, 'Dorbickmon played');
      w.ok(!w.pl('p1').battle.some((s) => s.uid === mUid), 'material left the battle area');
      w.eq(w.pl('p1').battle.some((s) => s.cardId === want), accept, `${want} ${accept ? 'was' : 'was not'} played for free`);
      return w;
    });
  }
}
await run('qa-unres-a-ex7-xros-leave');
