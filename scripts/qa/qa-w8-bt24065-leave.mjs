// W8 recheck (Q5644-5646 BT24-065 ディアボロモンX抗体 【서로의 턴】): "명칭에 「디아블로몬」을 포함하는 자신의 디지몬이 벗어날 때, 패나 진화원에서 「디아블로몬」 1장을 코스트 없이 등장" was never wired.
// Immediate-type (passive candidate of the 18-2 gate): plays BEFORE the leave; the leave still happens; a freshly played 「디아블로몬」 can be the sacrifice of BT22-053's inherited "벗어나지 않는다" (Q5644);
// [턴에 1회] + 1장 = only one card even if several leave together (Q5645).
import { S, E, newBoard, stk, mkChoose, drain, scenario, report, F3, zoneNames } from './lib5.mjs';
const dia = 'P-016'; // a plain 「디아블로몬」 digimon card
const resume = (st, idx = 0) => { const e = (st.pendingReplacements || [])[0]; if (!e) return false; S.resumeReplacement(st, e, idx); return true; };
await scenario('5644', 'BT24-065 (with BT22-053 source) leaving: play 디아블로몬 from hand first, then BT22-053 sacrifices it and the holder stays', async (chk) => {
  S.REPL.interactive = true;
  try {
    const st = newBoard({ p1: { battle: [{ id: 'BT24-065', src: ['BT22-053'] }], hand: [dia] }, p2: { battle: [F3[0]] }, memory: 3, active: 'p2', turn: 4 });
    const h = st.players.p1.battle[0]; st._fxSrc = { player: 'p2' };
    S.deleteStack(st, 'p1', h.uid, 'trash', 'effect');
    chk((st.pendingReplacements || []).length === 1, 'a replacement prompt (play 디아블로몬 / decline) must be offered');
    resume(st, 0); // use the BT24-065 effect
    chk(st.players.p1.battle.some(s => s.cardId === dia), '디아블로몬 played from hand: ' + zoneNames(st, 'p1', 'battle'));
    resume(st, 0); // now BT22-053's sacrifice
    chk(st.players.p1.battle.includes(h), 'holder survives via BT22-053 (sacrificing the fresh 디아블로몬): ' + zoneNames(st, 'p1', 'battle'));
  } finally { S.REPL.interactive = false; }
});
await scenario('5645', 'two 디아블로몬-named digimon leaving together: [턴에 1회] -> only one 디아블로몬 is played', async (chk) => {
  S.REPL.interactive = true;
  try {
    const st = newBoard({ p1: { battle: ['BT24-065', dia, 'P-016'], hand: [dia, dia] }, p2: { battle: [F3[0]] }, memory: 3, active: 'p2', turn: 4 });
    st._fxSrc = { player: 'p2' };
    const targets = st.players.p1.battle.filter(s => s.cardId === dia).map(s => s.uid);
    const before = st.players.p1.hand.length;
    for (const u of targets) { S.deleteStack(st, 'p1', u, 'trash', 'effect'); while (resume(st, 0)) { /* use every offered candidate */ } }
    chk(st.players.p1.hand.length === before - 1, 'exactly one hand card played, hand ' + before + ' -> ' + st.players.p1.hand.length);
  } finally { S.REPL.interactive = false; }
});
report();
