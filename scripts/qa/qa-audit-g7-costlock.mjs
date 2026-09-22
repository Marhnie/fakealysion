// g7 audit fix: "지불하는 등장/진화 코스트를 마이너스할 수 없다" (ST12-03/BT8-071/ST13-08/EX7-015 for play;
// BT5-008/BT5-021/BT5-033/ST20-07 for evolve) must ALSO block a "코스트를 지불하지 않고 등장/진화시킬 수 있다"
// (free: true) grant, not just a "-N" discount. Official Q&A (attached to EX12-013/027/041/043/050, BT26-012,
// EX12-066/067/068, BT26-091, EX13-069 in the g7 ruling files, though those particular cards already used a
// delta discount and were already correct): "발휘하여 등장/진화시킬 수 있지만, 코스트는 마이너스되지 않는다" —
// the effect still resolves and the card still enters play/evolves, but the FULL printed cost must be paid.
// Before this fix, src/cards/shard8.js's OPS.s8_playOrUse / OPS.s8_evolve treated `free: true` as an unconditional
// cost of 0, ignoring S.isPlayCostLocked / S.isEvoCostLocked entirely. Reachable today via BT26-054/BT26-049/
// BT26-077/EX13-045 (play) and BT26-099 (evolve) — all g7-scope cards. Run: node scripts/qa/qa-audit-g7-costlock.mjs < /dev/null
import { S, E, FILL, mk, put, drain, T, eq, ok, runAll, makeChoose } from './lib-s1.mjs';
import { OPS as S8_OPS } from '../../src/cards/shard8.js';

T(1, '등장 코스트 락(ST12-03) 상태에서 "코스트를 지불하지 않고 등장" 효과(BT26-054)는 그래도 발휘되지만 코스트는 원래대로 지불된다', async () => {
  const st = mk();
  put(st, 'p2', 'ST12-03'); // 서로는 지불하는 등장 코스트를 마이너스할 수 없다.
  ok('플레이 코스트 락 확인', S.isPlayCostLocked(st));
  st.players.p1.hand = ['BT26-054', 'BT22-083']; // BT22-083 카미시로 유코: 특징 CS, 코스트 4
  st.memory = 0;
  S.playDigimonFresh(st, 'p1', 0); // hand[0] = BT26-054
  await drain(st);
  ok('BT22-083가 실제로 등장함 (효과 자체는 여전히 발휘됨)', st.players.p1.battle.some((s) => s.cardId === 'BT22-083'));
  eq('코스트 4가 그대로 지불되어 메모리가 상대(p2) 쪽으로 4 이동', st.memory, -4);
});

T(2, '등장 코스트 락이 없으면 기존대로 완전 무료(메모리 변화 없음)', async () => {
  const st = mk();
  st.players.p1.hand = ['BT26-054', 'BT22-083'];
  st.memory = 0;
  S.playDigimonFresh(st, 'p1', 0);
  await drain(st);
  ok('BT22-083 등장', st.players.p1.battle.some((s) => s.cardId === 'BT22-083'));
  eq('코스트 없음 (메모리 불변)', st.memory, 0);
});

T(3, '진화 코스트 락(BT5-021) 상태에서 "코스트를 지불하지 않고 진화" (OPS.s8_evolve free:true)도 코스트는 원래대로 지불된다', async () => {
  // call the op directly (bypassing SCRIPTS registration, which is snapshotted at module load in src/cards/index.js
  // and so can't be extended from a test) — isolates s8_evolve's cost math from BT26-099's unrelated 《딜레이》 wrapper.
  const target4 = Object.values(S.CARDS).find((c) => c.category === 'digimon' && c.level === 4 && c.evoNormal && (c.evoNormal.cost || 0) > 0 && c.evoNormal.level === 3 && (c.evoNormal.colors || []).length);
  const target3 = target4 && Object.values(S.CARDS).find((c) => c.category === 'digimon' && c.level === 3 && (c.colors || []).some((x) => target4.evoNormal.colors.includes(x)));
  ok('테스트용 Lv.3/Lv.4 카드 확보 (색 일치)', !!target3 && !!target4);
  const instr = { subject: 'this', zones: ['hand'], free: true };

  const stLocked = mk();
  put(stLocked, 'p2', 'BT5-021'); // 상대는 지불하는 진화 코스트를 마이너스할 수 없다.
  ok('진화 코스트 락 확인(p1 기준)', S.isEvoCostLocked(stLocked, 'p1'));
  const meLocked = put(stLocked, 'p1', target3.id);
  stLocked.players.p1.hand = [target4.id];
  stLocked.memory = 0;
  const ctxLocked = { state: stLocked, S, E, self: 'p1', opp: 'p2', sourceStackUid: meLocked.uid, sourceCardId: target3.id, choose: makeChoose(stLocked) };
  await S8_OPS.s8_evolve(instr, ctxLocked);
  ok('진화됨', stLocked.players.p1.battle.some((s) => s.cardId === target4.id));
  eq('락 상태: 원래 진화 코스트가 그대로 지불됨', -stLocked.memory, target4.evoNormal.cost);

  const stFree = mk();
  const meFree = put(stFree, 'p1', target3.id);
  stFree.players.p1.hand = [target4.id];
  stFree.memory = 0;
  const ctxFree = { state: stFree, S, E, self: 'p1', opp: 'p2', sourceStackUid: meFree.uid, sourceCardId: target3.id, choose: makeChoose(stFree) };
  await S8_OPS.s8_evolve(instr, ctxFree);
  ok('진화됨', stFree.players.p1.battle.some((s) => s.cardId === target4.id));
  eq('락이 없으면 기존대로 무료', stFree.memory, 0);
});
await runAll('qa-audit-g7-costlock');
