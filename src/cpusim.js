// Headless action executor shared by scripts/test-cpu.mjs (CPU-vs-CPU games) and src/cpusearch.js (lookahead search).
// It performs card-game actions through the SAME rule functions the real game uses (state.js / engine.js / effects.js) with every
// effect prompt (ctx.choose) and every block / counter window answered by the CPU decision layer (src/cpu.js) — no rule is
// re-implemented here.  Pure logic: no DOM, works in node and in the browser.
import * as S from './state.js';
import * as E from './engine.js';
import * as Fx from './effects.js';
import * as Cpu from './cpu.js';

// opts: { cfgOf(p) -> { level, banned:Set }, onError(where, e), stats }
export function createSim(state, opts = {}) {
  const cfgOf = opts.cfgOf || (() => ({ level: 'hard', banned: new Set() }));
  const onError = opts.onError || (() => {});
  const stats = opts.stats || { actions: 0, attacks: 0, blocks: 0, counters: 0 };
  const rid = () => Math.random().toString(36).slice(2);
  const decider = (t, k, o) => Cpu.deciderFor(state, k, o, { pendingOwner: t.player });
  const find = (p, uid) => { const pl = state.players[p]; return pl.raising && pl.raising.uid === uid ? pl.raising : pl.battle.find((s) => s.uid === uid); };

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
          choose: async (k, o) => { const who = decider(t, k, o); return Cpu.answerChoice(state, k, o, who, cfgOf(who) || cfgOf('p1')); } };
        await Fx.runScript(script, ctx);
      } catch (e) { onError('pending', e); }
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
      if (last.result === 'defenderWins' || last.result === 'tie') S.deleteStack(state, p, uid, 'trash', 'battle');
    }
  }
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
    const opt = Cpu.decideCounter(state, { attackerP: p, attackerUid: uid, targetKind: pa.targetKind, targetUid: pa.targetUid }, counters, cfgOf(op));
    if (opt) {
      const r = S.activateCounter(state, op, opt, pa);
      if (r.ok) { stats.counters++; state.pending.push({ uid: 'ct' + rid(), player: op, cardId: opt.cardId, stackUid: opt.stackUid, tags: opt.tags, text: opt.body, resolved: false }); await drain(); }
    }
    const aSt = find(p, uid);
    if (!aSt || pa.ended) { await end(); return true; }
    // block timing
    const colliding = S.hasKeyword(aSt, '충돌') || S.hasContinuousKeyword(state, p, aSt, '충돌');
    const elig = state.players[op].battle.filter((s) => S.card(s.cardId).category === 'digimon' && !s.suspended && S.canRestByRule(state, op, s) && !S.s3Flag(state, s, 'noBlock') && !S.hookNoBlock(state, op, s) && (colliding || S.hasKeyword(s, '블로커') || S.hookGrantedKeywords(state, op, s).includes('블로커')));
    const blockers = elig.filter((s) => s.uid !== pa.targetUid && !S.cannotBeBlockedBy(state, p, uid, s));
    if (blockers.length) {
      let bu = Cpu.decideBlock(state, { attackerP: p, attackerUid: uid, targetKind: pa.targetKind, targetUid: pa.targetUid, blockers, mandatory: colliding }, cfgOf(op));
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

  const sig = (p) => { const pl = state.players[p]; return JSON.stringify([state.memory, pl.hand.length, pl.battle.length, pl.security.length, state.players[S.opponentOf(p)].security.length, pl.trash.length, state.log.length]); };
  // perform ONE main-phase action of player p (does not advance the turn)
  async function exec(p, act) {
    const pl = state.players[p];
    const sigBefore = sig(p);
    stats.actions++;
    switch (act.type) {
      case 'play': { const i = pl.hand.indexOf(act.cardId); if (i < 0) break; if (!S.canPayCost(state, act.cost)) break; if (act.cost > 0) S.spendMemory(state, act.cost); S.playDigimonFresh(state, p, i); break; }
      case 'option': { const i = pl.hand.indexOf(act.cardId); if (i < 0) break; S.useOptionCard(state, p, i); break; }
      case 'evolve': S.digivolve(state, p, act.uid, act.cardId, act.cost, 'hand'); break;
      case 'jogress': S.fuseStacks(state, p, act.a, act.b, act.cardId, act.cost, 'hand'); break;
      case 'train': S.useTraining(state, p, act.uid); break;
      case 'main': { const st = find(p, act.uid); if (!st) break; const zone = pl.raising && pl.raising.uid === st.uid ? 'raising' : 'battle'; const ab = S.activatableMainAbilities(state, p, st, zone)[act.idx]; if (ab) state.pending.push({ uid: 'main' + rid(), player: p, cardId: ab.cardId, stackUid: st.uid, tags: ab.tags, text: ab.text, resolved: false }); break; }
      case 'attack': await attack(p, act.uid, act.target); break;
      default: break;
    }
    await drain(); await drainRepl();
    if (act.key && sigBefore === sig(p)) { const c = cfgOf(p); if (c && c.banned) c.banned.add(act.key); return false; }
    return true;
  }
  // exec + the automatic turn end (memory crossed to the other side) / a Pass declaration.  -> true when the turn ended
  async function applyMain(p, act) {
    if (act.type === 'pass') { E.declarePass(state); await finishTurn(); return true; }
    await exec(p, act);
    if (state.winner) return true;
    if (E.checkAutoEndTurn(state)) { await finishTurn(); return true; }
    return false;
  }
  // unsuspend / draw / breeding phases of p's turn (planBreeding by cfg), leaves the game at the main phase
  async function beginTurn(p) {
    const cfg = cfgOf(p);
    let g = 0;
    while ((state.phase === 'unsuspend' || state.phase === 'draw') && g++ < 6) { E.nextPhase(state); await drain(); if (state.winner) return; }
    if (state.phase === 'breeding') {
      const b = Cpu.planBreeding(state, p, cfg);
      if (b.type === 'hatch') S.hatchDigitama(state, p); else if (b.type === 'move') S.moveRaisingToBattle(state, p);
      await drain();
      E.nextPhase(state); await drain();
    }
  }
  // the main phase of p: `choose()` -> action (async ok), until p passes / the turn ends.  maxActions guards runaway turns.
  async function mainLoop(p, choose, maxActions = 45) {
    let n = 0;
    while (!state.winner && state.activePlayer === p && state.phase === 'main' && !state.turnEnding && n++ < maxActions) {
      const act = await choose();
      if (await applyMain(p, act)) break;
    }
    if (!state.winner && state.activePlayer === p && state.phase === 'main' && !state.turnEnding) { E.endTurn(state, false); await finishTurn(); }
    await finishTurn();
  }
  return { state, stats, drain, drainRepl, finishTurn, securityCheck, attack, exec, applyMain, beginTurn, mainLoop, find };
}
