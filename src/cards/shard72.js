// Shard 72 — QA gaps pass (docs/qa-gaps-report.md): continuous "also treated as a DP N digimon" (BT25-104).
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};
const hk = (id, d) => { (HOOKS[id] ||= []).push(d); };

// BT25-104 샤인그레이몬: 버스트 모드 【자신의 턴】 자신의 「최건우」는 모두 DP 12000의 디지몬으로도 취급하며 《속공》을 얻는다.
// (official Q6499-6506, 6947: tamer AND digimon at once, DP 12000 while this card is in the battle area on its owner's turn, attacks / inherits like a digimon)
const isGunwoo = (t) => !!t && S.card(t.cardId).category === 'tamer' && S.cardNameIs(S.card(t.cardId), '최건우');
hk('BT25-104', {
  tag: '자신의 턴', has: '최건우',
  asDigimon: (state, hp, holder, t) => (isGunwoo(t) ? { dp: 12000 } : null),
  grantKw: (state, hp, holder, t) => (isGunwoo(t) && S.ownerOfStack(state, t) === hp ? ['속공'] : []),
});
