// Headless CPU-vs-CPU test: plays full games through the real engine (state.js / engine.js / effects.js scripts) with the
// src/cpu.js decision layer choosing every action, block, counter and prompt answer for BOTH players.
// Asserts: no exceptions, no stalls (turn cap), and reports win rates between levels (seats + decks swapped every other game).
//
// Run from the repo root:  node scripts/test-cpu.mjs [gamesPerMatchup=300] [--random-decks] < /dev/null
import * as fs from 'fs';
import * as S from '../src/state.js';
import * as E from '../src/engine.js';
import * as Fx from '../src/effects.js';
import * as Cpu from '../src/cpu.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url.replace(/^\.\//, './'), 'utf8')) });
await S.loadData();

const N = Number(process.argv.find((a) => /^\d+$/.test(a)) || 300);
const RANDOM_DECKS = process.argv.includes('--random-decks');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
const TURN_CAP = 90;
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const cards = Object.values(S.CARDS);
const COLORS = ['red', 'blue', 'yellow', 'green', 'black', 'purple', 'white'];

// ---------- deck generators ----------
function coherentDeck(name) {
  const cols = Math.random() < 0.5 ? [pick(COLORS)] : [...new Set([pick(COLORS), pick(COLORS)])];
  const ok = (c) => (c.colors || []).length > 0 && c.colors.every((x) => cols.includes(x)) && !c.isParallel;
  const byLv = (lv) => cards.filter((c) => c.category === 'digimon' && c.level === lv && ok(c) && c.cost != null);
  const eggs = cards.filter((c) => c.category === 'digitama' && ok(c));
  const tamers = cards.filter((c) => c.category === 'tamer' && ok(c));
  const opts = cards.filter((c) => c.category === 'option' && ok(c));
  const main = {}, dig = {};
  const add = (target, c, max) => { const cur = target[c.id] || 0; if (cur >= Math.min(max, S.maxCopiesFor(c.id))) return false; target[c.id] = cur + 1; return true; };
  const fill = (pool, n) => { let tries = 0, got = 0; while (got < n && pool.length && tries++ < 400) if (add(main, pick(pool), 4)) got++; };
  if (!eggs.length) return null;
  for (let i = 0; i < 5; i++) add(dig, pick(eggs), 4);
  const total = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  fill(byLv(3), 14); fill(byLv(4), 11); fill(byLv(5), 8); fill(byLv(6), 3); fill(tamers, 4); fill(opts, 6);
  const any = [...byLv(3), ...byLv(4), ...byLv(5), ...opts];
  let guard = 0; while (total(main) < 50 && any.length && guard++ < 2000) add(main, pick(any), 4);
  if (total(main) !== 50 || total(dig) < 1) return null;
  const d = { name, main, digitama: dig };
  return S.deckLegality(d).ok ? d : null;
}
const mainPool = cards.filter((c) => ['digimon', 'tamer', 'option'].includes(c.category));
const eggPool = cards.filter((c) => c.category === 'digitama' || (c.category === 'digimon' && c.level === 2));
function randomDeck(name) { // soak.mjs style: NOT color-coherent, NOT copy-limited (robustness)
  const main = {}, dig = {};
  for (let i = 0; i < 50; i++) { const c = pick(mainPool); main[c.id] = (main[c.id] || 0) + 1; }
  for (let i = 0; i < 5; i++) { const c = pick(eggPool); dig[c.id] = (dig[c.id] || 0) + 1; }
  return { name, main, digitama: dig };
}
function makeDeck(name) { if (RANDOM_DECKS) return randomDeck(name); let d = null, g = 0; while (!d && g++ < 50) d = coherentDeck(name); return d || randomDeck(name); }

// ---------- error bookkeeping ----------
const errors = {};
function note(where, e) {
  const k = where + ': ' + String(e && e.message).slice(0, 100);
  errors[k] = errors[k] || { n: 0, stack: String(e && e.stack).split('\n').slice(0, 4).join(' | ') };
  errors[k].n++;
}

