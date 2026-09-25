// W9 audit find (id=6792, EX12-036 즉시형 group ruling reused): "【진화 시】 효과는 발휘하지 않는다"가 걸린 디지몬은
// 다른 카드의 "이 디지몬의 【진화 시】 효과 1개를 발휘할 수 있다" 효과로도 강제 발동시킬 수 없다.
// shard42.js(EX12-064)/shard52.js(BT24-079)는 이미 S.evoTrigSuppressed 체크가 있었지만,
// shard41.js의 EX6-043/EX8-074 runTagOf 호출부에는 빠져 있어 억제 중에도 강제로 진화 시 효과를 발동시킬 수 있었다.
// Run: node scripts/qa/qa-w9-ex8074-evosuppress.mjs < /dev/null
import { S, C, plain, W, scenario, run } from './lib-s6.mjs';

function findSeg(id, tagWanted) {
  const segs = S.parseEffectSegments(C(id).effectKo || '').segments;
  return segs.find((s) => s.tags.some((t) => t.includes(tagWanted)) && s.body.includes('【진화 시】 효과 1개'));
}

for (const id of ['EX8-074', 'EX6-043']) {
  scenario(`W9-${id}-suppressed`, `${id}: 【진화 시】 효과가 억제된 동안 자신의 진화 시 효과를 강제 발동할 수 없다 (QA-S6 Q6792)`, async () => {
    const w = W({ p1: { battle: [{ id }] }, p2: { battle: [plain(3, 0)] }, memory: 10 });
    const s = w.p1.stacks[0]; s.noEvoTrigUntil = w.st.turnNumber; // suppressed this turn
    const sg = findSeg(id, '서로의 턴');
    w.ok(!!sg, 'segment found');
    await w.exec('p1', sg.body, id, s.uid, { tags: sg.tags });
    w.eq(w.prompts.length, 0, 'no prompt at all (suppressed effect never even asks)');
    w.eq(w.pl('p2').battle.length, 1, "opponent digimon untouched (진화 시's own destroy never ran)");
    return w;
  });
  scenario(`W9-${id}-normal`, `${id}: 억제되지 않은 상태에서는 여전히 정상적으로 【진화 시】 효과를 강제 발동할 수 있다 (regression guard)`, async () => {
    const w = W({ p1: { battle: [{ id }] }, p2: { battle: [plain(3, 0)] }, memory: 10 });
    const s = w.p1.stacks[0]; // no suppression
    const sg = findSeg(id, '서로의 턴');
    await w.exec('p1', sg.body, id, s.uid, { tags: sg.tags });
    w.ok(w.prompts.length > 0, 'at least one prompt was asked (effect actually attempted)');
    return w;
  });
}
await run('w9-ex8074-evosuppress');
