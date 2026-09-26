// Unresolved-b (3): a 〔턴에 1회〕 use is consumed only when the effect actually activates (rule 15-7-1 / 15-14-1) — cancelled picks / declined optional costs give it back.
// Run: node scripts/qa/qa-unres-b-once.mjs < /dev/null
import { S, E, C, FILL, LOW, BIG, mk, put, setHand, secN, drain, stackOf, atkSec, T, eq, ok, runAll, resolved } from './lib-s1.mjs';
const uses = (st, s) => Object.values(stackOf(st, 'p1', s.uid).turnEffectUses || {}).reduce((a, b) => a + b, 0);
const cancelAll = { pickFromZoneIndex: null, pickFromHandIndexes: [], pickStack: null, confirmEffect: false, multipleChoice: null, pickFromRevealed: [], pickStackAnySide: null };
const ANG = Object.values(S.CARDS).find(c => c.nameKo === '앙고라몬' && c.category === 'digimon').id;
const cand = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.dp && c.dp <= 4000 && (c.types || []).includes('일리아스'))?.id;

T('once-1', 'BT24-050 inherited 어택 시 [턴에 1회]: cancelling the play pick keeps the use; picking a card consumes it', async () => {
  ok('fixture', !!cand);
  const st = mk(); const a = put(st, 'p1', BIG, { src: ['BT24-050'] }); setHand(st, 'p1', [cand]); secN(st, 'p2', 3);
  st._qaAns = cancelAll; await atkSec(st, 'p1', a.uid);
  eq('hand untouched', st.players.p1.hand, [cand]); eq('use not consumed after cancel', uses(st, a), 0);
  const st2 = mk(); const a2 = put(st2, 'p1', BIG, { src: ['BT24-050'] }); setHand(st2, 'p1', [cand]); secN(st2, 'p2', 3);
  await atkSec(st2, 'p1', a2.uid); ok('played', st2.players.p1.battle.length === 2); ok('use consumed after play', uses(st2, a2) === 1);
});
T('once-2', 'EX12-050 【메인】[턴 1회]: cancelled pick / no card played does not use the once', async () => {
  const st = mk(); const a = put(st, 'p1', 'EX12-050'); setHand(st, "p1", [ANG]);
  st._qaAns = cancelAll;
  st.pending.push({ uid: 'x1', player: 'p1', cardId: 'EX12-050', stackUid: a.uid, topId: 'EX12-050', tags: ['메인'], text: '[턴 1회] 자신의 패에서, 「앙고라몬」이 기술되어 있거나 특징 「NSp」를 가진 카드 1장을 지불하는 코스트 -2로 등장/사용할 수 있다.', resolved: false });
  await drain(st); eq('use not consumed', uses(st, a), 0);
});
T('once-3', 'ST23-08 inherited 어택 종료 시 [턴 1회]: declining the optional under-card cost keeps the use', async () => {
  const st = mk(); const tm = put(st, 'p1', 'ST23-08'); // tamer under-cards come from a tamer stack
  const a = put(st, 'p1', BIG, { src: ['ST23-08'] });
  st.pending.push({ uid: 'x2', player: 'p1', cardId: 'ST23-08', stackUid: a.uid, topId: BIG, tags: ['어택 종료 시'], text: '[턴 1회] 자신의 테이머 아래의 뒷면 카드를 아래에서부터 1장 파기하는 것으로, 이 특징 「글로잉 던」을 가진 디지몬을 액티브로 한다.', resolved: false, inherited: true });
  st._qaAns = cancelAll; await drain(st); eq('use not consumed', uses(st, a), 0);
});
runAll('qa-unres-b-once');
