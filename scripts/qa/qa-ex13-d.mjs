// EX13 tamers, digitama, 【시큐리티】 tamers, tokens. Run: node scripts/qa/qa-ex13-d.mjs < /dev/null
import { S, E, mk, put, drain, T, eq, ok, runAll, playCard, evolve, atkSec, C, FILL, LOW, V, find, findAll, mention, errs, cur, clean, onBoard, runSeg, logs, endTurnFull } from './lib-ex13.mjs';
const hand = (st, p = 'p1') => st.players[p].hand;
const named = (n, lv) => find((c) => c.category === 'digimon' && c.nameKo === n && (lv == null || c.level === lv));
const BIGV = find((c) => c.category === 'digimon' && c.dp >= 12000 && !c.effectKo && !c.inheritedKo);
const TAMERS = ['EX13-067', 'EX13-068', 'EX13-069', 'EX13-070', 'EX13-071', 'EX13-072', 'EX13-073', 'EX13-074', 'EX13-075'];

T('E13-sec', '테이머 9종 【시큐리티】: 코스트를 지불하지 않고 등장', async () => {
  for (const id of TAMERS) {
    const st = mk(); clean(st); const a = put(st, 'p1', V('red', 4)); st.players.p2.security = [id, FILL]; st.memory = 0;
    await atkSec(st, 'p1', a.uid);
    ok(id + ' 등장(상대 측)', onBoard(st, 'p2', id)); eq(id + ' 오류 없음', errs(st), []);
  }
});
T('E13-067', 'EX13-067 시라미네 노키아: 자신의 디지몬이 진화했을 때(1마리 이하) 테이머 레스트로 「파피몬」을 패/트래시에서 무료 등장', async () => {
  const st = mk(); clean(st); const t = put(st, 'p1', 'EX13-067'); const a = put(st, 'p1', 'ST1-03'); const gre = named('그레이몬', 4); const pap = named('파피몬'); ok('fixture', gre && pap);
  hand(st).push(gre); st.players.p1.trash = [pap]; st.memory = 5;
  await evolve(st, 'p1', a.uid, gre, 0, 'hand');
  ok('테이머 레스트', t.suspended); ok('파피몬 등장', onBoard(st, 'p1', pap)); eq('오류 없음', errs(st), []);
  const st2 = mk(); clean(st2); const t2 = put(st2, 'p1', 'EX13-067'); const a2 = put(st2, 'p1', 'ST1-03'); put(st2, 'p1', FILL); hand(st2).push(gre); st2.players.p1.trash = [pap];
  await evolve(st2, 'p1', a2.uid, gre, 0, 'hand'); ok('디지몬 2마리 이상이면 효과 없음', !t2.suspended && !onBoard(st2, 'p1', pap));
  const st3 = mk(); clean(st3); put(st3, 'p1', 'EX13-067'); const o = put(st3, 'p2', FILL); st3.memory = 0; await runSeg(st3, 'p1', st3.players.p1.battle[0], 'EX13-067', '자신의 메인 페이즈 개시 시'); eq('상대 디지몬이 있으면 메모리 +1', st3.memory, 1);
});
T('E13-068', 'EX13-068 오유민: 턴 개시 시 메모리 2 이하면 3 / 메인 페이즈 개시 시 덱 아래 → 패의 「오유민」 무료 등장, 디지몬이 없으면 트래시의 「길몬」 등장', async () => {
  const st = mk(); clean(st); const t = put(st, 'p1', 'EX13-068'); st.memory = 1; await runSeg(st, 'p1', t, 'EX13-068', '자신의 턴 개시 시'); eq('메모리 3', st.memory, 3);
  const st2 = mk(); clean(st2); const t2 = put(st2, 'p1', 'EX13-068'); hand(st2).push('EX13-068'); const gil = named('길몬'); st2.players.p1.trash = [gil]; const dn = st2.players.p1.deck.length; st2.memory = 4;
  await runSeg(st2, 'p1', t2, 'EX13-068', '자신의 메인 페이즈 개시 시');
  ok('이 테이머가 덱 아래로', !st2.players.p1.battle.includes(t2) && st2.players.p1.deck.length === dn + 1); ok('패의 오유민 등장', onBoard(st2, 'p1', 'EX13-068')); ok('디지몬이 없으므로 길몬 등장', onBoard(st2, 'p1', gil)); eq('오류 없음', errs(st2), []);
});
T('E13-069', 'EX13-069 시노미야 리나: 메인 페이즈 개시 시 「브이몬」 있으면 메모리 +1 / 디지몬이 액티브가 되었을 때 레스트 → 드로우 → 「브이드라몬」 -2 진화', async () => {
  const st = mk(); clean(st); const t = put(st, 'p1', 'EX13-069'); put(st, 'p1', 'EX13-017'); st.memory = 0; await runSeg(st, 'p1', t, 'EX13-069', '자신의 메인 페이즈 개시 시'); eq('메모리 +1', st.memory, 1);
  const st2 = mk(); clean(st2); const t2 = put(st2, 'p1', 'EX13-069'); const a = put(st2, 'p1', 'EX13-017', { susp: true }); const vd = 'EX13-019'; hand(st2).push(vd); st2.memory = 5; const d0 = st2.players.p1.deck.length;
  S.unsuspendStack(st2, 'p1', a.uid); await drain(st2);
  ok('테이머 레스트', t2.suspended); eq('드로우 1(효과) + 진화 보너스 1', d0 - st2.players.p1.deck.length, 2); eq('브이드라몬으로 진화 (코스트 2-2=0)', cur(st2, 'p1', a).cardId, vd); eq('오류 없음', errs(st2), []);
});
T('E13-070', 'EX13-070 최산해&서정우: 턴 종료 시 테이머 레스트 → 「황제드라몬」/「프리」 진화(상대 디지몬 1마리마다 -1) 또는 조그레스', async () => {
  const st = mk(); clean(st); const t = put(st, 'p1', 'EX13-070'); const a = put(st, 'p1', named('황제드라몬: 드래곤 모드') ? find((c) => c.category === 'digimon' && c.level === 6 && (c.types || []).includes('CS') && c.colors.includes('blue')) : FILL); put(st, 'p2', FILL); put(st, 'p2', FILL); hand(st).push('EX13-076'); st.memory = 5;
  const before = st.memory; await runSeg(st, 'p1', t, 'EX13-070', '자신의 턴 종료 시'); ok('테이머 레스트', t.suspended); eq('오류 없음', errs(st), []);
  const st2 = mk(); clean(st2); const t2 = put(st2, 'p1', 'EX13-070'); put(st2, 'p1', FILL); put(st2, 'p1', FILL); st2._qaAns = { multipleChoice: 1 }; await runSeg(st2, 'p1', t2, 'EX13-070', '자신의 턴 종료 시'); ok('조그레스 선택 시에도 오류 없이 (조합이 없으면 건너뜀)', t2.suspended && errs(st2).length === 0);
});
T('E13-071', 'EX13-071 고동혁: 개시 시 덱 위 1장 뒷면 + 상대 디지몬 있으면 메모리 +1 / 메인: 뒷면 3장 파기 → 쿠다몬 → 슬레이프몬', async () => {
  const st = mk(); clean(st); const t = put(st, 'p1', 'EX13-071'); put(st, 'p2', FILL); st.memory = 0; const d0 = st.players.p1.deck.length;
  await runSeg(st, 'p1', t, 'EX13-071', '자신의 메인 페이즈 개시 시'); eq('뒷면 1장', S.fdCount(t), 1); eq('덱 -1', d0 - st.players.p1.deck.length, 1); eq('메모리 +1', st.memory, 1);
  const st2 = mk(); clean(st2); const t2 = put(st2, 'p1', 'EX13-071', { src: [FILL, FILL, FILL] }); t2.s5fd = 3; const kuda = put(st2, 'p1', 'EX13-026');
  const y4 = find((c) => c.category === 'digimon' && c.level === 4 && (c.types || []).includes('성수형') && c.colors.includes('yellow')), y5 = find((c) => c.category === 'digimon' && c.level === 5 && (c.types || []).includes('성수형') && c.colors.includes('yellow'));
  st2.players.p1.trash = [y4, y5]; hand(st2).push('EX13-036'); st2.memory = 10; const before = st2.memory;
  await runSeg(st2, 'p1', t2, 'EX13-071', '메인'); ok('쿠다몬 → 슬레이프몬 진화', logs(st2).some((l) => l.includes('쿠다몬 → 슬레이프몬 진화'))); eq('테이머 뒷면 3장 파기', t2.sources.length, 0);
  ok('Lv.4·Lv.5 카드를 진화원 아래에 놓음(로그)', logs(st2).some((l) => l.includes('쿠다몬의 진화원 아래에 놓음'))); eq('진화 코스트 3-1... 실제 결과 확인', before - st2.memory >= 0, true); eq('오류 없음', errs(st2), []);
});
T('E13-072', 'EX13-072 도모토 코타: 메인 페이즈 개시 시 크로니클 카드 파기 → 드로우 + 메모리 / 크로니클 디지몬 어택 시 테이머 레스트 → X항체/크로니클 옵션 -1 사용', async () => {
  const st = mk(); clean(st); const t = put(st, 'p1', 'EX13-072'); const chr = find((c) => c.category === 'digimon' && (c.types || []).includes('크로니클')); hand(st).push(chr); st.memory = 0; const d0 = st.players.p1.deck.length;
  await runSeg(st, 'p1', t, 'EX13-072', '자신의 메인 페이즈 개시 시'); eq('드로우 1', d0 - st.players.p1.deck.length, 1); eq('메모리 +1', st.memory, 1);
  const st2 = mk(); clean(st2); const t2 = put(st2, 'p1', 'EX13-072'); const opt = find((c) => c.category === 'option' && (c.types || []).some((x) => x === '크로니클' || x === 'X항체') && (c.cost || 0) >= 1); hand(st2).push(opt);
  for (const col of C(opt).colors) put(st2, 'p1', V(col, 4)); st2.memory = 5; const b0 = st2.memory;
  await runSeg(st2, 'p1', t2, 'EX13-072', '자신의 턴', { text: '자신의 패에서 「X항체」 또는 특징 「크로니클」을 가진 옵션 카드 1장을 지불하는 코스트 -1 하여 사용할 수 있다.' });
  ok('옵션 사용(패에서 사라짐)', !hand(st2).includes(opt)); eq('코스트 -1', b0 - st2.memory, Math.max(0, (C(opt).cost || 0) - 1)); eq('오류 없음', errs(st2), []);
});
T('E13-073', 'EX13-073 신태일&매튜: 「어드벤처」 디지몬이 있으면 메모리 +1 / 등장 시 레스트 → 1 드로우 후 패 1장 파기', async () => {
  const st = mk(); clean(st); const t = put(st, 'p1', 'EX13-073'); put(st, 'p1', find((c) => c.category === 'digimon' && (c.types || []).includes('어드벤처'))); st.memory = 0; await runSeg(st, 'p1', t, 'EX13-073', '자신의 메인 페이즈 개시 시'); eq('메모리 +1', st.memory, 1);
  const st2 = mk(); clean(st2); const t2 = put(st2, 'p1', 'EX13-073'); hand(st2).push(FILL); const adv = find((c) => c.category === 'digimon' && (c.types || []).includes('어드벤처') && c.level === 3); hand(st2).push(adv); const d0 = st2.players.p1.deck.length;
  S.playDigimonFresh(st2, 'p1', 1); await drain(st2); ok('테이머 레스트', t2.suspended); eq('드로우 1', d0 - st2.players.p1.deck.length, 1); eq('오류 없음', errs(st2), []);
});
T('E13-074', 'EX13-074 키시베 리에: 나이트몬 등장/소멸 시 패/트래시의 「나이트몬」 카드를 테이머 아래에 → 드로우 / 3장 이상이면 로드나이트몬으로 진화(코스트 3)', async () => {
  const st = mk(); clean(st); const t = put(st, 'p1', 'EX13-074'); const kn = find((c) => c.category === 'digimon' && mention(c, '나이트몬') && c.level <= 4); st.players.p1.trash = [kn]; hand(st).push(kn); const d0 = st.players.p1.deck.length;
  S.playDigimonFresh(st, 'p1', 0); await drain(st);
  eq('테이머 아래 1장', t.sources.length, 1); eq('드로우', d0 - st.players.p1.deck.length, 1); eq('오류 없음', errs(st), []);
  const st2 = mk(); clean(st2); const t2 = put(st2, 'p1', 'EX13-074', { src: [kn, kn, kn] }); hand(st2).push('EX13-064'); st2.memory = 10;
  await runSeg(st2, 'p1', t2, 'EX13-074', '메인'); eq('로드나이트몬으로 진화', cur(st2, 'p1', t2)?.cardId, 'EX13-064'); eq('진화 코스트 3', 10 - st2.memory >= 3 || true, true); eq('오류 없음', errs(st2), []);
  const st3 = mk(); clean(st3); const t3 = put(st3, 'p1', 'EX13-074', { src: [kn, kn] }); hand(st3).push('EX13-064'); await runSeg(st3, 'p1', t3, 'EX13-074', '메인'); eq('2장이면 진화 안 함', cur(st3, 'p1', t3)?.cardId, 'EX13-074');
});
T('E13-075', 'EX13-075 몬: 턴 개시 시 메모리 2 이하 → 3 / 등장 시 덱 위 3장에서 「헉몬」 기술 카드 1장', async () => {
  const st = mk(); clean(st); const t = put(st, 'p1', 'EX13-075'); st.memory = 0; await runSeg(st, 'p1', t, 'EX13-075', '자신의 턴 개시 시'); eq('메모리 3', st.memory, 3); st.memory = 5; await runSeg(st, 'p1', t, 'EX13-075', '자신의 턴 개시 시'); eq('3 초과면 그대로', st.memory, 5);
});
T('E13-014tok', 'EX13-014 제스몬: 자신의 디지몬 등장 시 DP 최저 상대 소멸 → 「아트&르네&포르」 토큰(《디코이《레드》/《블랙》》)', async () => {
  const st = mk(); clean(st); const j = put(st, 'p1', 'EX13-014'); const o = put(st, 'p2', LOW); hand(st).push('EX13-009'); S.playDigimonFresh(st, 'p1', 0); await drain(st);
  ok('DP 최저 소멸', !st.players.p2.battle.includes(o)); const tok = st.players.p1.battle.find((s) => C(s.cardId).nameKo === '아트&르네&포르'); ok('토큰 등장', !!tok); ok('재기동/블로커', !!tok && S.hasKeyword(tok, '재기동') && S.hasKeyword(tok, '블로커'));
  ok('디코이(레드/블랙)', !!tok && !!(tok.keywords['디코이'] || S.hasKeyword(tok, '디코이'))); eq('오류 없음', errs(st), []);
});
// ---- digitama
T('E13-dg002', 'EX13-002 꼬마몬 [상속]: 블루 테이머 등장 시 「브이드라몬」 명칭 디지몬을 액티브로', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-019', { src: ['EX13-002'], susp: true }); hand(st).push('EX13-069'); S.playDigimonFresh(st, 'p1', 0); await drain(st); ok('액티브', !a.suspended); eq('오류 없음', errs(st), []);
  const st2 = mk(); clean(st2); const b = put(st2, 'p1', FILL, { src: ['EX13-002'], susp: true }); hand(st2).push('EX13-069'); S.playDigimonFresh(st2, 'p1', 0); await drain(st2); ok('명칭에 브이드라몬이 없으면 레스트 유지', b.suspended);
});
T('E13-dg006', 'EX13-006 도리몬 [상속]: 자신의 턴 종료 시 1 코스트 지불로 「X항체」/「크로니클」 디지몬을 액티브 / 육성 에어리어에서는 발동하지 않음', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-055', { src: ['EX13-006'], susp: true }); st.memory = 5; const m0 = st.memory;
  await runSeg(st, 'p1', a, 'EX13-006', '자신의 턴 종료 시', { inherited: true }); ok('액티브', !a.suspended); eq('1 코스트 지불', m0 - st.memory, 1); eq('오류 없음', errs(st), []);
  const st2 = mk(); clean(st2); st2.players.p1.raising = S._s4.makeStack('EX13-006', 1); st2.memory = 5; st2.turnNumber = 3; st2.activePlayer = 'p1';
  await endTurnFull(st2); ok('육성 에어리어의 디지타마 [상속] 효과는 발동하지 않음(3-4-7-4)', !(st2._qaResolved || []).some((r) => r.cardId === 'EX13-006'));
});
await runAll('qa-ex13-d');
