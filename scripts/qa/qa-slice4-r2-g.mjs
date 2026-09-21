// Slice-4 round 2, batch G: "…하는 것으로," costs are all-or-nothing (a cost of N cards cannot be paid with fewer), for ~20 cards.
import { S, E, Fx, newBoard, F3, fillerLv, scenario, report, stk, mkChoose, drain, nm } from './lib5.mjs';
const L3 = fillerLv(3);
const ver = (v) => Object.values(S.CARDS).filter(c => c.category === 'digimon' && (c.types || []).includes(v)).map(c => c.id);
const runSeg = async (st, id, tag, holderId, srcPred, strip = true) => {
  const c = S.card(id); let text = null, tags = null;
  for (const k of ['effectKo', 'inheritedKo']) { const seg = S.parseEffectSegments(c[k] || '').segments.find(s => s.tags.includes(tag) && srcPred(s.body)); if (seg) { text = seg.body; tags = seg.tags; break; } }
  if (!text) throw new Error('no segment ' + id + ' ' + tag);
  const body = strip ? text.replace(/^(\[[^\]]*\]\s*)?.*?(?:했을|때)\s*때,\s*/, '') : text; const h = stk(st, 'p1', holderId);
  const sc = Fx.lookupCardSpecific(id, tags, text, false) || Fx.compileToScript(body);
  await Fx.runScript(sc, { state: st, S, E, self: 'p1', opp: 'p2', sourceCardId: id, sourceStackUid: h.uid, choose: mkChoose(st), trigger: { player: 'p1', cardId: id, stackUid: h.uid, tags }, startAttack() {} });
  return h;
};
// end-of-turn "trash 3 Ver.N cards under this digimon face-down, then evolve": only 2 in the trash -> nothing happens
for (const [q, id, v] of [[4804, 'EX9-049', 'Ver.3'], [4805, 'EX9-050', 'Ver.1'], [4806, 'EX9-052', 'Ver.5'], [4902, 'BT22-049', 'Ver.2']]) {
  await scenario(q, `${id}: cost of 3 ${v} trash cards cannot be paid with only 2 (no partial payment, no evolution)`, async (chk) => {
    const vs = ver(v).filter(x => S.card(x).level <= 4).slice(0, 3);
    const st = newBoard({ p1: { battle: [id], trash: vs.slice(0, 2), hand: [vs[2]] } }); const h = stk(st, 'p1', id); const src0 = h.sources.length;
    const ch = mkChoose(st); S.queueTriggersForStack?.(st, 'p1', h, 'turnEnd');
    await runSeg(st, id, '자신의 턴 종료 시', id, () => true, false);
    chk(st.players.p1.trash.length === 2 && h.sources.length === src0 && h.cardId === id, `trash ${st.players.p1.trash.length} sources ${h.sources.length}`);
    // control: with 3 cards the same script does something (cards leave the trash / the digimon evolves)
    const st2 = newBoard({ p1: { battle: [id], trash: vs.slice(0, 3), hand: [] } }); const h2 = stk(st2, 'p1', id);
    await runSeg(st2, id, '자신의 턴 종료 시', id, () => true, false);
    chk(st2.players.p1.trash.length < 3 || h2.sources.length > 0 || h2.cardId !== id, 'control: 3 cards did not trigger the effect at all');
  });
}
// leave-prevention costs: with too few cards the digimon is simply deleted and the cards stay where they are
const delByOpp = (st, uid) => { st._fxSrc = { player: 'p2', category: 'digimon' }; try { return S.deleteStack(st, 'p1', uid, 'trash', 'effect'); } finally { st._fxSrc = null; } };
await scenario(4408, 'BT20-082: 3 「데크스」 cards from trash are required (2 -> not prevented, the 2 stay in the trash)', async (chk) => {
  const dex = Object.values(S.CARDS).filter(c => c.category === 'digimon' && c.nameKo.includes('데크스')).slice(0, 2).map(c => c.id);
  const st = newBoard({ p1: { battle: ['BT20-082'], trash: dex }, p2: { battle: [F3[1]] } }); const h = stk(st, 'p1', 'BT20-082');
  const ch = mkChoose(st); delByOpp(st, h.uid); await drain(st, ch);
  chk(!stk(st, 'p1', 'BT20-082'), 'digimon was saved with 2 cards'); chk(dex.every(d => st.players.p1.trash.includes(d)) && !st.players.p1.deck.slice(-2).some(d => dex.includes(d)), 'cards moved to deck');
});
await scenario(4571, 'BT21-062: 4 「벰몬」 evolution cards are required (3 -> not prevented, they are not returned)', async (chk) => {
  const bem = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.nameKo === '벰몬')?.id;
  const st = newBoard({ p1: { battle: [{ id: 'BT21-062', src: [bem, bem, bem] }] }, p2: { battle: [F3[1]] } }); const h = stk(st, 'p1', 'BT21-062'); const deck0 = st.players.p1.deck.length;
  delByOpp(st, h.uid); await drain(st, mkChoose(st)); chk(!stk(st, 'p1', 'BT21-062') && st.players.p1.deck.length === deck0, 'deck ' + st.players.p1.deck.length + ' vs ' + deck0);
});
await scenario('4532', 'BT21-022: discarding 3 digimon evolution cards is required (2 -> not prevented)', async (chk) => {
  const st = newBoard({ p1: { battle: [{ id: 'BT21-022', src: [L3[0], L3[1]] }] }, p2: { battle: [F3[1]] } }); const h = stk(st, 'p1', 'BT21-022');
  delByOpp(st, h.uid); await drain(st, mkChoose(st)); chk(!stk(st, 'p1', 'BT21-022'), 'saved with only 2 sources');
});
// direct segment runs: cost "…진화원을 선택하여 2장 파기하는 것으로" with only 1 source
for (const [q, id, tag, pick] of [[5102, 'EX10-034', '서로의 턴', (b) => /진화원을\s*선택하여\s*2장/.test(b)], [5140, 'EX10-055', '서로의 턴', (b) => /진화원을\s*선택하여\s*2장/.test(b)], [5142, 'EX10-056', '서로의 턴', (b) => /진화원을\s*선택하여\s*2장/.test(b)], [5157, 'EX10-058', '서로의 턴', (b) => /진화원을\s*선택하여\s*2장/.test(b)]]) {
  await scenario(q, `${id}: cost "discard 2 evolution cards" cannot be paid with only 1 (nothing is discarded, no effect)`, async (chk) => {
    const st = newBoard({ p1: { battle: [{ id, src: [L3[0]] }], trash: [] }, p2: { battle: [{ id: F3[1], rested: true }], security: F3.slice(2, 5) } }); const h = stk(st, 'p1', id); const sec0 = st.players.p2.security.length, dp0 = S.effectiveDP(st, 'p1', h);
    await runSeg(st, id, tag, id, pick);
    chk(h.sources.length === 1 && st.players.p2.security.length === sec0 && S.effectiveDP(st, 'p1', h) === dp0 && !S.hasKeyword(h, '시큐리티어택'), `sources ${h.sources.length} sec ${st.players.p2.security.length}`);
  });
}
report();
