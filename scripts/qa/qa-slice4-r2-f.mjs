// Slice-4 round 2, batch F: link cards ("이 디지몬의 링크 카드 1장을 파기하는 것으로 …") and effect-linking rules.
import { S, E, Fx, newBoard, F3, fillerLv, scenario, report, stk, mkChoose, drain, nm, fire } from './lib5.mjs';
const L2 = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.level === 3 && /링크\s*:/.test(c.inheritedKo || '')).id;
const OTHER = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.level === 4 && /링크\s*:/.test(c.inheritedKo || '') && c.id !== L2).id;
// [card, Q "may discard another link card", Q "may discard itself"]
const LK = [['BT21-073', 4583, 5000], ['EX10-014', 5043, 5042], ['EX10-016', 5047, 5046], ['EX10-017', 5049, 5048], ['EX10-019', 5052, 5051], ['EX10-024', 5077, 5076], ['EX10-029', 5085, 5084], ['EX10-030', 5089, 5086], ['EX10-038', 5118, 5117], ['EX10-043', 5125, 5123]];
const linkSeg = (id) => { const segs = S.parseEffectSegments(S.card(id).inheritedKo || '').segments; return segs.find(s => /링크\s*카드\s*1\s*장을\s*파기하는\s*것으로/.test(s.body)); };
for (const [id, qOther, qSelf] of LK) {
  for (const [q, self] of [[qOther, false], [qSelf, true]]) {
    await scenario(q, `${id}: the cost "discard 1 link card" may pick ${self ? 'this card itself' : 'a different link card'} among several`, async (chk) => {
      const seg = linkSeg(id); if (!seg) { chk(true, 'no such segment'); return; }
      const st = newBoard({ p1: { battle: [F3[0]] }, p2: { battle: [F3[1], F3[2]] } }); const h = stk(st, 'p1', F3[0]); h.attackEligibleTurn = 0;
      h.linkCards = [{ cardId: id }, { cardId: OTHER }]; S.recomputeStackGrants(h);
      const want = self ? 0 : 1; let picked = null;
      const ch = mkChoose(st, { answer: (k, o) => { if (k === 'pickLinkCard') { picked = o; return want; } return undefined; } });
      const sc = (id === 'EX10-017' ? null : Fx.lookupCardSpecific(id, seg.tags, seg.body, true)) || Fx.compileToScript(seg.body.replace(/^.*?했을\s*때,\s*/, ''));
      const before = h.linkCards.length;
      await Fx.runScript(sc, { state: st, S, E, self: 'p1', opp: 'p2', sourceCardId: id, sourceStackUid: h.uid, choose: ch, trigger: { player: 'p1', cardId: id, stackUid: h.uid, tags: seg.tags, inherited: true }, startAttack() {} });
      const left = h.linkCards.map(x => x.cardId);
      // a leave-prevention cost is only paid when the leave really happens; the attack/other variants pay it when the effect runs
      chk(before === 2 && (left.length === 1 || /벗어나지/.test(seg.body)), 'link cards after: ' + JSON.stringify(left) + ' picker=' + !!picked);
      if (left.length === 1) chk(self ? left[0] === OTHER : left[0] === id, 'wrong card discarded: ' + JSON.stringify(left));
    });
  }
}
// 4533 family: a card without a 〈링크〉 ability cannot be linked by "링크할 수 있다" effects (own hand/trash/source zone, Lv.4 or lower)
const plain4 = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.level === 3 && !/링크\s*:/.test(c.inheritedKo || '') && !c.effectKo?.trim() && c.dp).id;
for (const [q, id] of [[4533, 'BT21-023'], [4581, 'BT21-073'], [4881, 'BT22-035'], [4938, 'BT22-075'], [5053, 'EX10-019'], [5087, 'EX10-030']]) {
  await scenario(q, id + ': 【등장 시】【진화 시】 link effect refuses a card without 〈링크〉', async (chk) => {
    for (const zone of ['hand', 'trash']) {
      const st = newBoard({ p1: { battle: [{ id, src: [plain4] }], [zone]: [plain4] }, p2: { battle: [F3[1]] } });
      const ch = mkChoose(st); await fire(st, 'p1', stk(st, 'p1', id), 'digivolve', ch);
      chk((stk(st, 'p1', id).linkCards || []).length === 0, 'plain card linked from ' + zone);
    }
  });
}
report();
