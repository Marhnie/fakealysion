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
  const H = opts.hooks || {}; // optional observers (scripts/rule-oracle.mjs); every call is guarded, absent hooks change nothing
  const rid = () => Math.random().toString(36).slice(2);
  const decider = (t, k, o) => Cpu.deciderFor(state, k, o, { pendingOwner: t.player });
  const find = (p, uid) => { const pl = state.players[p]; return pl.raising && pl.raising.uid === uid ? pl.raising : pl.battle.find((s) => s.uid === uid); };

  async function drain() {
    let guard = 0;
    const CX = globalThis.__CENSUS; // effect-trigger census (scripts/census.mjs); undefined in normal play -> zero overhead
    while (guard++ < 60) {
      if (CX) CX.sync(state);
      if (state._rcPending && !(state._rcDepth > 0)) S.flushRuleChecks(state); // lazily-recorded DP<=0 rule checks (15-15-5-2) — rule-oracle R-dp0
      // `_running` marks a trigger whose script is already executing further up the call stack (ctx.securityCheck's
      // ≪관통≫ bonus check calls securityCheck()/drain() reentrantly mid-script) — skip it so this nested pass only
      // picks up genuinely NEW pending items (e.g. a checked security card's own 【시큐리티】 trigger), never re-runs
      // the still-in-flight outer trigger a second time.
      const t = state.pending.find((x) => !x.resolved && !x._running);
      if (!t) { // effect-started attacks (진격/볼텍스/급습/에그제큐트/오버클럭, "이 디지몬으로 어택할 수 있다") run once the effect queue is empty and no attack is in progress (mirrors main.js startAttack)
        if (effAtkQ.length && !state.attackCtx && !state.winner) { const q = effAtkQ.shift(); try { await runEffectAttack(q); } catch (e) { onError('effectAttack', e); } continue; }
        return;
      }
      t._running = true;
      let cxs = null;
      try {
        if (t.schedFn) { t.schedFn(); S.resolvePending(state, t.uid); continue; }
        if (t.manualOnly) { if (CX) CX.manual(state, t, 'manualOnly'); S.resolvePending(state, t.uid); continue; }
        if (S.waitingDestroyEffectGone(state, t)) { S.log(state, `${t.player} ${S.card(t.cardId).nameKo}의 【소멸 시】 효과: 카드가 이미 트래시를 벗어나 발휘하지 못함`); S.resolvePending(state, t.uid); continue; }
        const specific = Fx.lookupCardSpecific(t.cardId, t.tags, t.text, !!t.inherited);
        let script = specific;
        if (!script && /^이\s*카드의\s*【메인】\s*효과를\s*발(?:휘|동)한다\.?$/.test(t.text.trim())) {
          const seg = S.parseEffectSegments(S.card(t.cardId).effectKo || '').segments.find((s) => s.tags.includes('메인'));
          if (seg) script = Fx.lookupCardSpecific(t.cardId, seg.tags, seg.body) || Fx.compileToScript(seg.body);
        }
        script = script || Fx.compileToScript(t.text);
        // mirror src/main.js runPendingScript: 15-4-4-3 stale check + [턴에 N회] gate / mark (without it the CPU re-activated once-per-turn 【메인】 abilities forever)
        if (t.stackUid && t.topId && !(t.evt && t.evt.leaving) && !(t.tags || []).some((x) => x.includes('소멸 시'))) {
          const pl0 = state.players[t.player]; const stNow = pl0.raising && pl0.raising.uid === t.stackUid ? pl0.raising : pl0.battle.find((s) => s.uid === t.stackUid);
          if (!stNow || stNow.cardId !== t.topId) { S.resolvePending(state, t.uid); continue; }
        }
        if (S.pendingCardLeftZone(state, t)) { S.resolvePending(state, t.uid); continue; } // Q5230/5593/5758/5905: the deleted card left the trash
        const om = String(t.text || '').match(/^[\[〔]턴\s*에?\s*(\d+)\s*회[\]〕]/);
        let onceMark = null;
        if (om && t.stackUid) {
          const st1 = find(t.player, t.stackUid);
          if (st1) {
            const key = S.onceLimitKey(t.cardId, t.tags);
            if (S.turnUsesRemaining(st1, key, Number(om[1])) <= 0) { S.resolvePending(state, t.uid); continue; }
            onceMark = { stack: st1, key };
          }
        }
        if (onceMark && script.length === 1 && script[0].op === 'condition' && !(script[0].else || []).length) { try { if (!(await Fx.evalConditionPublic(script[0].if, { state, S, E, self: t.player, opp: S.opponentOf(t.player), sourceCardId: t.cardId, sourceStackUid: t.stackUid, trigger: t }))) onceMark = null; } catch (e) { /* keep the mark */ } }
        if (onceMark) S.markTurnEffectUsed(onceMark.stack, onceMark.key);
        const ctx = { state, S, E, self: t.player, opp: S.opponentOf(t.player), sourceCardId: t.cardId, sourceStackUid: t.stackUid, trigger: t, startAttack: (p, uid, direct, o) => { if (!state.attackCtx) { effAtkQ.push({ p, uid, direct, o: o || {} }); const qs = state.players[p].battle.find((s) => s.uid === uid); if (qs) qs._effAtkQueued = true; /* W8: S.consumePierceCheck hold only for a queued attack of this digimon */ } }, attack: () => state.attackCtx, endAttack() {},
          // ≪관통≫ bonus check for a scripted "can battle" op (S.resolveDigimonBattle called directly by a card script) — capped at once per attack (S.consumePierceCheck).
          securityCheck: async (p, uid, op) => { if (!S.consumePierceCheck(state, p, uid)) return; await securityCheck(p, uid, op || S.opponentOf(p)); },
          choose: async (k, o) => { const who = decider(t, k, o); return Cpu.answerChoice(state, k, o, who, cfgOf(who) || cfgOf('p1')); } };
        if (CX) cxs = CX.before(state, t, script);
        H.effectBegin && H.effectBegin(t, script);
        if (t.onceKey && script.length === 1 && script[0].op === 'condition' && !(script[0].else || []).length) { try { if (!(await Fx.evalConditionPublic(script[0].if, ctx))) S.refundOnceUse(state, t); } catch (e) { /* keep the use */ } } // Q1431: unmet leading condition = never activated
        await Fx.runScript(script, ctx);
        H.effectEnd && H.effectEnd(t, script, ctx);
        if (t.onceKey && (ctx._declined || (ctx._costUnpaid && script.length === 1 && script[0].op === 'costGroup'))) S.refundOnceUse(state, t); // Q1180: declined optional watcher effect keeps its 〔턴에 1회〕
        if (onceMark && (ctx._declined || (ctx._costUnpaid && script.length === 1 && script[0].op === 'costGroup'))) { const u = onceMark.stack.turnEffectUses; if (u && u[onceMark.key] > 0) u[onceMark.key]--; } // sole cost not payable: the effect was never activated
        if (CX) CX.after(state, t, script, cxs);
      } catch (e) { if (CX) CX.error(state, t, e); onError('pending', e); }
      S.resolvePending(state, t.uid);
    }
    if (CX) CX.sync(state);
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
    H.secBegin && H.secBegin(ctl);
    while (!ctl.done && !state.winner && g++ < 30) {
      H.secStepBefore && H.secStepBefore(ctl);
      if (ctl.awaiting) { await drain(); S.battleSecurityCheck(ctl, ctl.awaiting.id); } else S.stepSecurityCheck(ctl);
      H.secRevealed && H.secRevealed(ctl);
      await drain();
      if (ctl.awaiting) { await drain(); S.battleSecurityCheck(ctl, ctl.awaiting.id); }
      H.secStepAfter && H.secStepAfter(ctl);
    }
    if (!ctl.gameOver && ctl.results.length) {
      const last = ctl.results[ctl.results.length - 1];
      if (last.result === 'defenderWins' || last.result === 'tie') S.deleteStack(state, p, uid, 'trash', 'battle');
    }
  }
  const effAtkQ = [];
  // effect-granted attack (mirror of main.js attackFlow force=true): no legal target -> not declared; the CPU picks player > weakest beatable digimon
  async function runEffectAttack(q) {
    const { p, uid, direct, o } = q; const st = find(p, uid); if (!st || state.winner) return;
    if (o.anyActive) st.anyActiveOnce = true;
    let tg = [], hit = false;
    try { tg = S.legalDigimonTargets(state, p, uid); hit = !o.digimonOnly && S.canAttackPlayer(state, p, uid); } catch (e) { tg = []; }
    delete st.anyActiveOnce;
    let target = null;
    if (direct === 'PLAYER' && hit) target = 'PLAYER';
    else if (direct && tg.includes(direct)) target = direct;
    else if (hit) target = 'PLAYER';
    else if (tg.length) { const op = S.opponentOf(p), me = S.effectiveDP(state, p, st); const dp = (u) => { const d = find(op, u); return d ? S.effectiveDP(state, op, d) : 1e9; }; target = tg.slice().sort((a, b) => (dp(a) < me ? 0 : 1) - (dp(b) < me ? 0 : 1) || dp(b) - dp(a))[0]; }
    if (!target) { S.log(state, `${p} 어택 불가: 어택 대상이 없어 이 효과의 어택을 하지 않음`); delete st._pierceHeld; delete st._effAtkQueued; return; }
    await attack(p, uid, target, o);
  }
  async function attack(p, uid, target, dopts) {
    const op = S.opponentOf(p);
    const dec = S.declareAttack(state, p, uid, dopts || {});
    if (!dec.ok) return false;
    stats.attacks++;
    const pa = { attacker: p, opp: op, uid, targetKind: target === 'PLAYER' ? 'player' : 'digimon', targetUid: target === 'PLAYER' ? null : target };
    pa.pierceUsed = !!dec.stack._pierceHeld; delete dec.stack._pierceHeld; delete dec.stack._effAtkQueued; // adopt a ≪관통≫ hold left by a scripted battle that ran before this attack existed (S.consumePierceCheck)
    state.attackCtx = pa; pa.terminate = () => { pa.ended = true; };
    H.attackDeclared && H.attackDeclared({ p, op, uid, target, dec, pa });
    S.queueTriggersForStack(state, p, dec.stack, 'attack');
    S.emitGameEvent(state, 'attack', { owner: p, stack: dec.stack, cause: null });
    { // UI parity (main.js enterRedirectTiming): once the target is fixed, 'attackTarget' (+ 'attackOnDigimon') fire together with 【어택 시】 (11-2-2 / 11-2-8: the declaration triggers all at once, resolved afterwards in the pending queue) so ST15-05 / ST16-05 / BT2-084 style triggers work headlessly
      const aT = find(p, uid);
      if (aT && !state.winner) {
        S.s1AttackTargeted(state, p, aT, pa.targetKind, pa.targetUid);
        if (pa.targetKind === 'digimon') { const dT = find(op, pa.targetUid); const aT2 = find(p, uid); if (aT2 && dT) S.emitGameEvent(state, 'attackOnDigimon', { owner: p, stack: aT2, cause: null, target: dT }); }
      }
    }
    await drain(); await drainRepl();
    const end = async () => { H.attackEnd && H.attackEnd({ p, op, uid, pa }); const st = find(p, uid); state.attackCtx = null; if (st) { S.s8AttackEnded(state, p, uid); S.queueTriggersForStack(state, p, st, 'attackEnd'); S.emitGameEvent(state, 'attackEnd', { owner: p, stack: st, cause: null }); } await drain(); };
    if (state.winner || pa.ended || !find(p, uid) || (pa.targetKind === 'digimon' && !find(op, pa.targetUid))) { await end(); return true; }
    // counter timing (defender)
    const counters = S.findCounterOptions(state, op);
    const opt = Cpu.decideCounter(state, { attackerP: p, attackerUid: uid, targetKind: pa.targetKind, targetUid: pa.targetUid }, counters, cfgOf(op));
    if (opt) {
      const r = S.activateCounter(state, op, opt, pa);
      if (r.ok) { stats.counters++; H.counter && H.counter({ p, op, uid, pa, opt }); state.pending.push({ uid: 'ct' + rid(), player: op, cardId: opt.cardId, stackUid: opt.stackUid, tags: opt.tags, text: opt.body, resolved: false }); await drain(); }
    }
    const aSt = find(p, uid);
    if (!aSt || pa.ended) { await end(); return true; }
    // block timing
    const colliding = S.hasKeyword(aSt, '충돌') || S.hasContinuousKeyword(state, p, aSt, '충돌');
    const elig = state.players[op].battle.filter((s) => S.card(s.cardId).category === 'digimon' && !s.suspended && S.canRestByRule(state, op, s) && !S.s3Flag(state, s, 'noBlock') && !S.hookNoBlock(state, op, s) && (colliding || S.hasKeyword(s, '블로커') || S.hookGrantedKeywords(state, op, s).includes('블로커')));
    const blockers = elig.filter((s) => s.uid !== pa.targetUid && !S.cannotBeBlockedBy(state, p, uid, s));
    H.blockWindow && H.blockWindow({ p, op, uid, pa, colliding, blockers });
    if (blockers.length) {
      let bu = Cpu.decideBlock(state, { attackerP: p, attackerUid: uid, targetKind: pa.targetKind, targetUid: pa.targetUid, blockers, mandatory: colliding }, cfgOf(op));
      if (colliding && !bu) bu = blockers[0].uid;
      if (bu) { const b = blockers.find((x) => x.uid === bu); if (b) { stats.blocks++; H.blockBefore && H.blockBefore({ p, op, uid, pa, b }); S.restStack(state, op, b.uid, 'block'); pa.targetKind = 'digimon'; pa.targetUid = b.uid; S.emitGameEvent(state, 'redirect', { owner: p, stack: aSt, cause: null, targetUid: b.uid }); S.emitGameEvent(state, 'blocked', { owner: p, stack: aSt, blocker: b, cause: null }); await drain(); } }
    }
    if (state.winner) return true;
    if (!find(p, uid) || pa.ended || (pa.targetKind === 'digimon' && !find(op, pa.targetUid))) { await end(); return true; }
    H.connect && H.connect({ p, op, uid, pa });
    if (pa.targetKind === 'player') await securityCheck(p, uid, op);
    else {
      H.battleBefore && H.battleBefore({ p, op, uid, pa });
      const res = S.resolveDigimonBattle(state, p, uid, pa.targetUid);
      H.battleAfter && H.battleAfter({ p, op, uid, pa, res });
      await drain();
      { const sv = res && res.result === 'attackerWins' && res.destroyedOnlyOpponent ? find(p, uid) : null; if (sv && S.hasKeyword(sv, '전투후액티브')) S.unsuspendStack(state, p, uid); } // ≪전투후액티브≫ (EX1-043 / BT1-112): the UI offers this as a click after the battle; headless play takes it (official Q&A 984)
      if (res && res.piercing && !state.winner && S.consumePierceCheck(state, p, uid)) await securityCheck(p, uid, op);
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
    let rejected = false; // the rule function refused the action (log lines from the refusal must not count as progress)
    stats.actions++;
    switch (act.type) {
      case 'play': { const i = pl.hand.indexOf(act.cardId); if (i < 0) break; if (!S.canPayCost(state, act.cost)) break; if (act.cost > 0) S.spendMemory(state, act.cost); S.playDigimonFresh(state, p, i); break; }
      case 'option': { const i = pl.hand.indexOf(act.cardId); if (i < 0) break; S.useOptionCard(state, p, i); break; }
      case 'evolve': if (!S.digivolve(state, p, act.uid, act.cardId, act.cost, 'hand')) rejected = true; break;
      case 'jogress': if (!S.fuseStacks(state, p, act.a, act.b, act.cardId, act.cost, 'hand')) rejected = true; break;
      case 'train': if (!S.useTraining(state, p, act.uid)) rejected = true; break;
      case 'delay': { const st = find(p, act.uid); const body = st ? S.parseDelayEffect(S.card(st.cardId).effectKo) : null; if (!st || !body || state.turnNumber <= st.placedTurn) { rejected = true; break; } const cid = S.discardForDelay(state, p, act.uid); if (cid) state.pending.push({ uid: 'delay' + rid(), player: p, cardId: cid, stackUid: null, tags: ['메인'], text: body, resolved: false }); break; }
      case 'main': { const st = find(p, act.uid); if (!st) break; const zone = pl.raising && pl.raising.uid === st.uid ? 'raising' : 'battle'; const ab = S.activatableMainAbilities(state, p, st, zone)[act.idx]; if (ab) state.pending.push({ uid: 'main' + rid(), player: p, cardId: ab.cardId, stackUid: st.uid, tags: ab.tags, text: ab.text, resolved: false }); break; }
      case 'attack': if (!(await attack(p, act.uid, act.target))) { const c0 = cfgOf(p); if (c0 && c0.banned && act.key) c0.banned.add(act.key); await drain(); return false; } break; // declaration rejected: never retry it this turn
      default: break;
    }
    await drain(); await drainRepl();
    if (act.type === 'main' && act.key) { // livelock guard: a 【메인】 ability whose attempt only appends log lines ("cost can't be paid", "no legal combination") must not be re-chosen forever
      const mu = state._cpuMainUse && state._cpuMainUse.turn === state.turnNumber ? state._cpuMainUse : (state._cpuMainUse = { turn: state.turnNumber, n: {} });
      if ((mu.n[act.key] = (mu.n[act.key] || 0) + 1) >= 3) { const c = cfgOf(p); if (c && c.banned) c.banned.add(act.key); }
    }
    if (act.key && (rejected || sigBefore === sig(p))) { const c = cfgOf(p); if (c && c.banned) c.banned.add(act.key); return false; }
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
    // an effect resolved at the start of the turn (breeding/draw/unsuspend triggers) may already have pushed the memory over -> the turn ends automatically (6-1-4-1), it must not be "passed"
    if (!state.winner && state.activePlayer === p && state.phase === 'main' && !state.turnEnding && E.checkAutoEndTurn(state)) { await finishTurn(); return; }
    while (!state.winner && state.activePlayer === p && state.phase === 'main' && !state.turnEnding && n++ < maxActions) {
      const act = await choose();
      if (await applyMain(p, act)) break;
    }
    if (!state.winner && state.activePlayer === p && state.phase === 'main' && !state.turnEnding) { E.endTurn(state, false); await finishTurn(); }
    await finishTurn();
  }
  return { state, stats, drain, drainRepl, finishTurn, securityCheck, attack, exec, applyMain, beginTurn, mainLoop, find };
}