// ---------- headless game driver ----------
async function playGame(deckP1, deckP2, lv, gameNo) {
  const cfgs = { p1: { level: lv.p1, banned: new Set() }, p2: { level: lv.p2, banned: new Set() } };
  const state = S.newGame(deckP1, deckP2);
  const stats = { actions: 0, attacks: 0, blocks: 0, counters: 0, turns: 0 };
  const t0 = Date.now();
  const timeUp = () => Date.now() - t0 > 25000;
  const decider = (t, k, o) => Cpu.deciderFor(state, k, o, { pendingOwner: t.player });
  async function drain() {
    let guard = 0;
    while (guard++ < 60) {
      const t = state.pending.find((x) => !x.resolved);
      if (!t) return;
      try {
        if (t.schedFn) { t.schedFn(); S.resolvePending(state, t.uid); continue; }
        if (t.manualOnly) { S.resolvePending(state, t.uid); continue; }
        const specific = Fx.lookupCardSpecific(t.cardId, t.tags, t.text);
        let script = specific;
        if (!script && /^이\s*카드의\s*【메인】\s*효과를\s*발(?:휘|동)한다\.?$/.test(t.text.trim())) {
          const seg = S.parseEffectSegments(S.card(t.cardId).effectKo || '').segments.find((s) => s.tags.includes('메인'));
          if (seg) script = Fx.lookupCardSpecific(t.cardId, seg.tags, seg.body) || Fx.compileToScript(seg.body);
        }
        script = script || Fx.compileToScript(t.text);
        const ctx = { state, S, E, self: t.player, opp: S.opponentOf(t.player), sourceCardId: t.cardId, sourceStackUid: t.stackUid, trigger: t, startAttack() {}, attack: () => state.attackCtx, endAttack() {},
          choose: async (k, o) => { const who = decider(t, k, o); return Cpu.answerChoice(state, k, o, who, cfgs[who] || cfgs.p1); } };
        await Fx.runScript(script, ctx);
      } catch (e) { note('pending', e); }
      S.resolvePending(state, t.uid);
    }
    for (const t of state.pending) if (!t.resolved) S.resolvePending(state, t.uid); // guard exhausted: never leave a stuck effect
  }
  async function drainRepl() { // replacement prompts (REPL.interactive is off here, but keep the hook honest)
    const pr = state.pendingReplacements;
    if (pr && pr.length) { const e = pr[0]; try { S.resumeReplacement(state, e, 0); } catch (er) { pr.shift(); } }
  }
  async function finishTurn() {
    let guard = 0;
    while (state.turnEnding && !state.winner && guard++ < 12) { await drain(); E.settleTurnEnd(state); }
  }
  async function securityCheck(p, uid, op) {
    const ctl = S.beginSecurityCheck(state, p, uid, op);
    ctl.deferBattle = true;
    let g = 0;
    while (!ctl.done && !state.winner && g++ < 30) {
      if (ctl.awaiting) { await drain(); S.battleSecurityCheck(ctl, ctl.awaiting.id); } else S.stepSecurityCheck(ctl);
      await drain();
      if (ctl.awaiting) { await drain(); S.battleSecurityCheck(ctl, ctl.awaiting.id); }
    }
    if (!ctl.gameOver && ctl.results.length) {
      const last = ctl.results[ctl.results.length - 1];
      if (last.result === 'defenderWins' || last.result === 'tie') { if (S.stackTopId ? true : true) S.deleteStack(state, p, uid, 'trash', 'battle'); }
    }
  }
  const find = (p, uid) => { const pl = state.players[p]; return pl.raising && pl.raising.uid === uid ? pl.raising : pl.battle.find((s) => s.uid === uid); };
  async function attack(p, uid, target) {
    const op = S.opponentOf(p);
    const dec = S.declareAttack(state, p, uid);
    if (!dec.ok) return false;
    stats.attacks++;
    const pa = { attacker: p, opp: op, uid, targetKind: target === 'PLAYER' ? 'player' : 'digimon', targetUid: target === 'PLAYER' ? null : target };
    state.attackCtx = pa; pa.terminate = () => { pa.ended = true; };
    S.queueTriggersForStack(state, p, dec.stack, 'attack');
    S.emitGameEvent(state, 'attack', { owner: p, stack: dec.stack, cause: null });
    await drain(); await drainRepl();
    const end = async () => { const st = find(p, uid); state.attackCtx = null; if (st) { S.s8AttackEnded(state, p, uid); S.queueTriggersForStack(state, p, st, 'attackEnd'); S.emitGameEvent(state, 'attackEnd', { owner: p, stack: st, cause: null }); } await drain(); };
    if (state.winner || pa.ended || !find(p, uid) || (pa.targetKind === 'digimon' && !find(op, pa.targetUid))) { await end(); return true; }
    // counter timing (defender)
    const counters = S.findCounterOptions(state, op);
    const opt = Cpu.decideCounter(state, { attackerP: p, attackerUid: uid, targetKind: pa.targetKind, targetUid: pa.targetUid }, counters, cfgs[op]);
    if (opt) {
      const r = S.activateCounter(state, op, opt, pa);
      if (r.ok) { stats.counters++; state.pending.push({ uid: 'ct' + Math.random().toString(36).slice(2), player: op, cardId: opt.cardId, stackUid: opt.stackUid, tags: opt.tags, text: opt.body, resolved: false }); await drain(); }
    }
    const aSt = find(p, uid);
    if (!aSt || pa.ended) { await end(); return true; }
    // block timing
    const colliding = S.hasKeyword(aSt, '충돌') || S.hasContinuousKeyword(state, p, aSt, '충돌');
    const elig = state.players[op].battle.filter((s) => S.card(s.cardId).category === 'digimon' && !s.suspended && S.canRestByRule(state, op, s) && !S.s3Flag(state, s, 'noBlock') && !S.hookNoBlock(state, op, s) && (colliding || S.hasKeyword(s, '블로커') || S.hookGrantedKeywords(state, op, s).includes('블로커')));
    const blockers = elig.filter((s) => s.uid !== pa.targetUid && !S.cannotBeBlockedBy(state, p, uid, s));
    if (blockers.length) {
      let bu = Cpu.decideBlock(state, { attackerP: p, attackerUid: uid, targetKind: pa.targetKind, targetUid: pa.targetUid, blockers, mandatory: colliding }, cfgs[op]);
      if (colliding && !bu) bu = blockers[0].uid;
      if (bu) { const b = blockers.find((x) => x.uid === bu); if (b) { stats.blocks++; S.restStack(state, op, b.uid, 'block'); pa.targetKind = 'digimon'; pa.targetUid = b.uid; S.emitGameEvent(state, 'redirect', { owner: p, stack: aSt, cause: null, targetUid: b.uid }); S.emitGameEvent(state, 'blocked', { owner: p, stack: aSt, blocker: b, cause: null }); await drain(); } }
    }
    if (state.winner) return true;
    if (!find(p, uid) || pa.ended || (pa.targetKind === 'digimon' && !find(op, pa.targetUid))) { await end(); return true; }
    if (pa.targetKind === 'player') await securityCheck(p, uid, op);
    else {
      const res = S.resolveDigimonBattle(state, p, uid, pa.targetUid);
      await drain();
      if (res && res.piercing && !state.winner) await securityCheck(p, uid, op);
    }
    await drain();
    await end();
    return true;
  }

  async function exec(p, act) {
    const pl = state.players[p];
    const sigBefore = JSON.stringify([state.memory, pl.hand.length, pl.battle.length, pl.security.length, state.players[S.opponentOf(p)].security.length, pl.trash.length, state.log.length]);
    stats.actions++;
    switch (act.type) {
      case 'play': { const i = pl.hand.indexOf(act.cardId); if (i < 0) break; if (!S.canPayCost(state, act.cost)) break; if (act.cost > 0) S.spendMemory(state, act.cost); S.playDigimonFresh(state, p, i); break; }
      case 'option': { const i = pl.hand.indexOf(act.cardId); if (i < 0) break; S.useOptionCard(state, p, i); break; }
      case 'evolve': S.digivolve(state, p, act.uid, act.cardId, act.cost, 'hand'); break;
      case 'jogress': S.fuseStacks(state, p, act.a, act.b, act.cardId, act.cost, 'hand'); break;
      case 'train': S.useTraining(state, p, act.uid); break;
      case 'main': { const st = find(p, act.uid); if (!st) break; const zone = pl.raising && pl.raising.uid === st.uid ? 'raising' : 'battle'; const ab = S.activatableMainAbilities(state, p, st, zone)[act.idx]; if (ab) state.pending.push({ uid: 'main' + Math.random().toString(36).slice(2), player: p, cardId: ab.cardId, stackUid: st.uid, tags: ab.tags, text: ab.text, resolved: false }); break; }
      case 'attack': await attack(p, act.uid, act.target); break;
      default: break;
    }
    await drain(); await drainRepl();
    const sigAfter = JSON.stringify([state.memory, pl.hand.length, pl.battle.length, pl.security.length, state.players[S.opponentOf(p)].security.length, pl.trash.length, state.log.length]);
    if (act.key && sigBefore === sigAfter) cfgs[p].banned.add(act.key);
  }

  try {
    E.drawOpeningHand(state, 'p1'); E.drawOpeningHand(state, 'p2');
    const first = E.coinFlip();
    for (const p of [first, S.opponentOf(first)]) if (Cpu.shouldMulligan(state, p, cfgs[p].level)) E.mulligan(state, p);
    E.setSecurityStacks(state); E.beginGame(state, first);
  } catch (e) { note('setup', e); return { winner: null, stats, err: true }; }
  for (let t = 0; t < TURN_CAP && !state.winner; t++) {
    if (timeUp()) { note('stall', new Error('game exceeded 25s wall clock')); return { winner: null, stats: { ...stats, turns: state.turnNumber }, stall: true }; }
    try {
      const p = state.activePlayer;
      const cfg = cfgs[p];
      cfg.banned = new Set();
      let g2 = 0;
      while ((state.phase === 'unsuspend' || state.phase === 'draw') && g2++ < 6) { E.nextPhase(state); await drain(); if (state.winner) break; }
      if (state.winner) break;
      if (state.phase === 'breeding') {
        const b = Cpu.planBreeding(state, p, cfg);
        if (b.type === 'hatch') S.hatchDigitama(state, p); else if (b.type === 'move') S.moveRaisingToBattle(state, p);
        await drain();
        E.nextPhase(state); await drain();
      }
      let n = 0;
      while (!state.winner && state.activePlayer === p && state.phase === 'main' && !state.turnEnding && n++ < 45) {
        const act = Cpu.planMain(state, p, cfg);
        if (act.type === 'pass') { E.declarePass(state); await finishTurn(); break; }
        await exec(p, act);
        if (state.winner) break;
        if (E.checkAutoEndTurn(state)) { await finishTurn(); break; }
      }
      if (!state.winner && state.activePlayer === p && state.phase === 'main' && !state.turnEnding) { E.endTurn(state, false); await finishTurn(); }
      await finishTurn();
      stats.turns = state.turnNumber;
    } catch (e) { note('turn', e); return { winner: null, stats, err: true }; }
  }
  if (!state.winner) return { winner: null, stats: { ...stats, turns: state.turnNumber }, stall: true };
  return { winner: state.winner, stats: { ...stats, turns: state.turnNumber }, turnsEnd: state.turnNumber };
}

