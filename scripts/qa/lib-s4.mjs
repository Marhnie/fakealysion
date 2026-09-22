// Slice-4 helpers for the official-Q&A scenario tests (scripts/qa/qa-slice4-*.mjs). Run: node scripts/qa/qa-slice4-x.mjs < /dev/null
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(path.resolve(ROOT, String(url).replace(/^\.\//, '')), 'utf8')) });
process.chdir(ROOT);
export const S = await import(pathToFileURL(path.join(ROOT, 'src/state.js')).href);
export const E = await import(pathToFileURL(path.join(ROOT, 'src/engine.js')).href);
export const Fx = await import(pathToFileURL(path.join(ROOT, 'src/effects.js')).href);
await S.loadData();
export const C = S.CARDS;
const cards = Object.values(S.CARDS);
export const FILL = cards.filter(c => c.category === 'digimon' && c.level === 3).slice(0, 20).map(c => c.id);
export function newState() {
  const deck = (n) => { const main = {}; for (let i = 0; i < 20; i++) main[FILL[i % FILL.length]] = (main[FILL[i % FILL.length]] || 0) + 1; return { name: n, main, digitama: {} }; };
  const st = S.newGame(deck('A'), deck('B'));
  for (const p of ['p1', 'p2']) { const pl = st.players[p]; pl.hand = []; pl.trash = []; pl.security = []; pl.battle.length = 0; pl.deck = [...FILL.slice(0, 15)]; pl.raising = null; }
  st.turnNumber = 3; st.activePlayer = 'p1'; st.phase = 'main'; st.memory = 0; return st;
}
// put(st,'p1',[topId, ...sources], {suspended}) -> stack
export function put(st, p, ids, { suspended = false } = {}) {
  const arr = Array.isArray(ids) ? ids : [ids];
  const stk = S._s4.makeStack(arr[0], 1); stk.sources = arr.slice(1); stk.suspended = suspended; stk.attackEligibleTurn = 0;
  st.players[p].battle.push(stk); S.recomputeStackGrants?.(stk); return stk;
}
// pool(pred) -> card ids (non-token) of Korean-DB cards
export const pool = (pred, n = 3) => cards.filter(c => !c.isToken && pred(c)).slice(0, n).map(c => c.id);
export const dig = (lv, color, extra = () => true) => (c) => c.category === 'digimon' && c.level === lv && (!color || (c.colors.length === 1 && c.colors[0] === color)) && extra(c);
export function makeCtx(st, { self = 'p1', cardId = null, stackUid = null, text = null, tags = [], picks = {}, trigger = {}, startAttack = () => {} } = {}) {
  const calls = [];
  const ctx = { state: st, S, E, self, opp: S.opponentOf(self), sourceCardId: cardId, sourceStackUid: stackUid, startAttack, trigger: { text, cardId, tags, player: self, stackUid, ...trigger }, calls, asked: [],
    choose: async (k, o) => {
      calls.push(k); if (k === 'confirmEffect') ctx.asked.push(o.prompt || '');
      const pk = picks[k]; if (typeof pk === 'function') return pk(o, calls);
      if (Array.isArray(pk) && pk.length) return pk.shift();
      if (k === 'pickStack') return o.uids?.[0] ?? null; if (k === 'pickStackAnySide') return o.entries?.[0] ?? null;
      if (k === 'pickFromZoneIndex') return o.eligibleIdxs?.[0] ?? null; if (k === 'pickFromHandIndexes') return (o.eligibleIdxs || []).slice(0, o.n || 1);
      if (k === 'pickFromRevealed') return o.eligible?.slice(0, o.max || 1).map(x => x.i) || [];
      if (k === 'confirmEffect') return true; if (k === 'multipleChoice') return 0; return null;
    } };
  return ctx;
}
// run one effect segment of a card by tag (Korean, e.g. '등장 시'); text defaults to the first segment with that tag (effect, then inherited)
export async function runEffect(st, cardId, tag, o = {}) {
  const c = S.card(cardId); let text = o.text;
  if (!text) { for (const k of ['effectKo', 'inheritedKo', 'optionKo']) { const segs = S.parseEffectSegments(c[k] || '').segments; const seg = segs.filter(s => s.tags.includes(tag))[o.idx || 0]; if (seg) { text = seg.body; break; } } }
  const spec = Fx.lookupCardSpecific(cardId, [tag], text, !!o.inherited); const sc = spec || Fx.compileToScript(text);
  const ctx = makeCtx(st, { ...o, cardId, text, tags: [tag] });
  await Fx.runScript(sc, ctx); return ctx;
}
export async function drain(st, picks = {}) {
  let g = 0; const done = [];
  while (g++ < 40) {
    const t = st.pending.find(x => !x.resolved); if (!t) break;
    try {
      if (t.schedFn) { await t.schedFn(); S.resolvePending(st, t.uid); done.push('sched'); continue; }
      const spec = Fx.lookupCardSpecific(t.cardId, t.tags, t.text, !!t.inherited); const sc = spec || Fx.compileToScript(t.text);
      await Fx.runScript(sc, makeCtx(st, { self: t.player, cardId: t.cardId, stackUid: t.stackUid, text: t.text, tags: t.tags, picks, trigger: t }));
      done.push(t.cardId + ':' + (t.tags || []).join('/'));
    } catch (e) { done.push('ERR ' + e.message); }
    S.resolvePending(st, t.uid);
  }
  return done;
}
// scenarios = [{q, card, fn: async(check)=>void}]; check(cond,msg)
export async function runAll(scenarios, label) {
  let pass = 0, fail = 0; const fails = [];
  for (const sc of scenarios) {
    const bad = []; const check = (cond, msg) => { if (!cond) bad.push(msg || 'assert'); };
    try { await sc.fn(check); } catch (e) { bad.push('EXC ' + String(e.stack || e).split('\n').slice(0, 2).join(' | ')); }
    if (process.env.QA_OUT) fs.appendFileSync(process.env.QA_OUT, JSON.stringify({ q: sc.q, card: sc.card, ok: !bad.length, msg: bad.join(' ; ').slice(0, 160) }) + String.fromCharCode(10));
    if (bad.length) { fail++; fails.push(sc.q); console.log('FAIL Q' + sc.q, sc.card || '', bad.join(' ; ')); } else pass++;
  }
  console.log(`${label}: pass ${pass} fail ${fail}` + (fails.length ? ' [' + fails.join(',') + ']' : ''));
  return { pass, fail, fails };
}
// activate the 《딜레이》 of a placed option stack like main.js does: discard it, then run the bullet text through the (card-specific or compiled) script
export async function runDelay(st, p, uid, picks = {}) {
  const stk = st.players[p].battle.find(s => s.uid === uid); const cardId = stk.cardId; const body = S.parseDelayEffect(C[cardId].effectKo);
  const ok = S.discardForDelay(st, p, uid); if (!ok) return { ok: false };
  const spec = Fx.lookupCardSpecific(cardId, ['메인'], body); const sc = spec || Fx.compileToScript(body);
  const ctx = makeCtx(st, { self: p, cardId, stackUid: null, text: body, tags: ['메인'], picks });
  await Fx.runScript(sc, ctx); return { ok: true, ctx, body };
}
// run ALL effects of the printed 【메인】 of an option card placed via S.useOptionCard semantics is not needed; use runEffect(st,id,'메인',{idx})
// run a raw effect sentence through the generic compiler (no card-specific script); srcCard only names the source for logs/filters
export async function runText(st, text, o = {}) {
  const sc = Fx.compileToScript(text); const ctx = makeCtx(st, { ...o, cardId: o.cardId || null, text, tags: o.tags || ['__test'] });
  await Fx.runScript(sc, ctx); return ctx;
}
// put face-down evolution cards (뒷면) at the bottom of a stack's sources (s5fd = number of face-down cards, kept at the front of the array)
export function faceDown(stack, ids) { stack.sources.unshift(...ids); stack.s5fd = (S.fdCount(stack) || 0) + ids.length; stack.s5fdFlag = true; S.recomputeStackGrants?.(stack); return stack; }
