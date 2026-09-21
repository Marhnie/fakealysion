// Slice-5 official Q&A: a waiting 【소멸 시】 effect cannot be resolved once the deleted card has left the trash (Q5230 BT23-015, 5593 BT24-017, 5758/5759 P-177, 5905 EX11-051, 5913 EX11-059).
// Expected (own words): delete the digimon; another effect returns that card to hand/deck before the 【소멸 시】 gets to resolve -> the effect does NOT happen. If the card stays in the trash it does.
import { S, E, newBoard, stk, mkChoose, drain, scenario, report, F3, fillerLv, nm, runOn, zoneNames } from './lib5.mjs';
const drawer = 'BT23-069'; // 【등장 시】【소멸 시】 plays a ghost digimon from the trash
const ghost = Object.values(S.CARDS).find(c => c.category === 'digimon' && (c.types || []).includes('고스트형') && c.level <= 4 && !c.effectKo?.trim())?.id;
await scenario('5230/5593/5905', 'deleted card returned to hand before its 소멸 시 resolves -> no effect; control: stays in trash -> effect happens', async (chk) => {
  for (const back of [true, false]) {
    const st = newBoard({ p1: { battle: [drawer], trash: [ghost] }, p2: { battle: [] } });
    const s = stk(st, 'p1', drawer); S.deleteStack(st, 'p1', s.uid, 'trash', 'effect');
    if (back) { const i = st.players.p1.trash.lastIndexOf(drawer); st.players.p1.trash.splice(i, 1); st.players.p1.hand.push(drawer); }
    await drain(st, mkChoose(st));
    const played = st.players.p1.battle.some(x => x.cardId === ghost);
    chk(played === !back, `back=${back}: ghost played=${played}`);
  }
});
report();
