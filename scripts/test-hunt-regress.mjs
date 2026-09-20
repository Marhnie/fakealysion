// Regression assertions for bugs found by scripts/cpu-hunt.mjs (CPU-vs-CPU mass hunt).  Run: node scripts/test-hunt-regress.mjs < /dev/null
import * as S from '../src/state.js';
import * as E from '../src/engine.js';
import * as Fx from '../src/effects.js';
import { createSim } from '../src/cpusim.js';
import { init } from './lib-driver.mjs';
await init();
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
function game(handP1, memory = 3) {
  const pad = (n) => Object.fromEntries([['ST1-03', n]]);
  const state = S.newGame({ name: 'A', main: pad(50), digitama: { 'ST1-01': 5 } }, { name: 'B', main: pad(50), digitama: { 'ST1-01': 5 } });
  E.drawOpeningHand(state, 'p1'); E.drawOpeningHand(state, 'p2'); E.setSecurityStacks(state); E.beginGame(state, 'p1');
  const pl = state.players.p1; pl.hand = [...handP1];
  while (state.phase !== 'main') E.nextPhase(state);
  state.memory = memory;
  return state;
}
// 1. cpusim.mainLoop: memory already past the threshold when the main phase starts -> turn ends automatically, no Pass declared (which would give the opponent 3)
{
  const state = game([], -1);
  const sim = createSim(state, {});
  let asked = 0;
  await sim.mainLoop('p1', async () => { asked++; return { type: 'pass' }; });
  ok(asked === 0, 'mainLoop asked the CPU for an action although the auto-end condition already held');
  ok(state.activePlayer === 'p2' && state.memory === -1, 'turn should have auto-ended with memory kept at -1 (got ' + state.activePlayer + ' ' + state.memory + ')');
}
// 2. [턴에 1회] 【메인】 (ST17-03 로프몬) is consumed by the headless executor (was re-activatable forever)
{
  const state = game(['ST17-03']);
  const sim = createSim(state, {});
  const pl = state.players.p1;
  S.playDigimonFresh(state, 'p1', 0); await sim.drain();
  const st = pl.battle[0];
  ok(st && st.cardId === 'ST17-03', 'setup: ST17-03 on the field');
  const before = S.activatableMainAbilities(state, 'p1', st, 'battle').length;
  ok(before === 1, 'ST17-03 main ability should be available once (got ' + before + ')');
  await sim.exec('p1', { type: 'main', uid: st.uid, idx: 0 });
  ok(S.activatableMainAbilities(state, 'p1', st, 'battle').length === 0, 'ST17-03 [턴에 1회] main ability still available after use');
}
// 3. mainAbilityPayable unwraps "if <cond> -> costGroup" (EX7-065: rested tamer can not pay its rest cost)
{
  const state = game(['EX7-065']);
  const pl = state.players.p1;
  S.playDigimonFresh(state, 'p1', 0);
  const st = pl.battle[0];
  const seg = S.parseEffectSegments(S.card('EX7-065').effectKo).segments.find((s) => s.tags.includes('메인'));
  ok(Fx.mainAbilityPayable(state, S, 'p1', st.uid, 'EX7-065', seg.tags, seg.body) === true, 'EX7-065 payable while active');
  st.suspended = true;
  ok(Fx.mainAbilityPayable(state, S, 'p1', st.uid, 'EX7-065', seg.tags, seg.body) === false, 'EX7-065 must NOT be payable while its tamer is rested');
}
// 4. 《불굴》 re-entry at DP<=0 (turn-long 'all opponent Digimon DP -N' reaches later arrivals) is rule-checked at once
{
  const state = game(['ST18-02']);
  const pl = state.players.p1;
  S.playDigimonFresh(state, 'p1', 0);
  const st = pl.battle[0]; st.sources.push('ST1-03');
  S.addDpAllMod(state, 'p1', -3000, 'turn');
  S.modifyDP(state, 'p1', st.uid, -5000, 'turn'); // original dies (DP<=0), 《불굴》 replays a fresh copy that the late all-mod puts back at DP 0
  if (process.env.DBG) console.log(pl.battle.map((x) => x.cardId + ":" + S.effectiveDP(state, "p1", x)), state.log.slice(0, 6).map((e) => e.msg));
  const alive = pl.battle.filter((x) => x.cardId === 'ST18-02' && S.effectiveDP(state, 'p1', x) <= 0);
  ok(alive.length === 0, '《불굴》 re-entered Digimon stays alive at DP<=0');
}
// 5. a deck-mill 【등장 시】 queued while another effect is being processed must wait in the queue (used to mill the still-revealed cards -> DUP/LOST)
{
  const id = Object.keys(S.CARDS).find((k) => S.CARDS[k].category === 'digimon' && /^【등장 시】 자신의 덱 위에서부터 2장 파기한다\.?$/.test((S.CARDS[k].effectKo || '').trim()));
  ok(!!id, 'setup: a mill-2 【등장 시】 digimon exists');
  const state = game([id]);
  const before = state.players.p1.deck.length;
  state._rcDepth = 1; // an effect is resolving
  S.playDigimonFresh(state, 'p1', 0);
  ok(state.players.p1.deck.length === before, 'deck was milled mid-effect (' + before + ' -> ' + state.players.p1.deck.length + ')');
  ok(state.pending.some((t) => !t.resolved && t.cardId === id), 'the mill trigger should be queued');
  state._rcDepth = 0;
}
console.log(fails ? `RESULT: ${fails} FAILED` : 'RESULT: OK');
process.exit(fails ? 1 : 0);
