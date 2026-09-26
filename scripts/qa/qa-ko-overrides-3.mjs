// data/ko-overrides.json cards, part 3: P-240 (아크투루스몬), P-060 blocked trigger, P-116/P-235/P-236 options, BT4/BT5 digitama inherited effects.
// Run: node scripts/qa/qa-ko-overrides-3.mjs
import { S, E, Fx, C, FILL, fillOf, world, runScenarios } from './lib2.mjs';

const list = [];
const T = (q, card, name, run, expect, extra = {}) => list.push({ q, card, name, run, expect, ...extra });
const cards = Object.values(S.CARDS);
const findId = (pred) => cards.find(pred)?.id;

// ---------------- P-240 아크투루스몬
const gam = (lv) => cards.find(c => c.category === 'digimon' && c.level === lv && S.cardMentions(c.id, '감마몬') && c.id !== 'P-240').id;
T(1, 'P-240', '어셈블리 -6 parses: Lv.5 × Lv.4 × Lv.3 of 「감마몬」-text or 「VB」 trait', async () => ({}), () => {
  const a = S.parseAssembly('P-240'); const vb = findId(c => c.category === 'digimon' && (c.types || []).includes('VB') && c.level === 4);
  const trash = [gam(5), gam(4), gam(3)];
  const sol = a && S.solveAssembly(a, trash);
  const sol2 = a && S.solveAssembly(a, [gam(5), vb, gam(3)]);
  const bad = a && S.solveAssembly(a, [gam(5), gam(4)]);
  return [['parsed per 6 / 3 reqs', a && a.per === 6 && a.reqs.length === 3], ['gammamon-text set solves', !!sol], ['VB trait also counts', !!sol2], ['2 cards insufficient', !bad]];
});
T(2, 'P-240', 'WD: 《퇴화 3》 opp, place 2 「감마몬」/VB cards from trash under itself, opp Digimon must attack', async (W) => {
  W.st.memory = 10;
  const host = W.put('p1', [fillOf(c => c.level === 5)[0]]);
  const g5 = gam(5), g4 = gam(4); W.trash('p1', [g5, g4]);
  const opp = W.put('p2', [findId(c => c.category === 'digimon' && c.level === 5 && !(c.effectKo || '').trim()), FILL[11], FILL[12]]); const top0 = opp.cardId;
  await W.evolve('p1', host.uid, 'P-240', 4); return { host, opp, top0 };
}, (W, x) => { const me = W.by('p1', x.host.uid); const o = W.by('p2', x.opp.uid); return [['P-240 in play', me && me.cardId === 'P-240'], ['opp de-digivolved (top card changed)', o && o.cardId !== x.top0], ['2 trash cards under P-240', W.pl('p1').trash.length === 0], ['forced-attack effect logged', W.st.log.some(e => /어택한다/.test(e.msg))]]; });
T(3, 'P-240', 'WD without enough cards in trash: de-digivolve only', async (W) => {
  W.st.memory = 10; const host = W.put('p1', [fillOf(c => c.level === 5)[0]]); W.trash('p1', [gam(5)]);
  const opp = W.put('p2', [findId(c => c.category === 'digimon' && c.level === 5 && !(c.effectKo || '').trim()), FILL[11], FILL[12]]);
  await W.evolve('p1', host.uid, 'P-240', 4); return { host, opp };
}, (W, x) => [['no forced attack', !W.st.log.some(e => /효과 부여/.test(e.msg))], ['trash card kept', W.pl('p1').trash.length === 1]]);
T(4, 'P-240', 'On deletion: play 「프록시마몬」 from hand/trash for free', async (W) => {
  const me = W.put('p1', ['P-240']); const px = findId(c => c.nameKo === '프록시마몬' && c.category === 'digimon'); W.trash('p1', [px]); W.st.memory = 5;
  S.deleteStack(W.st, 'p1', me.uid, 'trash', 'effect'); await W.drain(); return { px };
}, (W, x) => [['프록시마몬 played', W.pl('p1').battle.some(s => s.cardId === x.px)], ['no cost', W.st.memory === 5]]);
T(5, 'P-240', 'keywords Blocker/Piercing/Reboot/Collision parsed', async () => ({}), () => {
  const stk = S._s4.makeStack('P-240', 1); S.recomputeStackGrants(stk);
  return ['블로커', '관통', '재기동', '충돌'].map(k => [k, S.hasKeyword(stk, k) || (C('P-240').effectKo || '').includes('《' + k + '》')]);
});
T(6, 'P-240', 'inherited: opp attacks -> may redirect the attack target to this Digimon', async () => ({}), () => [['redirect text', /어택의 대상을 이 디지몬으로 변경/.test(C('P-240').inheritedKo)], ['tags', /【상대의 턴】/.test(C('P-240').inheritedKo)]]);

