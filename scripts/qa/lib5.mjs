// Slice-5 helpers (own file; lib.mjs belongs to another slice). Official-Q&A scenarios on the real engine.
// (mirror of main.js scriptFor/drain). Run from repo root: node scripts/qa/qa-slice5-xxx.mjs < /dev/null
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const R = pathToFileURL(ROOT + '/').href;
export const S = await import(R + 'src/state.js'); export const E = await import(R + 'src/engine.js'); export const Fx = await import(R + 'src/effects.js');
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(path.join(ROOT, String(url).replace(/^\.\//, '')), 'utf8')) });
await S.loadData();
const filler = Object.values(S.CARDS).filter(c => c.category === 'digimon' && c.level === 3 && !c.effectKo && !c.inheritedKo).slice(0, 60).map(c => c.id);
export const F3 = filler;
export const fillerLv = (lv, n = 40) => Object.values(S.CARDS).filter(c => c.category === 'digimon' && c.level === lv && !c.effectKo && !c.inheritedKo).slice(0, n).map(c => c.id);
function deckOf(n) { const main = {}; for (let i = 0; i < 50; i++) { const id = filler[(i + n) % filler.length]; main[id] = (main[id] || 0) + 1; } return { name: 'T', main, digitama: {} }; }
export function scriptFor(t) {
  const specific = Fx.lookupCardSpecific(t.cardId, t.tags, t.text, !!t.inherited); if (specific) return specific;
  if (/^이\s*카드의\s*【메인】\s*효과를\s*발(?:휘|동)한다\.?$/.test(t.text.trim())) { const { segments } = S.parseEffectSegments(S.card(t.cardId).effectKo || ''); const m = segments.find(s => s.tags.includes('메인')); if (m) return Fx.lookupCardSpecific(t.cardId, m.tags, m.body) || Fx.compileToScript(m.body); }
  return Fx.compileToScript(t.text);
}
// cfg: {turn, active, memory, p1:{hand,trash,security(top first),deck(top first),battle:[id|{id,src,rested,fd}],raising}, p2:{...}}
export function newBoard(cfg = {}) {
  const st = S.newGame(deckOf(0), deckOf(7)); S.resetTurnEffectUses?.(st);
  E.drawOpeningHand(st, 'p1'); E.drawOpeningHand(st, 'p2'); E.setSecurityStacks(st); E.beginGame(st, 'p1');
  st.pending.length = 0; st.phase = 'main'; st.turnNumber = cfg.turn || 3; st.activePlayer = cfg.active || 'p1'; st.memory = cfg.memory ?? 3;
  for (const p of ['p1', 'p2']) { const pl = st.players[p]; pl.hand.length = 0; pl.trash.length = 0; pl.raising = null; pl.battle.length = 0; }
  for (const p of ['p1', 'p2']) {
    const c = cfg[p] || {}; const pl = st.players[p];
    if (c.hand) pl.hand.push(...c.hand); if (c.trash) pl.trash.push(...c.trash);
    if (c.security) pl.security.splice(0, pl.security.length, ...c.security);
    if (c.deck) pl.deck.unshift(...c.deck);
    for (const b of (c.battle || [])) addStack(st, p, b);
  }
  st.pending.length = 0; return st;
}
export function addStack(st, p, b) {
  if (typeof b === 'string') b = { id: b };
  const pl = st.players[p];
  if (S.card(b.id).category === 'tamer') { const tk = S._s4.makeStack(b.id, 1); tk.attackEligibleTurn = 0; tk.placedTurn = 0; tk.suspended = !!b.rested; pl.battle.push(tk); return tk; }
  pl.hand.push(b.id); const idx = pl.hand.length - 1;
  const stack = S.playDigimonFresh(st, p, idx); st.pending.length = 0;
  stack.attackEligibleTurn = 0; stack.placedTurn = 0; stack.byEffect = undefined; stack.playedByEffect = false; stack.s7ByEffect = false;
  if (b.src) { stack.sources.push(...b.src); S.recomputeStackGrants(stack); }
  if (b.fd != null) stack.s5fd = b.fd;
  if (b.rested) stack.suspended = true;
  return stack;
}
export const stk = (st, p, cardId) => [st.players[p].raising, ...st.players[p].battle].filter(Boolean).find(s => s.cardId === cardId);
// answer(kind, opts, st) -> value | undefined (fall through to defaults: confirm=true, first candidate)
export function mkChoose(st, opts = {}) {
  const log = [];
  const f = async (kind, o) => {
    const ov = opts.answer && opts.answer(kind, o, st); if (ov !== undefined) { log.push(`${kind} => ${JSON.stringify(ov)} (script)`); return ov; }
    let r = null;
    if (kind === 'confirmEffect') r = true;
    else if (kind === 'pickStack') r = (o.uids && o.uids[0]) ?? null;
    else if (kind === 'pickStackAnySide') r = o.entries?.[0] ?? null;
    else if (kind === 'pickFromHand') r = st.players[o.player].hand[0] ?? null;
    else if (kind === 'pickFromHandIndexes') r = (o.eligibleIdxs || []).slice(0, o.n || 1);
    else if (kind === 'pickFromZoneIndex') r = o.eligibleIdxs?.[0] ?? null;
    else if (kind === 'pickFromRevealed') r = (o.eligible || []).slice(0, o.max || 1).map(x => x.i);
    else if (kind === 'pickSourcesMulti') r = [...Array(o.n || 0).keys()];
    else if (kind === 'pickLinkCard') r = 0;
    else if (kind === 'orderCards') r = o.ids.map((_, i) => i);
    else if (kind === 'multipleChoice') r = 0;
    log.push(`${kind} => ${JSON.stringify(r)}`); return r;
  };
  f.log = log; return f;
}
export function ctxFor(st, t, choose) { return { state: st, S, E, self: t.player, opp: S.opponentOf(t.player), sourceCardId: t.cardId, sourceStackUid: t.stackUid, choose, trigger: t, startAttack(p, uid) { (st._atk ||= []).push([p, uid]); }, attack: () => null, endAttack() {} }; }
export async function drain(st, choose) {
  let guard = 0; const ran = [];
  while (guard++ < 60) {
    const t = st.pending.find(x => !x.resolved); if (!t) break;
    if (t.schedFn) { t.schedFn(); S.resolvePending(st, t.uid); continue; }
    const fs_ = (u) => [st.players[t.player].raising, ...st.players[t.player].battle].filter(Boolean).find(x => x.uid === u);
    if (t.stackUid && t.topId && !t.evt?.leaving && !t.tags.some(x => x.includes('소멸 시'))) { const n = fs_(t.stackUid); let why = null; if (!n || n.cardId !== t.topId) why = 'left'; else if (t.inherited && !n.sources.includes(t.cardId) && !(n.linkCards || []).some(l => l.cardId === t.cardId)) why = 'lost inherited'; else if (t.tags.includes('자신의 턴') && t.player !== st.activePlayer) why = 'not own turn'; else if (t.tags.includes('상대의 턴') && t.player === st.activePlayer) why = 'not opp turn'; if (why) { ran.push(`SKIP ${t.cardId} (${why})`); S.resolvePending(st, t.uid); continue; } }
    const m_ = t.text.match(/^[\[〔]턴\s*에?\s*(\d+)\s*회[\]〕]/); const lim = m_ ? Number(m_[1]) : null;
    if (lim != null && t.stackUid) { const s_ = fs_(t.stackUid); if (s_) { const key = S.onceLimitKey(t.cardId, t.tags); if (S.turnUsesRemaining(s_, key, lim) <= 0) { ran.push(`ONCE-LIMIT skip ${t.cardId}`); S.resolvePending(st, t.uid); continue; } S.markTurnEffectUsed(s_, key); } }
    if (S.pendingCardLeftZone(st, t)) { ran.push(`LEFT-ZONE skip ${t.cardId}`); S.resolvePending(st, t.uid); continue; }
    const script = t.manualOnly ? [] : scriptFor(t);
    ran.push(`${t.cardId}【${t.tags.join('|')}】${t.manualOnly ? ' MANUAL' : ''}`);
    try { await Fx.runScript(script, ctxFor(st, t, choose)); } catch (e) { ran.push('THROW ' + String(e.stack).split('\n').slice(0, 2).join(' | ')); }
    S.resolvePending(st, t.uid);
  }
  return ran;
}
export async function fire(st, p, stack, evt, choose) { S.queueTriggersForStack(st, p, stack, evt); return drain(st, choose); }
export function evo(st, p, stack, id, cost = 0) { st.players[p].hand.push(id); return S.digivolve(st, p, stack.uid, id, cost, 'hand'); }
export const dp = (st, p, s) => S.effectiveDP(st, p, s);
export const pend = (st) => st.pending.filter(x => !x.resolved).map(t => `${t.cardId}【${t.tags.join('|')}】`);
export const nm = (id) => S.card(id)?.nameKo || id;
// ---- mini test runner: each scenario cites its Q id ----
const results = [];
export async function scenario(qid, name, fn) {
  try { const notes = []; const chk = (c, m) => { if (!c) notes.push(m); }; await fn(chk); results.push({ qid, name, ok: notes.length === 0, notes }); }
  catch (e) { results.push({ qid, name, ok: false, notes: ['EXC ' + String(e.stack).split('\n').slice(0, 3).join(' | ')] }); }
}
export function report() {
  let bad = 0; for (const r of results) { if (!r.ok) bad++; console.log(`${r.ok ? 'PASS' : 'FAIL'} Q${r.qid} ${r.name}${r.ok ? '' : ' :: ' + r.notes.join(' ; ')}`); }
  console.log(`${results.length - bad}/${results.length} passed`); process.exitCode = bad ? 1 : 0;
}
// ---- appended helpers (slice 5) ----
export const idByName = (name, pred = () => true) => Object.values(S.CARDS).find(c => c.nameKo === name && pred(c))?.id;
export const zoneNames = (st, p, z) => st.players[p][z].map(x => nm(typeof x === 'string' ? x : x.cardId));
// fire an event on p's stack of `holder` and drain with a chooser; opts.confirm decides every confirmEffect (default true); opts.answer overrides
export async function runOn(st, p, holder, evt, opts = {}) {
  const ch = mkChoose(st, { answer: (k, o, s) => { const a = opts.answer && opts.answer(k, o, s); if (a !== undefined) return a; if (k === 'confirmEffect' && opts.confirm !== undefined) return opts.confirm; return undefined; } });
  const ran = await fire(st, p, stk(st, p, holder), evt, ch);
  return { ran, log: ch.log };
}
export const countOf = (st, p, z, id) => st.players[p][z].filter(x => (typeof x === 'string' ? x : x.cardId) === id).length;
