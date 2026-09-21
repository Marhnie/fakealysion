// Slice-5 round 2: "A하는 것으로, B. 그 후/또한 C" — when the cost part A is not carried out, nothing after it resolves (Q5173, 5362, 5553, 5663 and the identical rulings of the other cost-then cards).
// Scenario: the tamer's main-phase-start effect (return this tamer to the deck bottom -> play the same-named tamer from hand, then more): decline => board/hand/deck unchanged; accept => tamer replaced (control).
import { S, E, newBoard, stk, mkChoose, scenario, report, F3, runOn } from './lib5.mjs';
const sig = (st) => JSON.stringify([st.memory, ['p1', 'p2'].map(p => { const pl = st.players[p]; return [pl.hand.length, pl.deck.length, pl.trash.length, pl.security.length, pl.battle.map(s => [s.cardId, !!s.suspended, s.sources.length])]; })]);
for (const [h, q] of [['EX10-063', 5173], ['BT23-087', 5362], ['BT20-085', 5553], ['BT24-082', 5663]]) {
  await scenario(q, `${h}: declining the "return this tamer to deck bottom" cost -> nothing after it resolves; paying does`, async (chk) => {
    const mk = () => newBoard({ turn: 3, memory: 3, p1: { battle: [h, F3[0]], hand: [h, F3[5]], deck: F3.slice(6, 12) }, p2: { battle: [F3[1]] } });
    let st = mk(); const s0 = sig(st);
    await runOn(st, 'p1', h, 'mainPhaseStart', { confirm: false, answer: (k) => (k === 'pickFromHandIndexes' ? [] : k === 'pickFromZoneIndex' ? null : k === 'pickStack' ? null : undefined) });
    chk(sig(st) === s0, 'declined: state must be unchanged');
    st = mk(); const s1 = sig(st);
    await runOn(st, 'p1', h, 'mainPhaseStart', { confirm: true });
    chk(sig(st) !== s1, 'control: accepting changes the state (setup exercised)');
  });
}
// second half ("또한/그 후, 자신의 디지몬이 없다면, 트래시에서 …") must not run either when the cost was declined (no own digimon; target in the trash)
const nameId = (n) => Object.values(S.CARDS).find(c => c.category === 'digimon' && c.nameKo === n)?.id;
const bird = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.level === 3 && (c.types || []).some(t => /조|새|병아리/.test(t)))?.id;
for (const [h, tgt, q] of [['EX10-063', nameId('샌드리자몬'), 5173], ['BT23-087', nameId('아이고스몬'), 5362], ['BT20-085', bird, 5553], ['BT24-082', nameId('엘리자몬'), 5663]]) {
  await scenario(q, `${h}: with no own digimon and a target in the trash, declining the cost also blocks the trash-play part`, async (chk) => {
    if (!tgt) { chk(false, 'fixture missing'); return; }
    const mk = () => newBoard({ turn: 3, memory: 3, p1: { battle: [h], hand: [h], trash: [tgt], deck: F3.slice(6, 12) }, p2: { battle: [F3[1]] } });
    let st = mk(); const s0 = sig(st);
    await runOn(st, 'p1', h, 'mainPhaseStart', { confirm: false, answer: (k) => (k === 'pickFromHandIndexes' ? [] : k === 'pickFromZoneIndex' ? null : k === 'pickStack' ? null : undefined) });
    chk(sig(st) === s0, 'declined: unchanged'); chk(!st.players.p1.battle.some(s => s.cardId === tgt), 'trash target must not have been played');
  });
}
// Q5554/5558/5559/5560/5569/5664/5743 (main-phase-start) and Q5667/5679 (turn-start): the copy played by the effect does NOT get its own start-of-phase trigger this phase.
for (const [h, evt, memory] of [['BT20-085', 'mainPhaseStart', 3], ['BT22-086', 'mainPhaseStart', 3], ['BT22-088', 'mainPhaseStart', 3], ['BT22-089', 'mainPhaseStart', 3], ['BT23-087', 'mainPhaseStart', 3], ['BT24-082', 'mainPhaseStart', 3], ['EX10-063', 'mainPhaseStart', 3]]) { // (BT24-083/088 turn-start: only a same-named copy has such a trigger; the hand/trash fixtures for their digimon-only clause are not built)
  await scenario('5554 family', `${h}: the copy played by the ${evt} effect does not run its own ${evt} trigger this phase`, async (chk) => {
    const st = newBoard({ turn: 3, memory, p1: { battle: [h, F3[0]], hand: [h === 'BT22-089' ? 'BT22-083' : h, F3[5]], trash: [h], deck: F3.slice(6, 12) }, p2: { battle: [F3[1]] } });
    const r = await runOn(st, 'p1', h, evt, { confirm: true });
    chk(st.players.p1.battle.some(s => s.cardId === (h === 'BT22-089' ? 'BT22-083' : h)), 'the card was played');
    const played = h === 'BT22-089' ? 'BT22-083' : h; const n = r.ran.filter(x => x.startsWith(played) && /개시 시/.test(x)).length;
    chk(n === (played === h ? 1 : 0), `start trigger of ${played} ran ${n} times: ${r.ran.join(' ; ')}`);
    chk(!st.pending.some(t => !t.resolved && t.cardId === (h === 'BT22-089' ? 'BT22-083' : h) && t.tags.some(g => /개시 시/.test(g))), 'no pending start trigger left for the new copy');
  });
}
report();
