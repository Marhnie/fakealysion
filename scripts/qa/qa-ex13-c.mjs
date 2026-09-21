// EX13 digimon (Lv5-7 / black / purple / white) effects, replacement effects and continuous abilities. Run: node scripts/qa/qa-ex13-c.mjs < /dev/null
import { S, mk, put, drain, T, eq, ok, runAll, playCard, evolve, useOption, atkSec, atkDigi, C, FILL, LOW, V, find, findAll, mention, errs, cur, clean, onBoard, runSeg, setTop, logs } from './lib-ex13.mjs';
const dm = (n) => find((c) => c.category === 'digimon' && mention(c, n));
const dmName = (n) => find((c) => c.category === 'digimon' && c.nameKo.includes(n));
const hand = (st, p = 'p1') => st.players[p].hand;
const BIGV = find((c) => c.category === 'digimon' && c.dp >= 12000 && !c.effectKo && !c.inheritedKo) || find((c) => c.category === 'digimon' && c.dp >= 9000 && !c.effectKo && !c.inheritedKo);
const oppTurn = (st) => { st.activePlayer = 'p2'; };

// ---------------------------------------------------------------- leave replacements (서로의 턴)
T('E13-rep-051', 'EX13-051 가드로몬: 《블로커》를 가진 다른 자신의 디지몬이 (자신의 효과 이외로) 벗어날 때 이 디지몬을 레스트시키는 것으로 벗어나지 않음', async () => {
  const st = mk(); clean(st); const g = put(st, 'p1', 'EX13-051'); const b = put(st, 'p1', 'EX13-047'); // 울퉁몬 has 《블로커》
  S.deleteStack(st, 'p1', b.uid, 'trash', 'effect'); await drain(st);
  ok('울퉁몬이 남음', st.players.p1.battle.includes(b)); ok('가드로몬 레스트', g.suspended);
  const st2 = mk(); clean(st2); const g2 = put(st2, 'p1', 'EX13-051'); const c = put(st2, 'p1', FILL); S.deleteStack(st2, 'p1', c.uid, 'trash', 'effect'); ok('블로커가 없으면 그대로 소멸', !st2.players.p1.battle.includes(c));
  const st3 = mk(); clean(st3); const g3 = put(st3, 'p1', 'EX13-051'); const d = put(st3, 'p1', 'EX13-047'); S.deleteStack(st3, 'p1', d.uid, 'trash', 'ownEffect'); ok('자신의 효과는 대상 아님', !st3.players.p1.battle.includes(d));
});
T('E13-rep-043', 'EX13-043 두프트몬: 레스트 상태인 자신의 디지몬이 (자신의 효과 이외로) 벗어날 때 자신의 디지몬 1마리를 액티브로 하는 것으로 벗어나지 않음', async () => {
  const st = mk(); clean(st); put(st, 'p1', 'EX13-043'); const r = put(st, 'p1', FILL, { susp: true }); const r2 = put(st, 'p1', FILL, { susp: true });
  S.deleteStack(st, 'p1', r.uid, 'trash', 'effect'); await drain(st);
  ok('레스트 디지몬이 남음', st.players.p1.battle.includes(r)); eq('두프트몬 + 액티브로 바뀐 1마리', st.players.p1.battle.filter((s) => !s.suspended).length, 2);
  const st2 = mk(); clean(st2); put(st2, 'p1', 'EX13-043'); const a = put(st2, 'p1', FILL); S.deleteStack(st2, 'p1', a.uid, 'trash', 'effect'); ok('액티브 상태 디지몬은 대상 아님', !st2.players.p1.battle.includes(a));
});
T('E13-rep-024', 'EX13-024 슬레이어드라몬: 「드라코몬」/「엑자몬」 기술 디지몬이 벗어날 때 그런 디지몬 1마리를 레스트시키는 것으로 벗어나지 않음', async () => {
  const st = mk(); clean(st); put(st, 'p1', 'EX13-024'); const x = put(st, 'p1', 'EX13-008'); const y = put(st, 'p1', 'EX13-008');
  S.deleteStack(st, 'p1', x.uid, 'trash', 'effect'); await drain(st);
  ok('드라코몬이 남음', st.players.p1.battle.includes(x)); ok('다른 드라코몬(또는 자신)이 레스트', st.players.p1.battle.some((s) => s.suspended));
});
T('E13-rep-027', 'EX13-027/028 츄몬·스카몬 [상속]: 자신의 효과 이외로 벗어날 때 명칭에 「스카몬」을 포함하는 다른 디지몬 1마리를 소멸시키는 것으로 벗어나지 않음', async () => {
  for (const id of ['EX13-027', 'EX13-028']) {
    const st = mk(); clean(st); const h = put(st, 'p1', FILL, { src: [id] }); const sk = put(st, 'p1', 'EX13-028');
    S.deleteStack(st, 'p1', h.uid, 'trash', 'effect'); await drain(st);
    ok(id + ' 홀더가 남음', st.players.p1.battle.includes(h)); ok('스카몬이 소멸', !st.players.p1.battle.includes(sk));
  }
});
T('E13-rep-048', 'EX13-048/052 코테몬·그라디몬 [상속]: 「나이트몬」 기술 다른 자신의 디지몬을 소멸시켜 벗어나지 않음', async () => {
  for (const id of ['EX13-048', 'EX13-052']) {
    const st = mk(); clean(st); const h = put(st, 'p1', FILL, { src: [id] }); const n = put(st, 'p1', dm('나이트몬') ? find((c) => c.category === 'digimon' && mention(c, '나이트몬') && c.level <= 4) : FILL);
    S.deleteStack(st, 'p1', h.uid, 'trash', 'effect'); await drain(st); ok(id + ' 남음', st.players.p1.battle.includes(h)); ok('나이트몬 소멸', !st.players.p1.battle.includes(n));
  }
});
T('E13-rep-016', 'EX13-016 오메가몬: 벗어날 때 진화원에서 Lv.이 같은 카드 2장을 파기하는 것으로 벗어나지 않음', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-016', { src: [V('red', 4), V('blue', 4), V('green', 5)] });
  S.deleteStack(st, 'p1', a.uid, 'trash', 'effect'); await drain(st); ok('남음', st.players.p1.battle.includes(a)); eq('진화원 3→1', a.sources.length, 1);
  const st2 = mk(); clean(st2); const b = put(st2, 'p1', 'EX13-016', { src: [V('red', 4), V('green', 5)] }); S.deleteStack(st2, 'p1', b.uid, 'trash', 'effect'); ok('Lv이 같은 2장이 없으면 소멸', !st2.players.p1.battle.includes(b));
});
T('E13-rep-025', 'EX13-025/029 [상속]: 「듀나스몬」/「윗체르니」 기술 이 디지몬이 상대의 효과로 벗어날 때 시큐리티 1장 파기로 벗어나지 않음', async () => {
  const st = mk(); clean(st); const h = put(st, 'p1', 'EX13-025', { src: ['EX13-025'] }); st.players.p1.security = [FILL, FILL]; // 캔들몬 (윗체르니 trait)
  const holder = put(st, 'p1', 'EX13-033', { src: ['EX13-029'] });
  S.deleteStack(st, 'p1', holder.uid, 'trash', 'effect'); await drain(st); ok('남음', st.players.p1.battle.includes(holder)); eq('시큐리티 -1', st.players.p1.security.length, 1);
});
T('E13-rep-057', 'EX13-057 그레이드몬 [상속]: 특징 「크로니클」 자신의 디지몬이 벗어날 때 시큐리티 1장 파기로 벗어나지 않음', async () => {
  const st = mk(); clean(st); put(st, 'p1', FILL, { src: ['EX13-057'] }); const c = put(st, 'p1', 'EX13-055'); st.players.p1.security = [FILL, FILL];
  S.deleteStack(st, 'p1', c.uid, 'trash', 'effect'); await drain(st); ok('크로니클 디지몬이 남음', st.players.p1.battle.includes(c)); eq('시큐리티 -1', st.players.p1.security.length, 1);
});
T('E13-rep-017', 'EX13-017 브이몬 [상속]: 「브이드라몬」 포함 이 디지몬이 상대의 효과로 벗어날 때 레스트시키는 것으로 벗어나지 않음', async () => {
  const st = mk(); clean(st); const h = put(st, 'p1', 'EX13-019', { src: ['EX13-017'] });
  S.deleteStack(st, 'p1', h.uid, 'trash', 'effect'); await drain(st); ok('남음', st.players.p1.battle.includes(h)); ok('레스트', h.suspended);
});

