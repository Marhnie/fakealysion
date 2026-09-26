// Official Q&A ids 3658/3659 (EX5-060 드라고몬 【서로의 턴】): 상대의 디지몬이 효과로 등장했을 때, 자신의 트래시에서 「등장한 디지몬의 Lv. 이하」의 퍼플인 디지몬 1장을 등장시킬 수 있다.
// Lv. 상한은 효과가 유발된 시점의 등장한 디지몬의 Lv. (그 사이에 Lv.가 바뀌거나 배틀 에어리어를 떠나도 유발 시점 기준). (Lv. 상한이 통째로 빠져 있었다.)
import { S, E, Fx, C, world, runScenarios } from './lib2.mjs';
const cards = Object.values(S.CARDS);
const f = (lv, col) => cards.find(c => c.category === 'digimon' && c.level === lv && c.colors.length === 1 && c.colors[0] === col && !c.effectKo && !c.inheritedKo && c.dp && !c.isParallel).id;
const p3 = f(3, 'purple'), p4 = f(4, 'purple'), p5 = f(5, 'purple'), r3 = f(3, 'red'), r4 = f(4, 'red'), r5 = f(5, 'red');
async function setup(W, mutate) {
  W.put('p1', 'EX5-060'); W.trash('p1', [p3, p4, p5, r3]); W.hand('p2', [r4]);
  const prev = W.st._fxSrc; W.st._fxSrc = { player: 'p2', category: 'digimon', cardId: 'X' }; const played = S.playFreeFromZone(W.st, 'p2', 'hand', 0, {}); W.st._fxSrc = prev;
  if (mutate) mutate(W, played);
  const offers = []; W.picks.pickFromZoneIndex = (o) => { offers.push(o.eligibleIdxs.map(i => W.st.players.p1.trash[i])); return undefined; };
  await W.drain(); return { offers };
}
const okOffer = (offers) => offers.length === 1 && offers[0].includes(p3) && offers[0].includes(p4) && !offers[0].includes(p5) && !offers[0].includes(r3);
runScenarios([
  { q: 3657, card: 'EX5-060', name: 'Lv.4 등장 → 퍼플 Lv.4 이하만', run: (W) => setup(W), expect: (W, { offers }) => [['퍼플 Lv.4 이하만 후보', okOffer(offers)], ['하나 등장', W.st.players.p1.battle.some(s => s.cardId === p3 || s.cardId === p4)]] },
  { q: 3658, card: 'EX5-060', name: '유발 후 Lv.가 5로 바뀌어도 Lv.4 이하', run: (W) => setup(W, (W2, played) => { played.cardId = r5; }), expect: (W, { offers }) => [['유발 시점 Lv.4 기준', okOffer(offers)]] },
  { q: 3659, card: 'EX5-060', name: '유발 후 등장한 디지몬이 떠나도 발휘', run: (W) => setup(W, (W2, played) => { const b = W2.st.players.p2.battle; b.splice(b.indexOf(played), 1); }), expect: (W, { offers }) => [['유발 시점 Lv.4 기준', okOffer(offers)]] },
], 'qa-w5r2-ex5-060');
