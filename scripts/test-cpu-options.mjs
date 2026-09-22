// Behaviour tests of the CPU's option / tamer / counter / optional-cost policy on constructed boards (docs/cpu-option-tamer-play.md).
//   node scripts/test-cpu-options.mjs < /dev/null
// Every case builds a small board (S.newGame + hand / battle overrides), asks src/cpu.js for its decision and asserts it.  "pre-fix" cases run the same
// board with params.optTam = 0 (hard) to document what the old policy did.
import * as S from '../src/state.js';
import * as E from '../src/engine.js';
import * as Cpu from '../src/cpu.js';
import { init, makeRng, makeDriver } from './lib-driver.mjs';
await init();
const drv = makeDriver(makeRng(7));
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('FAIL', m); } };

function fresh(memory = 6) {
  const st = drv.newRandomGame();
  st.turnNumber = 6; st.activePlayer = 'p1'; st.phase = 'main'; st.turnEnding = false; st.pending = []; st.memory = memory; st.winner = null;
  for (const p of ['p1', 'p2']) { const pl = st.players[p]; pl.hand = []; pl.battle = []; pl.raising = null; }
  return st;
}
function put(st, p, id, { sus = false } = {}) {
  const pl = st.players[p]; pl.hand.unshift(id);
  const stack = S.playDigimonFresh(st, p, 0); stack.attackEligibleTurn = 0; stack.suspended = sus; st.pending = [];
  return stack;
}
const CFG = { normal: { level: 'normal', banned: new Set(), params: null }, hard: { level: 'hard', banned: new Set(), params: null }, hardOld: { level: 'hard', banned: new Set(), params: Cpu.makeParams({ optTam: 0 }) } };
const acts = (st, p, cfg) => Cpu.enumerateActions(st, p, cfg);
const optAct = (st, p, cfg, id) => acts(st, p, cfg).find((a) => a.type === 'option' && a.cardId === id);

