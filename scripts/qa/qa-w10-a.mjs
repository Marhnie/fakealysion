// Wave-10 recheck (Q&A idx 6003-6672) regression scenarios. Run: node scripts/qa/qa-w10-a.mjs < /dev/null
import { S, mk, put, drain, T, eq, ok, runAll, C, FILL, LOW, V, find, findAll, errs, clean, runSeg, setTop, dp, useOption } from './lib-ex13.mjs';
import { BIG } from './lib-s1.mjs';

// idx6474: EX13-026's second "1장" (face-down under the 세이버즈 tamer) must ALSO be a specified card (성수형/로얄 나이츠/세이버즈)
T('w10-6474', 'EX13-026 쿠다몬: 테이머 아래에 뒷면으로 놓는 카드도 지정된 카드여야 함 (지정 카드 1장뿐이면 패에만 추가)', async () => {
  const sab = find((c) => c.category === 'digimon' && (c.types || []).includes('세이버즈') && !c.id.startsWith('EX13-'));
  const plain = FILL; ok('필러는 지정 특징이 아님', !(C(plain).types || []).some((x) => ['성수형', '로얄 나이츠', '세이버즈'].includes(x)));
  const tam = find((c) => c.category === 'tamer' && (c.types || []).includes('세이버즈'));
  { // one specified card + two others: added to hand, NOTHING goes under the tamer
    const st = mk(); clean(st); const k = put(st, 'p1', 'EX13-026'); const t = put(st, 'p1', tam); setTop(st, 'p1', [sab, plain, plain]);
    await runSeg(st, 'p1', k, 'EX13-026', '등장 시');
    eq('패에 추가', st.players.p1.hand, [sab]); eq('테이머 아래 카드 없음', t.sources.length, 0); eq('오류 없음', errs(st), []);
  }
  { // two specified cards: one to hand, the other under the tamer
    const st = mk(); clean(st); const k = put(st, 'p1', 'EX13-026'); const t = put(st, 'p1', tam); setTop(st, 'p1', [sab, sab, plain]);
    await runSeg(st, 'p1', k, 'EX13-026', '등장 시');
    eq('패 1장', st.players.p1.hand.length, 1); eq('테이머 아래 1장', t.sources.length, 1);
  }
});

// idx6062/6187: "겹쳐진 카드는 파기되지 않는다" also stops 《퇴화》 (the digimon itself may still be deleted)
T('w10-6062', 'EX12-059 파워드라몬ACE: 자신의 디지몬 전부에 겹쳐진 카드는 상대의 효과로 파기되지 않는다 (《퇴화》 무효)', async () => {
  const st = mk(); clean(st); const s = put(st, 'p1', 'EX12-059', { src: [V('black', 4)] }); put(st, 'p2', BIG, { src: [V('red', 3)] });
  const other = put(st, 'p1', FILL, { src: [V('red', 3)] }); st.players.p1.hand = ['ST1-09']; st.players.p1.trash = ['ST1-09']; // 메탈그레이몬 (사이보그형)
  await runSeg(st, 'p1', s, 'EX12-059', '등장 시');
  st._fxSrc = { player: 'p2', category: 'digimon' };
  eq('다른 디지몬 퇴화 무효', S.retreat(st, 'p1', other.uid, 1).length, 0);
  eq('자신도 퇴화 무효', S.retreat(st, 'p1', s.uid, 1).length, 0);
  eq('진화원 파기 무효', S.trashEvoSources(st, 'p1', other.uid, 1).length, 0);
  S.deleteStack(st, 'p1', other.uid, 'trash', 'effect'); ok('디지몬 자체는 소멸 가능', !st.players.p1.battle.includes(other));
});
T('w10-6187', 'BT26-029 아이기오투스몬:홀리: 겹쳐진 카드가 파기되지 않는다 (《퇴화》 무효, 디지몬 자체는 되돌릴 수 있음)', async () => {
  const st = mk(); clean(st); const s = put(st, 'p1', 'BT26-029', { src: [V('yellow', 4)] }); st.players.p1.security = [LOW, LOW];
  await runSeg(st, 'p1', s, 'BT26-029', '등장 시');
  st._fxSrc = { player: 'p2', category: 'digimon' };
  eq('퇴화 무효', S.retreat(st, 'p1', s.uid, 1).length, 0); eq('진화원 유지', s.sources.length, 1);
  eq('진화원 파기 무효', S.trashEvoSources(st, 'p1', s.uid, 1).length, 0);
});
// idx6450: EX13-020 「트래시의 카드의 색 1색마다」 counts BOTH players' trash
T('w10-6450', 'EX13-020 매그너몬: 트래시의 색 1색마다 DP+1000 — 서로의 트래시를 참조', async () => {
  const st = mk(); clean(st); const m = put(st, 'p1', 'EX13-020'); st.players.p1.trash = []; st.players.p2.trash = [V('red', 3), V('green', 3)];
  const d0 = dp(st, 'p1', m);
  await runSeg(st, 'p1', m, 'EX13-020', '등장 시');
  eq('상대 트래시 2색 → +2000', dp(st, 'p1', m) - d0, 2000);
});

