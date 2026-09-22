// Slice-6 helpers for the official-Q&A scenario suites (scripts/qa/qa-slice6-*.mjs).  (own file: scripts/qa/lib.mjs belongs to other slices)
// Scenarios run on the REAL engine (state.js / engine.js / effects.js); effect prompts are answered by a scripted policy.
//   scenario('G15', 'own-words description', async () => { const w = W({...}); ...; w.eq(actual, expected, 'what'); return w; });
import * as fs from 'fs';
import * as S from '../../src/state.js';
import * as E from '../../src/engine.js';
import * as Fx from '../../src/effects.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url, 'utf8')) });
await S.loadData();
export { S, E, Fx };
export const C = (id) => S.CARDS[id];
const cards = Object.values(S.CARDS);
// a plain (no effect text) digimon of a given level; distinct picks via `n`
export function plain(level = 3, n = 0, extra = {}) {
  const l = cards.filter((c) => c.category === 'digimon' && c.level === level && c.dp && !(c.effectKo || '').trim() && !(c.inheritedKo || '').trim() && (!extra.color || (c.colors || []).includes(extra.color)) && (!extra.dp || c.dp === extra.dp) && (!extra.cost || c.cost === extra.cost));
  return l[n % l.length].id;
}
export const plainTamer = () => cards.find((c) => c.category === 'tamer' && !(c.effectKo || '').trim() && !(c.inheritedKo || '').trim()).id;
export const plainOption = () => cards.find((c) => c.category === 'option' && !(c.effectKo || '').trim()).id;
const FILL = plain(3, 0);

