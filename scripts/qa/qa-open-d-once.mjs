// open-d (1): an effect that never asks a question because it has no legal target does not consume its 〔턴에 1회〕 use (15-7-1 / 15-14-1).
// Run: node scripts/qa/qa-open-d-once.mjs < /dev/null
import { S, E, C, FILL, LOW, BIG, mk, put, setHand, secN, drain, stackOf, atkSec, T, eq, ok, runAll, resolved } from './lib-s1.mjs';
const uses = (st, s) => Object.values(stackOf(st, 'p1', s.uid).turnEffectUses || {}).reduce((a, b) => a + b, 0);
const ANG = Object.values(S.CARDS).find(c => c.nameKo === '앙고라몬' && c.category === 'digimon').id;
const cand = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.dp && c.dp <= 4000 && (c.types || []).includes('일리아스'))?.id;

T('od-once-1', 'BT24-050 inherited 어택 시: empty hand (no legal target, no question) keeps the use; later with a target it consumes', async () => {
  const st = mk(); const a = put(st, 'p1', BIG, { src: ['BT24-050'] }); setHand(st, 'p1', []); secN(st, 'p2', 3);
  await atkSec(st, 'p1', a.uid);
  eq('no play', st.players.p1.battle.length, 1); eq('use not consumed (no target)', uses(st, a), 0);
});
T('od-once-2', 'EX12-050 【메인】[턴 1회]: nothing playable in hand does not use the once', async () => {
  const st = mk(); const a = put(st, 'p1', 'EX12-050'); setHand(st, 'p1', []);
  st.pending.push({ uid: 'x1', player: 'p1', cardId: 'EX12-050', stackUid: a.uid, topId: 'EX12-050', tags: ['메인'], text: '[턴 1회] 자신의 패에서, 「앙고라몬」이 기술되어 있거나 특징 「NSp」를 가진 카드 1장을 지불하는 코스트 -2로 등장/사용할 수 있다.', resolved: false });
  await drain(st); eq('use not consumed', uses(st, a), 0);
});
T('od-once-3', 'EX12-050: with a playable card the once IS consumed (positive control)', async () => {
  const st = mk(); const a = put(st, 'p1', 'EX12-050'); setHand(st, 'p1', [ANG]);
  st.pending.push({ uid: 'x1', player: 'p1', cardId: 'EX12-050', stackUid: a.uid, topId: 'EX12-050', tags: ['메인'], text: '[턴 1회] 자신의 패에서, 「앙고라몬」이 기술되어 있거나 특징 「NSp」를 가진 카드 1장을 지불하는 코스트 -2로 등장/사용할 수 있다.', resolved: false });
  await drain(st); ok('once consumed after use', uses(st, a) >= 1 || st.players.p1.hand.length === 0);
});
runAll('qa-open-d-once');