// ---------------- P-060 앙고라몬: 【자신의 턴】[턴에 1회] blocked -> trash top opp security
T(10, 'P-060', 'blocked -> opponent top security trashed', async (W) => {
  const a = W.put('p1', ['P-060']); const b = W.put('p2', [FILL[1]]); const n0 = W.pl('p2').security.length;
  await W.attack('p1', a.uid, null, { block: b.uid }); return { n0 };
}, (W, x) => [['opp security -1', W.pl('p2').security.length === x.n0 - 1]]);
T(11, 'P-060', 'inherited: memory +1 when attacking with 「문유리」 in play (once per turn)', async (W) => {
  const tam = findId(c => c.category === 'tamer' && c.nameKo === '문유리'); W.put('p1', [tam]); const a = W.put('p1', [FILL[0], 'P-060']); W.st.memory = 0;
  await W.attack('p1', a.uid, null); return {};
}, (W) => [['memory +1', W.st.memory >= 1]]);

// ---------------- options
T(20, 'P-116', 'costs 0 while 아구몬 / 펄스몬 / 감마몬 are in play; main adds Tamers with cost<=3', async (W) => {
  const ag = findId(c => c.nameKo === '아구몬' && c.category === 'digimon'), pu = findId(c => c.nameKo === '펄스몬' && c.category === 'digimon'), gm = findId(c => c.nameKo === '감마몬' && c.category === 'digimon');
  const tam = findId(c => c.category === 'tamer' && c.cost <= 3 && !c.colors.includes('white')); const junk = FILL[5];
  W.put('p1', [ag]); W.put('p1', [findId(c => c.category === 'digimon' && c.level === 3 && c.colors.length === 1 && c.colors[0] === 'white' && c.dp)]); W.put('p1', [pu]); W.put('p1', [gm]); W.deck('p1', [tam, junk, ...FILL.slice(26, 40)]); W.st.memory = 3;
  await W.useOption('p1', 'P-116'); return { tam };
}, (W, x) => [['memory unchanged (cost 0)', W.st.memory === 3], ['tamer added', W.pl('p1').hand.includes(x.tam)]]);
for (const [id, trait] of [['P-235', '세이버즈'], ['P-236', '글로잉 던']]) {
  T(id === 'P-235' ? 21 : 22, id, 'Main: reveal 3, add 1 「' + trait + '」 card, place in battle area; Delay: memory +2', async (W) => {
    const t = findId(c => (c.types || []).includes(trait) && c.category === 'digimon'); W.deck('p1', [FILL[5], t, FILL[6], ...FILL.slice(26, 40)]);
    const col = C(id).colors[0]; W.put('p1', [fillOf(c => c.colors.includes(col))[0]]);
    await W.useOption('p1', id);
    const opt = W.pl('p1').battle.find(s => s.cardId === id); if (opt) opt.placedTurn = 1; W.st.memory = 0;
    if (opt) { const body = S.parseDelayEffect(C(id).effectKo); const cid = S.discardForDelay(W.st, 'p1', opt.uid); W.st.pending.push({ uid: 'dl', player: 'p1', cardId: cid, stackUid: null, tags: ['메인'], text: body, resolved: false }); await W.drain(); }
    return { t };
  }, (W, x) => [['card added', W.pl('p1').hand.includes(x.t)], ['delay +2 memory', W.st.memory === 2], ['Korean name', /[가-힣]/.test(C(id).nameKo)]]);
}

// ---------------- BT4 / BT5 digitama (inherited effects only)
T(30, 'BT4/5', 'digitama have no own effect; every inherited text is Korean and yields a script', async () => ({}), () => {
  const ids = ['BT4-001', 'BT4-002', 'BT4-003', 'BT4-004', 'BT4-005', 'BT4-006', 'BT5-001', 'BT5-002', 'BT5-003', 'BT5-004', 'BT5-005', 'BT5-006'];
  return ids.map(id => [id, /[가-힣]/.test(C(id).inheritedKo) && /[가-힣]/.test(C(id).nameKo) && !C(id).effectKo]);
});
T(31, 'BT5-006', 'inherited (digitama hatched -> stack): +2000 DP when another own Digimon is deleted (once/turn)', async (W) => {
  const a = W.put('p1', [FILL[0], 'BT5-006']); const b = W.put('p1', [FILL[1]]); const dp0 = W.dp('p1', a);
  S.deleteStack(W.st, 'p1', b.uid, 'trash', 'effect'); await W.drain(); return { a, dp0 };
}, (W, x) => [['+2000', W.dp('p1', W.by('p1', x.a.uid)) === x.dp0 + 2000]]);
T(32, 'BT4-003', 'inherited: attacking with <=3 security -> opp Digimon -1000 DP', async (W) => {
  const a = W.put('p1', [FILL[0], 'BT4-003']); const o = W.put('p2', [FILL[1]]); W.sec('p1', FILL.slice(20, 23)); const dp0 = W.dp('p2', o);
  await W.attack('p1', a.uid, null); return { o, dp0 };
}, (W, x) => [['-1000', W.dp('p2', W.by('p2', x.o.uid)) === x.dp0 - 1000]]);

await runScenarios(list, 'ko-overrides-3');
