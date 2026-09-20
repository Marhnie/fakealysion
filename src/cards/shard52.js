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

const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
const hk = (id, d) => { (HOOKS[id] ||= []).push(d); };
const digs = (state, p) => state.players[p].battle.filter((s) => C(s.cardId).category === 'digimon');

// ---- BT25-075 이 카드가 등장할 때, 자신의 디지몬 수가 상대보다 적다면, 등장 코스트 -5. (no printed hook existed → full cost was always charged)
hk('BT25-075', { tag: '__handPlay', selfPlayDiscount: (state, hp) => (digs(state, hp).length < digs(state, opp(hp)).length ? -5 : 0) });

// ---- BT25-076 이 카드가 등장할 때, 진화원에 「네가몬」을 가진 등장 코스트 11 이하의 「네가몬」이 기술되어 있는 자신의 디지몬 1마리를 소멸시키는 것으로, 소멸시킨 디지몬의 등장 코스트만큼 등장 코스트를 감소시킬 수 있다.
hk('BT25-076', { tag: '__handPlay', handPlayOption: (state, p, cardId) => {
  const cands = () => digs(state, p).filter((s) => S.effectiveCost(state, s) <= 11 && (s.sources || []).some((id) => C(id).nameKo === '네가몬') && S.cardMentions(s.cardId, '네가몬'));
  if (!cands().length) return null;
  return { label: `${C(cardId).nameKo}: 진화원에 「네가몬」을 가진 자신의 디지몬 1마리를 소멸시켜 그 등장 코스트만큼 등장 코스트 감소?`, async apply(choose) {
    const cs = cands();
    const uid = cs.length === 1 ? cs[0].uid : await choose('pickStack', { player: p, uids: cs.map((s) => s.uid), prompt: '소멸시킬 자신의 디지몬 선택' });
    const v = cs.find((s) => s.uid === uid); if (!v) return 0;
    const cost = S.effectiveCost(state, v);
    S.deleteStack(state, p, v.uid, 'trash', 'ownEffect');
    return -cost;
  } };
} });
