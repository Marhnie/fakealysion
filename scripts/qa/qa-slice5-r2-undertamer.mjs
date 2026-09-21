// Slice-5 round 2: cards placed under a tamer go to the very bottom of the existing under-cards (Q5174/6170/6181/6186/6190/6198/6202/6207/6217/6224/6228),
// and trashing under-cards leaves the rest intact (Q6173 family: the discarded face-down cards end up in the trash).
import { S, E, newBoard, stk, mkChoose, scenario, report, F3, runOn, fillerLv } from './lib5.mjs';
const T1 = 'ST23-13', T2 = 'ST24-13';
const byTrait = (t, n = 0) => Object.values(S.CARDS).filter(c => c.category === 'digimon' && (c.types || []).includes(t))[n].id; const VAG = byTrait('바그라군'), SAV = byTrait('세이버즈'), SAV2 = byTrait('세이버즈', 1);
const cases = [['EX10-064', 'mainPhaseStart', 5174], ['ST23-06', 'play', 6170], ['ST23-06', 'move', 6170], ['ST23-10', 'play', 6181], ['ST23-13', 'mainPhaseStart', 6186], ['ST23-13', 'play', 6186], ['ST23-14', 'mainPhaseStart', 6190], ['ST23-14', 'play', 6190],
  ['ST24-02', 'play', 6198], ['ST24-03', 'play', 6202], ['ST24-03', 'digivolve', 6202], ['ST24-04', 'play', 6207], ['ST24-09', 'play', 6217], ['ST24-13', 'mainPhaseStart', 6224], ['ST24-13', 'play', 6224], ['ST24-14', 'mainPhaseStart', 6228], ['ST24-14', 'play', 6228]];
for (const [h, evt, q] of cases) {
  await scenario(q, `${h} (${evt}): a card placed under a tamer goes below the existing under-cards`, async (chk) => {
    const c = S.card(h);
    const battle = c.category === 'tamer' ? [h] : [h];
    const st = newBoard({ turn: 3, memory: 5, p1: { battle: [...battle, ...(c.category === 'tamer' ? [] : [])], hand: [...F3.slice(20, 26), VAG], trash: F3.slice(26, 32), deck: [SAV, SAV2, ...F3.slice(32, 40)] }, p2: { battle: [F3[0]] } });
    const tamers = [];
    for (const t of [T1, T2]) if (t !== h) { const tk = require_add(st, t); tamers.push(tk); }
    function require_add(st, id) { const p = st.players.p1; const s = S._s4.makeStack(id, 1); s.attackEligibleTurn = 0; s.placedTurn = 0; p.battle.push(s); return s; }
    const before = new Map(); for (const s of st.players.p1.battle) if (S.card(s.cardId).category === 'tamer') { s.sources.unshift(F3[10], F3[11]); s.s5fd = 2; before.set(s.uid, [...s.sources]); }
    await runOn(st, 'p1', h, evt, {});
    let exercised = false;
    for (const s of st.players.p1.battle) { if (!before.has(s.uid)) continue; const old = before.get(s.uid); if (s.sources.length > old.length) { exercised = true;
      const added = s.sources.length - old.length;
      chk(JSON.stringify(s.sources.slice(added)) === JSON.stringify(old), `${S.card(s.cardId).nameKo}: old under-cards must stay in order above the new bottom cards: ${JSON.stringify(s.sources)} vs old ${JSON.stringify(old)}`); } }
    chk(exercised, 'scenario did not place a card under any tamer (setup not exercised)');
  });
}
// Q6211: ST24-06's cost ("아래에서부터 2장 파기") cannot be paid with only 1 under-card -> nothing else resolves. Q6212: 2 cards across two tamers may pay it. Q6173-family: discarded face-down under-cards land in the trash.
const sav = Object.values(S.CARDS).filter(c => c.category === 'digimon' && (c.types || []).includes('세이버즈') && c.cost != null && c.cost <= 5 && c.level === 3).sort((a, b) => a.cost - b.cost)[0]?.id;
const mkT = (st, id, under) => { const s = S._s4.makeStack(id, 1); s.attackEligibleTurn = 0; s.placedTurn = 0; s.sources.unshift(...under); s.s5fd = under.length; st.players.p1.battle.push(s); return s; };
for (const [n, under1, under2, q] of [['one card only', [F3[10]], [], '6211'], ['2 cards on one tamer', [F3[10], F3[11]], [], '6173 family'], ['1+1 across two tamers', [F3[10]], [F3[11]], '6212']]) {
  await scenario(q, `ST24-06 cost with under-cards (${n})`, async (chk) => {
    const st = newBoard({ turn: 3, memory: 5, p1: { battle: ['ST24-06'], hand: [sav] }, p2: { battle: [F3[0]] } });
    const a = mkT(st, 'ST24-13', under1); const b = under2.length ? mkT(st, 'ST24-14', under2) : null;
    await runOn(st, 'p1', 'ST24-06', 'play', {});
    const paid = under1.length + under2.length >= 2, played = st.players.p1.battle.some(s => s.cardId === sav);
    chk(played === paid, `card played=${played}, expected ${paid}`);
    const left = a.sources.length + (b ? b.sources.length : 0);
    if (paid) { chk(left === under1.length + under2.length - 2, 'exactly 2 under-cards removed: left ' + left); chk(F3[10] && st.players.p1.trash.includes(F3[10]) || st.players.p1.trash.includes(F3[11]), 'discarded under-cards are in the trash'); }
    else chk(left === under1.length, 'cost not payable: nothing discarded');
  });
}
report();
