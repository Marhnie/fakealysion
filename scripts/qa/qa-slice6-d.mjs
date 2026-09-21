// Slice-6 official Q&A scenarios, part D (immunity, forced follow-ups, cost locks, sources, battle wins).  G# = group index in scripts/qa/s6/_groups.json.
// Run: node scripts/qa/qa-slice6-d.mjs [G#...] < /dev/null
import { S, E, Fx, C, plain, plainTamer, plainOption, W, scenario, run } from './lib-s6.mjs';
const all = Object.values(S.CARDS);
const withType = (t, lv, n = 0) => all.filter((c) => c.category === 'digimon' && (c.types || []).includes(t) && (lv == null || c.level === lv))[n]?.id;
const fx = (w, p, cat, fn) => { const prev = w.st._fxSrc; w.st._fxSrc = { player: p, category: cat, cardId: plain(3, 5) }; try { return fn(); } finally { w.st._fxSrc = prev; } };
const immune = (w, p, s) => S.grantShield(w.st, p, s.uid, { kinds: ['all'] });

// ---- 「効果を受けない」 (Q6358-6363 family) ----
scenario('G5', 'an "unaffected by effects" digimon can be chosen by an effect but is not rested', async () => {
  const w = W({ p1: {}, p2: { battle: [plain(3, 0)] } });
  immune(w, 'p2', w.p2.stacks[0]);
  await w.exec('p1', '상대의 디지몬 1마리를 레스트시킨다.', plain(3, 5));
  w.ok(w.prompts.some((p) => p.k === 'pickStack' && (p.o.uids || []).includes(w.p2.stacks[0].uid)), 'it was offered as a target');
  w.eq(w.p2.stacks[0].suspended, false, 'not rested');
  return w;
});
scenario('G6', 'granting an S-attack to an unaffected digimon is allowed but it does not act as having it', async () => {
  const w = W({ p1: {}, p2: { battle: [plain(3, 0)] } });
  immune(w, 'p2', w.p2.stacks[0]);
  await w.exec('p1', '턴 종료까지, 상대의 디지몬 1마리는 《S 어택 +1》을 얻는다.', plain(3, 5));
  w.eq(S.securityAttackBonus(w.p2.stacks[0]), 0, 'no S-attack bonus');
  return w;
});
scenario('G0', 'a debuff already applied is switched off once the digimon becomes unaffected (Q6354)', async () => {
  const w = W({ p1: {}, p2: { battle: [plain(3, 0)] } });
  const b = w.p2.stacks[0]; const base = w.dp('p2', b);
  fx(w, 'p1', 'digimon', () => S.modifyDP(w.st, 'p2', b.uid, -1000, 'turn'));
  w.eq(w.dp('p2', b) - base, -1000, 'debuff applied');
  immune(w, 'p2', b);
  w.eq(w.dp('p2', b) - base, 0, 'debuff no longer in effect while unaffected');
  return w;
});
scenario('G1', 'a debuff applies again once the digimon stops being unaffected (Q6355)', async () => {
  const w = W({ p1: {}, p2: { battle: [plain(3, 0)] } });
  const b = w.p2.stacks[0]; const base = w.dp('p2', b);
  fx(w, 'p1', 'digimon', () => S.modifyDP(w.st, 'p2', b.uid, -1000, 'turn'));
  immune(w, 'p2', b); b.shields = [];
  w.eq(w.dp('p2', b) - base, -1000, 'debuff back in effect');
  return w;
});
// ---- 【진화 시】 suppression (Q6790-6794) ----
scenario('G162', 'digimon with "evolve effect not activated" can still use its 【진화 시】【어택 시】 when attacking', async () => {
  const w = W({ p1: { battle: ['EX12-036'] }, p2: {} });
  const s = w.p1.stacks[0]; s.noEvoTrigUntil = w.st.turnNumber;
  await w.attack('p1', s.uid, 'PLAYER');
  w.ok(w.fires('EX12-036', '어택 시') >= 1, 'attack-time copy fired');
  return w;
});
scenario('G165', 'suppressed evolve trigger does not spend the [turn 1] of the 【진화 시】【어택 시】 effect', async () => {
  const w = W({ p1: { battle: ['EX12-017'] }, p2: {} });
  const s = w.p1.stacks[0]; s.noEvoTrigUntil = w.st.turnNumber;
  S.queueTriggersForStack(w.st, 'p1', s, 'digivolve'); await w.drain();
  w.eq(w.fires('EX12-017', '진화 시'), 0, 'nothing fired on evolve');
  await w.attack('p1', s.uid, 'PLAYER');
  w.eq(w.fires('EX12-017', '어택 시'), 1, 'attack-time effect still available once');
  return w;
});
// ---- forced follow-ups ("…할 수 있다" that the official answers say cannot be declined) (Q6737, Q6836, Q6972) ----
scenario('G138', 'EX12-015: after granting 《연계》 the SW digimon must attack (no decline)', async () => {
  const sw = withType('SW', 3);
  const w = W({ p1: { battle: ['EX12-015', sw] }, p2: { battle: [plain(3, 0)] } });
  w.answers.confirmEffect = () => false;
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  w.ok((w.attackReqs || []).length >= 1, 'an attack was started');
  return w;
});
scenario('G186', 'EX12-052 counter effect: after the DP bonus the battle cannot be declined', async () => {
  const w = W({ p1: { battle: ['EX12-052'] }, p2: { battle: [plain(3, 0)] } });
  w.answers.confirmEffect = () => false;
  await w.run('p1', w.p1.stacks[0].uid, '카운터');
  w.eq(w.pl('p2').battle.length, 0, 'the battle happened (weak digimon destroyed)');
  return w;
});
scenario('G188', 'EX12-052 counter effect: an unaffected opposing digimon can be chosen and loses the battle normally', async () => {
  const w = W({ p1: { battle: ['EX12-052'] }, p2: { battle: [plain(3, 0)] } });
  immune(w, 'p2', w.p2.stacks[0]);
  await w.run('p1', w.p1.stacks[0].uid, '카운터');
  w.eq(w.pl('p2').battle.length, 0, 'destroyed by the battle');
  return w;
});
// ---- cost locks (Q6732/6733/6806/6810..6812 family) ----
scenario('G135', 'EX12-013 main with a "no play-cost reduction" digimon on the field: card is played at full cost', async () => {
  const vb = 'EX12-040'; const full = C(vb).cost;
  const w = W({ p1: { battle: ['EX12-013'], hand: [vb] }, p2: { battle: ['ST12-03'] }, memory: 10 });
  await w.run('p1', w.p1.stacks[0].uid, '메인');
  w.ok(w.pl('p1').battle.some((s) => s.cardId === vb), 'played'); w.eq(w.st.memory, 10 - full, 'full cost paid');
  return w;
});
scenario('G136', 'EX12-013 main with an effect-play ban on the field: nothing is played', async () => {
  const vb = 'EX12-040';
  const w = W({ p1: { battle: ['EX12-013'], hand: [vb] }, p2: { battle: ['BT9-047'] }, memory: 10 });
  await w.run('p1', w.p1.stacks[0].uid, '메인');
  w.ok(!w.pl('p1').battle.some((s) => s.cardId === vb), 'not played'); w.eq(w.st.memory, 10, 'no cost paid');
  return w;
});
// ---- Q7036/7074: BT26-045 "fewer cards in hand" is checked while the card is still in hand ----
scenario('G261', 'BT26-045: equal hand sizes with the card still in hand -> no play-cost discount', async () => {
  const w = W({ p1: { hand: ['BT26-045', plain(3, 1), plain(3, 2)], battle: [] }, p2: { hand: [plain(3, 3), plain(3, 4), plain(3, 5)] } });
  w.eq(S.handSelfPlayDiscount(w.st, 'p1', 'BT26-045'), 0, 'no discount');
  w.pl('p2').hand.push(plain(3, 6));
  w.eq(S.handSelfPlayDiscount(w.st, 'p1', 'BT26-045'), -4, 'discount when strictly fewer');
  w.pl('p1').hand[0] = 'BT26-059'; w.pl('p2').hand.length = 3;
  w.eq(S.handSelfPlayDiscount(w.st, 'p1', 'BT26-059'), 0, 'BT26-059: equal -> no discount');
  w.pl('p2').hand.push(plain(3, 6));
  w.eq(S.handSelfPlayDiscount(w.st, 'p1', 'BT26-059'), -6, 'BT26-059: fewer -> -6');
  return w;
});
// ---- Q7079-7083: BT26-060 returns stacked cards counted from the TOP card (the top card is part of the stack), until one card is left ----
scenario('G278', 'BT26-060: stack of 3 cards -> top 2 cards go to the deck top, the bottom card stays as the digimon', async () => {
  const w = W({ p1: { battle: ['BT26-060'] }, p2: { battle: [{ id: plain(5, 0), src: [plain(3, 1), plain(4, 1)] }] } });
  const d0 = w.pl('p2').deck.length; const st = w.p2.stacks[0]; const bottom = st.sources[0];
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  w.eq(w.pl('p2').deck.length, d0 + 2, 'deck +2 (5-card limit but only 2 stacked above the last card)');
  w.eq(st.cardId, bottom, 'the bottom card is the digimon now'); w.eq(st.sources.length, 0, 'no sources left');
  return w;
});
scenario('G279', 'BT26-060: if the remaining card has no DP the digimon is trashed by the rule check', async () => {
  const egg = 'BT24-007';
  const w = W({ p1: { battle: ['BT26-060'] }, p2: { battle: [{ id: plain(3, 0), src: [egg] }] } });
  await w.run('p1', w.p1.stacks[0].uid, '등장 시'); w.st._rcPending && S.flushRuleChecks(w.st);
  w.eq(w.pl('p2').battle.length, 0, 'digimon gone (no DP)');
  return w;
});
// ---- Q6833 family: colours counted over all returned cards (EX12-047) ----
scenario('G180', 'EX12-047: returned red/blue + blue/yellow cards = 3 colours -> DP -15000', async () => {
  const w = W({ p1: { battle: ['EX12-047'] }, p2: { battle: [plain(3, 0), plain(6, 0)], trash: ['BT8-012', 'BT8-023'] } });
  const t = w.p2.stacks[1]; S.modifyDP(w.st, 'p2', t.uid, 30000, 'turn'); const b = w.dp('p2', t);
  w.answers.pickFromZoneIndex = (o) => undefined;
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  w.eq(w.dp('p2', t) - b, -15000, 'DP -15000');
  return w;
});
// ---- Q7008/7025/7010..: "when this digimon wins a battle" also vs security digimon, memory +1 (BT26-041 inherited) ----
scenario('G182', 'BT26-041 inherited: winning against a security digimon gives memory +1', async () => {
  const w = W({ p1: { battle: [{ id: plain(5, 0), src: ['BT26-041'] }] }, p2: { security: [plain(3, 0), plain(3, 1)] }, memory: 0 });
  await w.attack('p1', w.p1.stacks[0].uid, 'PLAYER');
  w.eq(w.st.memory, 1, 'memory +1');
  return w;
});
scenario('G181', 'BT26-041 inherited: winning against a digimon gives memory +1', async () => {
  const w = W({ p1: { battle: [{ id: plain(5, 0), src: ['BT26-041'] }] }, p2: { battle: [plain(3, 0)] }, memory: 0 });
  w.p2.stacks[0].suspended = true;
  await w.attack('p1', w.p1.stacks[0].uid, w.p2.stacks[0].uid);
  w.eq(w.st.memory, 1, 'memory +1'); w.eq(w.pl('p2').battle.length, 0, 'defender destroyed');
  return w;
});
// ---- Q7059: BT26-056 option side: devolve happens even without a hand card to discard ----
scenario('G271', 'BT26-056 arts side: empty hand -> the devolve still happens', async () => {
  const w = W({ p1: { hand: [] }, p2: { battle: [{ id: plain(5, 0), src: [plain(3, 1), plain(4, 1), plain(4, 2)] }] } });
  await w.runCard('p1', 'BT26-056', '메인', { inherited: true });
  w.ok(w.pl('p2').trash.length >= 1, 'a card was devolved off');
  return w;
});
await run('slice6-d');
