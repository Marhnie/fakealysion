// Shard 52 — pass-2 batch-5 verification fixes (docs/verify-pass2-b5.md).
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

const C = (id) => S.card(id);
const hasTrait = (id, t) => { const c = C(id); return [...(c.types || []), c.form, c.attribute].includes(t); };

// ---- BT25-073 【등장 시】【진화 시】 자신의 디지몬의 링크 카드를 1장 파기하는 것으로, 패에서 특징 「TS」를 가진 등장 코스트 또는 사용 코스트 5 이하의 카드 1장을 코스트를 지불하지 않고 등장시키거나 사용할 수 있다.
// (the generic compiler dropped the "등장 코스트 또는 사용 코스트 5 이하" bound entirely → any-cost TS card could be played)
SCRIPTS['BT25-073::등장 시'] = [{ op: 'costGroup', cost: [{ op: 'trashLink', n: 1, target: 'own' }],
  then: [{ op: 's8_playOrUse', zones: ['hand'], kinds: ['digimon', 'tamer', 'option'], free: true, pred: (id) => hasTrait(id, 'TS') && (C(id).cost || 0) <= 5 }] }];
SCRIPTS['BT25-073::진화 시'] = SCRIPTS['BT25-073::등장 시'];
