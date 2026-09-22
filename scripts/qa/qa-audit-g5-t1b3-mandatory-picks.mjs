// Official Q&A audit (tier1_batch3): a plain "…소멸시킨다" / "…얻는다" (no "까지"/"수 있다") is a MANDATORY pick —
// a legal target can't be waved off with the UI's "대상 없음/취소" button just to duck the effect (or to cheaply
// satisfy a later "이 효과로 소멸하지 않았다면" branch). Confirmed by:
//   - EX8-073 데유크몬 X항체 (id 3976/3977): a DP<=10000 opponent Digimon MUST be chosen and destroyed if one exists
//     (picking one that is itself immune to destruction is fine and legitimately fails to destroy it).
//   - BT22-074 데스메라몬 (id 4936/4937): same rule for its Lv.5-or-less mandatory destroy.
//   - BT21-061 메탈그레이몬 (id 4565): granting <<연계>> to one own Digimon is mandatory, can't be declined.
// Root cause: src/effects.js's 'destroy'/'grantKeyword' interpreter cases called ctx.choose('pickStack', ...)
// without a `required` flag, so wrapChoose()'s fallback heuristic had to guess from the FULL printed text of the
// whole timing box — and that heuristic gets fooled whenever a LATER, unrelated "그 후, …할 수 있다" clause shares
// the same box (exactly BT22-074's and BT21-061's shape), incorrectly marking the earlier mandatory pick optional.
// Fix: compile-time now tags each destroy/grant clause with its own `optional` flag (scoped to just that clause,
// not the whole segment), and the interpreter passes `required: !instr.optional` explicitly instead of guessing.
// This test also guards the fix's own risk: many real cards use "…소멸시킬 수 있다" with NO "까지" at all (e.g.
// EX8-074, BT21-045, BT16-079, BT21-029) — those must stay genuinely optional (required:false).
// Run: node scripts/qa/qa-audit-g5-t1b3-mandatory-picks.mjs < /dev/null
import { S, Fx, FILL, mk, put, T, eq, ok, runAll } from './lib-s1.mjs';

function segFor(cardId, tagIncludes, bodyIncludes = null) {
  const c = S.CARDS[cardId];
  const segs = S.parseEffectSegments(c.effectKo || '').segments.filter(s => s.tags.includes(tagIncludes));
  return (bodyIncludes ? segs.find(s => s.body.includes(bodyIncludes)) : segs[0]) || segs[0];
}

function makeCtx(st, self, opp, sourceCardId, sourceStackUid, seg, onPick) {
  return {
    state: st, S, E: null, self, opp, sourceCardId, sourceStackUid,
    trigger: { text: seg.body, tags: seg.tags, cardId: sourceCardId },
    choose: async (kind, payload) => {
      if (kind === 'pickStack') return onPick(payload);
      if (kind === 'confirmEffect') return true; // auto-pay any cost gate
      return null;
    },
    startAttack() {}, attack: () => null, endAttack() {},
  };
}

T(1, 'EX8-073: DP10000 이하 상대 디지몬이 있으면 소멸 대상 선택이 필수(required=true)이고, 실제로 소멸된다 (Q3976)', async () => {
  const st = mk();
  const me = put(st, 'p1', 'EX8-073');
  const foe = put(st, 'p2', FILL); // vanilla filler, DP well under 10000
  const seg = segFor('EX8-073', '진화 시', '소멸');
  const script = Fx.lookupCardSpecific('EX8-073', seg.tags, seg.body) || Fx.compileToScript(seg.body, { cardId: 'EX8-073' });
  const destroyOp = script.find(o => o.op === 'destroy') || (script.find(o => o.op === 'condition')?.then || []).find(o => o.op === 'destroy');
  ok('컴파일된 destroy op은 optional 표시가 없다 (필수)', destroyOp && !destroyOp.optional);
  const seenRequired = [];
  const ctx = makeCtx(st, 'p1', 'p2', 'EX8-073', me.uid, seg, (payload) => { seenRequired.push(!!payload.required); return payload.uids[0] ?? null; });
  await Fx.runScript(script, ctx);
  ok('필수 선택으로 요구됨(required=true)', seenRequired.length > 0 && seenRequired[0] === true);
  ok('실제로 대상이 소멸함', !st.players.p2.battle.includes(foe));
});

