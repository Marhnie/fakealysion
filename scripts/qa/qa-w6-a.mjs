// W6 recheck2 (Q&A idx 3335-4001): batch A — LM/RB1 rulings.
// Run: node scripts/qa/qa-w6-a.mjs < /dev/null
import { S, E, Fx, C, plain, plainTamer, W, scenario, run } from './lib-s6.mjs';
const all = Object.values(S.CARDS);
const blue = (n) => all.filter((c) => (c.colors || []).length === 1 && c.colors[0] === 'blue' && c.category === 'digimon' && !(c.effectKo || '').trim() && c.level === 3).slice(0, n).map((c) => c.id);

scenario('3360-61', 'LM-021 등장 시: total DP <= own DP, first pick required, further picks optional', async () => {
  const w = W({ p1: { battle: ['LM-021'] }, p2: { battle: [plain(3,0,{dp:6000}), plain(3,1,{dp:6000}), plain(3,2,{dp:6000})] }, memory: 3 });
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  w.eq(w.prompts[0].o.required, true, 'first pick required');
  w.eq(w.pl('p2').battle.length, 1, 'two 6000 digimon removed (12000<=14000), third exceeds');
  return w;
});
scenario('3339', 'LM-006 등장 시: sourceless opp digimon cannot attack; regains ability once it has a source', async () => {
  const w = W({ p1: { battle: ['LM-006'] }, p2: { battle: [plain(3,0), {id: plain(3,1), src:[plain(3,2)]}] }, memory: 3 });
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  w.st.activePlayer = 'p2'; w.st.turnNumber = 4;
  const a = w.p2.stacks[0];
  w.eq(S.declareAttack(w.st, 'p2', a.uid).ok, false, 'sourceless cannot attack');
  a.sources.push(plain(3,3)); S.recomputeStackGrants(a);
  w.eq(S.declareAttack(w.st, 'p2', a.uid).ok, true, 'with a source it can attack');
  return w;
});
scenario('3343', 'LM-011: no opp digimon -> own digimon still gets blocker', async () => {
  const w = W({ p1: { battle: ['LM-011', plain(3,0)] }, p2: { battle: [] }, memory: 3 });
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  w.ok(w.p1.stacks.some((s) => S.hasKeyword(s, '블로커')), 'a blocker was granted');
  return w;
});
scenario('3341-42', 'LM-009: -2 evo cost only into 앙고라몬-described cards; rest-trigger of the evolved-away card does not grant 속공', async () => {
  const tgt = all.find((c) => c.category === 'digimon' && c.level === 5 && (/앙고라몬/.test(c.effectKo || '') || /앙고라몬/.test(c.inheritedKo || '')) && E.canEvolveAny('LM-009', c.id, [], null).ok);
  const w = W({ p1: { battle: ['LM-009', 'LM-011'], hand: [tgt.id] }, p2: { battle: [] }, memory: 10 });
  const st = w.p1.stacks[0];
  const opts = S.hookEvoCostOptions(w.st, 'p1', st, tgt.id);
  w.eq(opts.length, 1, 'discount option offered for 앙고라몬 target');
  const d = opts[0].apply(); await w.drain();
  S.digivolve(w.st, 'p1', st.uid, tgt.id, E.canEvolveAny('LM-009', tgt.id, [], null).cost + d, 'hand'); await w.drain();
  w.ok(!S.hasKeyword(w.p1.stacks[1], '속공'), 'no 속공 after evolving away');
  const t2 = all.find((c) => c.category === 'digimon' && c.level === 5 && !/앙고라몬/.test(c.nameKo + (c.effectKo || '') + (c.inheritedKo || '')) && E.canEvolveAny('LM-009', c.id, [], null).ok);
  const w2 = W({ p1: { battle: ['LM-009'], hand: [t2.id] }, memory: 10 });
  w2.eq(S.hookEvoCostOptions(w2.st, 'p1', w2.p1.stacks[0], t2.id).length, 0, 'no discount into non-앙고라몬');
  w.results.push(...w2.results); return w;
});
scenario('3336', 'LM-003 source x2 with hand 7: only one draw', async () => {
  const w = W({ p1: { battle: [{ id: plain(3, 0), src: ['LM-003', 'LM-003'] }], hand: Array.from({ length: 7 }, (_, i) => plain(3, i + 1)) }, p2: {} });
  await w.attack('p1', w.p1.stacks[0].uid, 'PLAYER');
  w.eq(w.pl('p1').hand.length, 8, 'hand 7 -> 8 (second draw fails the <=7 check)');
  return w;
});
scenario('3337', 'LM-005 등장 시: discard two blue cards -> discard one source from each of two different opp targets', async () => {
  const bl = blue(2);
  const w = W({ p1: { battle: ['LM-005'], hand: bl }, p2: { battle: [{ id: plain(3, 0), src: [plain(3, 1)] }, { id: plain(3, 2), src: [plain(3, 3)] }] }, memory: 3 });
  let n = 0; w.answers.pickFromHandIndexes = (o) => o.eligibleIdxs.slice(0, 2);
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  const srcs = w.p2.stacks.map((s) => s.sources.length);
  console.log('after', JSON.stringify(srcs), 'p2 battle', w.pl('p2').battle.length, 'hand p1', w.pl('p1').hand.length, w.prompts.map(p=>p.k).join(','));
  w.eq(srcs.every((x) => x === 0) || w.pl('p2').battle.length < 2, true, 'both sources discarded (and the emptied ones bounced)');
  return w;
});
for (const [q, label, hand, text, dMem, dDraw] of [
  ['3452', 'RB1-035: Lv.- entrant -> tamer may rest but neither branch applies', ['EX2-045'], null, 0, 0],
  ['3453', 'RB1-035: Lv.3 + Lv.4 simultaneously -> memory +1 AND draw 1', [plain(3, 0), plain(4, 0)], '자신의 패에서 Lv.3의 디지몬 카드 1장과 Lv.4의 디지몬 카드 1장을 코스트를 지불하지 않고 등장시킨다.', 1, 1],
  ['3454', 'RB1-035: two Lv.3 simultaneously -> only one draw', [plain(3, 0), plain(3, 1)], '자신의 패에서 Lv.3의 디지몬 카드 2장을 코스트를 지불하지 않고 등장시킨다.', 0, 1]]) {
  scenario(q, label, async () => {
    const w = W({ p1: { battle: ['RB1-035'] }, p2: { hand, battle: [] }, memory: 3, active: 'p2' });
    const h0 = w.pl('p1').hand.length, m0 = w.st.memory; w.answers.confirmEffect = () => true;
    if (text) await w.exec('p2', text, 'ST1-02', null); else await w.play('p2', hand[0], 0);
    w.eq(w.st.memory - m0, dMem, 'memory delta'); w.eq(w.pl('p1').hand.length - h0, dDraw, 'draw delta');
    return w;
  });
}
const TOK = 'TOKEN-QAW6'; S.CARDS[TOK] = { id: TOK, cardId: TOK, nameKo: 'QA토큰', category: 'digimon', level: null, cost: 0, dp: 3000, colors: ['white'], types: [], effectKo: '', inheritedKo: '', isToken: true };
for (const [q, pick] of [['3351', 'EX2-007'], ['3352', TOK]]) {
  scenario(q, 'LM-020 진화 시: own ' + pick + ' may be put on security (redirected by rule) and the rest of the effect still runs', async () => {
    const w = W({ p1: { battle: ['LM-020', pick] }, p2: { security: [plain(3, 0), plain(3, 1), plain(3, 2)] } });
    w.answers.pickStackAnySide = (o) => { const e = o.entries.find((x) => w.find(x.player, x.uid) && w.find(x.player, x.uid).cardId === pick); return e ? { player: e.player, uid: e.uid } : null; };
    const dk = w.pl('p2').deck.length, ds = w.pl('p1').digitamaDeck.length;
    await w.run('p1', w.p1.stacks[0].uid, '진화 시');
    w.eq(w.pl('p1').battle.map((s) => s.cardId), ['LM-020'], 'the picked digimon left the battle area');
    w.eq(w.pl('p1').security.length, 5, 'own security did not really increase');
    w.eq(w.pl('p2').deck.length - dk, 1, 'opp: one revealed security card put on the deck top');
    w.eq(w.pl('p1').digitamaDeck.length - ds, pick === 'EX2-007' ? 1 : 0, 'digitama-type goes to the digitama deck bottom');
    return w;
  });
}
scenario('3354', 'LM-020 immunity to Digimon effects also covers OUR OWN other digimon effects (not its own, not Tamer effects)', async () => {
  const shield = (w) => S.grantShield(w.st, 'p1', w.p1.stacks[0].uid, { kinds: ['all'], until: w.st.turnNumber, fromCategory: 'digimon', anySide: true });
  const kill = async (srcId, srcIdx) => {
    const w = W({ p1: { battle: ['LM-020', plain(3, 0), 'RB1-035'] }, p2: {} });
    shield(w); const q = w.p1.stacks[0].uid; w.answers.pickStack = () => q;
    await w.exec('p1', '자신의 디지몬 1마리를 소멸시킨다.', srcId(w), w.p1.stacks[srcIdx].uid);
    return { w, alive: w.pl('p1').battle.some((s) => s.uid === q) };
  };
  const a = await kill((w) => plain(3, 0), 1);
  a.w.eq(a.alive, true, 'own OTHER digimon effect: Quantamon not destroyed');
  const b = await kill((w) => 'LM-020', 0);
  b.w.eq(b.alive, false, 'Quantamon own effect still applies (skipped: own exec)');
  const c = await kill((w) => 'RB1-035', 2);
  c.w.eq(c.alive, false, 'a Tamer effect is not covered by the Digimon category shield');
  a.w.results.push(...b.w.results, ...c.w.results); return a.w;
});
scenario('3438', 'RB1-019 진화 시: the activating player orders several Lv.3 digimon going onto one security stack', async () => {
  const w = W({ p1: { battle: ['RB1-019'] }, p2: { battle: [plain(3, 0), plain(3, 1)] } });
  w.answers.orderCards = () => [1, 0];
  await w.run('p1', w.p1.stacks[0].uid, '진화 시');
  const oc = w.prompts.filter((p) => p.k === 'orderCards');
  w.eq(oc.length, 1, 'one ordering prompt (for the two opposing digimon)');
  w.eq(oc[0] && oc[0].o.player, 'p1', 'asked to the activating player');
  w.eq(w.pl('p2').security.slice(0, 2), [plain(3, 1), plain(3, 0)], 'chosen order: second listed card is on top');
  return w;
});
scenario('3483', 'BT3-109 (「이 카드」 granted 소멸 시) after the digimon evolved: the EVOLVED card is played from the trash', async () => {
  const A = plain(3, 0, { color: 'purple' }), B = plain(4, 0, { color: 'purple' });
  const w = W({ p1: { battle: [A], hand: [B, 'BT3-109'] }, p2: {}, memory: 10 });
  await w.useOption('p1', 'BT3-109');
  S.digivolve(w.st, 'p1', w.p1.stacks[0].uid, B, 0, 'hand'); await w.drain();
  S.deleteStack(w.st, 'p1', w.p1.stacks[0].uid, 'trash', 'battle'); await w.drain();
  w.eq(w.pl('p1').battle.map((s) => s.cardId), [B], 'the evolved (current top) card returns');
  return w;
});
await run('w6-a');
