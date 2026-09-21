// Slice-5 official Q&A: candidate filters of "play from hand/trash/sources" effects (which cards are eligible). Q5220/5221 (BT23-012), 5244/5245 (BT23-023), 5278/5279 (BT23-032), 5398-5400 (P-207/208), 5652 (BT24-074), 5618/5619 (BT24-037).
// Expected (own words): eligible = union of the OR-branches (trait-substring OR trait TS/CS OR colour), each restricted by the level cap; a card meeting neither branch or above the cap is not offered.
import { S, E, newBoard, stk, mkChoose, fire, scenario, report, F3, nm, runOn } from './lib5.mjs';
const D = Object.values(S.CARDS).filter(c => c.category === 'digimon' && !c.effectKo?.trim() && !c.inheritedKo?.trim());
const T = (c, re) => (c.types || []).some(t => re.test(t));
const birdish = /조|새|병아리|수|짐승/;
const pick = (f) => D.find(f)?.id;
const A = pick(c => c.level === 4 && T(c, /^새|^조|병아리|짐승/) && !T(c, /^TS$/));             // matches 1st branch only
const Dall = Object.values(S.CARDS).filter(c => c.category === 'digimon');
const B = Dall.find(c => c.level === 4 && T(c, /^TS$/) && !T(c, birdish))?.id;                       // TS only
const Cc = pick(c => c.level === 5 && T(c, /^새|^조|병아리|짐승/));                          // level too high
const Dd = pick(c => c.level === 4 && !T(c, birdish) && !T(c, /^TS$/) && !T(c, /^CS$/));     // neither
const Cs = Dall.find(c => c.level === 4 && T(c, /^CS$/) && !T(c, birdish))?.id;                        // CS only
console.log('fixtures', [A, B, Cc, Dd, Cs].map(x => x && nm(x)));
async function offered(holder, evt, hand, zone = 'hand', setup = {}) {
  const st = newBoard({ p1: { battle: [holder], hand: zone === 'hand' ? hand : [], trash: zone === 'trash' ? hand : [], ...setup }, p2: { battle: [] } });
  let el = null;
  await runOn(st, 'p1', holder, evt, { answer: (k, o) => { if (/^pickFrom(Hand|Zone)/.test(k) && el === null) { el = (o.eligibleIdxs || []).slice(); } return undefined; } });
  return el;
}
for (const [holder, evt, q, need] of [['P-207', 'play', '5398', 'TS'], ['P-207', 'attack', '5399', 'TS']]) {
  await scenario(q, `${holder} ${evt}: bird/beast-or-TS Lv4-`, async (chk) => {
    const hand = [A, B, Cc, Dd];
    const el = await offered(holder, evt, hand, evt === 'attack' ? 'trash' : 'hand');
    chk(el && JSON.stringify(el.sort()) === '[0,1]', 'eligible idxs ' + JSON.stringify(el));
  });
}
await scenario('5220', 'BT23-012 소멸 시: bird/beast-or-CS Lv4- offered, others not', async (chk) => {
  const el = await offered('BT23-012', 'delete', [A, Cs, Cc, Dd, B]);
  chk(el && JSON.stringify(el.sort()) === '[0,1]', 'eligible idxs ' + JSON.stringify(el));
});
report();
