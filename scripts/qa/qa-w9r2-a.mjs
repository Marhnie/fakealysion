// W9 round-2 re-verification (Q&A idx 5336-6002), part A: BT25 TS cards.  Run: node scripts/qa/qa-w9r2-a.mjs < /dev/null
import { S, E, Fx, C, plain, W, scenario, run } from './lib-s6.mjs';
const shieldDel = (w, p, s) => S.grantShield(w.st, p, s.uid, { kinds: ['delete'] });
const plainTamer = () => 'BT24-102'; // any tamer id (cards_full.json currently has no effect-less tamer)
const lowDp = plain(3, 0, { dp: 3000 });
// ---- #5469-5471 BT25-014 메라몬 【메인】: pay a TS/화염형 hand card; destroy DP<=4000 (mandatory if one exists); "if not destroyed" -> 2 draw ----
scenario('W9-5469', 'BT25-014 main: no eligible opponent digimon -> effect still usable, draws 2', async () => {
  const w = W({ p1: { battle: ['BT25-014'], hand: ['BT25-009'] }, p2: {}, memory: 10 });
  await w.run('p1', w.p1.stacks[0].uid, '메인');
  w.eq(w.pl('p1').hand.length, 2, 'discarded 1, drew 2');
  return w;
});
scenario('W9-5470', 'BT25-014 main: an eligible DP<=4000 digimon must be destroyed -> no draw', async () => {
  const w = W({ p1: { battle: ['BT25-014'], hand: ['BT25-009'] }, p2: { battle: [lowDp] }, memory: 10 });
  await w.run('p1', w.p1.stacks[0].uid, '메인');
  w.eq(w.pl('p2').battle.length, 0, 'destroyed'); w.eq(w.pl('p1').hand.length, 0, 'discarded 1, no draw');
  return w;
});
scenario('W9-5471', "BT25-014 main: choosing a can't-be-destroyed DP<=4000 digimon -> not destroyed -> draws 2", async () => {
  const w = W({ p1: { battle: ['BT25-014'], hand: ['BT25-009'] }, p2: { battle: [lowDp] }, memory: 10 });
  shieldDel(w, 'p2', w.p2.stacks[0]);
  await w.run('p1', w.p1.stacks[0].uid, '메인');
  w.eq(w.pl('p2').battle.length, 1, 'survives'); w.eq(w.pl('p1').hand.length, 2, 'drew 2');
  return w;
});
// ---- #5584/5585 BT25-076 데스몬 / #5648 BT25-093: lowest-cost (DP) digimon MUST be picked; "if not destroyed" holds when the picked one can't be destroyed ----
scenario('W9-5584', 'BT25-076 on-play: destroys the lowest-cost opposing digimon (no free choice); security untouched', async () => {
  const w = W({ p1: { battle: ['BT25-076'] }, p2: { battle: ['ST1-05', 'ST1-02'] }, memory: 10 });
  const sec = w.pl('p2').security.length;
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  w.eq(w.pl('p2').battle.map((s) => s.cardId), ['ST1-05'], 'only the cost-2 digimon destroyed');
  w.eq(w.pl('p2').security.length, sec, 'no security discard');
  return w;
});
scenario('W9-5585', 'BT25-076 on-play: lowest-cost digimon is undestroyable -> "not destroyed" -> top security discarded', async () => {
  const w = W({ p1: { battle: ['BT25-076'] }, p2: { battle: ['ST1-05', 'ST1-02'] }, memory: 10 });
  shieldDel(w, 'p2', w.p2.stacks[1]);
  const sec = w.pl('p2').security.length;
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  w.eq(w.pl('p2').battle.length, 2, 'nothing destroyed');
  w.eq(w.pl('p2').security.length, sec - 1, 'security -1');
  return w;
});
scenario('W9-5648', 'BT25-093 main: destroys ALL lowest-DP opposing digimon', async () => {
  const w = W({ p1: { battle: ['BT25-009'], hand: ['BT25-093'] }, p2: { battle: ['ST1-02', 'ST1-02', 'ST1-04'] }, memory: 10 });
  await w.useOption('p1', 'BT25-093');
  w.eq(w.pl('p2').battle.map((s) => s.cardId), ['ST1-04'], 'both 3000-DP digimon destroyed');
  return w;
});
// ---- #5586-5589 BT25-077 바쿠스몬 【서로의 턴】[턴 1회] ----
scenario('W9-5587', 'BT25-077: works even when every digimon is already rested (rest is only a "can")', async () => {
  const w = W({ p1: { battle: [{ id: 'BT25-077', susp: true }], hand: ['ST1-02'] }, p2: { battle: ['ST1-04'] }, memory: 10 });
  await w.effPlay('p1', 'ST1-02');
  w.eq(w.pl('p2').battle.length, 0, 'opposing digimon destroyed by the effect-arrival');
  return w;
});
scenario('W9-5588', 'BT25-077: [턴 1회] spent by a non-effect arrival -> a later effect-arrival does nothing', async () => {
  const w = W({ p1: { battle: ['BT25-077'], hand: ['ST1-02', 'ST1-02'] }, p2: { battle: ['ST1-04', 'ST1-05'] }, memory: 10 });
  await w.play('p1', 'ST1-02'); await w.effPlay('p1', 'ST1-02');
  w.eq(w.pl('p2').battle.length, 2, 'no destroy at all (first arrival not by effect, second blocked by [턴 1회])');
  return w;
});
scenario('W9-5589', 'BT25-077: effect-arrival -> the lowest-DP opposing digimon is destroyed even if the player declines the rest', async () => {
  const w = W({ p1: { battle: ['BT25-077'], hand: ['ST1-02'] }, p2: { battle: ['ST1-04'] }, memory: 10 });
  w.answers.confirmEffect = () => false; w.answers.pickStackAnySide = () => null;
  await w.effPlay('p1', 'ST1-02');
  w.eq(w.pl('p2').battle.length, 0, 'destroyed regardless');
  return w;
});
// ---- #5593-5596 BT25-080 위치몬 ----
scenario('W9-5593', 'BT25-080 on-play: no hand card to discard -> nothing after it is processed', async () => {
  const w = W({ p1: { battle: ['BT25-080'], hand: [], trash: ['BT25-084'] }, p2: { battle: ['ST1-04'] }, memory: 10 });
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  w.eq(w.pl('p1').hand.length, 0, 'nothing returned'); w.eq(w.pl('p2').battle.length, 1, 'no destroy');
  return w;
});
scenario('W9-5596', 'BT25-080 arrived by effect: after discarding, the Lv<=5 opposing digimon is destroyed (cannot be declined)', async () => {
  const w = W({ p1: { hand: ['BT25-080', 'ST1-02'], trash: ['BT25-084'] }, p2: { battle: ['ST1-04'] }, memory: 10 });
  await w.effPlay('p1', 'BT25-080');
  w.eq(w.pl('p2').battle.length, 0, 'destroyed');
  return w;
});
// ---- #5611/#5612 hand-discard watcher (BT25-084 2nd 【서로의 턴】): one trigger per discard ACTION, not per card ----
scenario('W9-5611', 'BT25-084: two separate "discard 1" actions -> two triggers', async () => {
  const w = W({ p1: { battle: ['BT25-084'], hand: ['ST1-02', 'ST1-02', 'ST1-02'] }, p2: { battle: ['ST1-02', 'ST1-02', 'ST1-04'] }, memory: 10 });
  await w.exec('p1', '자신의 패를 1장 파기한다.', plainTamer()); await w.exec('p1', '자신의 패를 1장 파기한다.', plainTamer());
  w.eq(w.pl('p2').battle.length, 1, 'two destroyed');
  return w;
});
scenario('W9-5612', 'BT25-084: one "discard 2" action -> only one trigger', async () => {
  const w = W({ p1: { battle: ['BT25-084'], hand: ['ST1-02', 'ST1-02', 'ST1-02'] }, p2: { battle: ['ST1-02', 'ST1-02', 'ST1-04'] }, memory: 10 });
  await w.exec('p1', '자신의 패를 2장 파기한다.', plainTamer());
  w.eq(w.pl('p2').battle.length, 2, 'one destroyed');
  return w;
});
// ---- #5597 BT25-081 팡그몬: the non-purple tamer is rested unconditionally ----
scenario('W9-5597', 'BT25-081 on-play: rests a non-purple tamer (mandatory)', async () => {
  const t = plainTamer(); const col = C(t).colors || [];
  const w = W({ p1: { battle: ['BT25-081', t] }, p2: {}, memory: 10 });
  w.answers.confirmEffect = () => false;
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  w.eq(col.includes('purple') ? true : w.p1.stacks[1].suspended, true, 'tamer rested');
  return w;
});
// ---- #5617/5618 BT25-086 유우키 단 ----
scenario('W9-5617', 'BT25-086 turn end: memory on the opponent side 5 -> DP +5000', async () => {
  const w = W({ p1: { battle: ['BT25-086', 'BT25-009'] }, p2: {}, memory: -5 });
  const b = w.dp('p1', w.p1.stacks[1]);
  await w.run('p1', w.p1.stacks[0].uid, '자신의 턴 종료 시');
  w.eq(w.dp('p1', w.p1.stacks[1]) - b, 5000, 'DP +5000');
  return w;
});
scenario('W9-5618', 'BT25-086 turn end: tamer already rested -> no DP, no attack', async () => {
  const w = W({ p1: { battle: [{ id: 'BT25-086', susp: true }, 'BT25-009'] }, p2: {}, memory: -5 });
  const b = w.dp('p1', w.p1.stacks[1]);
  await w.run('p1', w.p1.stacks[0].uid, '자신의 턴 종료 시');
  w.eq(w.dp('p1', w.p1.stacks[1]) - b, 0, 'no DP change'); w.eq((w.attackReqs || []).length, 0, 'no attack');
  return w;
});
// ---- #5641/5642 BT25-091 모니카 ----
scenario('W9-5641', 'BT25-091 on-play: declining the trash-return -> draw 1', async () => {
  const w = W({ p1: { hand: ['BT25-091'], trash: ['BT25-093'] }, p2: {}, memory: 10 });
  w.answers.confirmEffect = () => false; w.answers.pickFromZoneIndex = () => null;
  await w.play('p1', 'BT25-091');
  w.eq(w.pl('p1').hand.length, 1, 'drew 1'); w.ok(w.pl('p1').trash.includes('BT25-093'), 'option stayed in trash');
  return w;
});
scenario('W9-5642', 'BT25-091 on-play: no TS option in trash -> draw 1', async () => {
  const w = W({ p1: { hand: ['BT25-091'], trash: [] }, p2: {}, memory: 10 });
  await w.play('p1', 'BT25-091');
  w.eq(w.pl('p1').hand.length, 1, 'drew 1');
  return w;
});
await run('w9r2-a');
