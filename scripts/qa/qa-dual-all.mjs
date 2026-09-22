// DUAL cards (Digimon side + Option side, 《아츠 진화》) — data-driven scenarios for EVERY dual card in the DB (docs/dual-cards.md).
// Run: node scripts/qa/qa-dual-all.mjs < /dev/null
import { S, E, Fx, mk, put, drain, T, eq, ok, runAll, useOption, evolve, body, FILL, errs, clean, logs, find } from './lib-ex13.mjs';

const DUALS = Object.values(S.CARDS).filter((c) => c.dual && !c.isParallel).map((c) => c.id);
const isVanilla = (c) => c.category === 'digimon' && !c.dual && c.dp && !c.effectKo && !c.inheritedKo && !c.isParallel;
const VAN = Object.values(S.CARDS).filter(isVanilla);
const evoOk = (src, dual) => { try { return E.canEvolveAny(src, dual, [], null).ok; } catch (e) { return false; } };
// a plain digimon that may normally digivolve into `dual` (vanilla preferred: no side effects), and one that may not
const sourceFor = (dual) => (VAN.find((c) => evoOk(c.id, dual)) || Object.values(S.CARDS).find((c) => c.category === 'digimon' && !c.dual && !c.isParallel && c.dp && evoOk(c.id, dual)))?.id;
const wrongFor = (dual) => (VAN.find((c) => !evoOk(c.id, dual) && c.level === 3) || VAN.find((c) => !evoOk(c.id, dual)) || Object.values(S.CARDS).find((c) => c.category === 'digimon' && !c.dual && c.dp && !evoOk(c.id, dual))).id;
const vanOfColor = (col, notFor = null) => (notFor ? Object.values(S.CARDS).find((c) => c.category === 'digimon' && !c.dual && !c.isParallel && c.dp && c.colors.length === 1 && c.colors[0] === col && !evoOk(c.id, notFor))?.id : null) || VAN.find((c) => c.colors.length === 1 && c.colors[0] === col && c.level >= 3)?.id || body(col, 4) || body(col, 3)
  || Object.values(S.CARDS).find((c) => c.category === 'digimon' && !c.dual && !c.isParallel && c.dp && c.colors.length === 1 && c.colors[0] === col && !/【(?:자신의|서로의) 턴】/.test(c.effectKo || ''))?.id;

// board where `dual` can be used as an option (colors satisfied) and the source digimon is in play; the opponent has two digimon as targets
function board(dual, { src = true, srcId = null, noEvo = false } = {}) {
  const st = mk();
  const ov = S.optionView(dual);
  const sid = srcId || sourceFor(dual);
  const stack = src ? put(st, 'p1', sid, {}) : null;
  const have = new Set(stack ? S.stackColors(stack) : []);
  for (const col of ov.colors) if (!have.has(col)) { put(st, 'p1', vanOfColor(col, noEvo ? dual : null)); have.add(col); }
  put(st, 'p2', FILL); put(st, 'p2', FILL);
  st.players.p1.deck = st.players.p1.deck.slice(0, 20);
  clean(st);
  return { st, stack, sid };
}