// ---------- matchups ----------
async function matchup(hi, lo, n) {
  const res = { hiWins: 0, loWins: 0, draws: 0, stalls: 0, errs: 0, turns: 0, games: 0, ms: 0 };
  const t0 = Date.now();
  for (let g = 0; g < n; g += 2) {
    const dA = makeDeck('A'), dB = makeDeck('B');
    for (let k = 0; k < 2 && g + k < n; k++) {
      const lv = k === 0 ? { p1: hi, p2: lo } : { p1: lo, p2: hi };
      const r = await playGame(dA, dB, lv, g + k);
      res.games++;
      if (r.err) { res.errs++; continue; }
      res.turns += r.stats.turns || 0;
      if (r.stall) { res.stalls++; continue; }
      if (r.winner === 'draw') { res.draws++; continue; }
      const hiSeat = k === 0 ? 'p1' : 'p2';
      if (r.winner === hiSeat) res.hiWins++; else res.loWins++;
    }
  }
  res.ms = Date.now() - t0;
  return res;
}
const fmt = (hi, lo, r) => `${hi} vs ${lo}: ${r.hiWins}-${r.loWins}  (games ${r.games}, draws ${r.draws}, stalls ${r.stalls}, errs ${r.errs}, avg turns ${(r.turns / Math.max(1, r.games)).toFixed(1)}, ${(r.ms / 1000).toFixed(1)}s)  ${hi} win-rate ${(100 * r.hiWins / Math.max(1, r.hiWins + r.loWins)).toFixed(1)}%`;

