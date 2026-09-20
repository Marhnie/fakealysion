// Reusable random-play driver (derived from soak.mjs) for snapshot/replay tests.
// makeDriver(rng) -> { newRandomGame(), step(state) } ; step plays ONE player action (or a turn transition) and drains pending effects.
import * as fs from 'fs';
import * as S from '../src/state.js';
import * as E from '../src/engine.js';
import * as Fx from '../src/effects.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url.replace(/^\.\//, './'), 'utf8')) });
export async function init() { await S.loadData(); }
export function makeRng(seed) { let a = seed >>> 0; const f = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; f.get = () => a; f.set = (v) => { a = v; }; return f; }
export function makeDriver(rng) {
  const rnd = (n) => Math.floor(rng() * n), pick = (a) => a[rnd(a.length)];
  const cards = Object.values(S.CARDS);
  const mainPool = cards.filter(c => ['digimon', 'tamer', 'option'].includes(c.category));
  const eggPool = cards.filter(c => c.category === 'digitama' || (c.category === 'digimon' && c.level === 2));
  function randomDeck(name) {
    const main = {}, dig = {};
    for (let i = 0; i < 50; i++) { const c = pick(mainPool); main[c.id] = (main[c.id] || 0) + 1; }
    for (let i = 0; i < 5; i++) { const c = pick(eggPool); dig[c.id] = (dig[c.id] || 0) + 1; }
    return { name, main, digitama: dig };
  }
  async function drainPending(state) {
    let guard = 0;
    while (guard++ < 40) {
      const t = state.pending.find(x => !x.resolved);
      if (!t) return;
      try {
        if (t.schedFn) { t.schedFn(); S.resolvePending(state, t.uid); continue; }
        const specific = Fx.lookupCardSpecific(t.cardId, t.tags, t.text);
        const script = specific || Fx.compileToScript(t.text);
        const ctx = { state, S, E, self: t.player, opp: S.opponentOf(t.player), sourceCardId: t.cardId, sourceStackUid: t.stackUid, startAttack() {},
          choose: async (k, o) => { if (k === 'pickStack') return o.uids?.[rnd(o.uids.length || 1)] ?? null; if (k === 'pickStackAnySide') return o.entries?.[0] ?? null; if (k === 'pickFromZoneIndex') return o.eligibleIdxs?.[0] ?? null; if (k === 'pickFromHandIndexes') return (o.eligibleIdxs || []).slice(0, o.n || 1); if (k === 'pickFromRevealed') return o.eligible?.slice(0, o.max || 1).map(x => x.i) || []; if (k === 'confirmEffect') return rng() < 0.7; return null; } };
        await Fx.runScript(script, ctx);
      } catch (e) { /* swallow */ }
      S.resolvePending(state, t.uid);
    }
  }
  async function finishTurn(state) { let g = 0; while (state.turnEnding && !state.winner && g++ < 10) { await drainPending(state); E.settleTurnEnd(state); } }
  function newRandomGame() {
    const state = S.newGame(randomDeck('A'), randomDeck('B'));
    E.drawOpeningHand(state, 'p1'); E.drawOpeningHand(state, 'p2'); E.setSecurityStacks(state); E.beginGame(state, rng() < 0.5 ? 'p1' : 'p2');
    return state;
  }
  // one action: returns a label
  async function step(state) {
    if (state.winner) return null;
    if (state.phase !== 'main') { E.nextPhase(state); await drainPending(state); return 'phase'; }
    const p = state.activePlayer, pl = state.players[p], opp = S.opponentOf(p);
    if (!state.breedingActionTaken && !pl.raising && pl.digitamaDeck.length && rng() < 0.4) { S.hatchDigitama(state, p); await drainPending(state); return 'hatch'; }
    const r = rng(); let label = 'noop';
    try {
      if (r < 0.3) { const idxs = pl.hand.map((id, i) => i).filter(i => ['digimon', 'tamer'].includes(S.card(pl.hand[i]).category)); if (idxs.length) { const i = pick(idxs); S.spendMemory(state, S.card(pl.hand[i]).cost || 0); S.playDigimonFresh(state, p, i); label = 'play'; } }
      else if (r < 0.42) { const idxs = pl.hand.map((id, i) => i).filter(i => S.card(pl.hand[i]).category === 'option'); if (idxs.length) { S.useOptionCard(state, p, pick(idxs)); label = 'option'; } }
      else if (r < 0.62) { const st = pick([...pl.battle, ...(pl.raising ? [pl.raising] : [])].filter(Boolean)); const hi = st ? pl.hand.map((id, i) => i).filter(i => S.card(pl.hand[i]).category === 'digimon' && E.canEvolveAny(st.cardId, pl.hand[i], st.extraColors || [], S.evolveTargetRestriction(state, p, st)).ok) : []; if (st && hi.length) { const i = pick(hi); const chk = E.canEvolveAny(st.cardId, pl.hand[i], st.extraColors || [], null); S.digivolve(state, p, st.uid, pl.hand[i], Math.max(0, chk.cost || 0), 'hand'); label = 'evolve'; } }
      else if (r < 0.9) { const att = pick(pl.battle.filter(s => !s.suspended && S.card(s.cardId).category === 'digimon')); if (att) { const dec = S.declareAttack(state, p, att.uid); if (dec.ok) { S.queueTriggersForStack(state, p, dec.stack, 'attack'); S.emitGameEvent(state, 'attack', { owner: p, stack: dec.stack, cause: null }); const targets = S.legalDigimonTargets(state, p, att.uid); if (targets.length && rng() < 0.5) S.resolveDigimonBattle(state, p, att.uid, pick(targets)); else { const res = S.resolveSecurityCheck(state, p, att.uid, opp); if (!res.gameOver) { const last = res.checks[res.checks.length - 1]; if (last && (last.result === 'defenderWins' || last.result === 'tie')) S.deleteStack(state, p, att.uid, 'trash', 'battle'); } } S.queueTriggersForStack(state, p, dec.stack, 'attackEnd'); label = 'attack'; } } }
    } catch (e) { label = 'err'; }
    await drainPending(state);
    if (!state.winner && state.activePlayer === p && state.phase === 'main' && (label === 'noop' || rng() < 0.08)) { E.endTurn(state, false); await finishTurn(state); await drainPending(state); label = 'endturn'; }
    else if (E.checkAutoEndTurn(state)) { await finishTurn(state); label = 'autoend'; }
    return label;
  }
  return { newRandomGame, step, drainPending, rnd, pick };
}
