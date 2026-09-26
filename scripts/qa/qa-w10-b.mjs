// Wave-10 recheck (Q&A idx 6003-6672): "벗어나지 않는다" replacement effects cover EVERY stack that met the trigger condition in the same cause.
// Official ruling (BT26-033/058, BT17-092, BT23-089, EX7-048, EX13-024/043/051 …): "発揮すると、この効果の誘発条件となったデジモン全てが離れなくなります".
// Run: node scripts/qa/qa-w10-b.mjs < /dev/null
import { S, mk, put, drain, T, eq, ok, runAll, C, FILL, LOW, V, find, errs, clean, runSeg } from './lib-ex13.mjs';

const nm = (st, p) => st.players[p].battle.map((s) => s.cardId);
const massDelete = async (st) => { // opponent (p2) resolves "상대의 디지몬 전부를 소멸시킨다." — one instruction deleting all of p1's digimon at once
  const src = put(st, 'p2', FILL);
  st.pending.push({ uid: 'w10q1', player: 'p2', cardId: FILL, stackUid: src.uid, tags: ['등장 시'], text: '상대의 디지몬 전부를 소멸시킨다.', resolved: false, topId: src.cardId });
  st._qaAns = { confirmEffect: () => true, pickStack: (q) => q.uids[0], multipleChoice: () => 0 };
  await drain(st);
};

T('w10-6265', 'BT26-058 하이안드로몬: 한 번 발휘하면 같은 원인으로 소멸하는 특징 「CS」 디지몬 전부가 벗어나지 않는다', async () => {
  const cs = find((c) => c.category === 'digimon' && (c.types || []).includes('CS') && c.level === 4);
  const st = mk(); clean(st);
  const h = put(st, 'p1', 'BT26-058', { src: [V('red', 3), V('red', 4), V('red', 5), V('red', 4)] });
  const a = put(st, 'p1', cs), b = put(st, 'p1', cs), c = put(st, 'p1', cs);
  await massDelete(st);
  eq('오류 없음', errs(st), []);
  eq('CS 디지몬 전부(홀더 포함)가 남음', st.players.p1.battle.length, 4);
  ok('a,b,c 모두 남음', [a, b, c].every((s) => st.players.p1.battle.includes(s)));
});

T('w10-6265b', '특징 조건이 맞지 않는 디지몬은 함께 지켜지지 않는다 (CS가 아닌 디지몬은 소멸)', async () => {
  const cs = find((c) => c.category === 'digimon' && (c.types || []).includes('CS') && c.level === 4);
  const st = mk(); clean(st);
  const h = put(st, 'p1', 'BT26-058', { src: [V('red', 3), V('red', 4), V('red', 5), V('red', 4)] });
  const a = put(st, 'p1', cs); const x = put(st, 'p1', FILL); ok('필러는 CS가 아님', !(C(FILL).types || []).includes('CS'));
  await massDelete(st);
  ok('CS 디지몬은 남음', st.players.p1.battle.includes(a)); ok('비 CS 디지몬은 소멸', !st.players.p1.battle.includes(x));
});
T('w10-6265c', '인터랙티브(UI) 경로: 첫 대상에서 발휘하면 이후 대상의 확인 프롬프트도 같은 활성화에 포함되어 함께 벗어나지 않는다', async () => {
  const cs = find((c) => c.category === 'digimon' && (c.types || []).includes('CS') && c.level === 4);
  S.REPL.interactive = true;
  try {
    const st = mk(); clean(st);
    put(st, 'p1', 'BT26-058', { src: [V('red', 3), V('red', 4), V('red', 5), V('red', 4)] });
    const a = put(st, 'p1', cs), b = put(st, 'p1', cs);
    const src = put(st, 'p2', FILL);
    st.pending.push({ uid: 'w10q2', player: 'p2', cardId: FILL, stackUid: src.uid, tags: ['등장 시'], text: '상대의 디지몬 전부를 소멸시킨다.', resolved: false, topId: src.cardId });
    st._qaAns = { confirmEffect: () => true, pickStack: (q) => q.uids[0], multipleChoice: () => 0 };
    let done = false; drain(st).then(() => { done = true; });
    for (let g = 0; !done && g < 300; g++) { await new Promise((r) => setTimeout(r, 5)); while ((st.pendingReplacements || []).length) S.resumeReplacement(st, st.pendingReplacements[0], true); }
    ok('처리 완료', done); eq('오류 없음', errs(st), []);
    eq('CS 디지몬 전부 남음(홀더 포함 3)', st.players.p1.battle.length, 3); ok('a,b 남음', st.players.p1.battle.includes(a) && st.players.p1.battle.includes(b));
  } finally { S.REPL.interactive = false; }
});
T('w10-6128', '효과를 받지 않는 디지몬에게도 「메인 페이즈 개시 시 어택」을 줄 수 있지만, 유발 시점에 그 효과를 받지 않으면 유발하지 않는다', async () => {
  const mkCase = (immune) => {
    const st = mk(); clean(st); const o = put(st, 'p2', FILL); (o.s3 ||= {}).forceAtkMain = { until: st.turnNumber + 1, src: 'P-240' };
    if (immune) S.grantShield(st, 'p2', o.uid, { kinds: ['all'], fromCategory: 'digimon', until: st.turnNumber + 1 });
    st.pending = []; S.queueForcedAttacks(st, 'p2'); return st.pending.filter((x) => !x.resolved).length;
  };
  eq('면역이 아니면 유발', mkCase(false), 1); eq('상대 디지몬의 효과를 받지 않으면 유발하지 않음', mkCase(true), 0);
});
T('w10-6208', '「배틀할 수 있다」 효과: 효과를 받지 않는 디지몬도 골라 배틀시킬 수 있고, 배틀에 지면 소멸한다', async () => {
  { const st = mk(); clean(st); const a = put(st, 'p1', 'BT26-047'); const o = put(st, 'p2', LOW); S.grantShield(st, 'p2', o.uid, { kinds: ['all'], until: st.turnNumber + 1 });
    st._qaAns = { pickStack: (q) => q.uids[0], confirmEffect: () => true };
    await runSeg(st, 'p1', a, 'BT26-047', '등장 시'); eq('오류 없음', errs(st), []); ok('면역 디지몬이 배틀에서 소멸', !st.players.p2.battle.includes(o)); }
  { const st = mk(); clean(st); const a = put(st, 'p1', 'EX12-052'); const o = put(st, 'p2', LOW); S.grantShield(st, 'p2', o.uid, { kinds: ['all'], until: st.turnNumber + 1 });
    st._qaAns = { pickStack: (q) => q.uids[0], confirmEffect: () => true };
    await runSeg(st, 'p1', a, 'EX12-052', '진화 시', { has: 'DP +3000' }); eq('오류 없음', errs(st), []); ok('EX12-052도 면역 디지몬과 배틀', !st.players.p2.battle.includes(o)); }
});
await runAll('qa-w10-b');
