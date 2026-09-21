// Slice-5 official Q&A: "서로는 효과로 디지몬을 등장시킬 수 없다" also blocks playing into the breeding area (Q5205, 5206, 5209), and
// BT23-014's "상대는 트래시에서 디지몬/테이머를 효과로 등장시킬 수 없다" only restrains the OPPONENT's own play effects (Q5226-5228, 6249).
// Expected (own words): with such a digimon in the battle area no effect can put a digimon into the breeding area; playing via the lock holder's controller's OWN effect from trash is still allowed (BT23-014 case).
import { S, E, newBoard, stk, mkChoose, drain, fire, scenario, report, F3, fillerLv, nm, runOn, zoneNames } from './lib5.mjs';
const deva = Object.values(S.CARDS).find(c => c.category === 'digimon' && (c.types || []).includes('데바') && c.cost != null && !c.effectKo?.trim())?.id
  || Object.values(S.CARDS).find(c => c.category === 'digimon' && (c.types || []).includes('데바')).id;
console.log('deva fixture', nm(deva));
for (const [lock, q] of [['BT9-033', '5205'], ['BT9-047', '5206'], ['BT14-009', '5209']]) {
  await scenario(q, `${lock} in battle area: EX5-021's 등장 시 cannot put a digimon into the breeding area`, async (chk) => {
    let st = newBoard({ p1: { battle: ['EX5-021'], hand: [deva], deck: F3.slice(0, 5) }, p2: { battle: [lock] } });
    await runOn(st, 'p1', 'EX5-021', 'play', {});
    chk(!st.players.p1.raising, 'raising area must stay empty; got ' + (st.players.p1.raising && nm(st.players.p1.raising.cardId)));
    st = newBoard({ p1: { battle: ['EX5-021'], hand: [deva], deck: F3.slice(0, 5) }, p2: { battle: [] } });
    await runOn(st, 'p1', 'EX5-021', 'play', {});
    chk(!!st.players.p1.raising, 'control: without the lock the digimon is placed in the raising area');
  });
}
const lv3s = fillerLv3();
function fillerLv3() { return Object.values(S.CARDS).filter(c => c.category === 'digimon' && c.level === 3 && !c.effectKo && !c.inheritedKo).slice(0, 6).map(c => c.id); }
await scenario(5227, 'BT23-014 lock is on the opponent: my own EX5-060 effect can still play the opponent digimon from their trash', async (chk) => {
  const st = newBoard({ p1: { battle: ['BT23-014', 'EX5-060'] }, p2: { battle: [], trash: [lv3s[0]] } });
  await runOn(st, 'p1', 'BT23-014', 'play', {}); st.pending.length = 0;
  await runOn(st, 'p1', 'EX5-060', 'play', {});
  chk(st.players.p2.battle.some(s => s.cardId === lv3s[0]), 'opp digimon played from opp trash by MY effect: ' + zoneNames(st, 'p2', 'battle'));
});
await scenario(5228, 'BT23-014 lock: the opponent EX5-060 cannot play MY digimon from my trash', async (chk) => {
  const st = newBoard({ p1: { battle: ['BT23-014'], trash: [lv3s[1]] }, p2: { battle: ['EX5-060'] } });
  await runOn(st, 'p1', 'BT23-014', 'play', {}); st.pending.length = 0;
  await runOn(st, 'p2', 'EX5-060', 'play', {});
  chk(!st.players.p1.battle.some(s => s.cardId === lv3s[1]), 'must not be played: ' + zoneNames(st, 'p1', 'battle'));
});
report();