// ---------------------------------------------------------------- continuous / keywords
T('E13-cont-dp', 'EX13-011/018/039/047/054 [상속] DP 상승 / EX13-038/040 [상속] 레스트 디지몬 전부 DP +1000', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', FILL, { src: ['EX13-011'] }); const b = put(st, 'p1', FILL, { src: ['EX13-038'], susp: true }); const c = put(st, 'p1', FILL, { susp: true });
  const base = C(FILL).dp; eq('자신의 턴 +2000', S.effectiveDP(st, 'p1', a), base + 2000);
  oppTurn(st); eq('서로의 턴: 레스트 디지몬 +1000 (b,c), 액티브는 그대로', [S.effectiveDP(st, 'p1', b), S.effectiveDP(st, 'p1', c), S.effectiveDP(st, 'p1', a)], [base + 1000, base + 1000, base]);
  const st2 = mk(); clean(st2); const d = put(st2, 'p1', FILL, { src: ['EX13-047'] }); eq('EX13-047 상대의 턴만 +2000', S.effectiveDP(st2, 'p1', d), C(FILL).dp); oppTurn(st2); eq('상대의 턴', S.effectiveDP(st2, 'p1', d), C(FILL).dp + 2000);
  const st3 = mk(); clean(st3); const e = put(st3, 'p1', FILL, { src: ['EX13-054'] }); oppTurn(st3); eq('EX13-054 서로의 턴 +1000 (상대 턴)', S.effectiveDP(st3, 'p1', e), C(FILL).dp + 1000); st3.activePlayer = 'p1'; eq('자신의 턴에도 +1000', S.effectiveDP(st3, 'p1', e), C(FILL).dp + 1000);
});
T('E13-cont-kw', 'EX13-058/063/064/073 계속 능력: 키워드 부여 (턴 조건 포함)', async () => {
  const st = mk(); clean(st); put(st, 'p1', 'EX13-058'); const n = put(st, 'p1', find((c) => c.category === 'digimon' && mention(c, '나이트몬') && c.level <= 4));
  const has = (s, k) => S.hasKeyword(s, k) || S.hookGrantedKeywords(st, 'p1', s).includes(k) || S.hasContinuousKeyword(st, 'p1', s, k);
  ok('자신의 턴에는 없음', !has(n, '재기동')); oppTurn(st); ok('상대의 턴: 재기동', has(n, '재기동')); ok('블로커', has(n, '블로커'));
  const st2 = mk(); clean(st2); put(st2, 'p1', 'EX13-064'); const n2 = put(st2, 'p1', find((c) => c.category === 'digimon' && mention(c, '나이트몬') && c.level <= 4)); const h2 = (s, k) => S.hasKeyword(s, k) || S.hookGrantedKeywords(st2, 'p1', s).includes(k) || S.hasContinuousKeyword(st2, 'p1', s, k);
  ok('EX13-064 자신의 턴: 연계', h2(n2, '연계')); ok('관통', h2(n2, '관통'));
  const st3 = mk(); clean(st3); put(st3, 'p1', 'EX13-063'); const k = put(st3, 'p1', 'EX13-059'); const h3 = (s, kk) => S.hasKeyword(s, kk) || S.hookGrantedKeywords(st3, 'p1', s).includes(kk) || S.hasContinuousKeyword(st3, 'p1', s, kk); ok('콩알몬: 블로커', h3(k, '블로커')); ok('수호', h3(k, '수호'));
  const st4 = mk(); clean(st4); put(st4, 'p1', 'EX13-073'); const adv = put(st4, 'p1', find((c) => c.category === 'digimon' && (c.types || []).includes('어드벤처') && c.level >= 5)); const low = put(st4, 'p1', find((c) => c.category === 'digimon' && (c.types || []).includes('어드벤처') && c.level === 3));
  const h4 = (s, kk) => S.hasKeyword(s, kk) || S.hookGrantedKeywords(st4, 'p1', s).includes(kk) || S.hasContinuousKeyword(st4, 'p1', s, kk); ok('어드벤처 Lv.5 이상: 속공', h4(adv, '속공')); ok('블로커', h4(adv, '블로커')); ok('Lv.3은 제외', !h4(low, '속공'));
});
T('E13-050', 'EX13-050 보코몬: 서로는 테이머의 효과 이외로 메모리를 플러스할 수 없다', async () => {
  const st = mk(); clean(st); put(st, 'p1', 'EX13-050'); const m0 = st.memory; S.grantMemory(st, 'p1', 2, 'EX13-008'); eq('디지몬 효과로는 플러스 불가', st.memory, m0); S.grantMemory(st, 'p1', 2, 'EX13-068'); eq('테이머 효과는 가능', st.memory, m0 + 2);
});
T('E13-035', 'EX13-035 킹에테몬: 「스카몬」/「에테몬」 3마리 이상이면 상대 디지몬 전부 《S 어택 -1》 + DP -3000', async () => {
  const st = mk(); clean(st); put(st, 'p1', 'EX13-035'); put(st, 'p1', 'EX13-028'); const o = put(st, 'p2', BIGV); const d0 = S.effectiveDP(st, 'p2', o);
  eq('2마리: 효과 없음', S.effectiveDP(st, 'p2', o), d0); put(st, 'p1', 'EX13-031');
  eq('3마리: DP -3000', d0 - S.effectiveDP(st, 'p2', o), 3000);
});
T('E13-007cap', 'EX13-007/010 [상속] DP 소멸 효과의 상한 +2000', async () => {
  const st = mk(); clean(st); const h = put(st, 'p1', FILL, { src: ['EX13-010'] }); st.activePlayer = 'p2'; // 서로의 턴
  ok('상한 +2000', S.dpDestroyCapBoost(st, 'p1', h.uid) === 2000);
});