// idx6400: 「Lv.이 서로 다른」 assembly can't use a Lv.-less card (BT26-085 itself is Lv.0/none)
T('w10-6400', 'BT26-085 거신병기: 어셈블리에 Lv.를 가지지 않는 「거신병기」 자신은 사용할 수 없음', async () => {
  const by = (lv) => find((c) => c.category === 'digimon' && (c.types || []).includes('신인형') && c.level === lv);
  const st = mk(); st.players.p1.hand = ['BT26-085'];
  st.players.p1.trash = [by(4), by(5), by(6), by(7), 'BT26-085'];
  eq('Lv.- 카드는 5번째 재료가 될 수 없음', S.planAssembly(st, 'p1', 0), null);
});

// idx6637: EX13-071 discards the 3 face-down cards FIRST; those discarded cards may also be placed under 「쿠다몬」
T('w10-6637', 'EX13-071 사츠마 렌타로: 테이머 아래에서 파기한 카드도 「쿠다몬」의 진화원 아래에 놓을 수 있음', async () => {
  const yb = (lv) => findAll((c) => c.category === 'digimon' && c.level === lv && (c.colors || []).includes('yellow') && (c.types || []).includes('성수형'));
  const l4 = yb(4), l5 = yb(5); ok('후보 Lv.5 2종 이상', l5.length >= 2);
  const st = mk(); clean(st); const tam = put(st, 'p1', 'EX13-071', { src: [FILL, FILL, l5[1]] }); tam.s5fd = 3; const kuda = put(st, 'p1', 'EX13-026');
  st.players.p1.hand = ['EX13-036']; st.players.p1.trash = [l4[0], l5[0]]; st.memory = 10;
  st._qaAns = { confirmEffect: () => true, pickStack: (q) => q.uids[0], pickFromZoneIndex: (q) => { const tr = st.players.p1.trash; const want = q.eligibleIdxs.find((i) => tr[i] === l5[1]); return want != null ? want : q.eligibleIdxs[0]; } };
  await runSeg(st, 'p1', tam, 'EX13-071', '메인');
  eq('오류 없음', errs(st), []);
  ok('선택한(테이머 아래에서 파기된) Lv.5 카드가 쿠다몬 진화원에 있음', kuda.sources.includes(l5[1]));
});
// P-241 김영웅 (idx6130): 【자신의 턴】 자신의 디지몬이 링크했을 때 — 테이머를 레스트해야 「또한」 이후를 처리, 어플몬 디지몬 《볼텍스》+DP+3000
T('w10-6130', 'P-241 김영웅: 링크했을 때 → 테이머 레스트, 어플몬 《볼텍스》·DP+3000', async () => {
  const st = mk(); clean(st); const t = put(st, 'p1', 'P-241'); const d = put(st, 'p1', 'BT26-010');
  const lk = find((c) => c.category === 'digimon' && (c.types || []).includes('세븐 코드') && c.id !== 'BT26-010');
  st._qaAns = { confirmEffect: () => true, pickStack: (q) => q.uids[0], pickFromRevealed: () => [] };
  S.linkCardTo(st, 'p1', d.uid, lk, lk, 0, 'x', null); const d0 = dp(st, 'p1', d); await drain(st);
  ok('테이머 레스트', t.suspended); eq('DP +3000', dp(st, 'p1', d) - d0, 3000); ok('《볼텍스》', !!d.keywords['볼텍스']); eq('오류 없음', errs(st), []);
  { // already rested tamer: nothing happens
    const st2 = mk(); clean(st2); const t2 = put(st2, 'p1', 'P-241', { susp: true }); const d2 = put(st2, 'p1', 'BT26-010');
    st2._qaAns = { confirmEffect: () => true, pickStack: (q) => q.uids[0], pickFromRevealed: () => [] };
    S.linkCardTo(st2, 'p1', d2.uid, lk, lk, 0, 'x', null); const e0 = dp(st2, 'p1', d2); await drain(st2);
    eq('레스트 상태면 효과 없음', dp(st2, 'p1', d2), e0);
  }
});
// P-242 권레이 (idx6131): 【메인】 이 테이머를 레스트 → 트래시의 시스템/라이프/변화 디지몬 카드를 링크(코스트 -1)
T('w10-6131', 'P-242 권레이: 【메인】 테이머 레스트 후 트래시에서 링크 (코스트 -1)', async () => {
  const lk = find((c) => c.category === 'digimon' && (c.types || []).includes('시스템') && (c.types || []).includes('어플몬'));
  const st = mk(); clean(st); const t = put(st, 'p1', 'P-242'); const d = put(st, 'p1', 'BT26-010'); st.players.p1.trash = [lk]; st.memory = 5;
  st._qaAns = { confirmEffect: () => true, pickStack: (q) => q.uids[0], pickFromRevealed: () => [0] };
  await runSeg(st, 'p1', t, 'P-242', '메인');
  ok('테이머 레스트', t.suspended); eq('링크 1장', (d.linkCards || []).length, 1); eq('오류 없음', errs(st), []);
});
// P-239 피코데블몬: 【소멸 시】 트래시의 이 카드를 「묘티스몬」 기술 디지몬의 진화원 아래에 놓고 패의 「묘티스몬」으로 코스트 없이 진화
T('w10-p239', 'P-239 피코데블몬: 【소멸 시】 트래시의 이 카드를 진화원 아래에 놓고 패의 「묘티스몬」으로 진화', async () => {
  const myo = findAll((c) => c.category === 'digimon' && c.nameKo.includes('묘티스몬'));
  const host0 = myo.find((i) => C(i).level === 5), evoTo = myo.find((i) => C(i).level === 6);
  const st = mk(); clean(st); const host = put(st, 'p1', host0); st.players.p1.trash = ['P-239']; st.players.p1.hand = [evoTo]; st.memory = 0;
  st._qaAns = { confirmEffect: () => true, pickStack: (q) => q.uids[0] };
  await runSeg(st, 'p1', host, 'P-239', '소멸 시');
  eq('오류 없음', errs(st), []); ok('진화함', C(host.cardId).nameKo.includes('묘티스몬') && host.cardId === evoTo); ok('이 카드가 진화원 아래에 있음', host.sources.includes('P-239')); eq('트래시에서 이동', st.players.p1.trash.includes('P-239'), false); eq('코스트 미지불', st.memory, 0);
  { // no 「묘티스몬」 host / no hand card: nothing moves
    const st2 = mk(); clean(st2); const h2 = put(st2, 'p1', FILL); st2.players.p1.trash = ['P-239']; st2.players.p1.hand = [evoTo];
    await runSeg(st2, 'p1', h2, 'P-239', '소멸 시'); ok('호스트 없으면 그대로', st2.players.p1.trash.includes('P-239'));
  }
});
// idx6137: BT24-102 호메로스 【자신의 턴 종료 시】 — 《계승》으로 얻고 있는 【등장 시】/【진화 시】 효과도 발휘 대상
T('w10-6137', 'BT24-102 호메로스: 《계승》으로 얻은 【등장 시】/【진화 시】 효과도 선택지에 포함', async () => {
  const st = mk(); clean(st); const h = put(st, 'p1', 'BT24-102'); put(st, 'p1', 'BT26-032', { src: ['BT25-059'] }); put(st, 'p2', BIG);
  let opts = null;
  st._qaAns = { confirmEffect: () => true, pickStack: (q) => q.uids.find((u) => st.players.p1.battle.find((s) => s.uid === u && s.cardId === 'BT26-032')) || q.uids[0], multipleChoice: (q) => { opts = q.options; return 0; } };
  await runSeg(st, 'p1', h, 'BT24-102', '자신의 턴 종료 시');
  ok('호메로스가 레스트됨', h.suspended); ok('선택지 2개(자신의 【진화 시】 + 계승한 【등장 시】【진화 시】)', Array.isArray(opts) && opts.length === 2);
});
// idx6505/6506: EX13-035 킹에테몬 — 10장(9장 불가)을 먼저 덱 아래로 되돌려 등장 코스트 상한 +6, 2장까지·코스트 합계 6까지
T('w10-6505', 'EX13-035 킹에테몬: 코스트 합계 상한 6(+6은 트래시 10장을 되돌렸을 때만, 먼저 처리)', async () => {
  const run = async (trashN, hand) => {
    const st = mk(); clean(st); const k = put(st, 'p1', 'EX13-035'); st.players.p1.hand = hand.slice(); st.players.p1.trash = Array(trashN).fill('EX13-028');
    st._qaAns = { confirmEffect: () => true, pickFromZoneIndex: (q) => q.eligibleIdxs[0], pickFromRevealed: (q) => q.eligible?.slice(0, 1).map((x) => x.i) || [] };
    await runSeg(st, 'p1', k, 'EX13-035', '등장 시'); eq('오류 없음', errs(st), []); return st;
  };
  { const st = await run(9, ['BT3-074']); ok('트래시 9장뿐이면 비용을 지불할 수 없어 상한 6 → 코스트 12 카드는 등장 불가', !st.players.p1.battle.some((s) => s.cardId === 'BT3-074')); eq('9장은 덱 아래로 되돌리지 않음', st.players.p1.deck.length, 20); }
  { const st = await run(10, ['BT3-074']); ok('10장 되돌리면 상한 12 → 등장', st.players.p1.battle.some((s) => s.cardId === 'BT3-074')); eq('트래시 10장 → 덱 아래', st.players.p1.deck.length, 30); }
  { const st = await run(0, ['BT3-063', 'BT3-063', 'BT3-063']); eq('코스트 3×3 중 합계 6까지(2장)', st.players.p1.battle.filter((s) => s.cardId === 'BT3-063').length, 2); }
});
// idx6302: BT26-079 [트래시]【메인】 — 패 5장 이하일 때 이 카드를 코스트 -4로 등장, 그 등장으로 《어셈블리》도 선언 가능 (코스트 12-4-2)
T('w10-6302', 'BT26-079 좀비플루토몬: [트래시]【메인】 코스트 -4 등장 + 어셈블리(-2)', async () => {
  const plu = find((c) => c.nameKo === '플루토몬');
  const seg = S.parseEffectSegments(C('BT26-079').effectKo).segments.find((s) => s.zoneMarker && s.tags.includes('메인'));
  const run = async (handN) => {
    const st = mk(); clean(st); st.memory = 10; st.players.p1.hand = Array(handN).fill(FILL); st.players.p1.trash = ['BT26-079', plu];
    st.pending.push({ uid: 'zm1', player: 'p1', cardId: 'BT26-079', stackUid: null, tags: seg.tags, text: seg.body, resolved: false, zoneMain: 'trash', zoneIdx: 0 });
    st._qaAns = { confirmEffect: () => true, pickFromZoneIndex: (q) => q.eligibleIdxs[0], pickFromRevealed: (q) => q.eligible?.slice(0, 3).map((x) => x.i) || [] };
    await drain(st); eq('오류 없음', errs(st), []); return st;
  };
  { const st = await run(1); ok('등장함', st.players.p1.battle.some((s) => s.cardId === 'BT26-079')); eq('코스트 6 지불(12-4-2)', st.memory, 4); ok('어셈블리로 플루토몬이 아래에', st.players.p1.battle[0].sources.includes(plu)); }
  { const st = await run(6); ok('패 6장이면 등장하지 않음', !st.players.p1.battle.some((s) => s.cardId === 'BT26-079')); eq('메모리 그대로', st.memory, 10); }
});
// idx6364: BT26-097 뇌정의 각성 「さらに」 — 진화한 카드와 다른 자신의 「유피테르몬」의 진화원 위에도 「아이기오투스몬」 카드를 놓을 수 있다
T('w10-6364', 'BT26-097 뇌정의 각성: 진화한 유피테르몬과 다른 「유피테르몬」도 고를 수 있음', async () => {
  const st = mk(); clean(st); st.memory = 10;
  put(st, 'p1', 'P-194'); const other = put(st, 'p1', 'BT24-101'); put(st, 'p1', 'P-199');
  st.players.p1.hand = ['BT26-033']; st.players.p1.trash = ['BT26-029']; st.players.p1.security = [LOW, LOW];
  st._qaAns = { confirmEffect: () => true, pickStack: (q) => q.uids[q.uids.length - 1], pickFromZoneIndex: (q) => q.eligibleIdxs[0], pickFromRevealed: (q) => q.eligible?.slice(0, 1).map((x) => x.i) || [] };
  await useOption(st, 'p1', 'BT26-097');
  eq('오류 없음', errs(st), []); ok('다른 유피테르몬의 진화원 위에 놓임', other.sources.includes('BT26-029'));
});
await runAll('qa-w10-a');
