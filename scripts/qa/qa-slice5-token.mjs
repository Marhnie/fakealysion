// Slice-5 official Q&A: tokens have no play cost -> "가장 등장 코스트가 높은 ... 1장을 고르고, 고른 것 이외 전부 소멸" with only cost-less opp digimon: nothing can be chosen, ALL are deleted (Q5796 EX11-011, 5895 EX11-046).
import { S, E, newBoard, stk, mkChoose, drain, scenario, report, F3, fillerLv, nm, runOn, zoneNames } from './lib5.mjs';
const tokenStack = (st, p) => { const tid = 'TOKEN-QA5'; if (!S.CARDS[tid]) S.CARDS[tid] = { id: tid, cardId: tid, nameKo: 'QA토큰', category: 'digimon', level: null, cost: 0, dp: 3000, colors: ['white'], types: [], effectKo: '', inheritedKo: '', isToken: true, evoNormal: null }; const s2 = S._s4.makeStack(tid, 1); s2.attackEligibleTurn = 0; st.players[p].battle.push(s2); return s2; };
const c5 = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.level <= 5 && !c.effectKo && !c.inheritedKo && c.cost === 5).id;
for (const [id, evt, q] of [['EX11-046', 'play', '5895'], ['EX11-011', 'play', '5796']]) {
  await scenario(q, `${id}: only token (cost-less) opp digimon -> all deleted; with a costed one -> only the costed one survives`, async (chk) => {
    let st = newBoard({ p1: { battle: [id] }, p2: { battle: [] } }); tokenStack(st, 'p2'); tokenStack(st, 'p2');
    await runOn(st, 'p1', id, evt, { answer: (k) => (k === 'confirmEffect' ? false : undefined) });
    chk(st.players.p2.battle.length === 0, 'tokens only: all deleted, left ' + st.players.p2.battle.length);
    st = newBoard({ p1: { battle: [id] }, p2: { battle: [c5] } }); tokenStack(st, 'p2');
    await runOn(st, 'p1', id, evt, { answer: (k) => (k === 'confirmEffect' ? false : undefined) });
    chk(st.players.p2.battle.length === 1 && st.players.p2.battle[0].cardId === c5, 'costed survives, token deleted: ' + zoneNames(st, 'p2', 'battle'));
  });
}
report();