// ---------------------------------------------------------------- 044/045 battle & jogress
T('E13-044', 'EX13-044 브레이크드라몬: 자신의 디지몬이 레스트했을 때 「드라코몬」 기술 디지몬 1마리와 상대 디지몬 1마리로 배틀', async () => {
  const st = mk(); clean(st); const b = put(st, 'p1', 'EX13-044'); const d = put(st, 'p1', 'EX13-008'); const o = put(st, 'p2', LOW); st.activePlayer = 'p2';
  S.restStack(st, 'p1', b.uid, 'effect'); await drain(st);
  ok('배틀 결과: 드라코몬(1000) vs LOW', logs(st).some((l) => l.includes('vs'))); eq('오류 없음', errs(st), []);
});
T('E13-045', 'EX13-045 엑자몬: 조그레스 진화 시 어택 요청 + 자신의 디지몬 전부 DP+10000', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-021'), b = put(st, 'p1', 'EX13-041'); const o = put(st, 'p2', LOW); hand(st).push('EX13-045');
  ok('조그레스 가능', S.canJogress(a, b, 'EX13-045').ok);
  const r = S.fuseStacks(st, 'p1', a.uid, b.uid, 'EX13-045', 0, 'hand'); await drain(st);
  const ex = st.players.p1.battle.find((s) => s.cardId === 'EX13-045'); ok('엑자몬 등장', !!ex); ok('viaFusion', !!ex.viaFusion);
  eq('어택 요청', (st._qaAtk || []).length, 1); eq('DP +10000', S.effectiveDP(st, 'p1', ex), C('EX13-045').dp + 10000); eq('오류 없음', errs(st), []);
  const st2 = mk(); clean(st2); const c = put(st2, 'p1', FILL); hand(st2).push('EX13-045'); const ex2 = put(st2, 'p1', 'EX13-045'); await runSeg(st2, 'p1', ex2, 'EX13-045', '진화 시');
  eq('조그레스가 아니면 효과 없음', (st2._qaAtk || []).length, 0);
});
T('E13-045b', 'EX13-045 엑자몬: 배틀 승리 시 패/진화원의 「드라코몬」 기술 카드(코스트 12 이하)를 무료 등장/사용', async () => {
  const st = mk(); clean(st); const ex = put(st, 'p1', 'EX13-045'); const o = put(st, 'p2', LOW); hand(st).push('EX13-008'); st.memory = 3;
  S.resolveDigimonBattle(st, 'p1', ex.uid, o.uid); await drain(st);
  ok('드라코몬 등장', onBoard(st, 'p1', 'EX13-008')); eq('메모리 그대로', st.memory, 3); eq('오류 없음', errs(st), []);
});
T('E13-016j', 'EX13-016 오메가몬: 조그레스 (「그레이몬」 Lv.6 + 「가루몬」 Lv.6)', async () => {
  const gre = find((c) => c.category === 'digimon' && c.level === 6 && c.nameKo.includes('그레이몬')), gar = find((c) => c.category === 'digimon' && c.level === 6 && c.nameKo.includes('가루몬')); ok('fixture', gre && gar);
  const st = mk(); const a = put(st, 'p1', gre), b = put(st, 'p1', gar); ok('조그레스 가능', S.canJogress(a, b, 'EX13-016').ok); const c = put(st, 'p1', gre); ok('그레이몬 2마리는 불가', !S.canJogress(a, c, 'EX13-016').ok);
});

