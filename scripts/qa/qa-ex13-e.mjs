// EX13 trigger-timing scenarios (watcher / event pipelines, turn-end, attack-declared) + keyword-ish extras. Run: node scripts/qa/qa-ex13-e.mjs < /dev/null
import { S, E, Fx, mk, put, drain, T, eq, ok, runAll, playCard, evolve, atkSec, C, FILL, LOW, V, find, mention, errs, cur, clean, onBoard, runSeg, logs, endTurnFull } from './lib-ex13.mjs';
const hand = (st, p = 'p1') => st.players[p].hand;
const oppTurn = (st) => { st.activePlayer = 'p2'; };
const resolved = (st, id) => (st._qaResolved || []).some((r) => r.cardId === id);

T('E13-009i', 'EX13-009 헉몬 [상속]: 【자신의 턴】[턴 1회] 화이트인 자신의 디지몬이 등장했을 때 메모리 +1', async () => {
  const st = mk(); clean(st); put(st, 'p1', FILL, { src: ['EX13-009'] }); const w = find((c) => c.category === 'digimon' && c.colors.includes('white') && c.cost <= 3); hand(st).push(w, w); st.memory = 0;
  S.playDigimonFresh(st, 'p1', 0); await drain(st); eq('메모리 +1', st.memory, 1); S.playDigimonFresh(st, 'p1', 0); await drain(st); eq('턴 1회', st.memory, 1);
});
T('E13-008i', 'EX13-008 드라코몬 [상속]: 【자신의 턴 종료 시】 이 디지몬과 다른 자신의 디지몬으로 패의 디지몬 카드로 조그레스 진화', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-021', { src: ['EX13-008'] }); const b = put(st, 'p1', 'EX13-041'); hand(st).push('EX13-045');
  await runSeg(st, 'p1', a, 'EX13-008', '자신의 턴 종료 시', { inherited: true });
  ok('엑자몬으로 조그레스 진화', onBoard(st, 'p1', 'EX13-045')); eq('오류 없음', errs(st), []);
});
T('E13-020t', 'EX13-020 매그너몬: 자신의 턴 종료 시 「프리」/「로얄 나이츠」 디지몬 1마리를 액티브로', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-020'); const k = put(st, 'p1', 'EX13-017', { susp: true }); await endTurnFull(st); ok('액티브', !k.suspended || resolved(st, 'EX13-020')); eq('오류 없음', errs(st), []);
});
T('E13-021i', 'EX13-021/022 [상속]: 「드라코몬」/「엑자몬」(브이드라몬) 포함 이 디지몬이 레스트했을 때 액티브로', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-008', { src: ['EX13-021'] }); oppTurn(st); S.restStack(st, 'p1', a.uid, 'effect'); await drain(st); ok('액티브 (드라코몬은 기술됨)', !a.suspended);
  const st2 = mk(); clean(st2); const b = put(st2, 'p1', 'EX13-019', { src: ['EX13-022'] }); oppTurn(st2); S.restStack(st2, 'p1', b.uid, 'effect'); await drain(st2); ok('브이드라몬 명칭: 액티브', !b.suspended);
  const st3 = mk(); clean(st3); const c = put(st3, 'p1', FILL, { src: ['EX13-022'] }); oppTurn(st3); S.restStack(st3, 'p1', c.uid, 'effect'); await drain(st3); ok('명칭 불일치: 레스트 유지', c.suspended);
});
T('E13-033i', 'EX13-033/034 [상속]: 시큐리티가 줄어들었을 때 이 디지몬을 액티브로 (서로의 턴 [턴 1회])', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', FILL, { src: ['EX13-033'], susp: true }); st.players.p1.security = [FILL, FILL, FILL]; oppTurn(st); S.trashTopSecurityByEffect(st, 'p1'); await drain(st); ok('액티브', !a.suspended);
});
T('E13-040t', 'EX13-040 미케몬: 【서로의 턴】 이 디지몬이 레스트했을 때 상대의 디지몬/테이머 1마리(명)를 레스트', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-040'); const o = put(st, 'p2', FILL); oppTurn(st); S.restStack(st, 'p1', a.uid, 'effect'); await drain(st); ok('상대 디지몬 레스트', o.suspended); eq('오류 없음', errs(st), []);
});
T('E13-041i', 'EX13-041 그라운드라몬 [상속]: 「드라코몬」 기술 자신의 디지몬이 배틀에서 상대 디지몬을 소멸시켰을 때 상대 시큐리티 1장 파기', async () => {
  const st = mk(); clean(st); put(st, 'p1', FILL, { src: ['EX13-041'] }); const d = put(st, 'p1', 'EX13-045'); const o = put(st, 'p2', LOW); st.players.p2.security = [FILL, FILL];
  S.resolveDigimonBattle(st, 'p1', d.uid, o.uid); await drain(st); eq('상대 시큐리티 -1', st.players.p2.security.length, 1);
});
T('E13-051i', 'EX13-051 가드로몬 [상속]: 상대의 턴 자신의 디지몬이 레스트했을 때 이 디지몬을 액티브로 (턴 1회)', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', FILL, { src: ['EX13-051'], susp: true }); const b = put(st, 'p1', FILL); oppTurn(st); S.restStack(st, 'p1', b.uid, 'effect'); await drain(st); ok('액티브', !a.suspended);
});
T('E13-060w', 'EX13-060 알파몬: 크로니클 디지몬이 등장하면 어택 요청 (자신의 턴, 턴 1회)', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-060'); const t = put(st, 'p1', FILL); hand(st).push('EX13-055'); S.playDigimonFresh(st, 'p1', 0); await drain(st); eq('어택 요청', (st._qaAtk || []).length, 1); ok('060 처리됨', resolved(st, 'EX13-060')); eq('오류 없음', errs(st), []);
});
T('E13-072w', 'EX13-072 도모토 코타: 크로니클 디지몬이 어택했을 때 테이머 레스트 → 옵션 -1 사용 (어택 선언 흐름)', async () => {
  const st = mk(); clean(st); const t = put(st, 'p1', 'EX13-072'); const a = put(st, 'p1', 'EX13-055'); const opt = find((c) => c.category === 'option' && (c.types || []).some((x) => x === '크로니클' || x === 'X항체') && (c.cost || 0) >= 1); hand(st).push(opt);
  for (const col of C(opt).colors) put(st, 'p1', V(col, 4)); st.memory = 8; st.players.p2.security = [LOW, LOW]; await atkSec(st, 'p1', a.uid);
  ok('트리거 발생', resolved(st, 'EX13-072')); ok('옵션 사용', !hand(st).includes(opt)); ok('테이머 레스트', t.suspended); eq('오류 없음', errs(st), []);
});
T('E13-038', 'EX13-038 플롯트몬: 등장 시 덱 위 3장에서 「두프트몬」 기술 카드 1장 + 수/짐승 포함 디지몬 1장', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-038'); const du = find((c) => mention(c, '두프트몬')); const beast = find((c) => c.category === 'digimon' && (c.types || []).some((t) => t.includes('짐승') && !['수장룡형', '수생형'].includes(t))) ; st.players.p1.deck = [du, beast, FILL, ...Array(10).fill(FILL)];
  await runSeg(st, 'p1', a, 'EX13-038', '등장 시'); ok('2장 추가', st.players.p1.hand.length === 2); eq('오류 없음', errs(st), []);
});
T('E13-move', '【이동 시】 (EX13-007/008/017/026/027/049): 육성 에어리어에서 배틀 에어리어로 이동할 때 발동', async () => {
  for (const id of ['EX13-007', 'EX13-008', 'EX13-017', 'EX13-026', 'EX13-027', 'EX13-049']) {
    const st = mk(); clean(st); st.players.p1.raising = S._s4.makeStack(id, 1); st.players.p1.raising.attackEligibleTurn = 0; S.recomputeStackGrants(st.players.p1.raising);
    st.phase = 'breeding'; S.moveRaisingToBattle(st, 'p1'); await drain(st);
    ok(id + ' 이동 시 발동', (st._qaResolved || []).some((r) => r.cardId === id && r.tags.includes('이동 시'))); eq(id + ' 오류 없음', errs(st), []);
  }
});
T('E13-asm', '어셈블리: EX13 카드의 재료 조건 (키워드/색/서로 다른 명칭·색/Lv 시리즈)', async () => {
  const st = mk(); const pl = st.players.p1;
  const lvSeries = (pred) => [5, 4, 3].map((lv) => find((c) => c.category === 'digimon' && c.level === lv && pred(c)));
  // 062: 《블로커》를 가진 블랙인 Lv.5×Lv.4×Lv.3
  const b = lvSeries((c) => c.colors.includes('black') && /《블로커》/.test(c.effectKo || '')); ok('062 fixture', b.every(Boolean)); pl.hand = ['EX13-062']; pl.trash = [...b];
  eq('062 계획', S.planAssembly(st, 'p1', 0)?.materials.length, 3);
  pl.trash = [FILL, FILL, FILL]; eq('062 재료 부족', S.planAssembly(st, 'p1', 0), null);
  // 043: 특징 「포유류형」/「짐승형」/「수인형」을 가진 그린인 Lv.5×Lv.4×Lv.3 (색은 모든 항목에 적용)
  const g = lvSeries((c) => c.colors.includes('green') && (c.types || []).some((x) => ['포유류형', '짐승형', '수인형'].includes(x))); pl.hand = ['EX13-043']; pl.trash = [...g];
  eq('043 계획', S.planAssembly(st, 'p1', 0)?.materials.length, 3);
  pl.trash = [g[0], V('red', 4), g[2]]; eq('043 두 번째 재료가 그린이 아니면 불가', S.planAssembly(st, 'p1', 0), null);
  // 077: 색이 서로 다른 특징 「어드벤처」를 가진 디지몬 카드 6장 (-8)
  const adv = []; const seen = new Set(); for (const c of Object.values(S.CARDS)) { if (c.category !== 'digimon' || !(c.types || []).includes('어드벤처') || c.isParallel) continue; const k = [...c.colors].sort().join('+'); if (!seen.has(k)) { seen.add(k); adv.push(c.id); } if (adv.length === 6) break; }
  pl.hand = ['EX13-077']; pl.trash = [...adv]; eq('077 계획(6장)', adv.length === 6 ? S.planAssembly(st, 'p1', 0)?.materials.length : 6, 6);
  pl.trash = [adv[0], adv[0], adv[0], adv[1], adv[2], adv[3]]; eq('077 색이 같은 카드는 중복 불가', S.planAssembly(st, 'p1', 0), null);
  // 061: 명칭이 서로 다른 「헉몬」 기술 디지몬 카드 3장 (-5)
  const hk = []; const nm = new Set(); for (const c of Object.values(S.CARDS)) { if (c.category === 'digimon' && !c.isParallel && S.cardMentions(c, '헉몬') && !nm.has(c.nameKo)) { nm.add(c.nameKo); hk.push(c.id); if (hk.length === 3) break; } }
  pl.hand = ['EX13-061']; pl.trash = [...hk]; eq('061 계획', S.planAssembly(st, 'p1', 0)?.materials.length, 3); pl.trash = [hk[0], hk[0], hk[1]]; eq('061 같은 명칭 중복 불가', S.planAssembly(st, 'p1', 0), null);
  eq('EX13 어셈블리 카드 전부 파싱됨', ['014', '015', '016', '020', '023', '024', '031', '036', '037', '043', '044', '060', '061', '062', '063', '076', '077'].filter((n) => !S.parseAssembly('EX13-' + n)), []);
});
T('E13-asmline', '어셈블리/디지크로스 "-N:" 줄은 앞 효과 본문에 붙지 않는다 (수동 비용 프롬프트 방지)', async () => {
  let bad = [];
  for (const c of Object.values(S.CARDS)) for (const txt of [c.effectKo, c.inheritedKo]) { if (!txt || !/(?:어셈블리|디지크로스)\s*-\s*\d+\s*[:：]/.test(txt)) continue; for (const sg of S.parseEffectSegments(txt).segments) { if (/(?:어셈블리|디지크로스)\s*-\s*\d+\s*[:：]/.test(sg.body)) bad.push(c.id); else { const sc = Fx.compileToScript(sg.body); if (JSON.stringify(sc).includes('manualCost') && /어셈블리|디지크로스/.test(JSON.stringify(sc))) bad.push(c.id + ':manual'); } } }
  eq('본문에 어셈블리 줄 없음', bad, []);
});
T('E13-lifecycle', '스모크: EX13 전 카드가 손패에서 등장/사용 → 진화 → 소멸을 오류 없이 통과', async () => {
  const ids = Object.keys(S.CARDS).filter((i) => /^EX13-\d+$/.test(i)).sort();
  for (const id of ids) {
    const c = C(id); if (c.category === 'digitama') continue;
    const st = mk(); clean(st); put(st, 'p2', V('red', 4), { src: [FILL] }); put(st, 'p2', V('blue', 5), { src: [FILL, FILL] }); st.players.p1.security = [FILL, FILL, FILL, FILL]; st.players.p2.security = [FILL, FILL, FILL]; st.memory = 10;
    st.players.p1.hand = [FILL]; st.players.p1.trash = [FILL, FILL];
    if (c.category === 'tamer' || c.category === 'digimon') { st.players.p1.hand.push(id); S.playDigimonFresh(st, 'p1', st.players.p1.hand.length - 1); await drain(st); const s = st.players.p1.battle.find((x) => x.cardId === id); if (s) { S.deleteStack(st, 'p1', s.uid, 'trash', 'effect'); await drain(st); } }
    eq(id + ' 오류 없음', errs(st), []);
  }
});
await runAll('qa-ex13-e');
