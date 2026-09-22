// Shared harness for scripts/qa/qa-slice2-*.mjs : builds a controlled board on the REAL engine (state.js/effects.js), fires triggers,
// drains pending effects with a scripted chooser, and runs data-driven scenarios. Each scenario cites its Q id (data/rulings is gitignored).
import * as fs from 'fs';
import * as S from '../../src/state.js';
import * as E from '../../src/engine.js';
import * as Fx from '../../src/effects.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url, 'utf8')) });
await S.loadData();
export { S, E, Fx };
const cardsAll = Object.values(S.CARDS);
export const FILL = cardsAll.filter(c => c.category === 'digimon' && c.level === 3 && c.dp && !(c.effectKo || '').trim() && !(c.inheritedKo || '').trim()).slice(0, 60).map(c => c.id);
export const fillOf = (pred) => cardsAll.filter(c => c.category === 'digimon' && !(c.effectKo || '').trim() && !(c.inheritedKo || '').trim() && pred(c)).map(c => c.id);
export const C = (id) => { const c = S.CARDS[id]; if (!c) throw new Error('no card ' + id); return c; };
export function world(o = {}) {
  const f = FILL;
  const deck = (n) => { const main = {}; for (let i = 0; i < 20; i++) main[f[i]] = 1; return { name: n, main, digitama: {} }; };
  const st = S.newGame(deck('A'), deck('B'));
  for (const p of ['p1', 'p2']) { const pl = st.players[p]; pl.hand = []; pl.trash = []; pl.security = f.slice(20, 25); pl.battle.length = 0; pl.deck = f.slice(26, 46); pl.raising = null; }
  st.turnNumber = 5; st.activePlayer = 'p1'; st.phase = 'main'; st.memory = o.memory ?? 5;
  const W = { st, prompts: [], picks: {}, errors: [] };
  W.pl = (p) => st.players[p];
  // ids[0] = top card, ids[1..] = sources
  W.put = (p, ids, opt = {}) => { ids = [].concat(ids); const s = S._s4.makeStack(ids[0], 1); s.sources = ids.slice(1); s.attackEligibleTurn = opt.fresh ? st.turnNumber + 1 : 0; s.placedTurn = 0; if (opt.suspended) s.suspended = true; st.players[p].battle.push(s); S.recomputeStackGrants(s); return s; };
  W.hand = (p, ids) => { st.players[p].hand = [].concat(ids); };
  W.trash = (p, ids) => { st.players[p].trash = [].concat(ids); };
  W.sec = (p, ids) => { st.players[p].security = [].concat(ids); };
  W.deck = (p, ids) => { st.players[p].deck = [].concat(ids); };
  W.by = (p, uid) => st.players[p].battle.find(s => s.uid === uid);
  W.alive = (p, s) => !!W.by(p, s.uid);
  W.dp = (p, s) => S.effectiveDP(st, p, s);
  W.mem = (p = 'p1') => (p === 'p1' ? st.memory : -st.memory);
  W.count = (p, id) => st.players[p].battle.filter(s => s.cardId === id).length;
  W.choose = async (k, o) => {
    W.prompts.push({ k, o });
    const h = W.picks[k]; if (typeof h === 'function') { const r = h(o, W); if (r !== undefined) return r; } else if (h !== undefined) return h;
    if (k === 'confirmEffect') return true;
    if (k === 'pickStack') return o.uids?.[0] ?? null;
    if (k === 'pickStackAnySide') return o.entries?.[0] ?? null;
    if (k === 'pickFromZoneIndex') return o.eligibleIdxs?.[0] ?? null;
    if (k === 'pickFromHandIndexes') return (o.eligibleIdxs || []).slice(0, o.n || 1);
    if (k === 'pickFromRevealed') return (o.eligible || []).slice(0, o.max ?? 1).map(x => x.i);
    if (k === 'multipleChoice') return 0;
    return null;
  };
  W.resolved = [];
  W.drain = async () => {
    let g = 0;
    while (g++ < 60) {
      const t = st.pending.find(x => !x.resolved); if (!t) break;
      W.resolved.push({ cardId: t.cardId, tags: t.tags });
      try {
        if (t.schedFn) { t.schedFn(); S.resolvePending(st, t.uid); continue; }
        const specific = Fx.lookupCardSpecific(t.cardId, t.tags, t.text, !!t.inherited);
        const script = specific || Fx.compileToScript(t.text);
        const ctx = { state: st, S, E, self: t.player, opp: S.opponentOf(t.player), sourceCardId: t.cardId, sourceStackUid: t.stackUid, trigger: t, startAttack() {}, securityCheck: async () => {}, choose: W.choose };
        await Fx.runScript(script, ctx);
      } catch (e) { W.errors.push(String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ')); }
      S.resolvePending(st, t.uid);
    }
  };
  W.play = async (p, id) => { st.players[p].hand.unshift(id); const s = S.playDigimonFresh(st, p, 0); await W.drain(); return s; };
  W.evolve = async (p, uid, id, cost = 0) => { st.players[p].hand.unshift(id); const s = S.digivolve(st, p, uid, id, cost, 'hand'); await W.drain(); return s; };
  // colour condition (4-22): a throw-away inert digimon of the option's colour is placed only while the option is being paid for, then removed before its effect resolves
  W.useOption = async (p, id) => { st.players[p].hand.unshift(id); const mates = []; if (!S.optionColorOk(st, p, id)) for (const col of C(id).colors) { const have = new Set(st.players[p].battle.flatMap(x => S.stackColors(x))); if (!have.has(col)) mates.push(W.put(p, fillOf(c => (c.colors || []).length === 1 && c.colors[0] === col)[0] || fillOf(c => (c.colors || []).includes(col))[0])); } const r = S.useOptionCard(st, p, 0); for (const mate of mates) { const b = st.players[p].battle; b.splice(b.indexOf(mate), 1); } if (mates.length) st._leavePending = []; await W.drain(); return r; };
  W.fire = async (p, stack, kind) => { S.queueTriggersForStack(st, p, stack, kind); await W.drain(); };
  W.emit = async (kind, info) => { S.emitGameEvent(st, kind, info); await W.drain(); };
  // attack: target = uid of a defender digimon, or null for the security check
  // opts.block = uid of a defender digimon that blocks (rested, attack retargeted to it, 'blocked' event) like main.js paBlock
  W.attack = async (p, uid, target = null, opts = {}) => {
    const opp = S.opponentOf(p); const dec = S.declareAttack(st, p, uid, opts.atk || {}); if (!dec.ok) return { ok: false, reason: dec.reason };
    const atk = dec.stack;
    S.queueTriggersForStack(st, p, atk, 'attack'); S.emitGameEvent(st, 'attack', { owner: p, stack: atk, cause: null }); await W.drain();
    if (!W.by(p, uid)) return { ok: true, gone: true };
    S.s1AttackTargeted(st, p, atk, target ? 'digimon' : 'player', target); await W.drain();
    if (target && W.by(opp, target)) { S.emitGameEvent(st, 'attackOnDigimon', { owner: p, stack: atk, cause: null, target: W.by(opp, target) }); await W.drain(); }
    if (opts.block) { const b = W.by(opp, opts.block); S.restStack(st, opp, b.uid, 'block'); target = b.uid; S.emitGameEvent(st, 'redirect', { owner: p, stack: atk, cause: null, targetUid: b.uid }); S.emitGameEvent(st, 'blocked', { owner: p, stack: atk, blocker: b, cause: null }); await W.drain(); }
    let res = null;
    if (target) { if (W.by(opp, target)) res = S.resolveDigimonBattle(st, p, uid, target); }
    else if (!st.winner && W.by(p, uid)) { res = S.resolveSecurityCheck(st, p, uid, opp); const last = res.checks?.[res.checks.length - 1]; if (last && (last.result === 'defenderWins' || last.result === 'tie') && W.by(p, uid)) S.deleteStack(st, p, uid, 'trash', 'battle'); }
    await W.drain();
    if (W.by(p, uid)) { S.queueTriggersForStack(st, p, atk, 'attackEnd'); S.emitGameEvent(st, 'attackEnd', { owner: p, stack: atk, cause: null }); await W.drain(); }
    return { ok: true, res };
  };
  // run the phase machine from 'unsuspend' (turn start) to 'main' for the active player, draining triggers at each step
  // p's turn begins: the opponent ends its turn (E.endTurn queues 【턴 개시 시】), then unsuspend/draw/breeding/main are stepped with all triggers drained
  W.newTurn = async (p) => { st.activePlayer = S.opponentOf(p); st.phase = 'main'; E.endTurn(st, false); let g = 0; while (st.turnEnding && !st.winner && g++ < 10) { await W.drain(); E.settleTurnEnd(st); } await W.drain(); g = 0; while (st.phase !== 'main' && g++ < 8) { E.nextPhase(st); await W.drain(); } };
  return W;
}
// scenario: { q, card, name, run: async (W)=>ctx, expect: (W, ctx)=>[[desc, bool],...], world? }
export async function runScenarios(list, label) {
  const out = []; let pass = 0, fail = 0;
  for (const sc of list) {
    let r;
    try { const W = world(sc.world || {}); const ctx = await sc.run(W); const checks = sc.expect(W, ctx) || []; if (process.env.QA_Q && +process.env.QA_Q === sc.q) { console.log('--- trace Q' + sc.q + ' ' + (sc.name || '')); console.log(W.st.log.slice(0, 25).reverse().map(e => e.msg).join(String.fromCharCode(10))); console.log(W.prompts.map(p => p.k + ' ' + JSON.stringify(p.o).slice(0, 160)).join(String.fromCharCode(10))); } r = { q: sc.q, card: sc.card, ok: checks.every(c => c[1]), fails: checks.filter(c => !c[1]).map(c => c[0]) }; if (W.errors.length && !sc.allowErrors) { r.ok = false; r.fails.push('script errors: ' + W.errors[0]); } }
    catch (e) { r = { q: sc.q, card: sc.card, ok: false, crash: true, fails: ['crash: ' + String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ')] }; }
    if (r.ok) pass++; else fail++;
    out.push(r); if (!r.ok) console.log(`FAIL Q${sc.q} ${sc.card} ${sc.name || ''}: ${r.fails.join(' ; ')}`);
  }
  console.log(`${label}: ${list.length} scenarios, pass ${pass}, fail ${fail}`);
  try { fs.writeFileSync(`scripts/qa/_s2-result-${label}.json`, JSON.stringify(out)); } catch {}
  return out;
}
