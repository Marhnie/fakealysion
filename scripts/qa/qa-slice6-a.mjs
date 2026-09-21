// Slice-6 official Q&A scenarios, part A (BT25 + general).  G# = group index in scripts/qa/s6/_groups.json (Q ids listed per group there).
// Run: node scripts/qa/qa-slice6-a.mjs [G#...] < /dev/null
import { S, E, Fx, C, plain, plainTamer, plainOption, W, scenario, run } from './lib-s6.mjs';
const tamerNonPurple = () => Object.values(S.CARDS).find((c) => c.category === 'tamer' && !(c.colors || []).includes('purple') && !(c.effectKo || '').trim()).id;
const TS3 = 'P-196'; // plain Lv3 digimon with trait TS (no effect)
const shieldDel = (w, p, s) => S.grantShield(w.st, p, s.uid, { kinds: ['delete'] });

// Q6373: with opposing digimon present the "if not destroyed" branch cannot be skipped: cheapest one is destroyed, security stays (BT25-076)
scenario('G15', 'BT25-076 on-play destroys the lowest-cost digimon; no security trashed', async () => {
  const lo = plain(3, 0), hi = plain(5, 0);
  const w = W({ p1: { hand: ['BT25-076'] }, p2: { battle: [lo, hi] } });
  const sec0 = w.pl('p2').security.length;
  await w.play('p1', 'BT25-076');
  w.eq(w.pl('p2').battle.map((s) => s.cardId), [hi], 'cheapest destroyed, other stays');
  w.eq(w.pl('p2').security.length, sec0, 'security untouched');
  return w;
});
// Q6374: choosing a digimon that cannot be destroyed still satisfies "if not destroyed" -> top security of opponent trashed
scenario('G16', 'BT25-076: undestroyable cheapest digimon -> counts as not destroyed, security top trashed', async () => {
  const w = W({ p1: { hand: ['BT25-076'] }, p2: { battle: [plain(3, 0)] } });
  shieldDel(w, 'p2', w.p2.stacks[0]);
  const sec0 = w.pl('p2').security.length;
  await w.play('p1', 'BT25-076');
  w.eq(w.pl('p2').battle.length, 1, 'digimon survived');
  w.eq(w.pl('p2').security.length, sec0 - 1, 'security top trashed');
  return w;
});
// Q6378 (+Q6375): BT25-077 [each turn] fires for its own arrival; effect-arrival forces the destroy even if rest is declined
scenario('G20', 'BT25-077: digimon arrives by effect -> lowest-DP opponent digimon destroyed even when the optional rest is declined', async () => {
  const w = W({ p1: { hand: [plain(3, 1)], battle: ['BT25-077'] }, p2: { battle: [plain(3, 0), plain(5, 0)] } });
  w.answers.pickStackAnySide = () => null; w.answers.confirmEffect = () => false;
  const lowest = w.p2.stacks.reduce((a, b) => (S.card(a.cardId).dp <= S.card(b.cardId).dp ? a : b));
  await w.effPlay('p1', w.pl('p1').hand[0]);
  w.ok(w.fires('BT25-077', '서로의 턴') >= 1, 'BT25-077 effect fired');
  w.ok(!w.pl('p2').battle.includes(lowest), 'lowest-DP opponent digimon destroyed');
  return w;
});
scenario('G17', 'BT25-077 triggers on its own arrival (hand play) and rests-only, no destroy', async () => {
  const w = W({ p1: { hand: ['BT25-077'] }, p2: { battle: [plain(3, 0)] } });
  await w.play('p1', 'BT25-077');
  w.ok(w.fires('BT25-077', '서로의 턴') >= 1, 'own-arrival trigger fired');
  w.eq(w.pl('p2').battle.length, 1, 'normal play does not destroy');
  return w;
});
// Q6377: once-per-turn spent by a non-effect arrival -> a later effect arrival does not activate again
scenario('G19', 'BT25-077: [turn 1] used up by normal play blocks the later effect arrival', async () => {
  const w = W({ p1: { hand: [plain(3, 1), plain(3, 2)], battle: ['BT25-077'] }, p2: { battle: [plain(3, 0)] } });
  await w.play('p1', w.pl('p1').hand[0]);
  await w.effPlay('p1', w.pl('p1').hand[0]);
  w.eq(w.pl('p2').battle.length, 1, 'no destroy on the second arrival');
  return w;
});
// Q6946: not resolving the rest (declined) on a normal arrival does not spend the once-per-turn
scenario('G222', 'BT25-077: declining the optional rest keeps [turn 1] for a later effect arrival', async () => {
  const w = W({ p1: { hand: [plain(3, 1), plain(3, 2)], battle: ['BT25-077'] }, p2: { battle: [plain(3, 0)] } });
  w.answers.pickStackAnySide = () => null; w.answers.confirmEffect = () => false;
  await w.play('p1', w.pl('p1').hand[0]);
  await w.effPlay('p1', w.pl('p1').hand[0]);
  w.eq(w.pl('p2').battle.length, 0, 'second (effect) arrival destroys the opponent digimon');
  return w;
});
// Q6365: own [my turn] watcher also triggers by the card itself entering (BT25-067)
scenario('G8', 'BT25-067 own-turn watcher fires when it is itself played', async () => {
  const w = W({ p1: { hand: ['BT25-067'] }, p2: {} });
  await w.play('p1', 'BT25-067');
  w.ok(w.fires('BT25-067', '자신의 턴') >= 1, 'watcher fired for own arrival');
  return w;
});
// Q6369 group: [both turns] watchers trigger for themselves entering (EX12-034 lower-level bounce)
scenario('G12', 'EX12-034 [both turns] watcher triggers on its own arrival: lowest-level opposing digimon sent to deck bottom', async () => {
  const w = W({ p1: { hand: ['EX12-034'] }, p2: { battle: [plain(3, 0), plain(5, 0)] } });
  await w.play('p1', 'EX12-034');
  w.eq(w.pl('p2').battle.length, 1, 'one opposing digimon returned');
  return w;
});
scenario('G160', 'EX12-035 [both turns] watcher fires for its own arrival', async () => {
  const w = W({ p1: { hand: ['EX12-035'] }, p2: { battle: [plain(3, 0)] } });
  await w.play('p1', 'EX12-035');
  w.ok(w.fires('EX12-035', '서로의 턴') >= 1, 'fired');
  return w;
});
// Q6380: BT25-079 blocks all memory gain except tamer effects
scenario('G22', 'BT25-079: memory +1 from a digimon effect is blocked, from a tamer effect it works', async () => {
  const w = W({ p1: { battle: ['BT25-079'] }, p2: {}, memory: 0 });
  await w.exec('p1', '메모리 +1.', plain(3, 1));
  w.eq(w.st.memory, 0, 'digimon-sourced +1 blocked');
  await w.exec('p1', '메모리 +1.', plainTamer());
  w.eq(w.st.memory, 1, 'tamer-sourced +1 allowed');
  return w;
});
// Q6382: BT25-080 — without discarding a hand card the later "if arrived by effect" part is not processed
scenario('G24', 'BT25-080 on-play: empty hand -> no discard -> nothing after (no destroy even when arrived by effect)', async () => {
  const w = W({ p1: { hand: ['BT25-080'] }, p2: { battle: [plain(3, 0)] } });
  await w.effPlay('p1', 'BT25-080');
  w.eq(w.pl('p2').battle.length, 1, 'opponent digimon untouched');
  return w;
});
// Q6385: BT25-080 after discarding, the by-effect destroy is mandatory
scenario('G27', 'BT25-080 on-play by effect: after discarding the destroy of a Lv<=5 opposing digimon happens', async () => {
  const w = W({ p1: { hand: ['BT25-080', plain(3, 1)] }, p2: { battle: [plain(3, 0)] } });
  await w.effPlay('p1', 'BT25-080');
  w.eq(w.pl('p2').battle.length, 0, 'destroyed');
  return w;
});
// Q6386: BT25-081 must rest one non-purple tamer
scenario('G28', 'BT25-081 on-play rests a non-purple tamer', async () => {
  const w = W({ p1: { hand: ['BT25-081'], battle: [tamerNonPurple()] } });
  await w.play('p1', 'BT25-081');
  w.ok(w.p1.stacks[0].suspended, 'tamer rested');
  return w;
});
await run('slice6-a');
