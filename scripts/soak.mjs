// Random-play soak test: plays N games between two random 50-card decks by calling
// the engine directly (no UI), auto-resolving every pending effect with scripted
// choices, and checks structural invariants after every action. Any thrown error or
// invariant violation is reported with a short stack.
//
// Run from the repo root: node scripts/soak.mjs [games=30]
import * as fs from 'fs';
import * as S from '../src/state.js';
import * as E from '../src/engine.js';
import * as Fx from '../src/effects.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url.replace(/^\.\//, './'), 'utf8')) });
await S.loadData();
// SOAK_INTERACTIVE=1: play with the browser's replacement gate (S.REPL.interactive) and answer every parked prompt (random candidate / decline).
let CUR = null, PARKED = 0, SOAK_TIMER = null;
if (process.env.SOAK_INTERACTIVE) {
  S.REPL.interactive = true;
  SOAK_TIMER = setInterval(() => { const pr = CUR && CUR.pendingReplacements; if (!pr || !pr.length) return; const e = pr[0]; PARKED++; try { S.resumeReplacement(CUR, e, Math.random() < 0.3 ? -1 : Math.floor(Math.random() * e.cands.length)); } catch (er) { note('resume', er); pr.shift(); } }, 1);
}
const cards = Object.values(S.CARDS);
const cats = {};
for (const c of cards) cats[c.category] = (cats[c.category] || 0) + 1;
const mainPool = cards.filter(c => ['digimon', 'tamer', 'option'].includes(c.category));
const eggPool = cards.filter(c => c.category === 'digitama' || (c.category === 'digimon' && c.level === 2));
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
function randomDeck(name) {
  const main = {}, dig = {};
  for (let i = 0; i < 50; i++) { const c = pick(mainPool); main[c.id] = (main[c.id] || 0) + 1; }
  for (let i = 0; i < 5; i++) { const c = pick(eggPool); dig[c.id] = (dig[c.id] || 0) + 1; }
  return { name, main, digitama: dig };
}
const errors = {};
function note(where, e) {
  const k = where + ': ' + String(e && e.message).slice(0, 90);
  errors[k] = errors[k] || { n: 0, stack: String(e && e.stack).split('\n').slice(0, 4).join(' | ') };
  errors[k].n++;
}
async function drainPending(state) {
  let guard = 0;
  while (guard++ < 40) {
    const t = state.pending.find(x => !x.resolved);
    if (!t) return;
    try {
      if (t.schedFn) { t.schedFn(); S.resolvePending(state, t.uid); continue; } // held end-of-turn effect (18-1)
      const specific = Fx.lookupCardSpecific(t.cardId, t.tags, t.text);
      let script = specific || Fx.compileToScript(t.text);
      const ctx = { state, S, E, self: t.player, opp: S.opponentOf(t.player), sourceCardId: t.cardId, sourceStackUid: t.stackUid, trigger: t, startAttack() {},
        choose: async (k, o) => { if (k === 'pickStack') return o.uids?.[rnd(o.uids.length || 1)] ?? null; if (k === 'pickStackAnySide') return o.entries?.[0] ?? null; if (k === 'pickFromZoneIndex') return o.eligibleIdxs?.[0] ?? null; if (k === 'pickFromHandIndexes') return (o.eligibleIdxs || []).slice(0, o.n || 1); if (k === 'pickFromRevealed') return o.eligible?.slice(0, o.max || 1).map(x => x.i) || []; if (k === 'confirmEffect') return Math.random() < 0.7; return null; } };
      await Fx.runScript(script, ctx);
    } catch (e) { note('pending', e); }
    S.resolvePending(state, t.uid);
  }
}
// Turn end is two-step (6-6): resolve everything the turn-end phase queued, then let the engine finish (or cancel) it.
async function finishTurn(state) {
  let guard = 0;
  while (state.turnEnding && !state.winner && guard++ < 10) { await drainPending(state); E.settleTurnEnd(state); }
}
function invariants(state, tag) {
  if (state.memory < -10 || state.memory > 10) note('invariant', new Error(tag + ' memory out of range ' + state.memory));
  const seen = new Set();
  for (const p of ['p1', 'p2']) {
    const pl = state.players[p];
    for (const z of ['hand', 'deck', 'trash', 'security']) for (const id of pl[z]) if (!S.CARDS[id]) note('invariant', new Error(tag + ' unknown card in ' + z + ': ' + id));
    for (const st of [pl.raising, ...pl.battle].filter(Boolean)) {
      if (seen.has(st.uid)) note('invariant', new Error(tag + ' duplicate uid ' + st.uid)); seen.add(st.uid);
      if (!S.CARDS[st.cardId]) note('invariant', new Error(tag + ' unknown stack card ' + st.cardId));
      for (const id of st.sources) if (!S.CARDS[id]) note('invariant', new Error(tag + ' unknown source ' + id));
      if (!st.keywords || !st.inheritedKeywords || st.tempDP === undefined) note('invariant', new Error(tag + ' malformed stack ' + st.cardId));
    }
  }
}
let games = 0, turns = 0, actions = 0;
const G = Number(process.argv[2] || 30);
for (let g = 0; g < G && true; g++) {
  const state = S.newGame(randomDeck('A'), randomDeck('B')); CUR = state;
  try {
    E.drawOpeningHand(state, 'p1'); E.drawOpeningHand(state, 'p2'); E.setSecurityStacks(state); E.beginGame(state, E.coinFlip());
  } catch (e) { note('setup', e); continue; }
  games++;
  for (let t = 0; t < 70 && !state.winner; t++) {
    turns++;
    try {
      let g2 = 0; while (state.phase !== 'main' && g2++ < 12) { E.nextPhase(state); await drainPending(state); }
      const p = state.activePlayer, pl = state.players[p], opp = S.opponentOf(p), opl = state.players[opp];
      // breeding-ish actions
      if (!pl.raising && pl.digitamaDeck.length && Math.random() < 0.8) { try { S.hatchDigitama(state, p); } catch (e) { note('hatch', e); } }
      else if (pl.raising && Math.random() < 0.5) { try { S.moveRaisingToBattle(state, p); } catch (e) { note('move', e); } }
      await drainPending(state);
      for (let a = 0; a < 6 && !state.winner && state.activePlayer === p && state.phase === 'main'; a++) {
        actions++;
        const r = Math.random();
        try {
          if (r < 0.3) { // play a digimon/tamer
            const idxs = pl.hand.map((id, i) => i).filter(i => ['digimon', 'tamer'].includes(S.card(pl.hand[i]).category));
            if (idxs.length) { const i = pick(idxs); const cost = S.card(pl.hand[i]).cost || 0; S.spendMemory(state, cost); S.playDigimonFresh(state, p, i); }
          } else if (r < 0.45) { // option
            const idxs = pl.hand.map((id, i) => i).filter(i => S.card(pl.hand[i]).category === 'option');
            if (idxs.length) { const i = pick(idxs); S.useOptionCard(state, p, i); }
          } else if (r < 0.65) { // evolve
            const st = pick([...pl.battle, ...(pl.raising ? [pl.raising] : [])].filter(Boolean));
            const hi = st ? pl.hand.map((id, i) => i).filter(i => S.card(pl.hand[i]).category === 'digimon' && E.canEvolveAny(st.cardId, pl.hand[i], st.extraColors || [], S.evolveTargetRestriction(state, p, st)).ok) : [];
            if (st && hi.length) { const i = pick(hi); const chk = E.canEvolveAny(st.cardId, pl.hand[i], st.extraColors || [], null); S.digivolve(state, p, st.uid, pl.hand[i], Math.max(0, (chk.cost || 0)), 'hand'); }
          } else { // attack
            const att = pick(pl.battle.filter(s => !s.suspended && S.card(s.cardId).category === 'digimon'));
            if (att) {
              const dec = S.declareAttack(state, p, att.uid);
              if (dec.ok) {
                S.queueTriggersForStack(state, p, dec.stack, 'attack'); S.emitGameEvent(state, 'attack', { owner: p, stack: dec.stack, cause: null });
                const targets = S.legalDigimonTargets(state, p, att.uid);
                if (targets.length && Math.random() < 0.5) S.resolveDigimonBattle(state, p, att.uid, pick(targets));
                else { const res = S.resolveSecurityCheck(state, p, att.uid, opp); if (!res.gameOver) { const last = res.checks[res.checks.length - 1]; if (last && (last.result === 'defenderWins' || last.result === 'tie')) S.deleteStack(state, p, att.uid, 'trash', 'battle'); } }
                S.queueTriggersForStack(state, p, dec.stack, 'attackEnd');
              }
            }
          }
        } catch (e) { note('action r=' + r.toFixed(1), e); }
        await drainPending(state);
        invariants(state, 'after action');
        try { if (E.checkAutoEndTurn(state)) { await finishTurn(state); break; } } catch (e) { note('autoEnd', e); break; }
      }
      if (!state.winner && state.activePlayer === p && state.phase === 'main') { try { E.endTurn(state, false); await finishTurn(state); } catch (e) { note('endTurn', e); break; } }
      await drainPending(state);
      // 6-6-4: a cancelled turn end leaves the same player in main phase — the next loop iteration keeps playing it.
    } catch (e) { note('turn', e); break; }
  }
}
if (SOAK_TIMER) clearInterval(SOAK_TIMER);
if (process.env.SOAK_INTERACTIVE) console.log('replacement prompts answered:', PARKED);
console.log('games', games, 'turns', turns, 'actions', actions, 'cats', JSON.stringify(cats));
const keys = Object.keys(errors);
console.log('distinct errors:', keys.length);
for (const k of keys.sort((a, b) => errors[b].n - errors[a].n).slice(0, 25)) console.log(errors[k].n, k, '\n     ', errors[k].stack);
