// W9 round-2 fix (official Q6099 AD1-020 / Q6113 AD1-023 「색이 다른」): "「XX의 다른」으로 참조하는 경우, XX의 정보를 여러 개 가진 카드는 다른 일부를 참조하여 다른 조합으로 취급할 수 있다"
// -> two red/blue cards CAN be chosen as "different colors" (one referenced as red, the other as blue). Before: any shared color made them the same.
// Fixed in: shard14 HYBRID_UNDER (AD1-020/023), effects.js revealPick distinctColors, shard41 EX7-037, shard12 BT18-096, state.js assembly 「색이 서로 다른」 (all via S.colorsAllDistinct).
// Run: node scripts/qa/qa-w9r2-distinct-color.mjs < /dev/null
import { S, C, W, scenario, run } from './lib-s6.mjs';
const hyb = Object.values(S.CARDS).filter((c) => (c.types || []).includes('하이브리드체'));
const dual = hyb.filter((c) => (c.colors || []).length === 2 && c.colors.includes('red') && c.colors.includes('blue')).map((c) => c.id);
const red = hyb.filter((c) => (c.colors || []).length === 1 && c.colors[0] === 'red').map((c) => c.id);
const blue = hyb.filter((c) => (c.colors || []).length === 1 && c.colors[0] === 'blue').map((c) => c.id);
async function place(id, hand) {
  const w = W({ p1: { battle: [id], hand }, p2: {}, memory: 3 });
  w.answers.pickFromRevealed = (o) => o.eligible.slice(0, 1).map((x) => x.i);
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  return w;
}
for (const id of ['AD1-020', 'AD1-023']) {
  scenario('W9-6099-' + id + '-dual', `${id}: two red/blue hybrid cards can both be placed (different colors via different parts)`, async () => {
    const w = await place(id, [dual[0], dual[1]]);
    w.eq(w.p1.stacks[0].sources.length, 2, 'both placed under the tamer');
    return w;
  });
  scenario('W9-6099-' + id + '-same', `${id}: two cards of the same single color -> only one`, async () => {
    const w = await place(id, [red[0], red[1]]);
    w.eq(w.p1.stacks[0].sources.length, 1, 'only one placed');
    return w;
  });
  scenario('W9-6099-' + id + '-rb', `${id}: a red and a blue card are two different colors`, async () => {
    const w = await place(id, [red[0], blue[0]]);
    w.eq(w.p1.stacks[0].sources.length, 2, 'both placed');
    return w;
  });
}
scenario('W9-6099-helper', 'S.colorsAllDistinct: SDR semantics', async () => {
  const w = W({ p1: {}, p2: {} });
  w.eq(S.colorsAllDistinct([['red', 'blue'], ['red', 'blue']]), true, 'two duals');
  w.eq(S.colorsAllDistinct([['red', 'blue'], ['red', 'blue'], ['red', 'blue']]), false, 'three duals need 3 colors');
  w.eq(S.colorsAllDistinct([['red'], ['red', 'blue']]), true, 'red + red/blue');
  w.eq(S.colorsAllDistinct([['red'], ['red']]), false, 'same single color');
  w.eq(S.colorsAllDistinct([['red'], []]), false, 'colorless card');
  return w;
});
await run('w9r2-distinct-color');
