// Slice-6 official Q&A scenarios, part C (security recover, restrictions, watchers, assembly).  G# = group index in scripts/qa/s6/_groups.json.
// Run: node scripts/qa/qa-slice6-c.mjs [G#...] < /dev/null
import { S, E, Fx, C, plain, plainTamer, plainOption, W, scenario, run } from './lib-s6.mjs';
const all = Object.values(S.CARDS);
const withType = (t, lv, n = 0) => all.filter((c) => c.category === 'digimon' && (c.types || []).includes(t) && (lv == null || c.level === lv))[n]?.id;
const shieldDel = (w, p, s) => S.grantShield(w.st, p, s.uid, { kinds: ['delete'] });
const secN = (w, p) => w.pl(p).security.length;

// ---- 《리커버리》 / security handling with an empty security stack (Q6804, Q6985, Q6986, Q7124, Q7188): the "add to hand" / "trash" part is skipped, the recover still happens ----
scenario('G169', 'EX12-042 on-play with 0 security: no hand gain, recover +1 still happens', async () => {
  const w = W({ p1: { hand: ['EX12-042'], security: [] }, p2: {} });
  await w.play('p1', 'EX12-042');
  w.eq(secN(w, 'p1'), 1, 'security 1 (recovered)'); w.eq(w.pl('p1').hand.length, 0, 'hand unchanged');
  return w;
});
scenario('G246', 'BT26-022 on-play with 0 security: recover +1 still happens', async () => {
  const w = W({ p1: { hand: ['BT26-022'], security: [] }, p2: {} });
  await w.play('p1', 'BT26-022');
  w.eq(secN(w, 'p1'), 1, 'security 1'); w.eq(w.pl('p1').hand.length, 0, 'hand unchanged');
  return w;
});
scenario('G247', 'BT26-025 inherited attack effect: 0 security -> recover +1', async () => {
  const w = W({ p1: { battle: [{ id: plain(3, 0), src: ['BT26-025'] }], security: [] }, p2: {} });
  await w.run('p1', w.p1.stacks[0].uid, '어택 시', { cardId: 'BT26-025', inherited: true });
  w.eq(secN(w, 'p1'), 1, 'security 1');
  return w;
});
scenario('G299', 'BT26-083 on-play with 0 security: no discard, recover +3 still happens', async () => {
  const w = W({ p1: { hand: ['BT26-083'], security: [] }, p2: { battle: [plain(3, 0)] } });
  await w.play('p1', 'BT26-083');
  w.eq(secN(w, 'p1'), 3, 'security 3'); w.eq(w.pl('p2').battle.length, 1, 'no destroy (0 discarded)');
  return w;
});
scenario('G321', 'BT26-103 on-evolve/counter with 0 security: recover +2 still happens', async () => {
  const w = W({ p1: { battle: ['BT26-103'], security: [] }, p2: {} });
  await w.run('p1', w.p1.stacks[0].uid, '진화 시');
  w.eq(secN(w, 'p1'), 2, 'security 2');
  return w;
});
// ---- play restriction "DP <= N digimon cannot be played" also covers effect play into the breeding area (Q6508, Q6509) ----
scenario('G102', 'EX3-012: no opposing digimon -> not destroyed -> opponent cannot play DP<=5000 digimon into the breeding area', async () => {
  const lowDp = plain(3, 0);
  const w = W({ p1: { hand: ['EX3-012'] }, p2: { hand: [lowDp] } });
  await w.play('p1', 'EX3-012');
  const r = S.playFreeToRaising(w.st, 'p2', 'hand', 0);
  w.ok(!r && !w.pl('p2').raising, 'breeding-area play refused');
  return w;
});
scenario('G103', 'EX7-014 on-evolve: opponent cannot play DP<=6000 digimon into the breeding area by effect', async () => {
  const lowDp = plain(3, 0);
  const w = W({ p1: { battle: ['EX7-014'] }, p2: { hand: [lowDp] } });
  await w.run('p1', w.p1.stacks[0].uid, '진화 시');
  const r = S.playFreeToRaising(w.st, 'p2', 'hand', 0);
  w.ok(!r && !w.pl('p2').raising, 'breeding-area play refused');
  return w;
});
// ---- Q6521: P-206 ignores its colour condition even with an empty area ----
scenario('G111', 'P-206: usable colour-wise with no own cards in the area', async () => {
  const w = W({ p1: { hand: ['P-206'] }, p2: {} });
  w.eq(S.optionColorOk(w.st, 'p1', 'P-206'), true, 'colour condition ignored');
  return w;
});
// ---- Q6517: EX11-062 the DP bonus is given even if the digimon did not rest by an effect ----
scenario('G108', 'EX11-062: rest by rule (not by effect) still gives the bird digimon DP +3000 (no draw)', async () => {
  const w = W({ p1: { battle: ['EX11-062', 'ST1-02'] }, p2: {} });
  const bird = w.p1.stacks[1]; const h0 = w.pl('p1').hand.length; const b = w.dp('p1', bird);
  S.restStack(w.st, 'p1', bird.uid, 'attack'); await w.drain();
  w.eq(w.dp('p1', bird) - b, 3000, 'DP +3000'); w.eq(w.pl('p1').hand.length, h0, 'no draw');
  return w;
});
// ---- Q6518/6519/6916: AD1-024 must un-rest itself, also without a rest target; once per turn spent by a non-effect arrival ----
scenario('G213', 'AD1-024: no opposing digimon to rest -> it is still activated', async () => {
  const w = W({ p1: { hand: [plain(3, 1)], battle: [{ id: 'AD1-024', susp: true }] }, p2: {} });
  await w.play('p1', plain(3, 1));
  w.eq(w.p1.stacks[0].suspended, false, 'AD1-024 active again');
  return w;
});
scenario('G109', 'AD1-024: it cannot decline the activation after resting an opposing digimon', async () => {
  const w = W({ p1: { hand: [plain(3, 1)], battle: [{ id: 'AD1-024', susp: true }] }, p2: { battle: [plain(3, 0)] } });
  w.answers.confirmEffect = () => false;
  await w.play('p1', plain(3, 1));
  w.eq(w.p2.stacks[0].suspended, true, 'opposing digimon rested'); w.eq(w.p1.stacks[0].suspended, false, 'AD1-024 activated');
  return w;
});
scenario('G110', 'AD1-024: [turn 1] is spent by a non-effect arrival -> second (effect) arrival does not trigger again', async () => {
  const w = W({ p1: { hand: [plain(3, 1), plain(3, 2)], battle: ['AD1-024'] }, p2: { battle: [plain(3, 0), plain(3, 3)] } });
  await w.play('p1', plain(3, 1)); await w.effPlay('p1', plain(3, 2));
  w.eq(w.fires('AD1-024', '서로의 턴'), 1, 'triggered once');
  return w;
});
// ---- Q6715: BT25-080 may return a digitama card, which goes to the bottom of the digitama deck ----
scenario('G122', 'BT25-080: a digitama card chosen from the trash goes to the bottom of the digitama deck', async () => {
  const w = W({ p1: { hand: ['BT25-080', plain(3, 1)], trash: ['BT24-007'] }, p2: {} });
  const dd = w.pl('p1').digitamaDeck.length;
  await w.play('p1', 'BT25-080');
  w.eq(w.pl('p1').digitamaDeck.length, dd + 1, 'digitama deck +1'); w.ok(!w.pl('p1').hand.includes('BT24-007'), 'not in hand');
  return w;
});
// ---- Q6743/Q6780/Q7210: assembly requires EACH listed level slot to satisfy the card condition ----
scenario('G141', 'EX12-017 assembly: every Lv slot must be a Grey/Agu-mon name or ME/VB trait card', async () => {
  const asm = S.parseAssembly('EX12-017'); const ok3 = [withType('VB', 5), withType('VB', 4), withType('VB', 3)];
  w0: { }
  const w = W({});
  w.ok(asm && S.solveAssembly(asm, ok3), 'all-matching pool satisfies the assembly');
  w.eq(S.solveAssembly(asm, [ok3[0], ok3[1], plain(3, 0)]), null, 'a non-matching Lv3 fails');
  return w;
});
scenario('G159', 'EX12-035 assembly: every Lv slot must match', async () => {
  const asm = S.parseAssembly('EX12-035'); const ok3 = [withType('VB', 5), withType('VB', 4), withType('VB', 3)];
  const w = W({});
  w.ok(asm && S.solveAssembly(asm, ok3), 'matching pool satisfies');
  w.eq(S.solveAssembly(asm, [ok3[0], plain(4, 0), ok3[2]]), null, 'a non-matching Lv4 fails');
  return w;
});
// ---- Q6721: EX12-026 grant lasts even if sources are added later ----
scenario('G147', 'EX12-026: attack/block ban stays on the target after it later gains sources', async () => {
  const w = W({ p1: { hand: ['EX12-026'] }, p2: { battle: [plain(3, 0)] } });
  await w.play('p1', 'EX12-026');
  const t = w.p2.stacks[0]; t.sources.push(plain(3, 1), plain(3, 2));
  w.ok(t.cannotAttackUntil != null && t.cannotAttackUntil !== 0, 'cannot attack flag kept'); w.ok(S.s3Flag(w.st, t, 'noBlock') || S.hookNoBlock(w.st, 'p2', t), 'cannot block flag kept');
  return w;
});
// ---- Q6758: EX12-028 needs the source-placing cost to be paid before devolve / memory ----
scenario('G148', 'EX12-028 both-turns effect: no DS card in hand -> no devolve and no memory', async () => {
  const opp = w0opp();
  const w = W({ p1: { battle: ['EX12-028'], hand: [plain(3, 1)] }, p2: { battle: [{ id: plain(3, 0), src: [plain(3, 1)] }] }, memory: 0 });
  await w.run('p1', w.p1.stacks[0].uid, '서로의 턴', { body: '자신의 패에서, 특징 「DS」를 가진 디지몬 카드 1장을 이 디지몬의 진화원 아래에 놓는 것으로, 상대의 디지몬 1마리를 《퇴화 1》. 또한, 메모리가 0 이하라면, 메모리 +1.' });
  w.eq(w.p2.stacks[0].sources.length, 1, 'no devolve'); w.eq(w.st.memory, 0, 'memory unchanged');
  return w;
});
function w0opp() { return null; }
// ---- Q6764/6766 EX12-030 inherited: cost is exactly 3 matching trash cards ----
scenario('G150', 'EX12-030 inherited: only 2 matching cards in trash -> the digimon stays rested', async () => {
  const ds = all.filter((c) => c.category === 'digimon' && (c.types || []).includes('DS')).slice(0, 3).map((c) => c.id);
  const w = W({ p1: { battle: [{ id: plain(3, 0), src: ['EX12-030'], susp: true }], trash: ds.slice(0, 2) }, p2: {} });
  await w.exec('p1', '자신의 트래시에서, 「젤리몬」이 기술되어 있거나 특징 「DS」를 가진 카드 3장을 덱 아래로 되돌리는 것으로, 이 디지몬을 액티브로 한다.', 'EX12-030', w.p1.stacks[0].uid, { tags: ['서로의 턴'], inherited: true });
  w.eq(w.p1.stacks[0].suspended, true, 'still rested'); w.eq(w.pl('p1').trash.length, 2, 'trash untouched');
  return w;
});
// ---- Q6818: EX12-047 needs 2 cards from the opponent trash ----
scenario('G178', 'EX12-047 on-play: only 1 card in opposing trash -> no DP change afterwards', async () => {
  const w = W({ p1: { battle: ['EX12-047'] }, p2: { battle: [plain(3, 0)], trash: [] } });
  const b = w.dp('p1', w.p1.stacks[0]);
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  w.eq(w.dp('p1', w.p1.stacks[0]), b, 'no +6000');
  return w;
});
// ---- Q6862/6863 EX12-064 same "not destroyed" logic as the level/DP variants ----
scenario('G197', 'EX12-064 on-play: a Lv<=4 opposing digimon must be destroyed (no devolve)', async () => {
  const w = W({ p1: { battle: ['EX12-064'] }, p2: { battle: [{ id: plain(4, 0), src: [plain(3, 1)] }] } });
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  w.eq(w.pl('p2').battle.length, 0, 'destroyed');
  return w;
});
scenario('G198', 'EX12-064 on-play: undestroyable Lv<=4 target still counts as chosen -> devolve happens', async () => {
  const w = W({ p1: { battle: ['EX12-064'] }, p2: { battle: [{ id: plain(4, 0), src: [plain(3, 1)] }] } });
  shieldDel(w, 'p2', w.p2.stacks[0]);
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  w.eq(w.p2.stacks[0].sources.length, 0, 'devolved (source removed)'); w.eq(w.pl('p2').battle.length, 1, 'still on field');
  return w;
});
// ---- Q6883/6886 EX12-070/071: no TB/SW card discarded -> no draw ----
scenario('G205', 'EX12-070 main: no TB card in hand -> no 2 draw', async () => {
  const w = W({ p1: { hand: [plain(3, 1)] }, p2: {} }); const d = w.pl('p1').deck.length;
  await w.runCard('p1', 'EX12-070', '메인');
  w.eq(w.pl('p1').deck.length, d, 'no draw');
  return w;
});
scenario('G208', 'EX12-071 main: no SW card in hand -> no 2 draw', async () => {
  const w = W({ p1: { hand: [plain(3, 1)] }, p2: {} }); const d = w.pl('p1').deck.length;
  await w.runCard('p1', 'EX12-071', '메인');
  w.eq(w.pl('p1').deck.length, d, 'no draw');
  return w;
});
// ---- Q6898/6899 EX12-077: two cards (hand + trash allowed) must be placed to destroy ----
scenario('G209', 'EX12-077 on-play: one VB card from hand and one from trash both placed -> opposing digimon destroyed', async () => {
  const w = W({ p1: { battle: ['EX12-077'], hand: ['EX12-040'], trash: ['EX12-042'] }, p2: { battle: [plain(3, 0)] } });
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  w.eq(w.pl('p2').battle.length, 0, 'destroyed');
  return w;
});
scenario('G210', 'EX12-077 on-play: only one matching card available -> nothing placed, no destroy', async () => {
  const w = W({ p1: { battle: ['EX12-077'], hand: ['EX12-040'], trash: [] }, p2: { battle: [plain(3, 0)] } });
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  w.eq(w.pl('p2').battle.length, 1, 'no destroy'); w.ok(w.pl('p1').hand.includes('EX12-040'), 'card stays in hand');
  return w;
});
// ---- Q6949-6951 BT26-060 "deck increased by own effect" watcher ----
scenario('G225', 'BT26-060: draw 1 then return a hand card to the deck bottom (deck count net 0) still triggers (Q6950)', async () => {
  const w = W({ p1: { battle: ['BT26-060'], hand: [plain(3, 1)] }, p2: { battle: [plain(3, 0)] } });
  await w.exec('p1', '자신의 패 1장을 덱 아래로 되돌리는 것으로, 《1 드로우》.', plain(3, 5));
  w.eq(w.pl('p2').battle.length, 0, 'opposing digimon destroyed');
  return w;
});
scenario('G226', 'BT26-060: own effect that increases the OPPONENT deck also triggers', async () => {
  const w = W({ p1: { battle: ['BT26-060'] }, p2: { battle: [plain(3, 0), plain(3, 3)] } });
  await w.exec('p1', '상대의 디지몬 1마리를 덱 아래로 되돌린다.', plain(3, 5));
  w.eq(w.pl('p2').battle.length, 0, 'one returned + one destroyed');
  return w;
});
// ---- Q7076: BT26-059 on the opponent turn: discard works, own-turn part does not ----
scenario('G273', 'BT26-059 on-play during the opponent turn: hand card discarded, no titan play', async () => {
  const w = W({ p1: { battle: ['BT26-059'], hand: [plain(3, 1)], trash: ['BT24-007'] }, p2: {}, active: 'p2' });
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  w.eq(w.pl('p1').hand.length, 0, 'hand card discarded'); w.eq(w.pl('p1').battle.length, 1, 'nothing played');
  return w;
});
// ---- Q7107: "opponent memory >= 5" means the opponent side of the memory gauge ----
scenario('G289', 'BT26-078 trash effect: "opponent memory 5+" = memory at the opponent side; own-side 5 does not qualify', async () => {
  const titan = 'BT25-080';
  const wOpp = W({ p1: { hand: [titan], trash: ['BT26-078'] }, p2: {}, memory: -5 });
  await wOpp.play('p1', titan);
  const wOwn = W({ p1: { hand: [titan], trash: ['BT26-078'] }, p2: {}, memory: 5 });
  await wOwn.play('p1', titan);
  wOpp.ok(!wOpp.pl('p1').trash.includes('BT26-078'), 'opponent-side 5 -> effect used (card left the trash)');
  wOpp.ok(wOwn.pl('p1').trash.includes('BT26-078'), 'own-side 5 -> not usable (card stays)');
  return wOpp;
});
// ---- Q7115: BT26-081 the DP reduction happens even if nothing was played ----
scenario('G294', 'BT26-081 on-play: nothing to play -> the DP reduction still applies', async () => {
  const w = W({ p1: { battle: ['BT26-081'] }, p2: { battle: [plain(5, 0)] } });
  const t = w.p2.stacks[0]; const b = w.dp('p2', t);
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  w.ok(w.dp('p2', t) < b, 'opposing digimon DP reduced anyway');
  return w;
});
// ---- Q7134: BT26-087 the memory / retrieval needs the trash TS digimon to be returned first ----
scenario('G304', 'BT26-087 main-phase start: no TS digimon in trash -> no memory, no Kyoshin retrieval', async () => {
  const w = W({ p1: { battle: ['BT26-087'], trash: [plain(3, 2)] }, p2: {}, memory: 0 });
  await w.run('p1', w.p1.stacks[0].uid, '자신의 메인 페이즈 개시 시');
  w.eq(w.st.memory, 0, 'memory unchanged'); w.ok(w.pl('p1').trash.includes(plain(3, 2)), 'trash card stays');
  return w;
});
// ---- Q7168: BT26-096 with the effect-play ban on the field the card cannot be played ----
scenario('G310', 'BT26-096 main: with an effect-play ban on the field the digimon is not played', async () => {
  const w = W({ p1: { battle: ['BT26-096'], hand: ['BT26-087'] }, p2: { battle: ['BT9-047'] } });
  await w.run('p1', w.p1.stacks[0].uid, '메인');
  w.ok(w.pl('p1').hand.includes('BT26-087') || !w.pl('p1').battle.some((s) => s.cardId === 'BT26-087'), 'tamer not played by effect');
  return w;
});
// ---- Q7182: BT26-101 rest of the effect works without the named tamer ----
scenario('G316', 'BT26-101 main: without Dan/Kanan tamer the later destroy option still works', async () => {
  const w = W({ p1: { battle: ['P-196'] }, p2: { battle: [plain(3, 0)] } });
  S.modifyDP(w.st, 'p1', w.p1.stacks[0].uid, 5000, 'turn');
  await w.runCard('p1', 'BT26-101', '메인');
  w.eq(w.pl('p2').battle.length, 0, 'opposing digimon (DP<=own TS digimon DP) destroyed');
  return w;
});
// ---- Q7195: BT26-029 the granted "sources do not return" does not stop the digimon itself from being bounced ----
scenario('G326', 'BT26-029 protected digimon can still be returned to hand by an opposing effect', async () => {
  const w = W({ p1: { battle: [{ id: 'BT26-029' }] }, p2: {} });
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  await w.exec('p2', '상대의 디지몬 1마리를 패로 되돌린다.', plain(3, 5));
  w.eq(w.pl('p1').battle.length, 0, 'digimon returned to hand');
  return w;
});
// ---- Q7215: EX12-065 keeps the 《길동무》 it got from the both-turns effect when destroyed in battle ----
scenario('G341', 'EX12-065 destroyed in battle still takes the opposing digimon along (길동무 from its own effect)', async () => {
  const w = W({ p1: { battle: ['EX12-065'] }, p2: { battle: [plain(6, 0)] }, active: 'p2' });
  const big = w.p2.stacks[0]; S.modifyDP(w.st, 'p2', big.uid, 8000, 'turn');
  const r = await w.attack('p2', big.uid, w.p1.stacks[0].uid);
  w.eq(w.pl('p1').battle.length, 0, 'EX12-065 destroyed'); w.eq(w.pl('p2').battle.length, 0, '길동무 destroyed the attacker');
  return w;
});
await run('slice6-c');
