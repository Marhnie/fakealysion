// Shared helpers for the slice1 official-Q&A scenario tests (scripts/qa/qa-slice1-*.mjs). Scenarios are data-driven: T(qid, title, async fn).
// Scenario bodies cite the Q id and describe the expected outcome in their own words (no rulings text is stored here; data/rulings is gitignored).
import * as fs from 'fs';
import * as S from '../../src/state.js';
import * as E from '../../src/engine.js';
import * as Fx from '../../src/effects.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url.replace(/^\.\//, './'), 'utf8')) });
await S.loadData();
export { S, E, Fx };
export const C = (id) => S.CARDS[id];
const fillers = Object.values(S.CARDS).filter(c => c.category === 'digimon' && c.level === 3 && c.dp && !c.effectKo && !c.inheritedKo).slice(0, 30).map(c => c.id);
export const FILL = fillers[0];
export const vanilla = (dpv, lv) => Object.values(S.CARDS).find(c => c.category === 'digimon' && c.dp === dpv && (lv == null || c.level === lv) && !c.effectKo && !c.inheritedKo)?.id;
export function mk({ me = 'p1' } = {}) {
  const deck = (n) => { const main = {}; for (let i = 0; i < 20; i++) main[fillers[i]] = 1; return { name: n, main, digitama: {} }; };
  const st = S.newGame(deck('A'), deck('B'));
  for (const p of ['p1', 'p2']) { const pl = st.players[p]; pl.hand = []; pl.trash = []; pl.security = []; pl.battle.length = 0; pl.deck = fillers.slice(0, 20); pl.raising = null; }
  st.turnNumber = 3; st.activePlayer = me; st.phase = 'main'; st.memory = 0; st.pending = []; return st;
}
// place a stack on the battle area. opts: src (ids, oldest-first), susp, fresh (entered this turn)
export function put(st, p, id, o = {}) {
  const s = S._s4.makeStack(id, 1); s.attackEligibleTurn = o.fresh ? st.turnNumber + 1 : 0;
  s.sources = [...(o.src || [])]; if (o.susp) s.suspended = true;
  st.players[p].battle.push(s); S.recomputeStackGrants(s); return s;
}
export const setHand = (st, p, ids) => { st.players[p].hand = [...ids]; };
export const setSec = (st, p, ids) => { st.players[p].security = [...ids]; };
export const LOW = Object.values(S.CARDS).filter(c => c.category === 'digimon' && c.dp && !c.effectKo && !c.inheritedKo).sort((a, b) => a.dp - b.dp)[0].id; // weakest vanilla digimon: security filler that loses every check
export const body = (color, lv = 4) => Object.values(S.CARDS).find(c => c.category === 'digimon' && c.colors.length === 1 && c.colors[0] === color && c.level === lv && c.dp && !c.effectKo && !c.inheritedKo && !c.isParallel)?.id; // vanilla digimon of a colour (option colour requirement)
export const secN = (st, p, n, id = LOW) => setSec(st, p, Array(n).fill(id));
export const setDeck = (st, p, ids) => { st.players[p].deck = [...ids]; };
export const setTrash = (st, p, ids) => { st.players[p].trash = [...ids]; };
export const dp = (st, p, s) => S.effectiveDP(st, p, s);
export const stackOf = (st, p, uid) => st.players[p].battle.find(s => s.uid === uid) || null;
export const alive = (st, p, s) => !!stackOf(st, p, s.uid);
export const mem = (st, p = 'p1') => (p === 'p1' ? st.memory : -st.memory); // memory from p's point of view
export const opp = (p) => S.opponentOf(p);
// default answers for interactive choices; override with st._qaAns = { kind: value|fn(opts) }
export function makeChoose(st) {
  return async (k, o) => {
    const ov = st._qaAns && st._qaAns[k]; if (ov !== undefined) return typeof ov === 'function' ? ov(o) : ov;
    if (k === 'pickStack') return o.uids?.[0] ?? null;
    if (k === 'pickStackAnySide') return o.entries?.[0] ?? null;
    if (k === 'pickFromZoneIndex') return o.eligibleIdxs?.[0] ?? null;
    if (k === 'pickFromHandIndexes') return (o.eligibleIdxs || []).slice(0, o.n || 1);
    if (k === 'pickFromRevealed') return o.eligible?.slice(0, o.max || 1).map(x => x.i) || [];
    if (k === 'confirmEffect') return true;
    if (k === 'multipleChoice') return 0;
    return null;
  };
}
const findS = (st, p, uid) => { const pl = st.players[p]; return pl.raising && pl.raising.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid); };
// mirrors src/cpusim.js / src/main.js runPendingScript (stale check, [turn N] gate, decline refund) but answers choices from st._qaAns / defaults
export async function drain(st) {
  let guard = 0;
  while (guard++ < 60) {
    if (st._rcPending && !(st._rcDepth > 0)) S.flushRuleChecks(st);
    const t = st.pending.find(x => !x.resolved); if (!t) return;
    (st._qaResolved = st._qaResolved || []).push({ cardId: t.cardId, tags: t.tags, text: t.text, player: t.player });
    try {
      if (t.schedFn) { t.schedFn(); S.resolvePending(st, t.uid); continue; }
      if (t.manualOnly) { S.resolvePending(st, t.uid); continue; }
      let script = Fx.lookupCardSpecific(t.cardId, t.tags, t.text, !!t.inherited);
      if (!script && /^이\s*카드의\s*【메인】\s*효과를\s*발(?:휘|동)한다\.?$/.test(t.text.trim())) { const seg = S.parseEffectSegments(S.card(t.cardId).effectKo || '').segments.find(x => x.tags.includes('메인')); if (seg) script = Fx.lookupCardSpecific(t.cardId, seg.tags, seg.body) || Fx.compileToScript(seg.body); }
      script = script || Fx.compileToScript(t.text);
      if (t.stackUid && t.topId && !(t.evt && t.evt.leaving) && !(t.tags || []).some(x => x.includes('소멸 시'))) { const now = findS(st, t.player, t.stackUid); if (!now || now.cardId !== t.topId) { S.resolvePending(st, t.uid); continue; } }
      const om = String(t.text || '').match(/^[\[〔]턴\s*에?\s*(\d+)\s*회[\]〕]/); let onceMark = null;
      if (om && t.stackUid) { const s1 = findS(st, t.player, t.stackUid); if (s1) { const key = S.onceLimitKey(t.cardId, t.tags); if (S.turnUsesRemaining(s1, key, Number(om[1])) <= 0) { S.resolvePending(st, t.uid); continue; } onceMark = { stack: s1, key }; } }
      if (onceMark) S.markTurnEffectUsed(onceMark.stack, onceMark.key);
      const ctx = { state: st, S, E, self: t.player, opp: S.opponentOf(t.player), sourceCardId: t.cardId, sourceStackUid: t.stackUid, trigger: t, startAttack() {}, attack: () => st.attackCtx, endAttack() {}, choose: makeChoose(st) };
      await Fx.runScript(script, ctx);
      if (onceMark && (ctx._declined || (ctx._costUnpaid && script.length === 1 && script[0].op === 'costGroup'))) { const u = onceMark.stack.turnEffectUses; if (u && u[onceMark.key] > 0) u[onceMark.key]--; }
    } catch (e) { (st._qaErr = st._qaErr || []).push(String(e.stack || e).slice(0, 300)); }
    S.resolvePending(st, t.uid);
  }
}
// end the active player's turn the way the UI does (turn-end triggers resolve, then the turn flips to the opponent)
export async function endTurnFull(st) { E.beginTurnEnd(st, false); let g = 0; while (st.turnEnding && !st.winner && g++ < 10) { await drain(st); E.settleTurnEnd(st); } await drain(st); }
export const BIG = Object.values(S.CARDS).filter(c => c.category === 'digimon' && c.dp >= 8000 && c.dp <= 9000 && !c.effectKo && !c.inheritedKo).map(c => c.id)[0] || FILL;
export const resolved = (st) => st._qaResolved || [];
export async function playCard(st, p, id, { cost = false } = {}) { const pl = st.players[p]; pl.hand.push(id); if (cost) S.spendMemory(st, C(id).cost || 0); const s = S.playDigimonFresh(st, p, pl.hand.length - 1); await drain(st); return s; }
export async function useOption(st, p, id) { const pl = st.players[p]; pl.hand.push(id); const r = S.useOptionCard(st, p, pl.hand.length - 1); await drain(st); return r; }
export async function evolve(st, p, uid, id, cost = 0, source = 'hand') { const pl = st.players[p]; if (source === 'hand') pl.hand.push(id); const r = S.digivolve(st, p, uid, id, cost, source); await drain(st); return r; }
async function securityCheck(st, p, uid, op) {
  const ctl = S.beginSecurityCheck(st, p, uid, op); ctl.deferBattle = true; let g = 0;
  while (!ctl.done && !st.winner && g++ < 30) {
    if (ctl.awaiting) { await drain(st); S.battleSecurityCheck(ctl, ctl.awaiting.id); } else S.stepSecurityCheck(ctl);
    await drain(st);
    if (ctl.awaiting) { await drain(st); S.battleSecurityCheck(ctl, ctl.awaiting.id); }
  }
  if (!ctl.gameOver && ctl.results.length) { const last = ctl.results[ctl.results.length - 1]; if (last.result === 'defenderWins' || last.result === 'tie') S.deleteStack(st, p, uid, 'trash', 'battle'); }
  return { checks: ctl.results, gameOver: !!ctl.gameOver, ctl };
}
// Full attack mirroring cpusim.attack. target = 'PLAYER' | uid. opts.block = uid of a blocker to use (default none). opts.counter = option chosen from findCounterOptions (default none).
export async function attack(st, p, uid, target = 'PLAYER', opts = {}) {
  const op = S.opponentOf(p); const dec = S.declareAttack(st, p, uid, opts.declare || {}); if (!dec.ok) return { declined: dec };
  const pa = { attacker: p, opp: op, uid, targetKind: target === 'PLAYER' ? 'player' : 'digimon', targetUid: target === 'PLAYER' ? null : target }; st.attackCtx = pa; pa.terminate = () => { pa.ended = true; };
  st.qaLog = { blockers: [], battle: null };
  S.queueTriggersForStack(st, p, dec.stack, 'attack'); S.emitGameEvent(st, 'attack', { owner: p, stack: dec.stack, cause: null }); await drain(st);
  const end = async () => { const s2 = findS(st, p, uid); st.attackCtx = null; if (s2) { S.s8AttackEnded(st, p, uid); S.queueTriggersForStack(st, p, s2, 'attackEnd'); S.emitGameEvent(st, 'attackEnd', { owner: p, stack: s2, cause: null }); } await drain(st); };
  if (st.winner || pa.ended || !findS(st, p, uid) || (pa.targetKind === 'digimon' && !findS(st, op, pa.targetUid))) { await end(); return { ended: true }; }
  if (opts.counter) { const r = S.activateCounter(st, op, opts.counter, pa); if (r.ok) { st.pending.push({ uid: 'ct' + Math.random(), player: op, cardId: opts.counter.cardId, stackUid: opts.counter.stackUid, tags: opts.counter.tags, text: opts.counter.body, resolved: false }); await drain(st); } }
  const aSt = findS(st, p, uid); if (!aSt || pa.ended) { await end(); return { ended: true }; }
  const colliding = S.hasKeyword(aSt, '충돌') || S.hasContinuousKeyword(st, p, aSt, '충돌');
  const elig = st.players[op].battle.filter(s => S.card(s.cardId).category === 'digimon' && !s.suspended && S.canRestByRule(st, op, s) && !S.s3Flag(st, s, 'noBlock') && !S.hookNoBlock(st, op, s) && (colliding || S.hasKeyword(s, '블로커') || S.hookGrantedKeywords(st, op, s).includes('블로커')));
  const blockers = elig.filter(s => s.uid !== pa.targetUid && !S.cannotBeBlockedBy(st, p, uid, s)); st.qaLog.blockers = blockers.map(b => b.uid);
  let bu = opts.block || null; if (colliding && !bu && blockers.length) bu = blockers[0].uid;
  if (bu) { const b = blockers.find(x => x.uid === bu); if (b) { S.restStack(st, op, b.uid, 'block'); pa.targetKind = 'digimon'; pa.targetUid = b.uid; S.emitGameEvent(st, 'redirect', { owner: p, stack: aSt, cause: null, targetUid: b.uid }); S.emitGameEvent(st, 'blocked', { owner: p, stack: aSt, blocker: b, cause: null }); await drain(st); st.qaLog.blocked = true; } }
  if (st.winner) return { winner: st.winner };
  if (!findS(st, p, uid) || pa.ended || (pa.targetKind === 'digimon' && !findS(st, op, pa.targetUid))) { await end(); return { ended: true }; }
  let out = {};
  if (pa.targetKind === 'player') out = await securityCheck(st, p, uid, op);
  else { const res = S.resolveDigimonBattle(st, p, uid, pa.targetUid); await drain(st); out = { battle: res }; { const sv = res && res.result === 'attackerWins' && res.destroyedOnlyOpponent ? findS(st, p, uid) : null; if (sv && S.hasKeyword(sv, '전투후액티브')) S.unsuspendStack(st, p, uid); } if (res && res.piercing && !st.winner) out.sec = await securityCheck(st, p, uid, op); }
  await drain(st); await end(); return out;
}
export const atkSec = (st, p, uid, opts) => attack(st, p, uid, 'PLAYER', opts);
export const atkDigi = (st, p, uid, tuid, opts) => attack(st, p, uid, tuid, opts);
// ---- registry ----
const tests = [];
export const T = (qid, title, fn) => tests.push({ qid, title, fn });
export const eq = (m, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); };
export const ok = (m, c) => { if (!c) throw new Error(m); };
export async function runAll(name) {
  let pass = 0, fail = 0;
  for (const t of tests) {
    try { await t.fn(); pass++; if (process.env.QA_VERBOSE) console.log('PASS', t.qid, t.title); }
    catch (e) { fail++; console.log('FAIL Q' + t.qid, t.title, '|', String(e.message).split('\n')[0]); }
  }
  console.log(`${name}: ${tests.length} scenarios, pass ${pass}, fail ${fail}`);
  if (process.env.QA_OUT) fs.appendFileSync(process.env.QA_OUT, JSON.stringify({ file: name, qids: [...new Set(tests.map(t => t.qid))], scenarios: tests.length, pass, fail }) + String.fromCharCode(10));
  return { pass, fail };
}
