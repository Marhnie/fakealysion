// Official Q&A ids 3430/3431 (EX3-065 쿠리하라 히나): 「이 테이머를 레스트시키는 것으로, 그 디지몬의 【등장 시】 효과 1개를 발휘시킨다」 — 레스트는 비용(것으로)이므로 이 트리거가 발휘될 때 지불한다
// (진화 시점에 자동으로 레스트하지 않는다): 거절하면 레스트하지 않고, 진화한 디지몬이 이미 없으면(1체째 효과로 소멸 등) 2체째는 레스트도 하지 않는다.
import { S, E, Fx, C, world, runScenarios } from './lib2.mjs';
const cards = Object.values(S.CARDS);
const target = cards.find(c => c.category === 'digimon' && (c.types || []).some(t => ['암룡형', '지룡형', '기룡형', '천룡형'].includes(t)) && /【등장 시】/.test(c.effectKo || '') && c.evoNormal && c.level >= 4 && !/【등장 시】[^\n]*(?:소멸|퇴화)/.test(c.effectKo));
const src = target && cards.find(c => c.category === 'digimon' && !c.effectKo && !c.inheritedKo && c.dp && !c.isParallel && E.canEvolveAny(c.id, target.id, [], null).ok);
const hinas = (W) => W.st.players.p1.battle.filter(s => s.cardId === 'EX3-065');
runScenarios([
  { q: 3430, card: 'EX3-065', name: '진화 시점에는 레스트하지 않고, 확인 후 발휘될 때 레스트 + 등장 시 효과', run: async (W) => {
      const h = W.put('p1', 'EX3-065'); const s = W.put('p1', src.id); W.picks.confirmEffect = true;
      const snap = { restedAtEvolve: null };
      W.st.hand = null; W.st.players.p1.hand.unshift(target.id); S.digivolve(W.st, 'p1', s.uid, target.id, 0, 'hand'); snap.restedAtEvolve = h.suspended;
      await W.drain(); return { h, snap }; },
    expect: (W, { h, snap }) => [['진화 직후(트리거 발휘 전)에는 레스트하지 않음', snap.restedAtEvolve === false], ['발휘 후 레스트', h.suspended === true], ['등장 시 효과가 발휘됨', W.resolved.some(r => r.cardId === target.id && r.tags.includes('등장 시'))]] },
  { q: 3430, card: 'EX3-065', name: '거절하면 레스트하지 않는다', run: async (W) => {
      const h = W.put('p1', 'EX3-065'); const s = W.put('p1', src.id); W.picks.confirmEffect = (o) => (/레스트시켜/.test(o.prompt || '') ? false : true);
      W.st.players.p1.hand.unshift(target.id); S.digivolve(W.st, 'p1', s.uid, target.id, 0, 'hand'); await W.drain(); return { h }; },
    expect: (W, { h }) => [['레스트하지 않음', h.suspended === false], ['등장 시 효과 없음', !W.resolved.some(r => r.cardId === target.id && r.tags.includes('등장 시'))]] },
], 'qa-w5r2-ex3-065');
