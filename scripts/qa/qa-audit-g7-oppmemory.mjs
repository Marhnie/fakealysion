// g7 audit fix: the generic compiler's parseConditionText() had no branch for "상대의 메모리가 N 이상/이하(이)라면"
// (opponent-signed memory, "상대의" BEFORE 메모리가) — only "메모리가 N…" (self) and "메모리가 상대 쪽의 N 이상…"
// (different word order) were handled. A later-sentence condition ("…한다. 그 후, <조건>라면, <효과>") that fails to
// parse makes the WHOLE gated clause silently vanish (effects.js: `if (!test) return prefix;`), so EX13-060 알파몬's
// 【진화 시】 "그 후, 상대의 메모리가 5 이상이라면, 메모리 +2." never granted the +2 memory at all, regardless of
// the opponent's memory. Run: node scripts/qa/qa-audit-g7-oppmemory.mjs < /dev/null
import { S, Fx, mk, put, drain, T, eq, ok, runAll } from './lib-s1.mjs';

T(1, 'EX13-060 알파몬 【진화 시】: 상대 메모리가 5 이상이면 메모리 +2 (그 전엔 조건 자체가 통째로 드롭됐음)', async () => {
  const st = mk();
  const a = put(st, 'p1', 'EX13-060');
  st.memory = -5; // p1 관점 메모리 -5 = 상대(p2) 쪽 메모리 +5
  st.pending.push({ uid: 'g7om1', player: 'p1', cardId: 'EX13-060', stackUid: a.uid, topId: 'EX13-060', tags: ['진화 시'], text: S.card('EX13-060').effectKo.split('\n').find((l) => l.includes('진화 시')).replace(/^【진화\s*시】\s*/, ''), resolved: false });
  await drain(st);
  eq('메모리 -5 + 2 = -3', st.memory, -3);
});

T(2, 'EX13-060: 상대 메모리가 5 미만이면 메모리 변화 없음', async () => {
  const st = mk();
  const a = put(st, 'p1', 'EX13-060');
  st.memory = 0;
  st.pending.push({ uid: 'g7om2', player: 'p1', cardId: 'EX13-060', stackUid: a.uid, topId: 'EX13-060', tags: ['진화 시'], text: S.card('EX13-060').effectKo.split('\n').find((l) => l.includes('진화 시')).replace(/^【진화\s*시】\s*/, ''), resolved: false });
  await drain(st);
  eq('메모리 불변', st.memory, 0);
});

T(3, 'parseConditionText 단위 확인: "상대의 메모리가 N 이상/이하(이)라면"이 자신 쪽이 아니라 상대 쪽 부호를 본다', async () => {
  const seg = S.parseEffectSegments(S.card('EX13-060').effectKo).segments.find((s) => /메모리/.test(s.body));
  const sc = Fx.compileToScript(seg.body);
  const condOp = sc.find((o) => o.op === 'condition');
  ok('condition op 생성됨', !!condOp && typeof condOp.if.test === 'function');
  ok('p1 메모리 -5 (상대 +5) → 참', await condOp.if.test({ self: 'p1', opp: 'p2', state: { memory: -5 } }));
  ok('p1 메모리 +5 (상대 -5) → 거짓', !(await condOp.if.test({ self: 'p1', opp: 'p2', state: { memory: 5 } })));
});
await runAll('qa-audit-g7-oppmemory');
