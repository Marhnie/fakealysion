// Slice-6 official Q&A scenarios, part F (stack-wide conditions, cost locks on bespoke plays, watchers).  G# = group index in scripts/qa/s6/_groups.json.
// Run: node scripts/qa/qa-slice6-f.mjs [G#...] < /dev/null
import { S, E, Fx, C, plain, plainTamer, plainOption, W, scenario, run } from './lib-s6.mjs';
const all = Object.values(S.CARDS);
const withType = (t, lv, n = 0) => all.filter((c) => c.category === 'digimon' && (c.types || []).includes(t) && (lv == null || c.level === lv))[n]?.id;

// ---- Q6768: "cards of the same Lv. stacked" counts the whole stack incl. the top card (EX12-032 / EX12-044) ----
scenario('G152', 'EX12-032 attack effect: top Lv5 + one Lv5 source counts as two same-level cards -> evolves from trash', async () => {
  const w = W({ p1: { battle: [{ id: 'EX12-032', src: [plain(5, 1)] }], trash: ['EX12-035'] }, p2: {}, memory: 10 });
  await w.run('p1', w.p1.stacks[0].uid, '어택 시');
  w.eq(w.p1.stacks[0].cardId, 'EX12-035', 'evolved');
  return w;
});
scenario('G152b', 'EX12-032 attack effect: no two same-level cards in the whole stack -> no evolution (control)', async () => {
  const w = W({ p1: { battle: [{ id: 'EX12-032', src: [plain(4, 1)] }], trash: ['EX12-035'] }, p2: {}, memory: 10 });
  await w.run('p1', w.p1.stacks[0].uid, '어택 시');
  w.eq(w.p1.stacks[0].cardId, 'EX12-032', 'not evolved');
  return w;
});
// ---- Q6146.. EX12-020 breeding-area evolution: the own-turn cost discount does not apply in the breeding area ----
scenario('G146', 'EX12-020: the evolve-cost discount works in the battle area, not in the breeding area', async () => {
  const tb = withType('TB', 3);
  const wb = W({ p1: { battle: ['EX12-020'] }, p2: {} }); const wr = W({ p1: { raising: 'EX12-020' }, p2: {} });
  wb.eq(S.continuousEvoCostDiscount(wb.st, 'p1', wb.p1.stacks[0], tb), -1, 'battle area: -1');
  wb.eq(S.continuousEvoCostDiscount(wr.st, 'p1', wr.p1.raising, tb), 0, 'breeding area: 0');
  return wb;
});
// ---- Q6795-6797: EX12-037 "per 5 sources choose an effect": the same effect may be chosen twice ----
scenario('G166', 'EX12-037: 10 sources -> the same option may be applied twice (DP -13000 twice)', async () => {
  const src = Array.from({ length: 10 }, (_, i) => plain(3, i));
  const w = W({ p1: { battle: [{ id: 'EX12-037', src }] }, p2: { battle: [plain(3, 0), plain(6, 0)] } });
  const t = w.p2.stacks[1]; S.modifyDP(w.st, 'p2', t.uid, 40000, 'turn'); const b = w.dp('p2', t);
  w.answers.multipleChoice = () => 0;
  await w.run('p1', w.p1.stacks[0].uid, '진화 시');
  w.eq(w.dp('p2', t) - b, -26000, 'DP -13000 x2');
  return w;
});
// ---- Q6811-6812: EX12-045 own-turn play: cost lock / effect-play ban ----
const gcard = () => withType('SW', 3);
scenario('G172', 'EX12-045 own-turn play with a "no play-cost reduction" digimon on the field: full cost, still played', async () => {
  const sw = gcard(); const full = C(sw).cost;
  const w = W({ p1: { battle: ['EX12-045'], hand: [sw] }, p2: { battle: ['ST12-03'] }, memory: 10 });
  await w.exec('p1', '자신의 패에서, 「손오공몬」이 기술되어 있거나 특징 「SW」를 가진 카드 1장을 지불하는 코스트 -2 하여 등장시킬 수 있다.', 'EX12-045', w.p1.stacks[0].uid, { tags: ['자신의 턴'] });
  w.ok(w.pl('p1').battle.some((s) => s.cardId === sw), 'played'); w.eq(w.st.memory, 10 - full, 'full cost paid');
  return w;
});
scenario('G173', 'EX12-045 own-turn play with an effect-play ban on the field: nothing is played', async () => {
  const sw = gcard();
  const w = W({ p1: { battle: ['EX12-045'], hand: [sw] }, p2: { battle: ['BT9-047'] }, memory: 10 });
  await w.exec('p1', '자신의 패에서, 「손오공몬」이 기술되어 있거나 특징 「SW」를 가진 카드 1장을 지불하는 코스트 -2 하여 등장시킬 수 있다.', 'EX12-045', w.p1.stacks[0].uid, { tags: ['자신의 턴'] });
  w.ok(!w.pl('p1').battle.some((s) => s.cardId === sw), 'not played'); w.eq(w.st.memory, 10, 'no cost paid');
  return w;
});
// ---- Q7078: BT26-059 both-turns watcher fires for either player's hand discard ----
scenario('G275', 'BT26-059: the OPPONENT discarding from its own hand also triggers it', async () => {
  const w = W({ p1: { battle: ['BT26-059'] }, p2: { battle: [plain(3, 0)], hand: [plain(3, 1)] } });
  await w.exec('p2', '자신의 패를 1장 파기한다.', plain(3, 5));
  w.eq(w.pl('p2').battle.length, 0, 'lowest-level opposing digimon destroyed');
  return w;
});
// ---- Q6976: BT26-016 needs the full 3 trash cards for its cost ----
scenario('G238', 'BT26-016: only 2 cards in the two trashes -> no 《리커버리》', async () => {
  const w = W({ p1: { battle: ['BT26-016'], trash: [plain(3, 1)], security: [plain(3, 0), plain(3, 1), plain(3, 2)] }, p2: { trash: [plain(3, 2)] } });
  const s0 = w.pl('p1').security.length;
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  w.eq(w.pl('p1').security.length, s0, 'security unchanged');
  return w;
});
// ---- Q6858: EX12-059 needs both cards to be placed ----
scenario('G194', 'EX12-059: only one matching card available -> nothing placed under it', async () => {
  const w = W({ p1: { battle: ['EX12-059'], hand: ['EX12-064'] }, p2: {} });
  const n0 = w.p1.stacks[0].sources.length;
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  w.eq(w.p1.stacks[0].sources.length, n0, 'sources unchanged'); w.ok(w.pl('p1').hand.includes('EX12-064'), 'card stays in hand');
  return w;
});
await run('slice6-f');
