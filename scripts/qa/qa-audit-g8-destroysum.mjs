// 공식 Q&A (503107.json id=693, ST7-12 아토믹 블래스터): "DP의 합계가 N 이하가 되도록 상대 디지몬을 골라, 고른 디지몬 전부를
// 소멸시킨다" 류의 합계-기반 소멸 효과(destroySum)는, 조건을 만족하는 대상이 있다면 최소 1마리는 반드시 골라야 하지만
// (1-3-6), 그 이후에는 상한까지 채우지 않고 자유롭게 그만둘 수 있다 — "N마리를 소멸시킨다"(고정 매수, 가능한 한 많이 골라야
// 함)와는 다른 규칙이다. src/effects.js의 'destroySum' 케이스가 매 반복마다 ctx.choose('pickStack', ...)를 payload.required
// 없이 호출하면, wrapChoose의 전체-텍스트 휴리스틱이 "수 있다/까지" 등이 없는 이 문구를 계속 "필수"로 오판해 2번째 이후
// 선택도 강제되어 버린다(취소 버튼이 숨겨짐). 이 회귀 테스트는 정확히 그 지점(payload.required)을 확인한다.
// Run: node scripts/qa/qa-audit-g8-destroysum.mjs < /dev/null
import { S, Fx, mk, put, T, eq, ok, runAll } from './lib-s1.mjs';
import '../../src/cards/index.js'; // registers OPS.s4_destroySum (shard4.js) as a side effect

T(1, 'destroySum: 첫 선택은 필수, 이후 선택은 자유(상한 미달로 중단 가능)', async () => {
  const st = mk();
  const c = S.CARDS['ST7-12'];
  const seg = S.parseEffectSegments(c.effectKo).segments.find(s => s.tags.includes('메인'));
  const script = Fx.lookupCardSpecific('ST7-12', seg.tags, seg.body) || Fx.compileToScript(seg.body);
  eq('컴파일된 op', script[0].op, 'destroySum');

  const lowDp = Object.values(S.CARDS).find(x => x.category === 'digimon' && x.dp === 3000 && !x.effectKo && !x.inheritedKo);
  put(st, 'p2', lowDp.id, {}); put(st, 'p2', lowDp.id, {}); put(st, 'p2', lowDp.id, {}); // DP 3000짜리 3마리: 2마리 합계 6000<=8000, 3마리 합계 9000>8000

  const requiredLog = [];
  let picks = 0;
  const ctx = {
    state: st, S, E: null, self: 'p1', opp: 'p2', sourceCardId: 'ST7-12', sourceStackUid: null,
    trigger: { text: seg.body, tags: seg.tags, cardId: 'ST7-12' },
    choose: async (kind, payload) => {
      if (kind !== 'pickStack') return null;
      requiredLog.push(!!payload.required);
      picks++;
      if (picks >= 2) return null; // 플레이어가 2번째 선택 후 "그만두기"를 원함 (상한 8000 안에 3번째도 넣을 수 있었음)
      return payload.uids[0] ?? null;
    },
    startAttack() {}, attack: () => null, endAttack() {},
  };
  await Fx.runScript(script, ctx);
  eq('선택 횟수', requiredLog.length, 2);
  ok('1번째 선택은 필수(required=true)', requiredLog[0] === true);
  ok('2번째 선택은 자유(required=false) — 취소 버튼이 보여야 함', requiredLog[1] === false);
  eq('실제로 1마리만 소멸함(자유 중단 존중)', st.players.p2.battle.length, 2);
});

T(2, 's4_destroySum (LM-021류, 동적 상한): 마찬가지로 첫 선택만 필수', async () => {
  const st = mk();
  const a = put(st, 'p1', 'LM-021', {}); // DP는 LM-021 자체 DP를 상한으로 사용
  const aDp = S.effectiveDP(st, 'p1', a);
  ok('테스트 전제: 이 디지몬의 DP > 0', aDp > 0);
  // 상대 디지몬 3마리, 각각 DP가 상한의 절반 이하가 되도록(합계로는 넘치게) 잡을 필요는 없고,
  // 그냥 DP가 아주 낮은 디지몬 3마리를 두어 매 선택마다 계속 후보가 남게 한다.
  const lowDp = Object.values(S.CARDS).find(x => x.category === 'digimon' && x.dp === 3000 && !x.effectKo && !x.inheritedKo);
  put(st, 'p2', lowDp.id, {}); put(st, 'p2', lowDp.id, {}); put(st, 'p2', lowDp.id, {});

  const c = S.CARDS['LM-021'];
  const seg = S.parseEffectSegments(c.effectKo).segments.find(s => s.tags.includes('등장 시'));
  const script = Fx.lookupCardSpecific('LM-021', seg.tags, seg.body);
  ok('전용 스크립트 사용(s4_destroySum)', Array.isArray(script) && script.some(o => o.op === 's4_destroySum'));

  const requiredLog = [];
  let picks = 0;
  const ctx = {
    state: st, S, E: null, self: 'p1', opp: 'p2', sourceCardId: 'LM-021', sourceStackUid: a.uid,
    trigger: { text: seg.body, tags: seg.tags, cardId: 'LM-021' },
    choose: async (kind, payload) => {
      if (kind !== 'pickStack') return null;
      requiredLog.push(!!payload.required);
      picks++;
      if (picks >= 2) return null; // 2번째 선택 후 그만두기
      return payload.uids[0] ?? null;
    },
    startAttack() {}, attack: () => null, endAttack() {},
  };
  await Fx.runScript(script, ctx);
  ok('1번째 선택은 필수', requiredLog[0] === true);
  ok('2번째 선택은 자유(상한이 남아 있어도 그만둘 수 있음)', requiredLog.length < 2 || requiredLog[1] === false);
});

await runAll('qa-audit-g8-destroysum');
