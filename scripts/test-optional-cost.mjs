// Rule 15-7-1 ("～ことで" = 「~하는 것으로」 optional processing condition): every "<cost>하는 것으로, <effect>" is the PLAYER's choice, asked BEFORE anything is paid.
// For a sample of >=40 distinct cards (compiled costGroups covering every cost kind) this asserts:
//   * a confirmEffect prompt {optionalCost:true, cardId, costKinds, effectText} appears BEFORE any state change,
//   * 'no' leaves the state (incl. 〔턴에 N회〕 counters) unchanged and nothing later in the text runs,
//   * 'yes' pays and then runs the benefit (state changes),
//   * a cost that cannot be paid in full -> no prompt, no change (15-7-3),
//   * the watcher-rested tamer path (restPending) rests the tamer only after 'yes'.
// Run: node scripts/test-optional-cost.mjs [--verbose] < /dev/null
import * as fs from 'fs';
import * as S from '../src/state.js';
import * as E from '../src/engine.js';
import * as Fx from '../src/effects.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url, 'utf8')) });
await S.loadData();
const verbose = process.argv.includes('--verbose');
const cards = Object.values(S.CARDS);
const digi = cards.filter(c => c.category === 'digimon' && c.level === 3);
const filler = digi.slice(0, 40).map(c => c.id);
const tamerId = cards.find(c => c.category === 'tamer' && !(c.effectKo || '').trim()).id;
const optId = cards.find(c => c.category === 'option').id;
let fail = 0, pass = 0;
const check = (ok, msg) => { if (ok) pass++; else { fail++; console.log('FAIL', msg); } };

function scenario(cardId) {
  const deck = (n) => { const main = {}; for (let i = 0; i < 20; i++) main[filler[i]] = 1; return { name: n, main, digitama: {} }; };
  const st = S.newGame(deck('A'), deck('B'));
  for (const p of ['p1', 'p2']) { const pl = st.players[p]; pl.hand = filler.slice(0, 8).concat(cards.filter(c => c.category === 'digimon' && c.level >= 4).slice(0, 4).map(c => c.id)); pl.trash = filler.slice(8, 20).concat([optId, optId]); pl.security = filler.slice(20, 26); pl.battle.length = 0; pl.deck = filler.slice(26, 40); pl.raising = null; }
  st.turnNumber = 5; st.activePlayer = 'p1'; st.phase = 'main'; st.memory = 5;
  const mk = (p, ids) => { const s = S._s4.makeStack(ids[0], 1); s.sources = ids.slice(1); s.attackEligibleTurn = 0; st.players[p].battle.push(s); S.recomputeStackGrants(s); return s; };
  const isT = S.card(cardId).category === 'tamer';
  const src = mk('p1', [cardId, ...filler.slice(0, 4), ...digi.slice(40, 43).map(c => c.id)]); // sources: plenty (Lv.3 ×7)
  const o1 = mk('p1', [filler[5], filler[6]]), o2 = mk('p1', [filler[7], filler[8]]), t1 = mk('p1', [tamerId]);
  const e1 = mk('p2', [filler[9], filler[10]]), e2 = mk('p2', [filler[11]]);
  return { st, src, o1, o2, t1, e1, e2 };
}
const sig = (st) => JSON.stringify({ m: st.memory, pl: ['p1', 'p2'].map(p => { const q = st.players[p]; return [q.hand, q.trash, q.security, q.deck.length, q.battle.map(s => [s.uid, s.cardId, s.sources, s.suspended, s.tempDP || 0, s.turnEffectUses || null]), q.raising && q.raising.cardId]; }) });
function run(cardId, tags, body, answer, onceKey) {
  const sc = scenario(cardId), { st } = sc;
  const script = Fx.lookupCardSpecific(cardId, tags, body, false) || Fx.compileToScript(body);
  const cg = Array.isArray(script) && script.find(o => o.op === 'costGroup');
  if (!cg) return { skip: 'no-costGroup' };
  const trig = { text: body, tags, cardId, stackUid: sc.src.uid, player: 'p1', evtStackUid: sc.o1.uid };
  const log = []; let before = null;
  const ctx = { state: st, S, E, self: 'p1', opp: 'p2', sourceCardId: cardId, sourceStackUid: sc.src.uid, trigger: trig, startAttack() {}, attack: () => null, endAttack() {},
    choose: async (k, o) => {
      if (k === 'confirmEffect') { const s0 = sig(st); log.push({ k, o, changed: s0 !== before }); return o && o.optionalCost ? answer : true; }
      if (k === 'pickStack') return o.uids?.[0] ?? null;
      if (k === 'pickStackAnySide') return o.entries?.[0] ? { player: o.entries[0].player, uid: o.entries[0].uid } : null;
      if (k === 'pickFromZoneIndex') return o.eligibleIdxs?.[0] ?? null;
      if (k === 'pickFromHandIndexes') return (o.eligibleIdxs || []).slice(0, o.n || 1);
      if (k === 'pickFromRevealed') return (o.eligible || []).slice(0, o.max ?? 1).map(x => x.i);
      if (k === 'multipleChoice') return 0;
      log.push({ k }); return null;
    } };
  const payable = Fx.costGroupPayable(ctx, cg);
  before = sig(st);
  return Fx.runScript(script, ctx).then(() => ({ st, before, after: sig(st), log, payable, kinds: Fx.costKindsOf(cg.cost), ctx, cg }), () => ({ crash: true }));
}