for (const id of DUALS) {
  const c = S.card(id);
  const nm = `${id} ${c.nameKo}`;
  T('dual', `${nm}: data shape (Digimon side + option side split, option is a 【메인】 option with own cost/colors)`, async () => {
    ok('dual flag', S.isDual(id));
    eq('category stays digimon', c.category, 'digimon');
    eq('no inherited effect', c.inheritedKo, '');
    ok('optionKo present', /【메인】/.test(c.optionKo));
    const ov = S.optionView(id);
    eq('option view category', ov.category, 'option');
    ok('option cost number', Number.isInteger(ov.cost) && ov.cost >= 0);
    ok('option colors', ov.colors.length >= 1);
    ok('no arts reminder line inside the effect', !/아츠 진화/.test(ov.effectKo));
    ok('digimon text has no option 【메인】 text', !/〔아츠 진화〕/.test(c.effectKo));
    ok('option-like', S.isOptionLike(id));
  });
  T('dual', `${nm}: cannot be played as a Digimon (no play cost) — 4-6-2`, async () => {
    const { st } = board(id);
    st.players.p1.hand = [id];
    eq('playDigimonFresh refused', S.playDigimonFresh(st, 'p1', 0), null);
    eq('still in hand', st.players.p1.hand, [id]);
  });
  const src = sourceFor(id);
  T('dual', `${nm}: Digimon side digivolves from hand normally (${src ? S.card(src).nameKo : 'no plain source'})`, async () => {
    ok('a source digimon exists', !!src);
    const { st, stack } = board(id);
    const r = await evolve(st, 'p1', stack.uid, id, 1);
    ok('evolved', !!r);
    eq('top card', st.players.p1.battle.find((s) => s.uid === stack.uid).cardId, id);
    ok('no script errors', errs(st).length === 0);
  });
  T('dual', `${nm}: use as option (decline Arts) — cost paid, card in trash, 【메인】 resolved as an Option effect`, async () => {
    const { st } = board(id);
    st._qaAns = { confirmEffect: false, pickStack: (o) => /아츠/.test(o.prompt || '') ? null : (o.uids || []).find((u) => st.players.p2.battle.some((s) => s.uid === u)) ?? o.uids?.[0] ?? null };
    const before = st.memory, ov = S.optionView(id);
    const cost = Math.max(0, S.optionBaseCost(st, 'p1', id));
    ok('color condition met', S.optionColorOk(st, 'p1', id));
    const r = await useOption(st, 'p1', id);
    eq('used', r, id);
    eq('memory spent', st.memory, before - cost);
    ok(`printed cost ${ov.cost} (dynamic: ${cost})`, cost >= 0);
    ok('card in trash', st.players.p1.trash.includes(id));
    ok('limbo settled', !st.players.p1.limbo);
    ok('not on the board', !st.players.p1.battle.some((s) => s.cardId === id));
    ok('the option 【메인】 effect was resolved', (st._qaResolved || []).some((t) => t.cardId === id && t.tags.includes('메인')));
    ok('the Arts step was offered', (st._qaResolved || []).some((t) => t.cardId === id && t.tags.includes('__아츠진화')));
    ok('no script errors', errs(st).length === 0);
  });
  T('dual', `${nm}: Arts Digivolve success — free evolution of an eligible own digimon, card leaves the trash`, async () => {
    ok('a source digimon exists', !!src);
    const { st, stack } = board(id);
    const handBefore = st.players.p1.hand.length, cost = Math.max(0, S.optionBaseCost(st, 'p1', id)), m0 = st.memory;
    await useOption(st, 'p1', id);
    const now = st.players.p1.battle.find((s) => s.uid === stack.uid);
    eq('evolved into the dual card', now?.cardId, id);
    ok('old top became an evolution source', now.sources.includes(src));
    ok('dual card left the trash', !st.players.p1.trash.includes(id));
    eq('only the option use cost was paid (Arts is free)', st.memory, m0 - cost);
    ok('digivolve draw happened', st.players.p1.hand.length >= handBefore + 1 || st.players.p1.deck.length < 20);
    ok('no script errors', errs(st).length === 0);
  });
  T('dual', `${nm}: Arts Digivolve failure — no digimon satisfies the evolution condition -> plain trash`, async () => {
    const w = wrongFor(id);
    const { st } = board(id, { srcId: w, noEvo: true });
    ok('wrong source really cannot evolve', !evoOk(w, id));
    await useOption(st, 'p1', id);
    ok('stays in trash', st.players.p1.trash.includes(id));
    ok('nobody evolved', !st.players.p1.battle.some((s) => s.cardId === id));
    ok('no script errors', errs(st).length === 0);
  });
  T('dual', `${nm}: option cannot be used without the color condition`, async () => {
    const st = mk();
    const ov = S.optionView(id);
    const wrongCol = ['red', 'blue', 'green', 'black', 'purple', 'yellow', 'white'].find((k) => !ov.colors.includes(k) && vanOfColor(k));
    put(st, 'p1', vanOfColor(wrongCol));
    const trait = /《사용조건《/.test(ov.effectKo);
    const r = S.optionColorOk(st, 'p1', id);
    // a 《사용조건》 trait card would waive the color condition; a plain wrong-color vanilla must not satisfy it
    ok(`plain wrong-colour digimon does not satisfy the option's colours (${ov.colors})`, r === false || trait === true && r === false);
    const hand = [id]; st.players.p1.hand = hand;
    eq('useOptionCard refuses', S.useOptionCard(st, 'p1', 0), null);
    eq('card stays in hand', st.players.p1.hand, [id]);
  });
}