// ---------- world ----------
// spec per player: { hand:[ids], trash:[ids], security:[ids], deck:[ids]|n, battle:[ id | {id, src:[ids], susp, fresh} ], raising: same }
export function world(spec = {}) {
  const deckOf = () => { const main = {}; for (let i = 0; i < 20; i++) main[plain(3, i)] = 1; return { name: 'x', main, digitama: {} }; };
  const st = S.newGame(deckOf(), deckOf());
  const w = { st, prompts: [], answers: {}, results: [], errors: [] };
  const mk = (p, e, raising = false) => {
    const o = typeof e === 'string' ? { id: e } : e;
    const s = S._s4.makeStack(o.id, 1); s.sources = [...(o.src || [])]; s.attackEligibleTurn = o.fresh ? 99 : 0; s.suspended = !!o.susp;
    if (raising) st.players[p].raising = s; else st.players[p].battle.push(s);
    S.recomputeStackGrants(s); return s;
  };
  for (const p of ['p1', 'p2']) {
    const pl = st.players[p], sp = spec[p] || {};
    pl.hand = [...(sp.hand || [])]; pl.trash = [...(sp.trash || [])]; pl.security = [...(sp.security || [FILL, FILL, FILL, FILL, FILL])]; pl.battle.length = 0; pl.raising = null;
    pl.deck = Array.isArray(sp.deck) ? [...sp.deck] : Array.from({ length: sp.deck ?? 20 }, (_, i) => plain(3, i));
    w[p] = { stacks: (sp.battle || []).map((e) => mk(p, e)) };
    if (sp.raising) w[p].raising = mk(p, sp.raising, true);
  }
  st.turnNumber = spec.turn || 3; st.activePlayer = spec.active || 'p1'; st.phase = 'main'; st.memory = spec.memory ?? 3; st.pending = [];
  w.mk = (p, e) => { const s = mk(p, e); w[p].stacks.push(s); return s; };
  const rec = (ok, msg) => w.results.push({ ok, msg });
  w.eq = (a, b, what) => rec(JSON.stringify(a) === JSON.stringify(b), `${what} | got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
  w.ok = (c, what) => rec(!!c, what);
  w.pl = (p) => st.players[p];
  w.find = (p, uid) => find(st, p, uid);
  w.dp = (p, s) => S.effectiveDP(st, p, s);
  w.drain = () => drain(w);
  w.play = async (p, id, cost = 0) => { const pl = st.players[p]; const i = pl.hand.indexOf(id); if (i < 0) throw new Error('not in hand ' + id); if (cost) S.spendMemory(st, cost); const s = S.playDigimonFresh(st, p, i); if (s) w[p].stacks.push(s); await drain(w); return s; };
  w.evolve = async (p, uid, id, cost = 0) => { const r = S.digivolve(st, p, uid, id, cost, 'hand'); await drain(w); return r; };
  w.attack = (p, uid, target) => attack(w, p, uid, target);
  w.run = (p, uid, tag, opts = {}) => runSeg(w, p, uid, tag, opts);
  w.runCard = (p, cardId, tag, opts = {}) => runSeg(w, p, null, tag, { ...opts, cardId });
  w.effPlay = async (p, id) => { const pl = st.players[p]; const i = pl.hand.indexOf(id); if (i < 0) throw new Error('not in hand ' + id); const s = S.playFreeFromZone(st, p, 'hand', i); if (s) w[p].stacks.push(s); await drain(w); return s; };
  w.useOption = async (p, id) => { const pl = st.players[p]; const i = pl.hand.indexOf(id); if (i < 0) throw new Error('not in hand ' + id); const r = S.useOptionCard(st, p, i); await drain(w); return r; };
  w.fires = (cardId, tagSub) => (w.fired || []).filter((f) => f.cardId === cardId && (!tagSub || (f.tags || []).some((x) => x.includes(tagSub)))).length;
  // run free effect text (compiled like printed card text) as player p; source card decides digimon/option category for immunity
  w.exec = async (p, text, sourceId, uid = null, o = {}) => { const stk = uid ? find(st, p, uid) : null; st.pending.push({ uid: 'qx' + Math.random(), player: p, cardId: sourceId, stackUid: uid, topId: stk ? stk.cardId : undefined, tags: o.tags || [], text, resolved: false, inherited: !!o.inherited, ...(o.trigger || {}) }); await drain(w); };
  return w;
}
export const W = world;
function find(st, p, uid) { const pl = st.players[p]; return pl.raising && pl.raising.uid === uid ? pl.raising : pl.battle.find((s) => s.uid === uid); }

// ---------- effect drain (mirrors src/cpusim.js drain() with a scripted chooser) ----------
// w.answers.<kind> = (o, t, w) => value (undefined -> default). kinds: confirmEffect,pickStack,pickStackAnySide,pickFromZoneIndex,pickFromHandIndexes,pickFromRevealed,multipleChoice
export function defaultAnswer(k, o) {
  switch (k) {
    case 'pickStack': return o.uids?.[0] ?? null;
    case 'pickStackAnySide': return o.entries?.[0] ? { player: o.entries[0].player, uid: o.entries[0].uid } : null;
    case 'pickFromZoneIndex': return o.eligibleIdxs?.[0] ?? null;
    case 'pickFromHandIndexes': return (o.eligibleIdxs || []).slice(0, o.n || 1);
    case 'pickFromRevealed': return (o.eligible || []).slice(0, o.max ?? 1).map((x) => x.i);
    case 'multipleChoice': return 0;
    case 'confirmEffect': return true;
    default: return null;
  }
}
export async function drain(w) {
  const state = w.st; let guard = 0;
  while (guard++ < 60) {
    if (state._rcPending && !(state._rcDepth > 0)) S.flushRuleChecks(state);
    // `_running`: a trigger whose script is already executing further up the call stack (ctx.securityCheck calling
    // scriptedSecCheck()/drain() reentrantly mid-script) — skip it so a nested drain() only picks up genuinely NEW
    // pending items, never re-runs the still-in-flight outer trigger a second time.
    const t = state.pending.find((x) => !x.resolved && !x._running);
    if (!t) { S.normalizeDigitamaZones(state); return; } // 3-1-3-9 (main.js does this through E.autoAdvance)
    t._running = true;
    (w.fired ||= []).push({ cardId: t.cardId, tags: t.tags, player: t.player });
    try {
      if (t.schedFn) { t.schedFn(); S.resolvePending(state, t.uid); continue; }
      if (t.manualOnly) { S.resolvePending(state, t.uid); continue; }
      if (S.waitingDestroyEffectGone(state, t)) { S.resolvePending(state, t.uid); continue; }
      let script = Fx.lookupCardSpecific(t.cardId, t.tags, t.text, !!t.inherited);
      if (!script && /^이\s*카드의\s*【메인】\s*효과를\s*발(?:휘|동)한다\.?$/.test(t.text.trim())) {
        const seg = S.parseEffectSegments(S.card(t.cardId).effectKo || '').segments.find((s) => s.tags.includes('메인'));
        if (seg) script = Fx.lookupCardSpecific(t.cardId, seg.tags, seg.body) || Fx.compileToScript(seg.body);
      }
      script = script || Fx.compileToScript(t.text);
      if (t.stackUid && t.topId && !(t.evt && t.evt.leaving) && !(t.tags || []).some((x) => x.includes('소멸 시'))) {
        const stNow = find(state, t.player, t.stackUid);
        if (!stNow || stNow.cardId !== t.topId) { S.resolvePending(state, t.uid); continue; }
      }
      const om = String(t.text || '').match(/^[\[〔]턴\s*에?\s*(\d+)\s*회[\]〕]/);
      let onceMark = null;
      if (om && t.stackUid) {
        const st1 = find(state, t.player, t.stackUid);
        if (st1) { const key = S.onceLimitKey(t.cardId, t.tags); if (S.turnUsesRemaining(st1, key, Number(om[1])) <= 0) { S.resolvePending(state, t.uid); continue; } onceMark = { stack: st1, key }; }
      }
      if (onceMark && script.length === 1 && script[0].op === 'condition' && !(script[0].else || []).length) {
        try { if (!(await Fx.evalConditionPublic(script[0].if, { state, S, E, self: t.player, opp: S.opponentOf(t.player), sourceCardId: t.cardId, sourceStackUid: t.stackUid, trigger: t }))) onceMark = null; } catch (e) { /* keep */ }
      }
      if (onceMark) S.markTurnEffectUsed(onceMark.stack, onceMark.key);
      const ctx = { state, S, E, self: t.player, opp: S.opponentOf(t.player), sourceCardId: t.cardId, sourceStackUid: t.stackUid, trigger: t, startAttack: (p, uid, tgt, o) => (w.attackReqs ||= []).push({ p, uid, tgt, o }), attack: () => state.attackCtx, endAttack() {},
        securityCheck: async (p, uid, op) => { if (!S.consumePierceCheck(state, p, uid)) return; await scriptedSecCheck(w, p, uid, op || S.opponentOf(p)); },
        choose: async (k, o) => { w.prompts.push({ k, card: t.cardId, o }); const f = w.answers[k]; if (f) { const r = await f(o, t, w); if (r !== undefined) return r; } return defaultAnswer(k, o); } };
      await Fx.runScript(script, ctx);
      if (onceMark && (ctx._declined || (ctx._costUnpaid && script.length === 1 && script[0].op === 'costGroup'))) { const u = onceMark.stack.turnEffectUses; if (u && u[onceMark.key] > 0) u[onceMark.key]--; }
    } catch (e) { w.errors.push(String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ')); }
    S.resolvePending(state, t.uid);
  }
}
// run one printed segment of a card's text (tag substring like '등장 시') as if triggered
async function runSeg(w, p, uid, tagWanted, opts = {}) {
  const state = w.st; const stk = uid ? find(state, p, uid) : null; const id = opts.cardId || stk.cardId;
  const segs = S.parseEffectSegments((opts.inherited ? (S.card(id).optionKo || S.card(id).inheritedKo) : S.card(id).effectKo) || '').segments;
  const seg = segs.find((s) => s.tags.some((x) => x.includes(tagWanted)));
  if (!seg) throw new Error('no segment ' + tagWanted + ' on ' + id);
  state.pending.push({ uid: 'qa' + Math.random(), player: p, cardId: id, stackUid: uid, topId: stk ? stk.cardId : undefined, tags: seg.tags, text: opts.body || seg.body, resolved: false, inherited: !!opts.inherited, ...(opts.trigger || {}) });
  await drain(w);
}
// shared security-check runner (real attack's own check, or a scripted "can battle" op's ≪관통≫ bonus check via ctx.securityCheck)
async function scriptedSecCheck(w, p, uid, op) {
  const state = w.st;
  const ctl = S.beginSecurityCheck(state, p, uid, op); ctl.deferBattle = true; let g = 0;
  while (!ctl.done && !state.winner && g++ < 30) {
    if (ctl.awaiting) { await drain(w); S.battleSecurityCheck(ctl, ctl.awaiting.id); } else S.stepSecurityCheck(ctl);
    await drain(w);
    if (ctl.awaiting) { await drain(w); S.battleSecurityCheck(ctl, ctl.awaiting.id); }
  }
  if (!ctl.gameOver && ctl.results.length) { const last = ctl.results[ctl.results.length - 1]; if (last.result === 'defenderWins' || last.result === 'tie') S.deleteStack(state, p, uid, 'trash', 'battle'); }
}
// attack: declare -> triggers -> (no counter/block) -> security check or digimon battle. target 'PLAYER' or uid of an opponent digimon
async function attack(w, p, uid, target) {
  const state = w.st; const op = S.opponentOf(p);
  const dec = S.declareAttack(state, p, uid); if (!dec.ok) return { ok: false, reason: dec.reason };
  const pa = { attacker: p, opp: op, uid, targetKind: target === 'PLAYER' ? 'player' : 'digimon', targetUid: target === 'PLAYER' ? null : target };
  pa.pierceUsed = !!dec.stack._pierceHeld; delete dec.stack._pierceHeld; // adopt a ≪관통≫ hold left by a scripted battle that ran before this attack existed (S.consumePierceCheck)
  state.attackCtx = pa; pa.terminate = () => { pa.ended = true; };
  S.queueTriggersForStack(state, p, dec.stack, 'attack');
  S.emitGameEvent(state, 'attack', { owner: p, stack: dec.stack, cause: null });
  await drain(w);
  const alive = () => find(state, p, uid) && !(pa.targetKind === 'digimon' && !find(state, op, pa.targetUid));
  if (!state.winner && !pa.ended && alive()) {
    if (pa.targetKind === 'player') await scriptedSecCheck(w, p, uid, op);
    else { const res = S.resolveDigimonBattle(state, p, uid, pa.targetUid); await drain(w); if (res && res.piercing && !state.winner && S.consumePierceCheck(state, p, uid)) await scriptedSecCheck(w, p, uid, op); }
  }
  await drain(w);
  const st = find(state, p, uid); state.attackCtx = null;
  if (st) { S.s8AttackEnded(state, p, uid); S.queueTriggersForStack(state, p, st, 'attackEnd'); S.emitGameEvent(state, 'attackEnd', { owner: p, stack: st, cause: null }); }
  await drain(w);
  return { ok: true };
}

// ---------- scenario registry ----------
const REG = [];
export function scenario(g, desc, fn, opts = {}) { REG.push({ g, desc, fn, xfail: opts.xfail || null }); } // opts.xfail = reason: known engine gap (reported, not counted as a failure)
export async function run(tag = 'slice6') {
  let pass = 0, fail = 0, xf = 0; const failed = []; const rows = [];
  const only = process.argv.slice(2);
  for (const s of REG) {
    if (only.length && !only.includes(s.g)) continue;
    let ok = true; const notes = [];
    try { const w = await s.fn(); const res = (w && w.results) || []; for (const x of res) if (!x.ok) { ok = false; notes.push(x.msg); } if (!res.length) { ok = false; notes.push('no assertions'); } if (w && w.errors && w.errors.length) { ok = false; notes.push('engine error: ' + w.errors[0]); } }
    catch (e) { ok = false; notes.push('threw ' + String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ')); }
    if (s.xfail) { rows.push({ g: s.g, ok, xfail: true }); if (ok) console.log(`XPASS ${s.g} (expected gap now passes) ${s.desc}`); else { xf++; console.log(`KNOWN-GAP ${s.g} ${s.desc}
   - ${s.xfail}`); } continue; }
    rows.push({ g: s.g, ok }); if (ok) pass++; else { fail++; failed.push(s.g); console.log(`FAIL ${s.g} ${s.desc}\n   - ${notes.join('\n   - ')}`); }
  }
  console.log(`${tag}: ${pass} pass, ${fail} fail, ${xf} known-gap`);
  if (fail) console.log('failed:', failed.join(' '));
  try { fs.mkdirSync('scripts/qa/s6', { recursive: true }); fs.writeFileSync(`scripts/qa/s6/_res-${tag}.json`, JSON.stringify(rows)); } catch (e) { /* ignore */ }
  return { pass, fail, failed };
}
