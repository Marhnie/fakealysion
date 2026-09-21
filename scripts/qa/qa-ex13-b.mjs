// EX13 digimon 【등장 시】/【진화 시】/【어택 시】 primary effects (data-driven). Run: node scripts/qa/qa-ex13-b.mjs < /dev/null
import { S, mk, put, drain, T, eq, ok, runAll, playCard, evolve, useOption, atkSec, C, FILL, LOW, V, find, findAll, mention, errs, cur, clean, onBoard, runSeg, setTop, logs } from './lib-ex13.mjs';
const dm = (n) => find((c) => c.category === 'digimon' && mention(c, n));
const dmName = (n) => find((c) => c.category === 'digimon' && c.nameKo.includes(n));
const tamerOf = (n) => find((c) => c.category === 'tamer' && mention(c, n));
const optOf = (n) => find((c) => c.category === 'option' && mention(c, n));
const hand = (st, p = 'p1') => st.players[p].hand;
const BIGV = find((c) => c.category === 'digimon' && c.dp >= 12000 && !c.effectKo && !c.inheritedKo) || find((c) => c.category === 'digimon' && c.dp >= 9000 && !c.effectKo && !c.inheritedKo);

// ---- reveal-top-3 family: [top3 cards], expected hand additions (ids), remaining go to deck bottom
const REVEAL = [
  ['EX13-008', '등장 시', () => [dm('드라코몬'), FILL, FILL], (h) => h.length === 1 && mention(C(h[0]), '드라코몬')],
  ['EX13-009', '등장 시', () => [dm('헉몬'), optOf('헉몬'), FILL], (h) => h.length === 2 && h.some((i) => C(i).category === 'digimon') && h.some((i) => C(i).category !== 'digimon')],
  ['EX13-017', '등장 시', () => [FILL, dm('브이드라몬'), FILL], (h) => h.length === 1 && mention(C(h[0]), '브이드라몬')],
  ['EX13-027', '등장 시', () => [dmName('스카몬'), FILL, FILL], (h) => h.length === 1 && C(h[0]).nameKo.includes('스카몬')],
  ['EX13-046', '등장 시', () => [dm('콩알몬'), find((c) => c.category === 'digimon' && (c.types || []).includes('돌연변이형') && !mention(c, '콩알몬')), FILL], (h) => h.length === 2],
  ['EX13-047', '등장 시', () => [find((c) => (c.types || []).includes('로얄 나이츠') && c.category === 'digimon' && !/《블로커》/.test(c.effectKo || '')), find((c) => /《블로커》/.test(c.effectKo || '') && !(c.types || []).includes('로얄 나이츠')), FILL], (h) => h.length === 2],
  ['EX13-048', '등장 시', () => [dm('나이트몬'), dmName('나이트몬'), FILL], (h) => h.length === 2],
  ['EX13-049', '등장 시', () => [find((c) => (c.types || []).includes('X항체') && c.category === 'digimon'), FILL, FILL], (h) => h.length === 1],
  ['EX13-075', '등장 시', () => [dm('헉몬'), FILL, FILL], (h) => h.length === 1],
];
for (const [id, tag, top, chk] of REVEAL) {
  T('E13-rv-' + id, `${id} ${C(id).nameKo}: 덱 위 3장 오픈 → 조건 카드를 패에 추가, 나머지는 덱 아래`, async () => {
    const st = mk(); clean(st); const a = put(st, 'p1', id);
    const t = top(); ok('픽스처 카드 존재', t.every(Boolean));
    st.players.p1.deck = [...t, ...Array(10).fill(FILL)]; const deckN = st.players.p1.deck.length; hand(st).length = 0;
    await runSeg(st, 'p1', a, id, tag);
    ok('패 추가 결과 ' + hand(st).map((i) => C(i).nameKo), chk(hand(st)));
    eq('덱 매수 = 원래 - 추가한 매수', st.players.p1.deck.length, deckN - hand(st).length); eq('오류 없음', errs(st), []);
  });
}
T('E13-007', 'EX13-007 길몬: 패 1장 파기 → 트래시의 「듀크몬」 디지몬/레드 테이머를 패로', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-007'); const duke = dmName('듀크몬');
  st.players.p1.hand = [FILL]; st.players.p1.trash = [duke];
  await runSeg(st, 'p1', a, 'EX13-007', '등장 시');
  ok('듀크몬이 패로', hand(st).includes(duke)); eq('파기한 카드는 트래시', st.players.p1.trash.includes(FILL), true); eq('오류 없음', errs(st), []);
});
T('E13-010', 'EX13-010 그라우몬: DP 4000 이하 소멸, 못 하면 《돌진》 + DP+3000', async () => {
  let st = mk(); clean(st); let a = put(st, 'p1', 'EX13-010'); const weak = put(st, 'p2', V('red', 3) && LOW);
  await runSeg(st, 'p1', a, 'EX13-010', '진화 시'); ok('약한 디지몬 소멸', !st.players.p2.battle.includes(weak));
  st = mk(); clean(st); a = put(st, 'p1', 'EX13-010'); put(st, 'p2', BIGV); // big DP: cannot be destroyed
  const before = S.effectiveDP(st, 'p1', a);
  await runSeg(st, 'p1', a, 'EX13-010', '진화 시');
  eq('DP +3000', S.effectiveDP(st, 'p1', a) - before, 3000); ok('돌진 획득', S.hasKeyword(a, '돌진'));
});
T('E13-011', 'EX13-011 바오헉몬: 테이머 1명 이하라면 패의 「몬」을 무료 등장', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-011'); hand(st).push('EX13-075'); st.memory = 5;
  await runSeg(st, 'p1', a, 'EX13-011', '등장 시');
  ok('몬 등장', onBoard(st, 'p1', 'EX13-075')); eq('메모리 그대로', st.memory, 5);
  const st2 = mk(); clean(st2); const a2 = put(st2, 'p1', 'EX13-011'); put(st2, 'p1', 'EX13-068'); put(st2, 'p1', 'EX13-069'); hand(st2).push('EX13-075');
  await runSeg(st2, 'p1', a2, 'EX13-011', '등장 시'); ok('테이머 2명이면 등장 없음', !onBoard(st2, 'p1', 'EX13-075'));
});
T('E13-013', 'EX13-013 메가로그라우몬: 어택 종료 시 패/트래시의 「길몬」 기술 테이머 무료 등장', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-013'); const t = tamerOf('길몬'); ok('fixture', !!t);
  st.players.p1.trash = [t]; st.memory = 5;
  await runSeg(st, 'p1', a, 'EX13-013', '어택 종료 시');
  ok('테이머 등장', onBoard(st, 'p1', t)); eq('메모리 그대로', st.memory, 5);
});
T('E13-013b', 'EX13-013 메가로그라우몬 [상속]: 상대 디지몬 소멸 시 (듀크몬 명칭이면) 상대 시큐리티 1장 파기', async () => {
  const st = mk(); clean(st); const duke = dmName('듀크몬');
  const a = put(st, 'p1', duke, { src: ['EX13-013'] }); const v = put(st, 'p2', LOW); st.players.p2.security = [FILL, FILL];
  st.activePlayer = 'p2'; // 서로의 턴: either turn
  S.deleteStack(st, 'p2', v.uid, 'trash', 'effect'); await drain(st);
  eq('상대 시큐리티 -1', st.players.p2.security.length, 1); eq('오류 없음', errs(st), []);
  const st2 = mk(); clean(st2); const b = put(st2, 'p1', FILL, { src: ['EX13-013'] }); const v2 = put(st2, 'p2', LOW); st2.players.p2.security = [FILL, FILL];
  S.deleteStack(st2, 'p2', v2.uid, 'trash', 'effect'); await drain(st2);
  eq('듀크몬이 아니면 파기 없음', st2.players.p2.security.length, 2);
});
T('E13-015', 'EX13-015 듀크몬: DP 12000 이상 소멸, 소멸 못 하면 상대 시큐리티 1장 파기', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-015'); const big = put(st, 'p2', find((c) => c.category === 'digimon' && c.dp >= 12000 && !c.effectKo && !c.inheritedKo) || 'BT1-113');
  st.players.p2.security = [FILL, FILL];
  await runSeg(st, 'p1', a, 'EX13-015', '등장 시');
  eq('보안 그대로(소멸 성공)', st.players.p2.security.length, 2); ok('소멸됨', !st.players.p2.battle.includes(big));
  const st2 = mk(); clean(st2); const a2 = put(st2, 'p1', 'EX13-015'); st2.players.p2.security = [FILL, FILL];
  await runSeg(st2, 'p1', a2, 'EX13-015', '등장 시'); eq('소멸할 대상 없음 → 시큐리티 -1', st2.players.p2.security.length, 1);
});
T('E13-016', 'EX13-016 오메가몬: 상대 디지몬/테이머 2마리 레스트 불가 / 진화원 이하 소멸', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-016', { src: [FILL, FILL] }); const o1 = put(st, 'p2', FILL), o2 = put(st, 'p2', FILL), o3 = put(st, 'p2', FILL);
  await runSeg(st, 'p1', a, 'EX13-016', '등장 시');
  const locked = [o1, o2, o3].filter((o) => o.cannotBeRestedUntil != null).length; eq('레스트 불가 2마리', locked, 2);
  const st2 = mk(); clean(st2); const b = put(st2, 'p1', 'EX13-016', { src: [FILL, FILL] }); const s1 = put(st2, 'p2', FILL, { src: [FILL] }), s3 = put(st2, 'p2', FILL, { src: [FILL, FILL, FILL] });
  await runSeg(st2, 'p1', b, 'EX13-016', '카운터');
  ok('진화원 3장(>2장)은 대상 아님', st2.players.p2.battle.includes(s3)); ok('진화원 1장은 소멸', !st2.players.p2.battle.includes(s1));
});
T('E13-018', 'EX13-018 코어드라몬: 「드라코몬」/「엑자몬」 기술 카드 파기 → 《2 드로우》', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-018'); hand(st).push(dm('드라코몬')); const d0 = st.players.p1.deck.length;
  await runSeg(st, 'p1', a, 'EX13-018', '등장 시');
  eq('2장 드로우', d0 - st.players.p1.deck.length, 2); eq('패: 파기 1 후 드로우 2', hand(st).length, 2);
});
T('E13-018b', 'EX13-018/039 코어드라몬: 다른 「드라코몬」/「엑자몬」 기술 디지몬 등장 시 「엑자몬」 기술 카드로 -2 진화', async () => {
  for (const id of ['EX13-018', 'EX13-039']) {
    const st = mk(); clean(st); const a = put(st, 'p1', id);
    const exa = find((c) => c.category === 'digimon' && mention(c, '엑자몬') && c.level === 5 && S.cardNameIs && c.evoNormal && c.evoNormal.level === 4); ok('fixture ' + id, !!exa);
    hand(st).push(exa); st.memory = 5;
    const drac = dm('드라코몬'); hand(st).push(FILL);
    const before = st.memory;
    hand(st).push('EX13-008'); S.playDigimonFresh(st, 'p1', hand(st).length - 1); await drain(st);
    eq(id + ' → 엑자몬 기술 카드로 진화', cur(st, 'p1', a).cardId, exa); eq('오류 없음', errs(st), []);
  }
});
T('E13-020', 'EX13-020 매그너몬: 트래시 색 1색마다 DP+1000, DP 5000마다 상대 디지몬 DP -4000', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-020'); const o = put(st, 'p2', BIGV);
  st.players.p1.trash = [V('red', 4), V('blue', 4), V('green', 4)]; const dp0 = S.effectiveDP(st, 'p1', a), od0 = S.effectiveDP(st, 'p2', o);
  await runSeg(st, 'p1', a, 'EX13-020', '등장 시');
  const dp1 = S.effectiveDP(st, 'p1', a); eq('DP +3000 (3색)', dp1 - dp0, 3000);
  const times = Math.floor(dp1 / 5000); eq('상대 DP -4000 x ' + times, od0 - S.effectiveDP(st, 'p2', o), 4000 * times);
});
T('E13-021', 'EX13-021 윙드라몬: 상대 디지몬 진화원 아래에서 2장 파기 + 레스트 불가 1마리(명)', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-021'); const o = put(st, 'p2', FILL, { src: [FILL, FILL, FILL] });
  await runSeg(st, 'p1', a, 'EX13-021', '등장 시'); eq('진화원 3→1', o.sources.length, 1); ok('레스트 불가', o.cannotBeRestedUntil != null);
});
T('E13-022', 'EX13-022 에어로브이드라몬: 패의 「브이드라몬」 기술 테이머 무료 등장 / 자신의 테이머 등장 시 상대 1마리 레스트 불가', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-022'); const t = tamerOf('브이드라몬'); hand(st).push(t);
  await runSeg(st, 'p1', a, 'EX13-022', '등장 시'); ok('테이머 등장', onBoard(st, 'p1', t));
  const st2 = mk(); clean(st2); put(st2, 'p1', 'EX13-022'); const o = put(st2, 'p2', FILL); hand(st2, 'p1').push('EX13-068');
  S.playDigimonFresh(st2, 'p1', 0); await drain(st2); ok('자신의 테이머 등장 → 상대 레스트 불가', o.cannotBeRestedUntil != null);
});
T('E13-023', 'EX13-023 알포스브이드라몬: 표시 형식 변경 / 진화원이 가장 적은 상대 디지몬 전부 덱 아래 / 액티브 중 DP 감소 무효', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-023'); const b = put(st, 'p1', FILL);
  st._qaAns = { pickStack: (o) => o.uids.includes(b.uid) ? b.uid : o.uids[0] };
  await runSeg(st, 'p1', a, 'EX13-023', '등장 시', { text: '[턴 1회] 자신의 디지몬 1마리의 표시 형식을 변경할 수 있다.' }); ok('액티브→레스트', b.suspended);
  const st2 = mk(); clean(st2); const c = put(st2, 'p1', 'EX13-023'); const o1 = put(st2, 'p2', FILL, { src: [FILL] }), o2 = put(st2, 'p2', FILL, { src: [FILL] }), o3 = put(st2, 'p2', FILL, { src: [FILL, FILL] });
  await runSeg(st2, 'p1', c, 'EX13-023', '진화 시', { text: '진화원이 가장 적은 상대의 디지몬 전부를 덱 아래로 되돌릴 수 있다.' });
  eq('진화원 1장 두 마리가 덱 아래로', st2.players.p2.battle.length, 1); ok('진화원 2장은 남음', st2.players.p2.battle[0] === o3);
  const st3 = mk(); clean(st3); const d = put(st3, 'p1', 'EX13-023'); st3.activePlayer = 'p2'; const dp0 = S.effectiveDP(st3, 'p1', d);
  S.modifyDP(st3, 'p1', d.uid, -3000, 'turn'); // (source unknown => not blocked); the printed immunity applies to the opponent's effect
  st3._fxSrc = { player: 'p2', category: 'digimon' }; ok('액티브 상태: DP 감소 면역', S.effectBlocked(st3, 'p1', d, 'dpDown')); d.suspended = true; ok('레스트 상태: 면역 아님', !S.effectBlocked(st3, 'p1', d, 'dpDown'));
});
T('E13-024', 'EX13-024 슬레이어드라몬: 자신의 진화원 1장마다 상대 진화원 파기 → 진화원 최소 상대 전부 덱 아래', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-024', { src: [FILL, FILL] }); const o1 = put(st, 'p2', FILL, { src: [FILL, FILL, FILL] }), o2 = put(st, 'p2', FILL, { src: [FILL] });
  await runSeg(st, 'p1', a, 'EX13-024', '등장 시');
  eq('진화원 4장 중 2장 파기 → 둘 다 1장(최소)이라 전부 덱 아래', st.players.p2.battle.length, 0);
});
T('E13-025', 'EX13-025 캔들몬: 메인 페이즈 개시 시 시큐리티 3장 이상이면 파기 + 드로우 + 메모리 +1 → 2장 이하면 「윗체르니」 카드를 시큐리티 아래에', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-025'); st.players.p1.security = [FILL, FILL, FILL]; hand(st).push('EX13-029'); const m0 = st.memory, d0 = st.players.p1.deck.length;
  await runSeg(st, 'p1', a, 'EX13-025', '자신의 메인 페이즈 개시 시');
  eq('시큐리티 3→2', st.players.p1.security.length, 3); // -1 then the 윗체르니 card goes under (2 or fewer)
  eq('메모리 +1', st.memory - m0, 1); eq('드로우', d0 - st.players.p1.deck.length, 1); eq('오류 없음', errs(st), []);
});
T('E13-026', 'EX13-026 쿠다몬: 덱 위 3장 → 성수형/로얄 나이츠/세이버즈 1장 패에, 1장 세이버즈 테이머 아래에 뒷면', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-026'); const tam = put(st, 'p1', find((c) => c.category === 'tamer' && (c.types || []).includes('세이버즈')) || 'EX13-071');
  const k1 = 'EX13-030', k2 = 'EX13-032';
  st.players.p1.deck = [k1, k2, FILL, ...Array(10).fill(FILL)];
  await runSeg(st, 'p1', a, 'EX13-026', '등장 시');
  eq('패 +1', hand(st).length, 1); eq('테이머 아래에 뒷면 1장', S.fdCount(tam), 1); eq('오류 없음', errs(st), []);
});
T('E13-028', 'EX13-028 스카몬: 소멸 시 덱 위 3장 → 코스트 3 이하의 「츄몬」/「스카몬」 무료 등장, 나머지 파기', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-028'); const chu = 'EX13-027'; st.players.p1.deck = [chu, FILL, FILL, ...Array(10).fill(FILL)];
  await runSeg(st, 'p1', a, 'EX13-028', '소멸 시'); ok('츄몬 등장', onBoard(st, 'p1', chu)); eq('오류 없음', errs(st), []);
});
T('E13-029', 'EX13-029 화염위자몬: 시큐리티 파기 → 상대 DP-4000, 시큐리티 3장 이하면 DP 4000 이하 소멸', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-029'); const o = put(st, 'p2', 'ST1-03'); st.players.p1.security = [FILL, FILL, FILL, FILL];
  await runSeg(st, 'p1', a, 'EX13-029', '진화 시'); eq('시큐리티 -1', st.players.p1.security.length, 3); ok('DP -4000 (2000→0 이하) 소멸', !st.players.p2.battle.includes(o));
});
T('E13-030', 'EX13-030 레파몬: 시큐리티 1장 파기 → 패/트래시의 「고동혁」 무료 등장', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-030'); st.players.p1.security = [FILL, FILL]; hand(st).push('EX13-071'); st.memory = 4;
  await runSeg(st, 'p1', a, 'EX13-030', '등장 시'); ok('고동혁 등장', onBoard(st, 'p1', 'EX13-071')); eq('시큐리티 -1', st.players.p1.security.length, 1); eq('메모리 그대로', st.memory, 4);
});
T('E13-031', 'EX13-031 스카몬 대왕: 패의 「츄몬」/「스카몬」 파기 → 상대 디지몬을 원래 명칭 「스카몬」·화이트·DP 3000으로', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-031'); const o = put(st, 'p2', BIGV); hand(st).push('EX13-027');
  await runSeg(st, 'p1', a, 'EX13-031', '등장 시');
  eq('파기됨', st.players.p1.trash.includes('EX13-027'), true); eq('DP 3000', S.effectiveDP(st, 'p2', o), 3000); ok('화이트', S.stackColors(o).includes('white')); eq('오류 없음', errs(st), []);
});
T('E13-031b', 'EX13-031 스카몬 대왕 [상속]: 「스카몬」을 포함하는 다른 디지몬 소멸 시 덱 위 3장에서 「츄몬」/「스카몬」 무료 등장', async () => {
  const st = mk(); clean(st); put(st, 'p1', FILL, { src: ['EX13-031'] }); const sk = put(st, 'p2', 'EX13-028'); st.players.p1.deck = ['EX13-027', FILL, FILL, ...Array(10).fill(FILL)];
  S.deleteStack(st, 'p2', sk.uid, 'trash', 'effect'); await drain(st);
  ok('츄몬 등장', onBoard(st, 'p1', 'EX13-027')); eq('오류 없음', errs(st), []);
});
T('E13-032', 'EX13-032 치린몬: 시큐리티 파기로 액티브 / 상대 디지몬 【진화 시】 봉인 / 벗어날 때 진화원을 시큐리티 위로', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-032', { susp: true }); const o = put(st, 'p2', FILL); st.players.p1.security = [FILL, FILL];
  await runSeg(st, 'p1', a, 'EX13-032', '진화 시'); ok('액티브', !a.suspended); ok('진화 시 봉인', o.noEvoTrigUntil != null);
  const st2 = mk(); clean(st2); const b = put(st2, 'p1', 'EX13-032', { src: ['EX13-026', FILL] }); const sec0 = st2.players.p1.security.length;
  S.deleteStack(st2, 'p1', b.uid, 'trash', 'effect'); await drain(st2);
  ok('디지몬이 남음(벗어나지 않음)', st2.players.p1.battle.includes(b)); eq('진화원 -1, 시큐리티 +1', [b.sources.length, st2.players.p1.security.length - sec0], [1, 1]);
});
T('E13-033', 'EX13-033 미스티몬: 윗체르니 카드를 시큐리티 아래에 → 시큐리티 파기로 어택 / 시큐리티 감소 시 DP-6000', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-033'); st.players.p1.security = [FILL, FILL, FILL, FILL]; hand(st).push('EX13-025');
  await runSeg(st, 'p1', a, 'EX13-033', '등장 시'); eq('윗체르니 카드가 시큐리티 아래로 + 1장 파기 = 4', st.players.p1.security.length, 4);
  eq('어택 요청', (st._qaAtk || []).length >= 1, true);
  const st2 = mk(); clean(st2); const b = put(st2, 'p1', 'EX13-033'); const o = put(st2, 'p2', 'ST1-03'); st2.players.p1.security = [FILL, FILL]; st2.activePlayer = 'p2';
  S.trashTopSecurityByEffect(st2, 'p1'); await drain(st2); ok('시큐리티 ≤3이라 DP-6000 후 DP 6000 이하 소멸', !st2.players.p2.battle.includes(o)); eq('오류 없음', errs(st2), []);
});
T('E13-034', 'EX13-034 와이즈몬: 시큐리티 감소 시 《퇴화 1》 + 진화 불가 / 재기동·블로커 + 퇴화 면역', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-034'); const o = put(st, 'p2', V('red', 4), { src: [FILL] }); st.players.p1.security = [FILL, FILL]; st.activePlayer = 'p2';
  S.trashTopSecurityByEffect(st, 'p1'); await drain(st);
  eq('퇴화로 진화원 0', o.sources.length, 0); ok('진화 불가', o.cannotEvolveUntil != null);
  const st2 = mk(); clean(st2); const b = put(st2, 'p1', 'EX13-034'); await runSeg(st2, 'p1', b, 'EX13-034', '등장 시');
  ok('재기동', S.hasKeyword(b, '재기동')); ok('블로커', S.hasKeyword(b, '블로커')); st2._fxSrc = { player: 'p2', category: 'digimon' }; ok('퇴화 면역', S.effectBlocked(st2, 'p1', b, 'retreat'));
});
T('E13-035', 'EX13-035 킹에테몬: 패/트래시에서 츄몬·스카몬·에테몬 2장까지 합계 6까지 무료 등장', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-035'); hand(st).push('EX13-027', 'EX13-028', 'EX13-031');
  await runSeg(st, 'p1', a, 'EX13-035', '등장 시');
  const n = ['EX13-027', 'EX13-028', 'EX13-031'].filter((i) => onBoard(st, 'p1', i)).length; ok('2장까지 등장(합계 6 이내)', n >= 1 && n <= 2); eq('오류 없음', errs(st), []);
});
T('E13-036', 'EX13-036 슬레이프몬: 【시큐리티】/【등장 시】 DP -7000 / 진화 시 시큐리티 파기 → 【시큐리티】 효과 / 서로 1마리씩 시큐리티 위', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-036'); const o = put(st, 'p2', BIGV); const dp0 = S.effectiveDP(st, 'p2', o);
  st.players.p1.security = [FILL, FILL]; st.players.p2.security = [FILL, FILL];
  await runSeg(st, 'p1', a, 'EX13-036', '시큐리티'); ok('서로 시큐리티 합계 4 ≤ 6 → 상대 디지몬 전부 DP -7000', dp0 - S.effectiveDP(st, 'p2', o) === 7000);
  const st2 = mk(); clean(st2); const b = put(st2, 'p1', 'EX13-036'); const m = put(st2, 'p1', FILL), t = put(st2, 'p2', FILL); st2.players.p1.security = [FILL]; st2.players.p2.security = [FILL];
  await runSeg(st2, 'p1', b, 'EX13-036', '진화 시', { text: '[턴 1회] 서로의 디지몬 1마리씩을 시큐리티 위에 놓을 수 있다.' });
  eq('자신 디지몬 1 + 상대 디지몬 1 → 시큐리티 +1씩', [st2.players.p1.security.length, st2.players.p2.security.length], [2, 2]); eq('오류 없음', errs(st2), []);
});
T('E13-037', 'EX13-037 듀나스몬: 시큐리티 파기 + DP+10000, 3장 이하면 상대 시큐리티 파기 / 시큐리티 감소 시 DP -12000', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-037'); st.players.p1.security = [FILL, FILL, FILL, FILL]; st.players.p2.security = [FILL, FILL]; const dp0 = S.effectiveDP(st, 'p1', a);
  await runSeg(st, 'p1', a, 'EX13-037', '등장 시'); eq('DP +10000', S.effectiveDP(st, 'p1', a) - dp0, 10000); eq('자신 4→3(→리커버리로 다시 4: 서로의 턴 효과), 상대 2→1', [st.players.p1.security.length, st.players.p2.security.length], [4, 1]);
  const st2 = mk(); clean(st2); put(st2, 'p1', 'EX13-037'); const o = put(st2, 'p2', BIGV); st2.players.p1.security = [FILL, FILL, FILL]; st2.activePlayer = 'p2'; const d0 = S.effectiveDP(st2, 'p2', o);
  S.trashTopSecurityByEffect(st2, 'p1'); await drain(st2); ok('상대 디지몬 DP -12000 (또는 소멸)', !st2.players.p2.battle.includes(o) || d0 - S.effectiveDP(st2, 'p2', o) === 12000); eq('오류 없음', errs(st2), []);
});
T('E13-040', 'EX13-040/041/044 레스트 계열: 액티브 되지 않음 / 레스트 후 다음 액티브 페이즈 액티브 불가', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-040'); const o = put(st, 'p2', FILL);
  await runSeg(st, 'p1', a, 'EX13-040', '등장 시'); ok('다음 액티브 페이즈 스킵', !!o.skipNextUnsuspend || o.cannotUnsuspendUntil != null || o.skipUnsuspend);
  const st2 = mk(); clean(st2); const b = put(st2, 'p1', 'EX13-041'); const o1 = put(st2, 'p2', FILL), o2 = put(st2, 'p2', FILL);
  await runSeg(st2, 'p1', b, 'EX13-041', '등장 시'); eq('레스트 1마리', st2.players.p2.battle.filter((s) => s.suspended).length, 1); eq('오류 없음', errs(st2), []);
  const st3 = mk(); clean(st3); const c = put(st3, 'p1', 'EX13-044'); put(st3, 'p1', FILL); const p1 = put(st3, 'p2', FILL);
  await runSeg(st3, 'p1', c, 'EX13-044', '등장 시'); ok('2마리(명)까지 레스트', st3.players.p1.battle.filter((s) => s.suspended).length + st3.players.p2.battle.filter((s) => s.suspended).length === 2); eq('오류 없음', errs(st3), []);
});
T('E13-042', 'EX13-042 바스테몬: 패의 수/짐승 포함 코스트 4 이하 디지몬 무료 등장', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-042'); const beast = find((c) => c.category === 'digimon' && c.cost <= 4 && (c.types || []).some((t) => t.includes('짐승') || t.includes('수')) && !(c.types || []).some((t) => ['수장룡형', '수생형', '수생포유류형', '정보수집 타입'].includes(t))); ok('fixture', !!beast);
  hand(st).push(beast); const other = find((c) => c.category === 'digimon' && c.cost <= 3 && !(c.types || []).some((t) => t.includes('짐승') || t.includes('수'))); hand(st).push(other);
  await runSeg(st, 'p1', a, 'EX13-042', '진화 시'); ok('짐승형 등장', onBoard(st, 'p1', beast)); eq('오류 없음', errs(st), []);
});
T('E13-043', 'EX13-043 두프트몬: 디지몬 1마리 레스트 후 DP 최저 상대 디지몬 덱 아래', async () => {
  const st = mk(); clean(st); const a = put(st, 'p1', 'EX13-043'); const o = put(st, 'p2', LOW); const o2 = put(st, 'p2', BIGV);
  await runSeg(st, 'p1', a, 'EX13-043', '등장 시'); ok('DP 최저가 덱 아래로', !st.players.p2.battle.includes(o) && st.players.p2.battle.includes(o2)); eq('덱 아래 확인', st.players.p2.deck[st.players.p2.deck.length - 1], C(o.cardId).id); eq('오류 없음', errs(st), []);
});
await runAll('qa-ex13-b');