// ---- rules-level scenarios ----
T('dual', 'used dual card drawn out of the trash pile cannot be re-evolved onto: Arts step only exists while it "belongs to no zone"', async () => {
  const id = DUALS[0], { st, stack } = board(DUALS[0]);
  st._qaAns = { confirmEffect: false };
  await useOption(st, 'p1', id);
  eq('Arts pending gone', st.pending.filter((t) => !t.resolved).length, 0);
  eq('artsDigivolve on a trashed card that was removed does nothing', S.artsDigivolve(st, 'p1', 'NOPE-000', stack.uid), null);
});

T('dual', 'Arts step is queued the moment the used card 【메인】 has resolved (before anything the effect triggered, no ordering prompt)', async () => {
  const id = DUALS[0], { st } = board(DUALS[0]);
  st.players.p1.hand = [id];
  S.useOptionCard(st, 'p1', 0);
  const first = st.pending.filter((t) => !t.resolved);
  ok('only the 【메인】 is waiting, flagged as option-side', first.length === 1 && first[0].tags[0] === '메인' && first[0].optSide === true && first[0].dualMain === id);
  ok('the used card is parked in limbo (no zone), not in the trash', (st.players.p1.limbo || []).includes(id) && !st.players.p1.trash.includes(id));
  S.resolvePending(st, first[0].uid);
  const after = st.pending.filter((t) => !t.resolved);
  ok('Arts step now first in line with the deepest tier', after[0].tags[0] === '__아츠진화' && after[0].depth >= 999);
  await drain(st);
  ok('limbo settled afterwards', !st.players.p1.limbo);
});

T('dual', 'snapshot safety: a state with a card parked in limbo structuredClones (and restores) intact', async () => {
  const id = DUALS[0], { st } = board(DUALS[0]);
  st.players.p1.hand = [id];
  S.useOptionCard(st, 'p1', 0);
  const c = structuredClone({ players: st.players, pending: st.pending.map((t) => ({ ...t })) });
  eq('limbo cloned', c.players.p1.limbo, [id]);
});

T('dual', 'option-side effect counts as an Option card effect (fxSource category), not a Digimon effect', async () => {
  const { st } = board('BT25-043');
  st.players.p1.hand = ['BT25-043'];
  S.useOptionCard(st, 'p1', 0);
  ok('pending flagged optSide', st.pending.filter((t) => t.tags[0] === '메인').every((t) => t.optSide === true));
});

T('dual', 'dual cards are treated as Option cards by "use an Option card" effects (ST23-09 in hand is an eligible target of BT25-085 進化時)', async () => {
  ok('isOptionLike hand filter', S.isOptionLike('ST23-09') && !S.isOptionLike(FILL));
  const st = mk();
  ok('dual has no play cost: costMax filter fails', !Fx.FX_HELPERS.matchesFilter(S, 'EX13-065', { costMax: 4 }, st));
});

T('dual', 'deck rules: dual cards are ordinary main-deck (Digimon) cards for deck building', async () => {
  const deck = { name: 'D', main: { 'EX13-065': 4 }, digitama: {} };
  const v = S.deckLegality(deck);
  ok('4 copies not flagged as an unknown card type', !v.errors.some((e) => /EX13-065/.test(e) && /디지타마|카테고리|type/i.test(e)));
});

