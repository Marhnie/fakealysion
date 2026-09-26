// Official Q&A id3350 (EX2-064 앨리스 맥코이): Lv.5 디지몬이 Lv.6으로 진화할 때, 그 진화하는 Lv.5 디지몬 자신을 소멸시킬 수 있고, 그러면 진화는 실패한다(진화 코스트 지불 안 함, 카드는 패로 돌아감).
// main.js 의 진화 흐름은 state._evoAbort 를 보고 중단한다. 다른 디지몬을 고르면 종전대로 진화 코스트 -3.
import { S, C, FILL, mk, put, T, eq, ok, runAll } from './lib-s1.mjs';
const lv5 = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.level === 5 && c.dp && !c.effectKo && !c.inheritedKo)?.id;
const lv6 = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.level === 6 && c.dp && !c.effectKo && !c.inheritedKo)?.id;
const optsFor = (st, evo) => S.s1EvoOptions(st, 'p1', evo, lv6);
T(3350, 'EX2-064: 진화하려는 Lv.5 자신을 소멸시키면 진화 중단 플래그', async () => {
  const st = mk(); put(st, 'p1', 'EX2-064'); const evo = put(st, 'p1', lv5); const other = put(st, 'p1', FILL);
  const o = optsFor(st, evo).find(x => /앨리스/.test(x.label)); ok('옵션 제시', !!o);
  const d = await o.apply(async (k, q) => { ok('자신도 선택지에 포함', q.uids.includes(evo.uid)); return evo.uid; });
  eq('할인 없음', d, 0); eq('진화 중단 플래그', st._evoAbort, true);
  eq('진화하려던 디지몬은 배틀에어리어에서 소멸', st.players.p1.battle.some(s => s.uid === evo.uid), false);
  ok('다른 디지몬은 그대로', st.players.p1.battle.some(s => s.uid === other.uid));
});
T('3350b', 'EX2-064: 다른 디지몬을 소멸시키면 진화 코스트 -3, 진화 계속', async () => {
  const st = mk(); put(st, 'p1', 'EX2-064'); const evo = put(st, 'p1', lv5); const other = put(st, 'p1', FILL);
  const o = optsFor(st, evo).find(x => /앨리스/.test(x.label));
  const d = await o.apply(async () => other.uid);
  eq('코스트 -3', d, -3); ok('중단 플래그 없음', !st._evoAbort); ok('진화하는 디지몬 생존', st.players.p1.battle.some(s => s.uid === evo.uid));
});
await runAll('qa-w5r2-ex2-064');