const plan = [['hard', 'easy'], ['normal', 'easy'], ['hard', 'normal'], ['easy', 'easy'], ['normal', 'normal'], ['hard', 'hard']].filter(([a, b]) => !ONLY || ONLY === a + '-' + b);
let fail = 0;
console.log(`CPU-vs-CPU headless test: ${N} games per matchup, ${RANDOM_DECKS ? 'random (soak-style) decks' : 'color-coherent legal decks'}`);
for (const [hi, lo] of plan) {
  const r = await matchup(hi, lo, N);
  console.log(fmt(hi, lo, r));
  const decided = r.hiWins + r.loWins;
  if (r.errs || r.stalls > Math.max(2, r.games * 0.02)) { fail++; console.log('  FAIL: errors/stalls above tolerance'); }
  if (hi !== lo && ['easy'].includes(lo) && decided > 20 && r.hiWins / decided < 0.6) { fail++; console.log(`  FAIL: ${hi} should beat ${lo} > 60%`); }
  if (hi === 'hard' && lo === 'normal' && decided > 20 && r.hiWins / decided < 0.5) { fail++; console.log('  WARN: hard did not beat normal'); }
}
const keys = Object.keys(errors);
console.log('distinct errors:', keys.length);
for (const k of keys.sort((a, b) => errors[b].n - errors[a].n).slice(0, 20)) console.log(errors[k].n, k, '\n     ', errors[k].stack);
console.log(fail || keys.length ? 'RESULT: PROBLEMS' : 'RESULT: OK');
process.exit(fail || keys.length ? 1 : 0);
