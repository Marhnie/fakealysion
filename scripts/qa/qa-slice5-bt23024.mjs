// Slice-5 official Q&A: BT23-024 【서로의 턴】 rest lock on all opp digimon except the highest-cost one (Q5247-5252, 6025, 6026). Re-evaluated continuously.
import { S, E, newBoard, stk, mkChoose, drain, scenario, report, F3, nm } from './lib5.mjs';
const byCost = (n, k = 0) => Object.values(S.CARDS).filter(c => c.category === 'digimon' && c.level <= 5 && !c.effectKo && !c.inheritedKo && c.cost === n)[k].id;
async function armed(oppIds) {
  const st = newBoard({ p1: { battle: [{ id: 'BT23-024', rested: true }] }, p2: { battle: oppIds }, active: 'p1' });
  const h = stk(st, 'p1', 'BT23-024'); S.linkCardTo(st, 'p1', h.uid, 'BT23-028', null, 0, 'trash'); await drain(st, mkChoose(st));
  return st;
}
const canRest = (st, uid) => { const s = st.players.p2.battle.find(x => x.uid === uid); const before = s.suspended; s.suspended = false; S.restStack(st, 'p2', uid, 'effect'); const r = !!s.suspended; s.suspended = false; return r; };
await scenario(5247, 'two opp digimon (cost5, cost6): only the cost-5 one cannot rest', async (chk) => {
  const st = await armed([byCost(5), byCost(6)]); const [a, b] = st.players.p2.battle;
  chk(!canRest(st, a.uid), 'cost5 must be locked'); chk(canRest(st, b.uid), 'cost6 (highest) may rest');
  chk(!stk(st, 'p1', 'BT23-024').suspended, 'BT23-024 became active (cost of the effect)');
});
await scenario(5248, 'single opp digimon may rest', async (chk) => { const st = await armed([byCost(5)]); chk(canRest(st, st.players.p2.battle[0].uid), 'sole digimon is the highest'); });
await scenario(5249, 'two tied at cost 5 may both rest', async (chk) => { const st = await armed([byCost(5, 0), byCost(5, 1)]); chk(st.players.p2.battle.every(s => canRest(st, s.uid)), 'both tied'); });
await scenario(5250, 'a costlier digimon appears later: the former highest is now locked', async (chk) => {
  const st = await armed([byCost(5)]); S.playFreeFromZone ? null : null; st.players.p2.hand.push(byCost(6)); const n = S.playDigimonFresh(st, 'p2', st.players.p2.hand.length - 1); st.pending.length = 0;
  const five = st.players.p2.battle.find(s => S.card(s.cardId).cost === 5); chk(!canRest(st, five.uid), 'cost5 locked after cost6 arrived');
});
await scenario(5251, 'one of two evolves to a costlier card: the other becomes locked', async (chk) => {
  const st = await armed([byCost(5, 0), byCost(5, 1)]); const [a, b] = st.players.p2.battle;
  st.players.p2.hand.push(byCost(6)); S.digivolve(st, 'p2', a.uid, byCost(6), 0, 'hand'); st.pending.length = 0;
  chk(!canRest(st, b.uid), 'other cost5 locked'); chk(canRest(st, a.uid), 'evolved costlier one free');
});
await scenario(5252, 'the costliest leaves: the remaining lower one is free again', async (chk) => {
  const st = await armed([byCost(5), byCost(6)]); const [a, b] = st.players.p2.battle; S.deleteStack(st, 'p2', b.uid, 'trash', 'effect'); st.pending.length = 0;
  chk(canRest(st, a.uid), 'cost5 free once cost6 gone');
});
const tokenStack = (st, p) => { const tid = 'TOKEN-QA5'; if (!S.CARDS[tid]) S.CARDS[tid] = { id: tid, cardId: tid, nameKo: 'QA토큰', category: 'digimon', level: null, cost: 0, dp: 3000, colors: ['white'], types: [], effectKo: '', inheritedKo: '', isToken: true, evoNormal: null }; const s2 = S._s4.makeStack(tid, 1); s2.attackEligibleTurn = 0; st.players[p].battle.push(s2); return s2; };
await scenario(6025, 'only cost-less (token) opp digimon: none is exempt, nobody may rest', async (chk) => {
  const st = await armed([]); const tk = tokenStack(st, 'p2');
  chk(!canRest(st, tk.uid), 'token cannot rest');
});
await scenario(6026, 'cost-less token stays locked even after a costed digimon appears (locked either way)', async (chk) => {
  const st = await armed([]); const tk = tokenStack(st, 'p2'); st.players.p2.hand.push(byCost(5)); S.playDigimonFresh(st, 'p2', st.players.p2.hand.length - 1); st.pending.length = 0;
  chk(!canRest(st, tk.uid), 'token locked'); const c5 = st.players.p2.battle.find(s => S.card(s.cardId).cost === 5); chk(canRest(st, c5.uid), 'the costed one is the highest and free');
});
report();
