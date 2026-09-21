// Slice-4 round 2, batch H: "…하는 것으로, A. 그 후/또한, B." — when the cost is not paid nothing (B included) is processed; face-up 【시큐리티】 conditions; hand 【메인】 with no digimon.
import { S, E, Fx, newBoard, F3, fillerLv, scenario, report, stk, mkChoose, drain, pend, nm } from './lib5.mjs';
const L3 = fillerLv(3), L4 = fillerLv(4), L5 = fillerLv(5);
const segOf = (id, tag, pred = () => true) => { for (const k of ['effectKo', 'inheritedKo']) { const seg = S.parseEffectSegments(S.card(id)[k] || '').segments.find(s => s.tags.includes(tag) && pred(s.body)); if (seg) return { ...seg, inherited: k === 'inheritedKo' }; } throw new Error('no seg ' + id + tag); };
const runBody = async (st, id, holder, seg, confirm, strip) => {
  const body = strip ? seg.body.replace(/^(\[[^\]]*\]\s*)?[^,]*?(?:했을|때)\s*때,\s*/, '') : seg.body; const h = holder ? stk(st, 'p1', holder) : null;
  const sc = (!strip && Fx.lookupCardSpecific(id, seg.tags, seg.body, seg.inherited)) || Fx.compileToScript(body);
  await Fx.runScript(sc, { state: st, S, E, self: 'p1', opp: 'p2', sourceCardId: id, sourceStackUid: h ? h.uid : null, choose: mkChoose(st, { answer: (k) => (k === 'confirmEffect' ? confirm : undefined) }), trigger: { player: 'p1', cardId: id, stackUid: h ? h.uid : null, tags: seg.tags }, startAttack(p, uid) { (st._atk ||= []).push([p, uid]); } });
  return h;
};
// BT22-010 / BT22-011 【메인】: cost 2 / 3 memory not paid -> no keywords, no attack
for (const [qs, id] of [[[4867, 4866], 'BT22-010'], [[4869], 'BT22-011']]) {
  await scenario(qs[0], `${id}: declining the memory cost -> the following "또한 …어택" is not processed (accepting does attack)`, async (chk) => {
    for (const yes of [false, true]) {
      const st = newBoard({ p1: { battle: [id] }, p2: { battle: [{ id: L3[0], rested: true }] }, memory: 5 }); const h = stk(st, 'p1', id); h.attackEligibleTurn = 0;
      await runBody(st, id, id, segOf(id, '메인'), yes, false);
      if (!yes) chk((st._atk || []).length === 0 && st.memory === 5, `declined: atk ${(st._atk || []).length} mem ${st.memory}`); else chk((st._atk || []).length === 1 && st.memory === 5 - (id === 'BT22-010' ? 2 : 3), `accepted: atk ${(st._atk || []).length} mem ${st.memory}`);
    }
  });
}
// P-193 【메인】 (4987): no matching card in hand to discard -> no 2 draws (and the tail "place this card" is not processed)
await scenario(4987, 'P-193: without a 합성형/사신형 card to discard nothing else happens (draws, placement)', async (chk) => {
  const fxs = [...new Set(S.card('P-193').colors.map(col => F3.find(x => S.card(x).colors.length === 1 && S.card(x).colors[0] === col) || F3[0]))]; const st = newBoard({ p1: { battle: fxs, hand: ['P-193', F3[3]], deck: F3.slice(4, 10) }, memory: 5 }); const hand0 = st.players.p1.hand.length;
  S.useOptionCard(st, 'p1', 0); await drain(st, mkChoose(st));
  chk(st.players.p1.hand.length === hand0 - 1 && !st.players.p1.battle.some(s => s.cardId === 'P-193'), `hand ${st.players.p1.hand.length} (expected ${hand0 - 1}); option placed: ${st.players.p1.battle.some(s => s.cardId === 'P-193')}`);
});
// EX9-068 / EX9-066 (tamers): the "이 테이머를 레스트시키는 것으로" cost declined -> nothing else
await scenario(4828, 'EX9-068: tamer rest cost declined -> no draw / memory / hand-to-source', async (chk) => {
  const st = newBoard({ p1: { battle: ['EX9-068', F3[0]], hand: [F3[3]], deck: F3.slice(4, 10) }, memory: 1 }); const h0 = st.players.p1.hand.length;
  await runBody(st, 'EX9-068', 'EX9-068', segOf('EX9-068', '자신의 턴'), false, true);
  chk(st.players.p1.hand.length === h0 && st.memory === 1 && !stk(st, 'p1', 'EX9-068').suspended, `hand ${st.players.p1.hand.length} mem ${st.memory}`);
});
await scenario(4826, 'EX9-066: tamer rest cost declined -> no memory gain', async (chk) => {
  const g = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.level <= 5 && c.nameKo.includes('그레이몬')).id;
  const st = newBoard({ p1: { battle: ['EX9-066', g] }, memory: 1 });
  await runBody(st, 'EX9-066', 'EX9-066', segOf('EX9-066', '서로의 턴'), false, true); chk(st.memory === 1, 'memory ' + st.memory);
  const st2 = newBoard({ p1: { battle: ['EX9-066', g] }, memory: 1 }); await runBody(st2, 'EX9-066', 'EX9-066', segOf('EX9-066', '서로의 턴'), true, true); chk(st2.memory >= 2, 'control: accepted -> memory ' + st2.memory);
});
// BT22-086 【자신의 메인 페이즈 개시 시】 (4956): tamer not returned to the deck bottom -> the 「산호몬」 sentence is not processed
await scenario(4956, 'BT22-086: declining the deck-bottom cost -> no 「산호몬」 played from trash even with no digimon', async (chk) => {
  const sango = Object.values(S.CARDS).find(c => c.nameKo === '산호몬')?.id;
  const st = newBoard({ p1: { battle: ['BT22-086'], trash: [sango] } });
  await runBody(st, 'BT22-086', 'BT22-086', segOf('BT22-086', '자신의 메인 페이즈 개시 시'), false, false);
  chk(!st.players.p1.battle.some(s => s.cardId === sango) && !!stk(st, 'p1', 'BT22-086'), 'played anyway');
});
// EX9-043 【등장 시】 (4797): no digimon card in trash to put under -> no 《퇴화》/deletion
await scenario(4797, 'EX9-043: no digimon in trash -> the "또한" deletion (DP 3000 or less) is not processed', async (chk) => {
  const weak = L3.find(id => S.card(id).dp <= 3000 && S.card(id).dp > 0); if (!weak) { chk(true); return; }
  const st = newBoard({ p1: { battle: ['EX9-043'], trash: [] }, p2: { battle: [weak] } });
  await runBody(st, 'EX9-043', 'EX9-043', segOf('EX9-043', '등장 시'), true, false); chk(!!stk(st, 'p2', weak), 'opponent digimon was deleted without paying the cost');
});
// 5037 family: "이 카드가 앞면이었다면" = checked while lying face-up in security
const dark = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.level <= 5 && /어둠의 4천왕/.test(c.effectKo || '') && c.cost != null)?.id;
for (const [q, id] of [[5037, 'EX10-012'], [5064, 'EX10-020'], [5111, 'EX10-035'], [5156, 'EX10-057']]) {
  await scenario(q, `${id}: 【시큐리티】 "이 카드가 앞면이었다면" is met only when checked face-up`, async (chk) => {
    for (const up of [true, false]) {
      const st = newBoard({ p1: { battle: [F3[0]] }, p2: { hand: [dark], security: F3.slice(2, 5) } }); st.players.p2.security.unshift(id); if (up) (st.players.p2.secUp ||= {})[id] = 1;
      const a = stk(st, 'p1', F3[0]); a.attackEligibleTurn = 0; const ctl = S.beginSecurityCheck(st, 'p1', a.uid, 'p2'); ctl.deferBattle = true; S.stepSecurityCheck(ctl);
      await drain(st, mkChoose(st)); const played = st.players.p2.battle.some(s => s.cardId === dark);
      chk(played === up, `face-up=${up} but played=${played}`);
    }
  });
}
report();
