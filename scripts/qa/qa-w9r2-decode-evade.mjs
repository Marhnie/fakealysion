// W9 round-2 fix (official Q6515/Q6516 EX11-018, Q6783/Q6784 EX12-035, Q6788/Q6789 EX12-036): ≪디코드≫ and ≪회피≫ trigger at the same leave moment.
//  - the ≪디코드≫ source is still played when ≪회피≫ (rest) keeps the digimon in the battle area  (Q6516: "≪회피≫ first, then ≪디코드≫ — yes")
//  - if the digimon is still at DP 0 the next rule check attempts to delete it again and ≪디코드≫ can be used again (Q6515)
// Before the fix ≪디코드≫ was only performed when the stack really left, so a surviving digimon never decoded.
// Run: node scripts/qa/qa-w9r2-decode-evade.mjs < /dev/null
import { S, C, W, scenario, run } from './lib-s6.mjs';
const AQ = 'BT2-024'; // Lv4 「수생」 digimon (DP 4000) = a legal decode target for EX11-018 (특징에 「수생」을 포함하는 Lv.5 이하)
for (const id of ['EX11-018']) {
  scenario('W9-6515-' + id, `${id}: DP 0 -> ≪회피≫ keeps it and ≪디코드≫ plays a source; second check: ≪디코드≫ again, then it is deleted`, async () => {
    const w = W({ p1: { battle: [{ id, src: [AQ, AQ] }] }, p2: {}, memory: 10 });
    const s = w.p1.stacks[0];
    S.modifyDP(w.st, 'p1', s.uid, -20000, 'turn'); await w.drain();
    w.eq(w.pl('p1').battle.filter((x) => x.cardId === AQ).length, 2, 'both sources ended up in play (one per leave attempt)');
    w.eq(w.pl('p1').trash.length, 1, 'only the deleted top card is in the trash');
    w.eq(w.pl('p1').battle.some((x) => x.cardId === id), false, 'the digimon itself is gone after the second check');
    return w;
  });
  scenario('W9-6516-' + id, `${id}: ≪회피≫ saves it from an effect deletion and the ≪디코드≫ source is still played`, async () => {
    const w = W({ p1: { battle: [{ id, src: [AQ] }] }, p2: { battle: ['ST1-02'] }, memory: 10 });
    const s = w.p1.stacks[0];
    S.deleteStack(w.st, 'p1', s.uid, 'trash', 'effect'); await w.drain();
    w.eq(w.pl('p1').battle.some((x) => x.cardId === id), true, 'survived via ≪회피≫ (rested)');
    w.eq(s.suspended, true, 'rested');
    w.eq(w.pl('p1').battle.filter((x) => x.cardId === AQ).length, 1, 'decode source played');
    return w;
  });
  scenario('W9-decode-battle-' + id, `${id}: ≪디코드≫ does not work on a battle deletion (unchanged)`, async () => {
    const w = W({ p1: { battle: [{ id, src: [AQ], susp: true }] }, p2: {}, memory: 10 });
    const s = w.p1.stacks[0];
    S.deleteStack(w.st, 'p1', s.uid, 'trash', 'battle'); await w.drain();
    w.eq(w.pl('p1').battle.filter((x) => x.cardId === AQ).length, 0, 'no decode after a battle deletion');
    return w;
  });
}
// ---- Q6735/Q6738 「XXの、AAかBB」: EX12-014/016/017/031/032/035/036 ≪디코드≫ conditions were parsed as AND (name AND trait) so no source ever qualified ----
for (const [label, src, ok] of [['name alternative (Lv.3 아구몬)', 'ST1-03', true], ['trait alternative (Lv.3 ME)', 'EX12-053', true], ['neither', 'ST1-02', false], ['name alternative but Lv.5 (over the Lv.4 limit)', 'ST1-09', false]]) {
  scenario('W9-6735-' + label, `EX12-016 ≪디코드≫ 「Lv.4 이하의, 명칭에 「아구몬」/「그레이몬」을 포함하거나 특징 「ME」/「VB」」: ${label} -> ${ok ? 'eligible' : 'not eligible'}`, async () => {
    const w = W({ p1: { battle: [{ id: 'EX12-016', src: [src] }] }, p2: {}, memory: 10 });
    const plays = S.extractLeaveSourcePlays(w.st, 'p1', w.p1.stacks[0], 'effect');
    w.eq(plays.length > 0, ok, 'decode source found');
    return w;
  });
}
// ---- Q6743/Q6780 EX12-017/035 + EX12-016 assembly: each slot may be matched by the NAME alternative or the bare 「특징 「ME」/「VB」」 alternative (the bare trait alternative was dropped by the parser) ----
for (const [label, id, tr, ok] of [
  ['EX12-016 assembly: Lv.4 ME/VB card (trait alternative)', 'EX12-016', ['EX12-054'], true],
  ['EX12-016 assembly: Lv.3 아구몬 (name alternative)', 'EX12-016', ['ST1-03'], true],
  ['EX12-016 assembly: Lv.5 over the Lv.4 limit', 'EX12-016', ['ST1-09'], false],
  ['EX12-017 assembly Lv.5xLv.4xLv.3 all via ME/VB or names', 'EX12-017', ['EX12-016', 'EX12-054', 'EX12-053'], true],
  ['EX12-017 assembly: the Lv.4 slot has no matching card', 'EX12-017', ['EX12-016', 'ST1-05', 'EX12-053'], false],
]) {
  scenario('W9-6743-' + label, label + ' -> ' + (ok ? 'possible' : 'impossible'), async () => {
    const w = W({ p1: { hand: [id], trash: tr }, p2: {}, memory: 12 });
    w.eq(!!S.planAssembly(w.st, 'p1', 0), ok, 'assembly plan');
    return w;
  });
}
await run('w9r2-decode-evade');