// 1. removal option written "상대 디지몬" (no 의): BT4-112 (purple, cost 6) "Lv.6 이상의 상대 디지몬 1마리를 소멸시킨다"
{
  const st = fresh(6); put(st, 'p1', 'ST6-02'); put(st, 'p2', 'ST6-12'); st.players.p1.hand = ['BT4-112'];
  for (const lv of ['normal', 'hard']) { const a = optAct(st, 'p1', CFG[lv], 'BT4-112'); ok(a && a.why === 'removal', `${lv}: "상대 디지몬" removal option is classified removal (got ${a && a.why})`); }
  const old = optAct(st, 'p1', CFG.hardOld, 'BT4-112'); ok(old && old.why === 'misc', 'pre-fix (optTam 0) classified it misc: ' + (old && old.why));
  const pm = Cpu.planMain(st, 'p1', { ...CFG.hard, banned: new Set() }); ok(pm.type === 'option' && pm.cardId === 'BT4-112', 'hard casts the affordable removal on a Lv.6 target, got ' + pm.type);
  const pmn = Cpu.planMain(st, 'p1', { ...CFG.normal, banned: new Set() }); ok(pmn.type === 'option' && pmn.cardId === 'BT4-112', 'normal casts it as well, got ' + pmn.type);
  const pmo = Cpu.planMain(st, 'p1', { ...CFG.hardOld, banned: new Set() }); ok(!(pmo.type === 'option' && pmo.cardId === 'BT4-112'), 'pre-fix hard did NOT cast it');
}
// 2. legal-target check: no Lv.6+ opponent digimon -> the option is not offered (no wasted card / memory)
{
  const st = fresh(6); put(st, 'p1', 'ST6-02'); put(st, 'p2', 'ST6-02'); st.players.p1.hand = ['BT4-112'];
  ok(!optAct(st, 'p1', CFG.hard, 'BT4-112'), 'hard: Lv.6+ removal not offered when the opponent only has a Lv.3');
  ok(!optAct(st, 'p1', CFG.normal, 'BT4-112'), 'normal: same');
}
// 3. free-evolution option (LM-030: evolve a green digimon with a green hand card, cost -3)
{
  const st = fresh(6); put(st, 'p1', 'ST4-02'); put(st, 'p2', 'ST4-02'); st.players.p1.hand = ['LM-030', 'ST4-06'];
  const a = optAct(st, 'p1', CFG.hard, 'LM-030'); ok(a && a.why === 'free', 'hard: LM-030 with an evolvable pair is offered as free evolution (' + (a && a.why) + ')');
  ok(a && a.score > 1.5, 'and scores above the play threshold (' + (a && a.score) + ')');
  st.players.p1.hand = ['LM-030'];
  ok(!optAct(st, 'p1', CFG.hard, 'LM-030'), 'hard: LM-030 is not offered without a digimon card in hand to evolve into');
}
// 4. tamer with 【등장 시】 draw (BT4-093, blue, cost 3): played with the memory available (also when a digimon competes at the same price)
{
  const st = fresh(3); st.players.p1.hand = ['BT4-093'];
  for (const lv of ['normal', 'hard']) { const pm = Cpu.planMain(st, 'p1', { ...CFG[lv], banned: new Set() }); ok(pm.type === 'play' && pm.cardId === 'BT4-093', `${lv}: plays the 등장 시 tamer with exactly enough memory, got ${pm.type}`); }
}
// 5. 《블래스트 진화》 counter (the pool's only 【카운터】): a free evolution during the attack
{
  const st = fresh(0); const atk = put(st, 'p1', 'ST4-02'); put(st, 'p2', 'ST4-02');
  st.players.p2.hand = ['BT14-049']; st.players.p2.security = st.players.p2.security.slice(0, 4);
  const cnt = S.findCounterOptions(st, 'p2'); ok(cnt.length === 1, 'blast card is offered as a counter option (' + cnt.length + ')');
  const ctx = { attackerP: 'p1', attackerUid: atk.uid, targetKind: 'player', targetUid: null };
  ok(!!Cpu.decideCounter(st, ctx, cnt, { ...CFG.hard }), 'hard: uses the free blast evolution against an attack on a 4-card security');
  ok(!Cpu.decideCounter(st, ctx, cnt, { ...CFG.hardOld }), 'pre-fix: passed (danger only counted at security <= 3)');
  st.players.p2.security = ['ST4-01', 'ST4-01', 'ST4-01', 'ST4-01', 'ST4-01', 'ST4-01', 'ST4-01'];
  ok(!Cpu.decideCounter(st, ctx, cnt, { ...CFG.hard }), 'hard: keeps the card against a weak attack on a 7-card security');
  st.players.p2.security = [];
  ok(!!Cpu.decideCounter(st, ctx, cnt, { ...CFG.hard }), 'hard: lethal attack -> counter');
  ok(!!Cpu.decideCounter(st, ctx, cnt, { ...CFG.normal }), 'normal: lethal attack -> counter (unchanged behaviour)');
}
// 6. optional-cost prompts (15-7-1)
{
  const st = fresh(2); const pl = st.players.p1;
  const ans = (kinds, eff = '카드를 드로우한다') => Cpu.answerChoice(st, 'confirmEffect', { player: 'p1', prompt: 'x', optionalCost: true, costKinds: kinds, effectText: eff }, 'p1', { level: 'hard' });
  pl.security = ['ST4-01', 'ST4-01']; ok(ans(['removeSecurity']) === false, 'never pays the second-to-last security card');
  pl.security = ['ST4-01', 'ST4-01', 'ST4-01', 'ST4-01', 'ST4-01']; ok(ans(['removeSecurity']) === true, 'pays a security card when 5 remain');
  pl.hand = ['ST4-02']; ok(ans(['trashHand']) === false, 'does not trash its last hand card for an effect');
  pl.hand = ['ST4-02', 'ST4-03', 'ST4-04', 'ST4-05']; ok(ans(['trashHand']) === true, 'trashes a hand card when 4 are held');
  ok(ans(['restTamer']) === true, 'rests a tamer for its effect ("이 테이머를 레스트시키는 것으로")');
  ok(ans(['destroyOwn'], '카드를 드로우한다') === true || ans(['destroyOwn'], '카드를 드로우한다') === false, 'sacrifice prompt answers without throwing');
  ok(Cpu.answerChoice(st, 'confirmEffect', { player: 'p1', prompt: '이 테이머의 효과를 사용할까요?' }, 'p1', { level: 'normal' }) === true, 'plain "may" effects are accepted');
}
console.log(`test-cpu-options: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