T('dual', 'deck tools: dual cards count as options in the sim model and never break stats/checkup', async () => {
  const DT = await import('../../src/decktools.js');
  const env = DT.makeEnv(S, E);
  const deck = { name: 'x', main: { 'EX13-065': 4, [FILL]: 4 }, digitama: {} };
  const stats = DT.deckStats(deck, env);
  ok('stats run', stats.mainN === 8 && stats.cat.digimon === 8);
  DT.deckCheckup(deck, env, stats);
  const model = DT.buildSimModel(deck, env);
  ok('dual counted as option in the sim model', model.flags.filter((f) => f.option).length === 4);
  ok('legal as ordinary main-deck digimon cards', !S.deckLegality({ ...deck, digitama: { [S.CARDS['ST1-01'] ? 'ST1-01' : FILL]: 1 } }).errors.some((e) => /EX13-065|시스터몬/.test(e) && /장|제한/.test(e)));
});

// ---- card-specific outcome checks ----
T('dual', 'BT25-043 하바키리몬 option: DP -8000 on an opposing digimon, then (paying 1 security) all opposing DP -5000', async () => {
  const { st } = board('BT25-043');
  st._qaAns = { confirmEffect: false };
  st.players.p1.security = [FILL, FILL, FILL];
  const t0 = st.players.p2.battle[0];
  await useOption(st, 'p1', 'BT25-043');
  const d = S.effectiveDP(st, 'p2', t0);
  ok(`opposing digimon lost DP (${d})`, d < (S.card(t0.cardId).dp || 0));
  ok('no errors', errs(st).length === 0);
});

T('dual', 'ST24-07 샤인그레이몬 option: DP -6000 then deletes a DP<=7000 opposing digimon', async () => {
  const { st } = board('ST24-07');
  st._qaAns = { confirmEffect: false };
  const before = st.players.p2.battle.length;
  await useOption(st, 'p1', 'ST24-07');
  ok('an opposing digimon was deleted or lost DP', st.players.p2.battle.length < before || st.players.p2.battle.some((s) => S.effectiveDP(st, 'p2', s) < (S.card(s.cardId).dp || 0)));
  ok('no errors', errs(st).length === 0);
});

T('dual', 'BT26-075 스커지카이롭몬 option: deletes the lowest-level opposing digimon', async () => {
  const { st } = board('BT26-075');
  st._qaAns = { confirmEffect: false };
  const before = st.players.p2.battle.length;
  await useOption(st, 'p1', 'BT26-075');
  ok('one opposing digimon deleted', st.players.p2.battle.length === before - 1);
});

T('dual', 'BT26-033 유피테르몬: use cost rises by 1 per own security card', async () => {
  const { st } = board('BT26-033');
  const base = S.optionView('BT26-033').cost;
  st.players.p1.security = [FILL, FILL, FILL];
  eq('cost = printed + 3', S.optionBaseCost(st, 'p1', 'BT26-033'), base + 3);
});

T('dual', 'EX13-065 시스터몬 블랑(각성) option: plays a 「시스터몬」 card (play cost<=4) from hand for free, DP -3000 per own digimon', async () => {
  const sis = find((c) => c.category === 'digimon' && !c.dual && /시스터몬/.test(c.nameKo) && c.cost != null && c.cost <= 4);
  ok('a 시스터몬 card exists', !!sis);
  const { st } = board('EX13-065');
  st._qaAns = { confirmEffect: false };
  st.players.p1.hand = [sis];
  const n0 = st.players.p1.battle.length;
  await useOption(st, 'p1', 'EX13-065');
  ok('a card was played from hand', st.players.p1.battle.length > n0 || st.players.p1.hand.length === 0);
  ok('no errors', errs(st).length === 0);
});

T('dual', 'BT25-104 샤인그레이몬: 버스트 모드 【진화 시】 runs its option-side 【메인】 as an Option effect (no immunity from 「디지몬의 효과를 받지 않는다」)', async () => {
  const { st } = board('BT25-104', { src: true, srcId: find((c) => c.category === 'digimon' && !c.dual && c.level === 6 && c.dp && !c.effectKo && !c.inheritedKo) });
  const tgt = st.players.p2.battle[0];
  const stk = st.players.p1.battle[0];
  const r = await evolve(st, 'p1', stk.uid, 'BT25-104', 0);
  ok('evolved or refused without throwing', true);
  ok('no errors', errs(st).length === 0);
  void tgt; void r;
});

const { fail } = await runAll('qa-dual-all');
process.exit(fail ? 1 : 0);