T(2, 'EX8-073: 소멸 대상이 "효과로 소멸하지 않는" 카드여도 선택은 강제되고, 소멸은 실패해 보너스가 발휘된다 (Q3977)', async () => {
  const st = mk();
  const me = put(st, 'p1', 'EX8-073', { susp: true });
  const foe = put(st, 'p2', FILL);
  foe.s1 = { noEffectDelete: 999 }; // simulate an "effect immunity to deletion" target, independent of any specific card's bespoke mechanism
  const secCard = FILL;
  st.players.p2.security = [secCard, secCard];
  const seg = segFor('EX8-073', '진화 시', '소멸');
  const script = Fx.lookupCardSpecific('EX8-073', seg.tags, seg.body) || Fx.compileToScript(seg.body, { cardId: 'EX8-073' });
  const seenRequired = [];
  const ctx = makeCtx(st, 'p1', 'p2', 'EX8-073', me.uid, seg, (payload) => { seenRequired.push(!!payload.required); return payload.uids[0] ?? null; });
  await Fx.runScript(script, ctx);
  ok('필수 선택으로 요구됨', seenRequired[0] === true);
  ok('면역 대상은 소멸하지 않고 그대로 남는다', st.players.p2.battle.includes(foe));
  ok('"소멸하지 않았다면" 보너스: 이 디지몬이 액티브가 된다', !me.suspended);
  eq('"소멸하지 않았다면" 보너스: 상대 시큐리티 1장 파기', st.players.p2.security.length, 1);
});

T(3, 'BT22-074: 대상이 있으면 소멸 선택은 필수(required=true) — 그 후 절의 "어택할 수 있다"에 휘둘리지 않는다 (Q4936)', async () => {
  const st = mk();
  const me = put(st, 'p1', 'BT22-074');
  const foe = put(st, 'p2', FILL);
  st.memory = 0;
  const seg = segFor('BT22-074', '메인');
  const script = Fx.lookupCardSpecific('BT22-074', seg.tags, seg.body) || Fx.compileToScript(seg.body, { cardId: 'BT22-074' });
  const seenRequired = [];
  const ctx = makeCtx(st, 'p1', 'p2', 'BT22-074', me.uid, seg, (payload) => { seenRequired.push(!!payload.required); return payload.uids[0] ?? null; });
  await Fx.runScript(script, ctx);
  ok('destroy 선택이 최소 1회는 필수로 표시됨', seenRequired.some(r => r === true));
  ok('실제로 대상이 소멸함', !st.players.p2.battle.includes(foe));
});

T(4, 'BT21-061: 조건 충족 시 <<연계>> 부여 대상 선택은 필수(required=true) — 뒤의 "어택할 수 있다"에 휘둘리지 않는다 (Q4565)', async () => {
  const st = mk();
  const me = put(st, 'p1', 'BT21-061');
  const other = put(st, 'p1', FILL); // eligible recipient of <<연계>>
  const seg = segFor('BT21-061', '자신의 턴');
  const script = Fx.lookupCardSpecific('BT21-061', seg.tags, seg.body) || Fx.compileToScript(seg.body, { cardId: 'BT21-061' });
  const grantOp = script.find(o => o.op === 'grantKeyword');
  ok('컴파일된 grantKeyword op은 optional 표시가 없다 (필수)', grantOp && !grantOp.optional);
  const seenRequired = [];
  const ctx = makeCtx(st, 'p1', 'p1', 'BT21-061', me.uid, seg, (payload) => { seenRequired.push(!!payload.required); return payload.uids[0] ?? null; });
  ctx.opp = 'p2';
  await Fx.runScript(script, ctx);
  ok('필수 선택으로 요구됨(required=true)', seenRequired.length > 0 && seenRequired[0] === true);
  ok('연계가 실제로 부여됨', S.hasKeyword(me, '연계') || S.hasKeyword(other, '연계'));
});

T(5, '회귀 방지: "…소멸시킬 수 있다"(까지 없이도) 카드는 여전히 optional로 컴파일된다 — 이번 수정이 다른 카드들을 망가뜨리지 않았는지 확인', () => {
  const cases = [
    ['EX8-074', '진화 시'],
    ['BT21-045', '진화 시'],
    ['BT16-079', '자신의 턴 종료 시'],
  ];
  for (const [id, tag] of cases) {
    const seg = segFor(id, tag);
    ok(`${id}: 세그먼트 존재`, !!seg);
    if (!seg) continue;
    if (Fx.lookupCardSpecific(id, seg.tags, seg.body)) continue; // bespoke scripts aren't affected by this compile-site fix; skip
    const script = Fx.compileToScript(seg.body, { cardId: id });
    const found = script.find(o => o.op === 'destroy') || (script.flatMap(o => o.then || [])).find(o => o.op === 'destroy');
    ok(`${id}: destroy op 발견`, !!found);
    ok(`${id}: optional=true 유지`, found && found.optional === true);
  }
});

await runAll('qa-audit-g5-t1b3-mandatory-picks');
