// Slice-5 official Q&A: effects with a "security to hand" step when the security stack is empty (Q5276 BT23-031, 6165 ST23-03/BT25-036, 6304 BT25-037, 5715/5714 BT24-101).
// Expected (own words): nothing is added to the hand, but the rest of the text still happens (Recovery +1 takes a deck card into security; the "place a card top/bottom" step works; the DP-13000 still applies; the 1-per-security evolve cost is 0).
import { S, E, newBoard, stk, mkChoose, drain, fire, scenario, report, F3, fillerLv, nm, runOn, zoneNames } from './lib5.mjs';
for (const [id, evt, q] of [['BT23-031', 'play', '5276'], ['ST23-03', 'play', '6165'], ['BT25-036', 'play', '6165b']]) {
  await scenario(q, `${id}: security 0 -> hand unchanged, recovery +1 still happens`, async (chk) => {
    const st = newBoard({ p1: { battle: [id], hand: [F3[5]], deck: F3.slice(0, 6), security: [] }, p2: { battle: [] } });
    st.players.p1.security.length = 0;
    const d0 = st.players.p1.deck.length;
    await runOn(st, 'p1', id, evt, {});
    chk(st.players.p1.hand.length === 1, 'hand unchanged: ' + st.players.p1.hand.length);
    chk(st.players.p1.security.length === 1 && st.players.p1.deck.length === d0 - 1, `recovery +1: sec ${st.players.p1.security.length} deck ${d0}->${st.players.p1.deck.length}`);
  });
}
await scenario('6304', 'BT25-037: security 0 -> can still place a hand card on the security', async (chk) => {
  const angel = Object.values(S.CARDS).find(c => c.category === 'digimon' && (c.types || []).some(t => /천사형/.test(t)) && c.cost != null).id;
  const st = newBoard({ p1: { battle: ['BT25-037'], hand: [angel], deck: F3.slice(0, 6), security: [] }, p2: { battle: [] } });
  st.players.p1.security.length = 0;
  await runOn(st, 'p1', 'BT25-037', 'play', {});
  chk(st.players.p1.security.length === 1 && !st.players.p1.hand.includes(angel), 'card placed into security: sec ' + st.players.p1.security.length + ' hand ' + zoneNames(st, 'p1', 'hand'));
});
await scenario('5715', 'BT24-101: security 0 (cannot trash) -> opp digimon still gets DP-13000', async (chk) => {
  const st = newBoard({ p1: { battle: ['BT24-101'], security: [] }, p2: { battle: [F3[0]] } });
  st.players.p1.security.length = 0;
  const t = st.players.p2.battle[0]; const before = S.effectiveDP(st, 'p2', t);
  await runOn(st, 'p1', 'BT24-101', 'play', {});
  const t2 = st.players.p2.battle.find(s => s.uid === t.uid);
  chk(!t2 || S.effectiveDP(st, 'p2', t2) === before - 13000, 'DP reduced (or deleted by rule check): ' + (t2 && S.effectiveDP(st, 'p2', t2)));
});
await scenario('5714', 'BT24-101 3rd evolve condition: from an Aigiosmon-name Lv5 with 0 security costs 0', async (chk) => {
  const src = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.level === 5 && c.nameKo.includes('아이기오투스몬')); 
  if (!src) { chk(false, 'fixture missing'); return; }
  const st = newBoard({ p1: { battle: [src.id], hand: ['BT24-101'], security: [] }, p2: { battle: [] } }); st.players.p1.security.length = 0;
  const s = stk(st, 'p1', src.id);
  const r = E.canEvolveAny(s.cardId, 'BT24-101', s.extraColors || [], S.evolveTargetRestriction(st, 'p1', s));
  chk(r.ok && r.cost === 0, 'evolve cost ' + JSON.stringify(r));
});
report();