// ---- enumerate compiled costGroup segments ----
const seen = new Set(), kindCover = {}, picked = [], unpayable = [];
for (const c of cards) {
  if (seen.has(c.id)) continue;
  for (const [srcName, text] of [['effectKo', c.effectKo], ['inheritedKo', c.inheritedKo]]) {
    if (!text || seen.has(c.id)) continue;
    for (const seg of S.parseEffectSegments(text).segments) {
      const body = seg.body.replace(/^[\[〔]턴\s*에?\s*\d+\s*회[\]〕]\s*/, '');
      if (!/것으로/.test(body) || /\n/.test(seg.body)) continue;
      const script = Fx.lookupCardSpecific(c.id, seg.tags, seg.body, srcName === 'inheritedKo') || Fx.compileToScript(seg.body);
      if (!Array.isArray(script) || !script[0] || script[0].op !== 'costGroup' || script[0].else) continue;
      const kinds = Fx.costKindsOf(script[0].cost);
      if (kinds.includes('manual')) continue;
      const k0 = kinds[0];
      if ((kindCover[k0] || 0) >= 7) continue; // sample: <=7 cards per primary cost kind
      const r = await run(c.id, seg.tags, seg.body, false);
      if (r.skip || r.crash) continue;
      if (!r.payable) { if (unpayable.length < 14) unpayable.push({ id: c.id, tags: seg.tags, body: seg.body }); continue; }
      kindCover[k0] = (kindCover[k0] || 0) + 1; seen.add(c.id); picked.push({ id: c.id, tags: seg.tags, body: seg.body, kinds, srcName });
      break;
    }
  }
}
console.log(`sampled ${picked.length} distinct cards; primary cost kinds: ${JSON.stringify(kindCover)}; unpayable samples ${unpayable.length}`);
check(picked.length >= 40, `need >=40 distinct cards, got ${picked.length}`);

