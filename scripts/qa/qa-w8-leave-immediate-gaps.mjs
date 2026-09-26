// W8 recheck: leave-time 즉시형 abilities ("…벗어날/소멸할 때, …") that had NO wiring at all (found while checking Q5644-5646 BT24-065; all wired through the shared 18-2 replacement gate,
// docs/effect-classification-rules.md): EX10-031, EX13-015, BT26-055 (inherited), BT14-020 (inherited, deletion only), EX9-032 (inherited, same text as BT22-036).
import { S, E, newBoard, stk, mkChoose, drain, scenario, report, F3, fillerLv, zoneNames } from './lib5.mjs';
const lv3 = fillerLv(3);
const puppet = Object.values(S.CARDS).find(c => c.category === 'digimon' && (c.types || []).includes('퍼펫형') && c.level <= 4 && !c.effectKo?.trim() && !c.inheritedKo?.trim())?.id;
const inter = async (fn) => { S.REPL.interactive = true; try { return await fn(); } finally { S.REPL.interactive = false; } };
const resume = (st, idx = 0) => { const e = (st.pendingReplacements || [])[0]; if (!e) return false; S.resumeReplacement(st, e, idx); return true; };
const mk = (cfg) => newBoard({ ...cfg, memory: 3, active: 'p2', turn: 4 });
await scenario('EX10-031', 'leaving: a cost<=4 source card is played first (passive), then the digimon still leaves', async (chk) => inter(async () => {
  const st = mk({ p1: { battle: [{ id: 'EX10-031', src: [lv3[5]] }] }, p2: { battle: [lv3[0]] } }); const h = st.players.p1.battle[0]; st._fxSrc = { player: 'p2' };
  S.deleteStack(st, 'p1', h.uid, 'trash', 'effect');
  chk((st.pendingReplacements || []).length === 1, 'prompt offered'); resume(st, 0);
  chk(st.players.p1.battle.some(s => s.cardId === lv3[5]) && !st.players.p1.battle.includes(h), 'source played, holder gone: ' + zoneNames(st, 'p1', 'battle'));
}));
await scenario('EX13-015', 'opp effect deletes it: destroy an opp digimon (DP<=9000) instead -> it stays; own effect -> no prompt', async (chk) => inter(async () => {
  const st = mk({ p1: { battle: ['EX13-015'] }, p2: { battle: [lv3[0]] } }); const h = st.players.p1.battle[0]; st._fxSrc = { player: 'p2' };
  S.deleteStack(st, 'p1', h.uid, 'trash', 'effect');
  chk((st.pendingReplacements || []).length === 1, 'prompt offered'); resume(st, 0);
  chk(st.players.p1.battle.includes(h) && st.players.p2.battle.length === 0, 'holder stays, opp digimon deleted');
  const st2 = mk({ p1: { battle: ['EX13-015'] }, p2: { battle: [lv3[0]] } }); const h2 = st2.players.p1.battle[0];
  S.deleteStack(st2, 'p1', h2.uid, 'trash', 'ownEffect');
  chk((st2.pendingReplacements || []).length === 0 && !st2.players.p1.battle.includes(h2), 'own effect: no replacement');
}));
await scenario('BT26-055', 'inherited: leaving discards the opp top security (forced, leave still happens)', async (chk) => {
  const st = mk({ p1: { battle: [{ id: F3[1], src: ['BT26-055'] }] }, p2: { battle: [lv3[0]], security: F3.slice(3, 8) } }); const h = st.players.p1.battle[0]; st._fxSrc = { player: 'p2' };
  const n0 = st.players.p2.security.length; S.deleteStack(st, 'p1', h.uid, 'trash', 'effect');
  chk(st.players.p2.security.length === n0 - 1, 'opp security ' + n0 + ' -> ' + st.players.p2.security.length);
  chk(!st.players.p1.battle.includes(h), 'digimon left');
});
await scenario('BT14-020', 'inherited 【상대의 턴】: on DELETION the 쉬라몬 source is played', async (chk) => inter(async () => {
  const shi = S.CARDS['BT14-020'].id;
  const st = mk({ p1: { battle: [{ id: F3[1], src: ['BT14-020', shi] }] }, p2: { battle: [lv3[0]] } }); const h = st.players.p1.battle[0]; st._fxSrc = { player: 'p2' };
  S.deleteStack(st, 'p1', h.uid, 'trash', 'effect');
  chk((st.pendingReplacements || []).length === 1, 'prompt offered on deletion'); resume(st, 0);
  chk(st.players.p1.battle.some(s => s.cardId === shi), '쉬라몬 played: ' + zoneNames(st, 'p1', 'battle'));
}));
await scenario('EX9-032', 'inherited (same text as BT22-036): a 퍼펫형 digimon can be destroyed so the holder does not leave', async (chk) => inter(async () => {
  const st = mk({ p1: { battle: [{ id: F3[1], src: ['EX9-032'] }, puppet] }, p2: { battle: [lv3[0]] } }); const h = st.players.p1.battle[0]; st._fxSrc = { player: 'p2' };
  S.deleteStack(st, 'p1', h.uid, 'trash', 'effect');
  chk((st.pendingReplacements || []).length === 1, 'prompt offered'); resume(st, 0);
  chk(st.players.p1.battle.includes(h) && !st.players.p1.battle.some(s => s.cardId === puppet), 'holder stays, puppet sacrificed: ' + zoneNames(st, 'p1', 'battle'));
}));
report();
