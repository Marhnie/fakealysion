// Slice3 QA scenario helper (official Q&A conformance). Run from repo root: node scripts/qa/qa-slice3-*.mjs < /dev/null
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
export const C = (id) => S.CARDS[id];
const filler = Object.values(S.CARDS).filter(c => c.category === 'digimon' && c.level === 3).slice(0, 30).map(c => c.id);
export const FILL = filler;
export function newState() {
  const deck = (n) => { const main = {}; for (let i = 0; i < 20; i++) main[filler[i]] = 1; return { name: n, main, digitama: {} }; };
  const st = S.newGame(deck('A'), deck('B'));
  for (const p of ['p1', 'p2']) { const pl = st.players[p]; pl.hand = []; pl.trash = []; pl.security = []; pl.battle.length = 0; pl.deck = [...filler.slice(0, 15)]; pl.raising = null; }
  st.turnNumber = 3; st.activePlayer = 'p1'; st.phase = 'main'; st.memory = 0; return st;
}
// put a stack [top, ...sources] on the battle area (able to attack)
export function put(st, p, ids, opts = {}) { const s = S._s4.makeStack(ids[0], 1); s.sources = ids.slice(1); s.attackEligibleTurn = 0; if (opts.rest) s.suspended = true; st.players[p].battle.push(s); S.recomputeStackGrants(s); return s; }
export const other = (p) => (p === 'p1' ? 'p2' : 'p1');
// drain pending effects with a scripted chooser: ch(kind, opts, trigger) -> answer (undefined => default)
export async function drain(st, ch) {
  let guard = 0; const ran = [];
  while (guard++ < 60) {
    const t = st.pending.find(x => !x.resolved); if (!t) break;
    { const pl_ = st.players[t.player]; if (t.stackUid && t.topId && !t.evt?.leaving && !t.tags.some(x => x.includes('소멸 시'))) { const n = [pl_.raising, ...pl_.battle].filter(Boolean).find(x => x.uid === t.stackUid); if (!n || n.cardId !== t.topId || (t.inherited && !n.sources.includes(t.cardId) && !(n.linkCards || []).some(l => l.cardId === t.cardId))) { S.resolvePending(st, t.uid); continue; } } } // same 'stack/source left before it resolved' guard as the real UI drain
    try {
      if (t.schedFn) { t.schedFn(); S.resolvePending(st, t.uid); continue; }
      const specific = Fx.lookupCardSpecific(t.cardId, t.tags, t.text, !!t.inherited);
      const script = specific || Fx.compileToScript(t.text);
      const om = String(t.text || '').match(/^[\[〔]턴\s*에?\s*(\d+)\s*회[\]〕]/);
      if (om && t.stackUid) { const pl0 = st.players[t.player]; const st1 = [pl0.raising, ...pl0.battle].filter(Boolean).find(x => x.uid === t.stackUid); if (st1) { const key = S.onceLimitKey(t.cardId, t.tags); if (S.turnUsesRemaining(st1, key, Number(om[1])) <= 0) { S.resolvePending(st, t.uid); continue; } S.markTurnEffectUsed(st1, key); } } // same once-per-turn gate as main.js / cpusim.js
      ran.push(t.cardId + ':' + (t.tags || []).join(','));
      const ctx = { state: st, S, E, self: t.player, opp: S.opponentOf(t.player), sourceCardId: t.cardId, sourceStackUid: t.stackUid, trigger: t, startAttack() {}, attack: () => st.attackCtx, endAttack() { if (st.attackCtx && st.attackCtx.terminate) st.attackCtx.terminate(); }, securityCheck: async () => {}, // ≪관통≫ bonus check not modeled here — no-op stub so scripted "can battle" ops don't throw
        choose: async (k, o) => { let r; if (ch) r = await ch(k, o, t); if (r !== undefined) return r;
          if (k === 'pickStack') return o.uids?.[0] ?? null; if (k === 'pickStackAnySide') return o.entries?.[0] ?? null; if (k === 'pickFromZoneIndex') return o.eligibleIdxs?.[0] ?? null;
          if (k === 'pickFromHandIndexes') return (o.eligibleIdxs || []).slice(0, o.n || 1); if (k === 'pickFromRevealed') return o.eligible?.slice(0, o.max || 1).map(x => x.i) || []; if (k === 'confirmEffect') return true; return null; } };
      await Fx.runScript(script, ctx);
    } catch (e) { st.__err = e; if (process.env.QA_DEBUG) console.log('  drain err', e.message); }
    S.resolvePending(st, t.uid);
  }
  return ran;
}
export async function playCard(st, p, id, ch) { st.players[p].hand.push(id); const i = st.players[p].hand.length - 1; const cost = 0; S.playDigimonFresh(st, p, i); const r = await drain(st, ch); return r; }
export async function trig(st, p, stack, tag, ch) { S.queueTriggersForStack(st, p, stack, tag); return drain(st, ch); }
const results = [];
export async function sc(qid, name, fn) {
  let r; try { r = await fn(); } catch (e) { r = 'ERROR ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | '); }
  const ok = r === true || r === undefined; results.push({ qid, name, ok, msg: ok ? '' : String(r) });
  console.log((ok ? 'PASS ' : 'FAIL ') + qid + ' ' + name + (ok ? '' : ' :: ' + r));
}
export function finish(tag) { const f = results.filter(r => !r.ok); console.log(`\n${tag}: ${results.length - f.length}/${results.length} pass`); process.exit(f.length ? 1 : 0); }
export const eq = (m, a, b) => (a === b ? true : `${m}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
export const all = (...rs) => rs.find(r => r !== true) ?? true;
