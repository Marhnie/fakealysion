// Slice-5 official Q&A: a card without a 〈링크〉 ability cannot be linked by "링크시킬 수 있다" effects (Q5241, 5243, 5246, 5280, 5367, 5396, 5442, 5654, 5659, 6056, 6328 ...).
// Expected (own words): from a hand containing one link-capable digimon and one plain digimon of the right level, only the link-capable one is offered / linked; with only the plain one nothing is linked.
import { S, E, newBoard, stk, mkChoose, drain, fire, scenario, report, F3, fillerLv, nm, runOn, zoneNames } from './lib5.mjs';
const lv = (n) => Object.values(S.CARDS).filter(c => c.category === 'digimon' && c.level === n);
const linkable = (n) => lv(n).find(c => /링크\s*:/.test(c.inheritedKo || '') && c.cost != null);
const plain = (n) => lv(n).find(c => !/링크\s*:/.test(c.inheritedKo || '') && !c.effectKo?.trim() && c.dp);
for (const [holder, evt, q, level] of [['BT23-021', 'digivolve', '5241', 3], ['BT23-022', 'digivolve', '5243', 4], ['BT23-033', 'play', '5280', 4]]) {
  await scenario(q, `${holder}: link candidates exclude cards without 〈링크〉`, async (chk) => {
    const L = linkable(level), P = plain(level);
    if (!L || !P) { chk(false, 'fixtures missing'); return; }
    // trash-zone version for BT23-033 (hand? -> "트래시 또는 진화원"), hand version for the others
    const zone = holder === 'BT23-033' ? 'trash' : 'hand';
    let st = newBoard({ p1: { battle: [holder], [zone]: [P.id] }, p2: { battle: [] } });
    await runOn(st, 'p1', holder, evt, {});
    chk((stk(st, 'p1', holder).linkCards || []).length === 0, 'plain card must not be linked');
    st = newBoard({ p1: { battle: [holder], [zone]: [P.id, L.id] }, p2: { battle: [] } });
    await runOn(st, 'p1', holder, evt, { answer: (k, o) => (k === 'pickFromHandIndexes' ? (o.eligibleIdxs || []).slice(0, 1) : k === 'pickFromZoneIndex' ? (o.eligibleIdxs || [])[0] : undefined) });
    const lk = (stk(st, 'p1', holder).linkCards || []).map(x => x.cardId);
    chk(lk.length === 1 && lk[0] === L.id, 'only the link-capable card is linked; got ' + JSON.stringify(lk));
  });
}
report();
