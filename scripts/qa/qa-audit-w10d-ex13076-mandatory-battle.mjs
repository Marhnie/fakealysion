// Wave10/sliceD audit — Q7466 (idx6656): EX13-076 황제드라몬: 팔라딘 모드 【등장 시】【진화 시】【어택 시】 효과.
// 공식 룰링: "상대의 디지몬 1마리의 진화원을 전부 덱 아래로 되돌리고, 이 디지몬으로 그 디지몬과 배틀할 수 있다"는
// 하나의 묶인 선택지 — 진화원을 되돌린 디지몬과는 (가능한 한) 반드시 배틀해야 하며, 되돌린 뒤 배틀만 따로 거부할 수 없다.
// Run: node scripts/qa/qa-audit-w10d-ex13076-mandatory-battle.mjs < /dev/null
import { S, mk, put, drain, runSeg, T, eq, ok, runAll, errs, cur } from './lib-ex13.mjs';

T('7466', 'EX13-076: 진화원을 되돌린 디지몬과는 반드시 배틀한다 (배틀 여부를 따로 거부할 수 없음)', async () => {
  const st = mk();
  const a = put(st, 'p1', 'EX13-076', { src: [] }); // no sources of its own is fine; battle compares SOURCE COUNT not DP for this scripted battle
  a.sources = ['BT9-109']; // give it 1 source so it beats a 0-source target
  const b = put(st, 'p2', 'ST1-03', { src: [] }); // target has 0 evolution sources -> guaranteed to lose the "source count" battle once its sources are (already empty and) stripped
  st.players.p1.hand = []; st.players.p2.hand = [];
  // decline the optional "rest an opponent digimon" step, pick the only opponent digimon as the return/battle target,
  // and (if the implementation still asks) DECLINE the extra "do you want to battle?" confirmation.
  st._qaAns = { pickStack: (o) => (o.prompt.includes('레스트시킬') ? null : o.uids[0]), confirmEffect: false };
  await runSeg(st, 'p1', a, 'EX13-076', '등장 시');
  eq('오류 없음', errs(st), []);
  ok('진화원은 이미 되돌려짐 (mandatory 파트)', b.sources.length === 0);
  ok('배틀이 실제로 일어나 상대 디지몬이 소멸함 (배틀을 따로 거부할 수 없음)', !st.players.p2.battle.some((s) => s.uid === b.uid));
});
await runAll('qa-audit-w10d-ex13076-mandatory-battle');
