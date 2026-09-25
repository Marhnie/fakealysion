// Official Q&A (rulings ids 6031/6032, EX4-060 오메가몬 Alter-S): "이 디지몬의 진화원의 「크레스가루몬」과 「블리츠그레이몬」
// 1장씩을 코스트를 지불하지 않고 등장시킨다" must pull ONLY the named cards that were actually among the leaving
// digimon's OWN evolution sources — not any same-named card that happens to already be sitting in the trash for an
// unrelated reason. Bug found in src/cards/shard11.js playNamedFromTrash(): it searched the whole trash pile by name
// alone, so an old unrelated same-named card in the trash could get summoned even when the leaving stack's own
// sources never had one. Fixed by restricting the search to ids drawn from evt.sources (passed in as sourceIds).
// Run: node scripts/qa/qa-slice-w5-ex4-060-leave-sources.mjs
import { S, put, drain, setTrash, T, eq, ok, runAll } from './lib-s1.mjs';

const OMNI = 'EX4-060', BLITZ = 'ST5-13' /* 블리츠그레이몬 */, CRES_OLD = 'ST6-13' /* 크레스가루몬, unrelated old copy */;

T(6031, 'EX4-060: 진화원에 없는 이름의 카드는, 트래시에 동명 카드가 이미 있어도 등장시키지 않는다', async () => {
  const state = S.newGame({ name: 'A', main: {}, digitama: {} }, { name: 'B', main: {}, digitama: {} });
  for (const p of ['p1', 'p2']) { const pl = state.players[p]; pl.hand = []; pl.trash = []; pl.security = []; pl.battle.length = 0; pl.raising = null; }
  state.turnNumber = 3; state.activePlayer = 'p1'; state.phase = 'main'; state.memory = 0; state.pending = [];
  setTrash(state, 'p1', [CRES_OLD]); // an unrelated 크레스가루몬 already sitting in the trash BEFORE this digimon ever left
  const s = put(state, 'p1', OMNI, { src: [BLITZ] }); // this stack's OWN evolution sources: only 블리츠그레이몬, no 크레스가루몬
  S.deleteStack(state, 'p1', s.uid, 'trash', 'effect'); // opponent's effect deletes it ("자신의 효과 이외로")
  await drain(state);
  const trash = state.players.p1.trash;
  ok('블리츠그레이몬은 진화원에서 등장 (트래시에서 사라짐)', !trash.includes(BLITZ));
  ok('배틀 에어리어에 블리츠그레이몬이 등장함', state.players.p1.battle.some(x => x.cardId === BLITZ));
  ok('무관한 기존 크레스가루몬은 트래시에 그대로 남는다 (등장시키면 안 됨)', trash.includes(CRES_OLD));
  ok('배틀 에어리어에 크레스가루몬은 등장하지 않음', !state.players.p1.battle.some(x => x.cardId === CRES_OLD));
});
await runAll('qa-slice-w5-ex4-060-leave-sources');