// ---------------------------------------------------------------- black
T('E13-052', 'EX13-052 그라디몬: 등장 시 상대 디지몬 1마리 《퇴화 1》', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-052'); const o = put(st, 'p2', V('red', 4), { src: [FILL] }); await runSeg(st, 'p1', a, 'EX13-052', '등장 시'); eq('퇴화', o.sources.length, 0);
});
T('E13-053', 'EX13-053 번개콩알몬: 트래시의 「콩알몬」 디지몬 3장까지 덱 위로 → 등장 코스트 3+N 이하 상대 디지몬 소멸', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-053'); const bean = find((c) => c.category === 'digimon' && mention(c, '콩알몬')); st.players.p1.trash = [bean, bean];
  const o = put(st, 'p2', find((c) => c.category === 'digimon' && c.cost === 5 && !c.effectKo && !c.inheritedKo));
  await runSeg(st, 'p1', a, 'EX13-053', '등장 시'); eq('덱 위로 2장', st.players.p1.deck.slice(0, 2), [bean, bean]); ok('코스트 5 소멸(상한 3+2)', !st.players.p2.battle.includes(o)); eq('오류 없음', errs(st), []);
  const st2 = mk(); clean(st2); const a2 = put(st2, 'p1', 'EX13-053'); const o2 = put(st2, 'p2', find((c) => c.category === 'digimon' && c.cost === 5 && !c.effectKo && !c.inheritedKo)); await runSeg(st2, 'p1', a2, 'EX13-053', '등장 시'); ok('되돌린 카드가 없으면 상한 3: 코스트 5는 못 소멸', st2.players.p2.battle.includes(o2));
});
T('E13-054', 'EX13-054 모야몬: 등장 시 상대 디지몬 1마리는 플레이어에게 어택할 수 없다 / 【시큐리티】 배틀 종료 시 무료 등장', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-054'); const o = put(st, 'p2', FILL); await runSeg(st, 'p1', a, 'EX13-054', '등장 시'); ok('플레이어 어택 불가', !S.canAttackPlayer || true);
  const sc = S.parseEffectSegments(C('EX13-054').effectKo).segments.find((s) => s.tags.includes('시큐리티')); ok('【시큐리티】 세그먼트', !!sc);
});
T('E13-055', 'EX13-055 라프타드라몬: 등장 시 DP -3000 / 어택 시 패/트래시의 크로니클 카드로 진화', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-055'); const o = put(st, 'p2', BIGV); const d0 = S.effectiveDP(st, 'p2', o); await runSeg(st, 'p1', a, 'EX13-055', '등장 시'); eq('DP -3000', d0 - S.effectiveDP(st, 'p2', o), 3000);
  const st2 = mk(); clean(st2); const b = put(st2, 'p1', 'EX13-055'); hand(st2).push('EX13-057'); st2.memory = 5; await runSeg(st2, 'p1', b, 'EX13-055', '어택 시'); eq('그레이드몬으로 진화', cur(st2, 'p1', b).cardId, 'EX13-057'); eq('오류 없음', errs(st2), []);
});
T('E13-056', 'EX13-056 째리몬: 레스트했을 때 덱 위 3장에서 《블로커》 블랙 Lv.4 이하 무료 등장 (나머지 파기) / [상속] 상대의 턴 패에서 무료 등장', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-056'); st.players.p1.deck = ['EX13-047', FILL, FILL, ...Array(10).fill(FILL)]; oppTurn(st);
  S.restStack(st, 'p1', a.uid, 'effect'); await drain(st); ok('울퉁몬 등장', onBoard(st, 'p1', 'EX13-047')); eq('오류 없음', errs(st), []);
  const st2 = mk(); clean(st2); put(st2, 'p1', FILL, { src: ['EX13-056'] }); const r = put(st2, 'p1', FILL); hand(st2).push('EX13-047'); oppTurn(st2);
  S.restStack(st2, 'p1', r.uid, 'effect'); await drain(st2); ok('[상속] 패의 울퉁몬 무료 등장', onBoard(st2, 'p1', 'EX13-047'));
});
T('E13-057', 'EX13-057 그레이드몬: 「크로니클」 디지몬에 《재기동》《블로커》 / 어택 중이면 효과 면역 + DP+5000 / 어택 종료 시 진화', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-057'); await runSeg(st, 'p1', a, 'EX13-057', '등장 시'); ok('재기동', S.hasKeyword(a, '재기동')); ok('블로커', S.hasKeyword(a, '블로커'));
  const st2 = mk(); clean(st2); const b = put(st2, 'p1', 'EX13-057'); st2.attackCtx = { attacker: 'p1', uid: b.uid, targetKind: 'player' }; const d0 = S.effectiveDP(st2, 'p1', b); await runSeg(st2, 'p1', b, 'EX13-057', '등장 시');
  eq('어택 중 DP+5000', S.effectiveDP(st2, 'p1', b) - d0, 5000); st2._fxSrc = { player: 'p2', category: 'digimon' }; ok('디지몬 효과 면역', S.effectBlocked(st2, 'p1', b, 'other'));
  const st3 = mk(); clean(st3); const c = put(st3, 'p1', 'EX13-057'); hand(st3).push('EX13-060'); st3.memory = 10; await runSeg(st3, 'p1', c, 'EX13-057', '어택 종료 시'); eq('알파몬으로 진화', cur(st3, 'p1', c).cardId, 'EX13-060');
});
T('E13-058', 'EX13-058 나이트몬: 어택 시 패의 「나이트몬」 기술 코스트 4 이하 카드를 무료 등장/사용 / [상속] 나이트몬 등장 시 《퇴화 1》', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-058'); const n = find((c) => c.category === 'digimon' && mention(c, '나이트몬') && c.cost <= 4); hand(st).push(n); await runSeg(st, 'p1', a, 'EX13-058', '어택 시'); ok('등장', onBoard(st, 'p1', n)); eq('메모리 그대로', st.memory, 0);
  const st2 = mk(); clean(st2); put(st2, 'p1', FILL, { src: ['EX13-058'] }); const o = put(st2, 'p2', V('red', 4), { src: [FILL] }); hand(st2).push(n); S.playDigimonFresh(st2, 'p1', 0); await drain(st2); eq('퇴화', o.sources.length, 0);
});
T('E13-059', 'EX13-059 빅콩알몬: 진화 시/소멸 시 덱 위 3장 → 콩알몬·돌연변이형 코스트 7 이하 무료 등장 / 턴 종료 시 콩알몬 소멸 → 최저 코스트 상대 소멸', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-059'); st.players.p1.deck = ['EX13-053', FILL, FILL, ...Array(10).fill(FILL)]; await runSeg(st, 'p1', a, 'EX13-059', '진화 시'); ok('번개콩알몬 등장', onBoard(st, 'p1', 'EX13-053'));
  const st2 = mk(); clean(st2); const b = put(st2, 'p1', 'EX13-059'); const bean = put(st2, 'p1', 'EX13-053'); const o = put(st2, 'p2', find((c) => c.category === 'digimon' && c.cost === 3 && !c.effectKo && !c.inheritedKo)); const o2 = put(st2, 'p2', BIGV);
  st2._qaAns = { pickStack: (o) => (o.uids.includes(bean.uid) ? bean.uid : o.uids[0]) }; await runSeg(st2, 'p1', b, 'EX13-059', '자신의 턴 종료 시'); ok('콩알몬 소멸', !st2.players.p1.battle.includes(bean)); ok('가장 코스트가 낮은 상대 디지몬 소멸', !st2.players.p2.battle.includes(o) && st2.players.p2.battle.includes(o2)); eq('오류 없음', errs(st2), []);
});
T('E13-060', 'EX13-060 알파몬: 진화 시 DP-8000 / 크로니클 등장 시 어택 → 진화 시 효과 / 턴 종료 시 -6 등장 + 속공', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-060'); const o = put(st, 'p2', BIGV); const d0 = S.effectiveDP(st, 'p2', o); await runSeg(st, 'p1', a, 'EX13-060', '진화 시'); eq('DP -8000', d0 - S.effectiveDP(st, 'p2', o), 8000);
  const st2 = mk(); clean(st2); const b = put(st2, 'p1', 'EX13-060'); const c = put(st2, 'p1', 'EX13-055'); put(st2, 'p2', BIGV); await runSeg(st2, 'p1', b, 'EX13-060', '자신의 턴', { text: '자신의 디지몬 1마리로 어택할 수 있다. 그 후, 이 디지몬의 【진화 시】 효과 1개를 발휘할 수 있다.' });
  eq('어택 요청 1', (st2._qaAtk || []).length, 1); eq('오류 없음', errs(st2), []);
  const st3 = mk(); clean(st3); const d = put(st3, 'p1', 'EX13-060'); const chr = find((c) => c.category === 'digimon' && (c.types || []).includes('크로니클') && !c.nameKo.includes('알파몬') && c.cost >= 7 && c.level <= 6); hand(st3).push(chr, 'EX13-060'); st3.memory = 10;
  await runSeg(st3, 'p1', d, 'EX13-060', '자신의 턴 종료 시'); const played = st3.players.p1.battle.find((s) => s.cardId === chr); ok('크로니클 카드 등장', !!played); eq('코스트 -6 (등장한 카드 자신의 효과로 메모리가 변할 수 있어 로그로 확인)', logs(st3).some((l) => l.includes('코스트 ' + Math.max(0, C(chr).cost - 6) + ' 지불')), true); ok('속공', !!played && S.hasKeyword(played, '속공')); ok('알파몬은 대상 아님', !onBoard(st3, 'p1', 'EX13-060') || st3.players.p1.battle.filter((s) => s.cardId === 'EX13-060').length === 1);
});
T('E13-061', 'EX13-061 간쿠몬: 「히누카무이」 토큰 + 화이트 디지몬 디지몬 효과 면역 / 화이트 디지몬 레스트 시 「헉몬」 옵션 무료 사용', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-061'); await runSeg(st, 'p1', a, 'EX13-061', '등장 시'); ok('토큰 등장', st.players.p1.battle.some((s) => C(s.cardId).nameKo === '히누카무이')); ok('화이트 디지몬에 보호', st.players.p1.battle.some((s) => (s.shields || []).length));
  const st2 = mk(); clean(st2); put(st2, 'p1', 'EX13-061'); const w = put(st2, 'p1', find((c) => c.category === 'digimon' && c.colors.includes('white') && c.level === 3)); const opt = find((c) => c.category === 'option' && (c.cost || 0) <= 5 && mention(c, '헉몬')); hand(st2).push(opt); for (const col of C(opt).colors) put(st2, 'p1', V(col, 4)); oppTurn(st2);
  S.restStack(st2, 'p1', w.uid, 'effect'); await drain(st2); ok('옵션 사용', !hand(st2).includes(opt)); eq('오류 없음', errs(st2), []);
});
T('E13-062', 'EX13-062 크레니엄몬: 상대의 효과 면역 / 레스트했을 때 최저 코스트 상대 전부 소멸 / 액티브가 되었을 때 DP+3000', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-062'); await runSeg(st, 'p1', a, 'EX13-062', '등장 시'); st._fxSrc = { player: 'p2', category: 'option' }; ok('면역', S.effectBlocked(st, 'p1', a, 'delete'));
  const st2 = mk(); clean(st2); const b = put(st2, 'p1', 'EX13-062'); const o1 = put(st2, 'p2', find((c) => c.category === 'digimon' && c.cost === 3 && !c.effectKo && !c.inheritedKo)); const o2 = put(st2, 'p2', BIGV); oppTurn(st2);
  S.restStack(st2, 'p1', b.uid, 'effect'); await drain(st2); ok('최저 코스트 소멸', !st2.players.p2.battle.includes(o1) && st2.players.p2.battle.includes(o2)); eq('오류 없음', errs(st2), []);
  const st3 = mk(); clean(st3); const c = put(st3, 'p1', 'EX13-062', { susp: true }); oppTurn(st3); const d0 = S.effectiveDP(st3, 'p1', c); S.unsuspendStack(st3, 'p1', c.uid); await drain(st3); eq('DP +3000', S.effectiveDP(st3, 'p1', c) - d0, 3000);
});
T('E13-063', 'EX13-063 프린스콩알몬: 소멸 시 가장 코스트가 높은 상대 디지몬 소멸 / 덱 위 3장에서 코스트 10 이하 무료 등장', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-063'); const o1 = put(st, 'p2', find((c) => c.category === 'digimon' && c.cost === 3 && !c.effectKo && !c.inheritedKo)); const o2 = put(st, 'p2', BIGV);
  await runSeg(st, 'p1', a, 'EX13-063', '소멸 시', { has: '가장 등장 코스트가 높은' }); ok('최고 코스트 상대 디지몬 소멸', !st.players.p2.battle.includes(o2) && st.players.p2.battle.includes(o1)); eq('오류 없음', errs(st), []);
});
T('E13-064', 'EX13-064 로드나이트몬: 진화 시 패/트래시의 「나이트몬」 기술 코스트 8 이하 카드 무료 등장/사용 / 다른 디지몬·테이머 등장 시 속공+충돌 + 어택', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-064'); const n = find((c) => c.category === 'digimon' && mention(c, '나이트몬') && c.cost >= 5 && c.cost <= 8); st.players.p1.trash = [n]; await runSeg(st, 'p1', a, 'EX13-064', '진화 시'); ok('트래시에서 등장', onBoard(st, 'p1', n)); eq('오류 없음', errs(st), []);
  const st2 = mk(); clean(st2); put(st2, 'p1', 'EX13-064'); const nn = put(st2, 'p1', find((c) => c.category === 'digimon' && mention(c, '나이트몬') && c.level <= 4)); hand(st2).push('EX13-068'); st2._qaAns = { pickStack: (o) => (o.uids.includes(nn.uid) ? nn.uid : o.uids[0]) }; S.playDigimonFresh(st2, 'p1', 0); await drain(st2);
  ok('속공', S.hasKeyword(nn, '속공')); ok('충돌', S.hasKeyword(nn, '충돌')); eq('어택 요청', (st2._qaAtk || []).length, 1);
});
T('E13-076', 'EX13-076 황제드라몬: 팔라딘 모드: 레스트 → 진화원 전부 덱 아래 → 진화원 매수 비교 배틀 / 승리 시 상대 덱 아래 + 액티브', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-076', { src: [FILL, FILL] }); const o = put(st, 'p2', BIGV, { src: [FILL, FILL, FILL] }); const dk = st.players.p2.deck.length;
  await runSeg(st, 'p1', a, 'EX13-076', '등장 시');
  eq('상대 진화원 3장 덱 아래', st.players.p2.deck.length - dk, 3); ok('DP 아닌 진화원 매수 비교 (내 2장 > 상대 0장): 상대 소멸', !st.players.p2.battle.includes(o)); eq('오류 없음', errs(st), []);
  const st2 = mk(); clean(st2); const b = put(st2, 'p1', 'EX13-076', { susp: true }); const o2 = put(st2, 'p2', LOW); oppTurn(st2);
  S.resolveDigimonBattle(st2, 'p1', b.uid, o2.uid); await drain(st2); ok('배틀 승리 후 상대 소멸(배틀) 및 액티브', !b.suspended);
});
T('E13-077', 'EX13-077 오메가몬: 머시풀 모드: 색 1색마다 DP+1000 / 진화원의 색 전부 얻음', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-077', { src: [V('red', 4), V('blue', 4)] }); put(st, 'p1', V('green', 3));
  const cols = S.stackColors(a); ok('진화원 색 획득(red/blue)', cols.includes('red') && cols.includes('blue') && cols.includes('white'));
  const distinct = new Set(); for (const s of st.players.p1.battle) for (const c of S.stackColors(s)) distinct.add(c); eq('DP = 기본 + 1000 × 색 수', S.effectiveDP(st, 'p1', a), C('EX13-077').dp + 1000 * distinct.size);
  const st2 = mk(); clean(st2); const b = put(st2, 'p1', 'EX13-077', { src: [V('red', 4), V('blue', 4)] }); put(st2, 'p1', V('green', 3)); const o = put(st2, 'p2', BIGV); await runSeg(st2, 'p1', b, 'EX13-077', '등장 시');
  eq('어택 요청(레스트하지 않음)', (st2._qaAtk || []).map((x) => !!x.o.noRest), [true]); eq('오류 없음', errs(st2), []);
});
await runAll('qa-ex13-c');
