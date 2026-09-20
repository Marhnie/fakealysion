// Regression assertions for fixes found by the effect-trigger census (scripts/census.mjs). Run: node scripts/test-census-regress.mjs < /dev/null
import * as fs from 'fs';
import * as S from '../src/state.js';
import * as E from '../src/engine.js';
import * as Fx from '../src/effects.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url.replace(/^\.\//, './'), 'utf8')) });
await S.loadData();
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL:', m); } else console.log('ok  :', m); };
const eggs = () => { const e = Object.values(S.CARDS).find(c => c.category === 'digitama'); return { [e.id]: 5 }; };
function board() { const st = S.newGame({ name: 'a', main: { 'BT3-011': 50 }, digitama: eggs() }, { name: 'b', main: { 'BT3-011': 50 }, digitama: eggs() }); E.drawOpeningHand(st, 'p1'); E.drawOpeningHand(st, 'p2'); E.setSecurityStacks(st); E.beginGame(st, 'p1'); return st; }

// 1) [시큐리티]【서로의 턴/자신의 턴/상대의 턴 (종료 시)】 segments are continuous / turn-end effects, never check-time effects
for (const id of ['EX12-072', 'EX8-068', 'BT21-095', 'BT20-052', 'BT25-039']) {
  const st = board(); st.pending = [];
  S.queueTriggersFor(st, 'p1', id, 'security');
  ok(!st.pending.some(t => (t.tags || []).some(tg => /^(?:자신의|상대의|서로의) 턴/.test(tg))), `${id}: security reveal does not queue its [시큐리티]【턴 범위】 continuous/turn-end segment`);
}
{ const st = board(); st.pending = []; S.queueTriggersFor(st, 'p1', 'BT3-011', 'security'); ok(st.pending.length >= 1, 'BT3-011: a real 【시큐리티】 effect still queues on reveal'); }

// 2) "그 디지몬을 DP+N" (event subject of a watcher) compiles to modifyDP{last} instead of an empty (manual) script
for (const t of ['다음 상대의 턴 종료 시까지 그 디지몬을 DP+1000.', '이 턴 동안 그 디지몬의 DP를 +1000 한다.']) {
  const sc = Fx.compileToScript(t);
  ok(sc.length === 1 && sc[0].op === 'modifyDP' && sc[0].last === true && sc[0].amount === 1000, `compile "${t}" -> modifyDP last`);
}
{ // runtime: the pending of BT2-086 (watcher) raises the ATTACKER (evtStackUid), not the tamer
  const st = board();
  const pl = st.players.p1;
  const digi = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.level === 3 && c.dp);
  const a = S.makeStack ? null : null; // (stack construction goes through playDigimonFresh)
  pl.hand.unshift(digi.id); S.playDigimonFresh(st, 'p1', 0);
  const att = pl.battle.find(s => S.card(s.cardId).category === 'digimon');
  const before = S.effectiveDP(st, 'p1', att);
  const script = Fx.compileToScript('이 턴 동안 그 디지몬의 DP를 +1000 한다.');
  await Fx.runScript(script, { state: st, S, E, self: 'p1', opp: 'p2', sourceCardId: 'BT2-086', sourceStackUid: null, trigger: { evtStackUid: att.uid }, choose: async () => null });
  ok(S.effectiveDP(st, 'p1', att) === before + 1000, 'runtime: "그 디지몬" DP +1000 lands on the trigger event subject');
}
// 3) mandatory "이 디지몬으로 어택한다." (granted forced attack) compiles to attackNow instead of a manual prompt
{ const sc = Fx.compileToScript('【자신의 메인 페이즈 개시 시】 이 디지몬으로 어택한다.'); ok(sc.length === 1 && sc[0].op === 'attackNow' && sc[0].thisStack, 'forced attack text compiles to attackNow'); }
// 4) "디지몬을 1마리 소멸시킨다" (object particle before the count, BT25-080 inherited watcher)
{ const sc = Fx.compileToScript('Lv.4 이하의 상대의 디지몬을 1마리 소멸시킨다.'); ok(sc.length === 1 && sc[0].op === 'destroy' && sc[0].filter.levelMax === 4, '"디지몬을 1마리 소멸시킨다" compiles to destroy'); }
// 5) shard61 bespoke watcher scripts are registered
ok(!!Fx.lookupCardSpecific('EX5-043', ['자신의 턴'], 'x'), 'EX5-043 watcher has a script');
{ // BT25-074: the chosen opponent Digimon cannot digivolve until the end of the opponent's turn
  const st = board(); const pl2 = st.players.p2;
  const digi = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.level === 3 && c.dp);
  pl2.hand.unshift(digi.id); S.playDigimonFresh(st, 'p2', 0);
  const t = pl2.battle.find(x => S.card(x.cardId).category === 'digimon');
  const sc = Fx.lookupCardSpecific('BT25-074', ['서로의 턴'], 'x');
  await Fx.runScript(sc, { state: st, S, E, self: 'p1', opp: 'p2', sourceCardId: 'BT25-074', sourceStackUid: null, trigger: {}, choose: async (k, o) => (k === 'pickStack' ? o.uids[0] : null) });
  ok(t.cannotEvolveUntil != null && t.cannotEvolveUntil >= st.turnNumber, 'BT25-074: target cannot evolve (cannotEvolveUntil set)');
}
console.log(fail ? `RESULT: ${fail} FAILED` : 'RESULT: OK');
process.exit(fail ? 1 : 0);