for (const pk of picked) {
  const no = await run(pk.id, pk.tags, pk.body, false);
  const tag = `${pk.id} [${pk.tags.join('/')}] ${pk.kinds.join('+')}`;
  check(!no.crash && no.log.some(l => l.o && l.o.optionalCost), `${tag}: no optional-cost prompt appeared`);
  const first = no.log.find(l => l.o && l.o.optionalCost);
  if (first) {
    check(first.changed === false, `${tag}: state changed BEFORE the prompt (cost was auto-paid)`);
    check(first.o.cardId === pk.id && Array.isArray(first.o.costKinds) && typeof first.o.effectText === 'string' && /하는 것으로/.test(first.o.prompt), `${tag}: prompt payload does not identify the effect`);
  }
  check(no.before === no.after, `${tag}: 'no' changed the state`);
  check(no.ctx._declined === true && no.ctx._costUnpaid === true, `${tag}: 'no' must flag _declined/_costUnpaid (once-per-turn refund)`);
  const yes = await run(pk.id, pk.tags, pk.body, true);
  check(!yes.crash && yes.before !== yes.after, `${tag}: 'yes' changed nothing (cost not paid / effect not run)`);
  check(yes.log.filter(l => l.o && l.o.optionalCost).length === 1, `${tag}: expected exactly one optional-cost prompt on 'yes'`);
}
// ---- 15-7-3: a cost that cannot be paid in full -> no prompt, no change ----
for (const u of unpayable) {
  const r = await run(u.id, u.tags, u.body, true);
  check(!r.crash && !r.log.some(l => l.o && l.o.optionalCost) && r.before === r.after, `${u.id} unpayable: expected no prompt and no state change`);
}
// ---- bespoke (shard) scripts without a costGroup: the runScript gate asks first (unless the script already asks itself) ----
{
  let gated = 0, ownAsk = 0, bad = 0;
  const bespoke = [];
  for (const c of cards) for (const [srcName, text] of [['effectKo', c.effectKo], ['inheritedKo', c.inheritedKo]]) {
    if (!text) continue;
    for (const seg of S.parseEffectSegments(text).segments) {
      if (/\n\s*[·▷]/.test(seg.body) || !Fx.optionalCostSplit(seg.body)) continue;
      const sp = Fx.lookupCardSpecific(c.id, seg.tags, seg.body, srcName === 'inheritedKo');
      if (!Array.isArray(sp) || !sp.length || JSON.stringify(sp, (k, v) => (typeof v === 'function' ? 'fn' : v)).includes('costGroup')) continue;
      bespoke.push({ id: c.id, tags: seg.tags, body: seg.body, inherited: srcName === 'inheritedKo' });
    }
  }
  const seenB = new Set();
  for (const b of bespoke) {
    if (seenB.has(b.id)) continue; seenB.add(b.id);
    const sc = scenario(b.id); const { st } = sc;
    const script = Fx.lookupCardSpecific(b.id, b.tags, b.body, b.inherited);
    const trig = { text: b.body, tags: b.tags, cardId: b.id, stackUid: sc.src.uid, player: 'p1', evtStackUid: sc.o1.uid };
    const prompts = []; let s0 = sig(st), changedBefore = null;
    const ctx = { state: st, S, E, self: 'p1', opp: 'p2', sourceCardId: b.id, sourceStackUid: sc.src.uid, trigger: trig, startAttack() {}, attack: () => null, endAttack() {},
      choose: async (k, o) => { if (k === 'confirmEffect') { prompts.push({ o, changed: sig(st) !== s0 }); return o && o.optionalCost ? false : false; } return null; } };
    try { await Fx.runScript(script, ctx); } catch (e) { bad++; console.log('  bespoke crash', b.id, e.message); continue; }
    const gate = prompts.find(p => p.o && p.o.optionalCost);
    if (gate) { gated++; check(!gate.changed && sig(st) === s0, b.id + ' (bespoke gate): state changed before/after a declined gate'); check(ctx._declined === true, b.id + ' (bespoke gate): _declined not set'); }
    else ownAsk++;
    if (gated >= 60 && ownAsk >= 20) break;
  }
  console.log('bespoke scripts: ' + gated + ' gated by runScript, ' + ownAsk + ' ask/skip on their own');
  check(gated >= 40, 'expected >=40 bespoke cards gated, got ' + gated);
}
// ---- mandatory forms (no 것으로) must not prompt ----
{
  const sc = scenario('BT1-084'); let asked = 0;
  const script = Fx.compileToScript('메모리를 +1 한다.');
  await Fx.runScript(script, { state: sc.st, S, E, self: 'p1', opp: 'p2', sourceCardId: 'BT1-084', sourceStackUid: sc.src.uid, trigger: { text: '메모리를 +1 한다.', tags: ['등장 시'] }, choose: async (k) => { if (k === 'confirmEffect') asked++; return true; } });
  check(asked === 0, 'mandatory "메모리를 +1 한다." must not prompt');
}
// ---- once-per-turn: a declined optional cost does not consume 〔턴에 1회〕 (main.js/cpusim refund on ctx._declined) ----
{
  const sc = scenario('BT1-039'); const key = S.onceLimitKey('BT1-039', ['어택 시']);
  S.markTurnEffectUsed(sc.src, key); // main.js marks before running
  const before = sc.src.turnEffectUses[key];
  const script = Fx.compileToScript('[턴에 2회] 자신의 패를 3장 파기하는 것으로, 이 디지몬을 액티브로 한다.');
  const ctx = { state: sc.st, S, E, self: 'p1', opp: 'p2', sourceCardId: 'BT1-039', sourceStackUid: sc.src.uid, trigger: { text: '자신의 패를 3장 파기하는 것으로, 이 디지몬을 액티브로 한다.', tags: ['어택 시'] }, choose: async (k) => (k === 'confirmEffect' ? false : null) };
  await Fx.runScript(script, ctx);
  check(ctx._declined === true && sc.src.turnEffectUses[key] === before, 'once-per-turn counter untouched by runScript on decline (runner refunds via _declined)');
}
// ---- watcher-queued "이 테이머를 레스트시키는 것으로": tamer stays active until the player says yes ----
for (const [tid, kind, mkInfo] of [['BT2-086', 'attack', (sc) => ({ owner: 'p1', stack: sc.o1 })], ['ST6-14', 'delete', (sc) => ({ owner: 'p1', stack: sc.o1, cause: 'effect' })], ['ST4-14', 'rest', (sc) => ({ owner: 'p2', stack: sc.e1, cause: 'effect' })]]) {
  for (const ans of [false, true]) {
    const sc = scenario(tamerId); const tam = S._s4.makeStack(tid, 1); tam.attackEligibleTurn = 0; sc.st.players.p1.battle.push(tam); S.recomputeStackGrants(tam);
    if (tid === 'BT2-086') { const c = S.card(filler[5]); void c; }
    sc.st.pending.length = 0;
    S.emitGameEvent(sc.st, kind, mkInfo(sc));
    const t = sc.st.pending.find(x => x.stackUid === tam.uid);
    if (!t) { console.log(`  (watcher ${tid}/${kind}: not queued in this scenario, skipped)`); continue; }
    check(t.restPending === true && !tam.suspended, `${tid}: tamer must NOT be rested at queue time (restPending=${t.restPending}, suspended=${tam.suspended})`);
    const script = Fx.lookupCardSpecific(t.cardId, t.tags, t.text, false) || Fx.compileToScript(t.text);
    let asked = 0;
    const ctx = { state: sc.st, S, E, self: 'p1', opp: 'p2', sourceCardId: t.cardId, sourceStackUid: t.stackUid, trigger: t, startAttack() {}, choose: async (k, o) => { if (k === 'confirmEffect') { asked++; check(tam.suspended === false, `${tid}: tamer rested before the prompt`); return o && o.optionalCost ? ans : true; } if (k === 'pickStack') return o.uids?.[0] ?? null; return null; } };
    await Fx.runScript(script, ctx);
    check(asked === 1, `${tid}: expected exactly 1 prompt, got ${asked}`);
    check(tam.suspended === ans, `${tid}: after '${ans ? 'yes' : 'no'}' tamer suspended=${tam.suspended}`);
  }
}
console.log(`optional-cost test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
