// Slice-5 official Q&A: the 【자신의 턴】 "이 디지몬이 ...로 진화할 때, 진화 코스트 -1" of a digimon standing in the BREEDING area does not apply (Q5215, 5299, 6164, 6201?, 6254, 6316, 5601, 5612, 5630, 6216...). Same card in the battle area gets the -1.
import { S, E, newBoard, addStack, stk, mkChoose, drain, fire, scenario, report, F3, fillerLv, nm, runOn, zoneNames } from './lib5.mjs';
const target = (pred) => Object.values(S.CARDS).find(c => c.category === 'digimon' && c.level === 4 && pred(c))?.id;
const T = (c, re) => (c.types || []).some(t => re.test(t));
const cases = [
  ['BT23-005', '5215', target(c => T(c, /^파충류형$|^용인형$/))],
  ['ST23-02', '6164', target(c => T(c, /^글로잉 던$/))],
  ['BT25-010', '6254', target(c => T(c, /조|새|병아리|짐승/))],
  ['BT24-033', '5612', target(c => T(c, /^일리아스$/))],
];
for (const [id, q, tgt] of cases) {
  await scenario(q, `${id}: evolve-cost -1 applies in the battle area but NOT in the breeding area`, async (chk) => {
    if (!tgt) { chk(false, 'no fixture'); return; }
    const st = newBoard({ p1: { battle: [id] }, p2: { battle: [] } });
    const b = stk(st, 'p1', id);
    const inBattle = S.previewEvoCostDelta(st, 'p1', b, tgt);
    // move the same stack into the breeding area
    st.players.p1.battle.splice(st.players.p1.battle.indexOf(b), 1); st.players.p1.raising = b;
    const inRaising = S.previewEvoCostDelta(st, 'p1', b, tgt);
    chk(inBattle === -1, 'battle area delta ' + inBattle + ' (want -1)');
    chk(inRaising === 0, 'breeding area delta ' + inRaising + ' (want 0)');
  });
}
report();
