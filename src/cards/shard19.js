// Shard 19 — option-card zone audit, batch 2 (docs/verify-options-2.md).
// Per-card scripts for Option cards whose generic compilation read/wrote the wrong zone or side (trash-zone triggers, "→ deck bottom" costs,
// evolution-source / opponent-trash / breeding-area references, delay bullets that resolved the MAIN script, ...).
// state.js is imported lazily (only used inside functions) because state.js imports cards/index.js.
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

// ------------------------------------------------------------------ helpers
const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
const C = (id) => S.card(id);
const isDig = (st) => !!st && C(st.cardId).category === 'digimon';
const isTam = (st) => !!st && C(st.cardId).category === 'tamer';
const stacksOf = (state, p) => [state.players[p].raising, ...state.players[p].battle].filter(Boolean);
const digs = (state, p) => state.players[p].battle.filter(isDig);
const tams = (state, p) => state.players[p].battle.filter(isTam);
const hasType = (c, ...ts) => ts.some(t => (c.types || []).includes(t));
const fn = (f) => ({ op: 's19_fn', fn: f });
OPS.s19_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
const sc = (key, f) => { SCRIPTS[key] = [fn(f)]; };
const log = (ctx, msg) => S.log(ctx.state, msg);
const removeFrom = (arr, id) => { const i = arr.lastIndexOf(id); if (i >= 0) arr.splice(i, 1); return i >= 0; };

async function ask(ctx, prompt, who) { return !!(await ctx.choose('confirmEffect', { player: who || ctx.self, prompt })); }
async function pickStack(ctx, who, stacks, prompt) {
  if (!stacks.length) return null;
  const uid = await ctx.choose('pickStack', { player: who, uids: stacks.map(s => s.uid), prompt });
  return stacks.find(s => s.uid === uid) || null;
}
// pick one card from an arbitrary id list (temp zone trick so the stock picker UI works)
async function pickFromList(ctx, who, ids, idxs, prompt) {
  if (!idxs.length) return null;
  const pl = ctx.state.players[who];
  pl.s19tmp = ids;
  try { return await ctx.choose('pickFromZoneIndex', { player: who, zone: 's19tmp', eligibleIdxs: idxs, prompt }); } finally { delete pl.s19tmp; }
}
// run the printed MAIN segment of a card (bespoke script or compiled)
async function runMainOf(ctx, R, cardId) {
  const Fx = await import('../effects.js');
  const seg = S.parseEffectSegments(C(cardId).effectKo || '').segments.find(sg => sg.tags.includes('메인') && !sg.zoneMarker && !/^[≪《]\s*딜레이/.test(sg.body.trim()));
  if (!seg) return;
  const script = Fx.lookupCardSpecific(cardId, seg.tags, seg.body) || Fx.compileToScript(seg.body);
  await R.runScript(script, { ...ctx, sourceCardId: cardId });
}

// ================================================================== [트래시] "세븐스" options
// "[트래시]【자신의 턴】 자신의 디지몬이 「N」로 진화했을 때, 이 카드를 덱 아래로 되돌리는 것으로, …" — queued by state.queueTrashZoneEventTriggers
// while the card is in the TRASH; paying the cost = moving this card from the trash to the bottom of its own deck.
async function payReturnSelfToDeckBottom(ctx) {
  const { state, self } = ctx;
  const pl = state.players[self];
  if (!removeFrom(pl.trash, ctx.sourceCardId)) return false; // it has to be in the trash to be returned
  pl.deck.push(ctx.sourceCardId);
  log(ctx, `${self} ${C(ctx.sourceCardId).nameKo}을(를) 트래시에서 덱 아래로 되돌림`);
  return true;
}
function seventh(id, tag, effect) {
  sc(`${id}::${tag}`, async (ctx, R) => {
    if (!ctx.state.players[ctx.self].trash.includes(ctx.sourceCardId)) return;
    if (!await ask(ctx, `${C(id).nameKo}: 이 카드를 덱 아래로 되돌리고 효과를 발휘할까요?`)) return;
    if (!await payReturnSelfToDeckBottom(ctx)) return;
    await effect(ctx, R);
  });
}
seventh('BT12-110', '자신의 턴', (ctx, R) => R.runOne({ op: 'destroy', target: 'opponent', mode: 'choose', filter: { extreme: { stat: 'level', dir: 'min' } } }, ctx));
seventh('BT15-100', '서로의 턴', async (ctx, R) => {
  await R.runOne({ op: 'destroy', target: 'opponent', mode: 'choose', filter: { level: 4 } }, ctx);
  await R.runOne({ op: 'destroy', target: 'opponent', mode: 'choose', filter: { level: 6 } }, ctx);
});
for (const id of ['EX7-072', 'EX8-072', 'BT23-097', 'BT24-096']) seventh(id, '자신의 턴', (ctx, R) => runMainOf(ctx, R, id));
seventh('BT19-094', '자신의 턴', async (ctx) => {
  const { state, self } = ctx, o = opp(self);
  if (state.players[o].security.length && await ask(ctx, `${C('BT19-094').nameKo}: 시큐리티를 위에서부터 1장 파기할까요? (파기하지 않으면 상대가 《리커버리 +1》)`, o)) S.trashTopSecurityByEffect(state, o);
  else S.recoverTopOfDeckToSecurity(state, self);
});

// ================================================================== shared building blocks
const ownDigimonWhere = (state, p, pred) => digs(state, p).filter(pred);
const traitOf = (id, ...ts) => hasType(C(id), ...ts);
async function runOp(ctx, R, instr) { await R.runOne(instr, ctx); }
// evolve one specific (already chosen) own stack into a card of its owner's hand/trash, paying the printed cost minus `discount` (free when discount === 'free')
async function evolvePinned(ctx, st, zone, cardPred, discount, prompt) {
  const { state, self } = ctx;
  const pl = state.players[self];
  const idxs = pl[zone].map((id, i) => i).filter(i => C(pl[zone][i]).category === 'digimon' && cardPred(pl[zone][i]) && ctx.E.canEvolveAny(st.cardId, pl[zone][i], S.evoExtraArg(state, null, st), S.evolveTargetRestriction(state, self, st)).ok);
  if (!idxs.length) { log(ctx, `${self} 진화할 수 있는 카드가 없음`); return null; }
  const idx = await ctx.choose('pickFromZoneIndex', { player: self, zone, eligibleIdxs: idxs, prompt: prompt || '진화할 카드 선택' });
  if (idx == null) return null;
  const cardId = pl[zone][idx];
  const chk = ctx.E.canEvolveAny(st.cardId, cardId, S.evoExtraArg(state, null, st), null);
  const printed = chk.ok ? chk.cost : (C(cardId).evoNormal?.cost ?? 0);
  const cost = discount === 'free' ? 0 : Math.max(0, printed - (discount || 0));
  if (zone === 'trash') pl.trash.splice(idx, 1);
  return S.digivolve(state, self, st.uid, cardId, cost, zone === 'trash' ? 'trash' : 'hand');
}

// ================================================================== MAIN fixes
// EX6-066 천성괴해: 패의 「수생」 디지몬 카드 1장을 블루인 자신의 디지몬의 진화원 아래에 놓는 것으로, 놓은 카드와 같은 Lv.의 상대의 디지몬 전부를 패로 되돌린다.
sc('EX6-066::메인', async (ctx, R) => {
  const { state, self } = ctx, pl = state.players[self];
  const blue = ownDigimonWhere(state, self, s => S.stackColors(s).includes('blue'));
  const idxs = pl.hand.map((id, i) => i).filter(i => C(pl.hand[i]).category === 'digimon' && (C(pl.hand[i]).types || []).some(t => t.includes('수생')));
  if (!blue.length || !idxs.length) { log(ctx, `${self} 비용(패의 「수생」 디지몬 카드 / 블루인 자신의 디지몬)을 지불할 수 없어 효과를 건너뜀`); return; }
  if (!await ask(ctx, '패의 「수생」 디지몬 카드 1장을 블루인 자신의 디지몬의 진화원 아래에 놓아 효과를 발휘할까요?')) return;
  const hi = await ctx.choose('pickFromZoneIndex', { player: self, zone: 'hand', eligibleIdxs: idxs, prompt: '진화원 아래에 놓을 「수생」 디지몬 카드 선택' });
  if (hi == null) return;
  const st = await pickStack(ctx, self, blue, '카드를 진화원 아래에 놓을 블루인 디지몬 선택');
  if (!st) return;
  const [id] = pl.hand.splice(hi, 1);
  st.sources.splice(S.fdCount(st), 0, id); S.recomputeStackGrants(st);
  log(ctx, `${self} ${C(id).nameKo}을(를) ${C(st.cardId).nameKo}의 진화원 아래에 놓음`);
  await runOp(ctx, R, { op: 'returnToHandStripSources', target: 'opponent', all: true, filter: { level: C(id).level }, requireSuspended: null, dest: 'hand' });
});

// EX6-071 / EX8-072: "상대의 패가 5장 이상이라면, 상대는 본인의 패 1장을 파기한다. 그 후, (상대의 패 매수 이상의 Lv.의 / Lv.7 이하의) 상대의 디지몬 1마리를 소멸시킨다." — the discard resolves BEFORE the Lv. limit reads the hand.
sc('EX6-071::메인', async (ctx, R) => {
  const { state, opp: o } = ctx;
  if (state.players[o].hand.length >= 5) await runOp(ctx, R, { op: 'trashHand', who: 'opponent', n: 1 });
  await runOp(ctx, R, { op: 'destroy', target: 'opponent', mode: 'choose', filter: { levelMin: state.players[o].hand.length } });
});
sc('EX8-072::메인', async (ctx, R) => {
  const { state, opp: o } = ctx;
  if (state.players[o].hand.length >= 5) await runOp(ctx, R, { op: 'trashHand', who: 'opponent', n: 1 });
  await runOp(ctx, R, { op: 'destroy', target: 'opponent', mode: 'choose', filter: { levelMax: 7 - Math.floor(state.players[o].hand.length / 3) } });
});

// BT19-092 해신의 정화: Lv.4 이하의 상대의 디지몬 1마리를 덱 아래로. 블루인 자신의 디지몬 1마리를 덱 아래로 되돌리는 것으로, 대신 Lv.6 이하의 상대의 디지몬 1마리를 덱 아래로.
sc('BT19-092::메인', async (ctx, R) => {
  const { state, self } = ctx;
  const blue = ownDigimonWhere(state, self, s => S.stackColors(s).includes('blue'));
  let lim = 4;
  if (blue.length && await ask(ctx, '블루인 자신의 디지몬 1마리를 덱 아래로 되돌려 대신 Lv.6 이하의 상대의 디지몬을 덱 아래로 되돌릴까요?')) {
    const n0 = blue.length;
    await runOp(ctx, R, { op: 'returnToHandStripSources', target: 'self', n: 1, filter: { colors: ['blue'] }, requireSuspended: null, dest: 'deckBottom' });
    if (digs(state, self).filter(s => S.stackColors(s).includes('blue')).length < n0) lim = 6;
  }
  await runOp(ctx, R, { op: 'returnToHandStripSources', target: 'opponent', n: 1, filter: { levelMax: lim }, requireSuspended: null, dest: 'deckBottom' });
});

// BT15-093 천국의 화살: DP -6000. 그 후, 자신의 시큐리티를 위 또는 아래에서부터 1장 파기하는 것으로, 턴 종료까지 상대의 디지몬 1마리를 DP -6000.
sc('BT15-093::메인', async (ctx, R) => {
  const { state, self } = ctx, pl = state.players[self];
  await runOp(ctx, R, { op: 'modifyDP', target: 'opponent', amount: -6000, duration: 'turn' });
  if (!pl.security.length || !await ask(ctx, '자신의 시큐리티를 위 또는 아래에서부터 1장 파기하여 상대의 디지몬 1마리에 DP -6000을 더할까요?')) return;
  const side = pl.security.length > 1 ? await ctx.choose('multipleChoice', { player: self, prompt: '시큐리티를 어느 쪽에서 파기할까요?', options: ['위에서부터', '아래에서부터'] }) : 0;
  if (side === 1) S.trashBottomSecurityByEffect(state, self); else S.trashTopSecurityByEffect(state, self);
  await runOp(ctx, R, { op: 'modifyDP', target: 'opponent', amount: -6000, duration: 'turn' });
});

// BT14-098 DCD봄: 《퇴화 1》. 그 후, 자신의 트래시에서 「D-브리가드」/「디지대」 카드 3장을 덱 위로 되돌리는 것으로, 등장 코스트 합계 6까지 상대의 디지몬을 소멸시킨다.
sc('BT14-098::메인', async (ctx, R) => {
  const { state, self } = ctx, pl = state.players[self];
  await runOp(ctx, R, { op: 'retreat', target: 'opponent', n: 1 });
  const ok = (id) => traitOf(id, 'D-브리가드', '디지대');
  if (pl.trash.filter(ok).length < 3) { log(ctx, `${self} 트래시에 「D-브리가드」/「디지대」 카드가 3장 없어 비용을 지불할 수 없음`); return; }
  if (!await ask(ctx, '자신의 트래시에서 「D-브리가드」/「디지대」 카드 3장을 덱 위로 되돌려 등장 코스트 합계 6까지 상대의 디지몬을 소멸시킬까요?')) return;
  const picked = [];
  for (let k = 0; k < 3; k++) {
    const idxs = pl.trash.map((id, i) => i).filter(i => ok(pl.trash[i]));
    const i = await ctx.choose('pickFromZoneIndex', { player: self, zone: 'trash', eligibleIdxs: idxs, prompt: `덱 위로 되돌릴 카드 선택 (${k + 1}/3)` });
    if (i == null) { pl.deck.unshift(...picked.reverse()); log(ctx, '비용을 전부 지불하지 못해 이후 효과를 처리하지 않음'); return; }
    picked.push(pl.trash.splice(i, 1)[0]);
  }
  pl.deck.unshift(...picked.reverse());
  log(ctx, `${self} 트래시의 카드 3장을 덱 위로 되돌림`);
  await runOp(ctx, R, { op: 'destroySum', stat: 'cost', limit: 6 });
});

// EX8-070 조프르 카부스: 「광물형」/「광석형」 자신의 디지몬 1마리의 진화원을 선택하여 1장 파기하는 것으로, 그 디지몬은 《충돌》《관통》《재기동》을 얻고 … DP +3000.
sc('EX8-070::메인', async (ctx) => {
  const { state, self } = ctx;
  const cands = ownDigimonWhere(state, self, s => s.sources.length > 0 && (C(s.cardId).types || []).some(t => t === '광물형' || t === '광석형'));
  if (!cands.length) { log(ctx, `${self} 진화원을 가진 「광물형」/「광석형」 디지몬이 없어 비용을 지불할 수 없음`); return; }
  if (!await ask(ctx, '「광물형」/「광석형」 자신의 디지몬의 진화원을 1장 파기하여 효과를 발휘할까요?')) return;
  const st = await pickStack(ctx, self, cands, '진화원을 파기할 디지몬 선택');
  if (!st) return;
  const k = await pickFromList(ctx, self, st.sources.slice(), st.sources.map((_, i) => i), '파기할 진화원 선택');
  if (k == null) return;
  const gone = S.trashEvoSources(state, self, st.uid, 1, 'bottom', [k]);
  if (!gone || !gone.length) return;
  for (const kw of ['충돌', '관통', '재기동']) S.grantKeyword(state, self, st.uid, kw, undefined, 'opponentTurn');
  S.modifyDP(state, self, st.uid, 3000, 'opponentTurn');
  log(ctx, `${self} ${C(st.cardId).nameKo}: 《충돌》《관통》《재기동》 + DP +3000 (상대의 턴 종료까지; 「상대의 효과로 패/덱으로 되돌아가지 않는다」는 수동으로 적용)`);
});

// BT20-098 애퍼리션 레기온: 상대의 트래시에서 디지몬 카드를 Lv. 합계 9가 되도록 덱 아래로 되돌리는 것으로, 자신의 트래시에서 「고스트형」이고 되돌린 카드와 같은 Lv.의 디지몬 카드 1장씩을 코스트 없이 등장. 등장한 디지몬은 상대의 턴 종료까지 《속공》《블로커》.
sc('BT20-098::메인', async (ctx) => {
  const { state, self, opp: o } = ctx, opl = state.players[o], pl = state.players[self];
  const lvl = (id) => C(id).level || 0;
  const cardsLv = opl.trash.map((id, i) => ({ id, i })).filter(x => C(x.id).category === 'digimon' && lvl(x.id) > 0);
  const canReach = (pool, target) => { if (target === 0) return true; if (target < 0) return false; return pool.some((x, k) => lvl(x.id) <= target && canReach(pool.filter((_, j) => j > k), target - lvl(x.id))); };
  if (!canReach(cardsLv, 9)) { log(ctx, `${self} 상대의 트래시의 디지몬 카드로 Lv. 합계 9를 만들 수 없어 비용을 지불할 수 없음`); return; }
  if (!await ask(ctx, '상대의 트래시에서 디지몬 카드를 Lv. 합계 9가 되도록 덱 아래로 되돌려 효과를 발휘할까요?')) return;
  let remain = 9; const chosen = [];
  while (remain > 0) {
    const pool = cardsLv.filter(x => !chosen.includes(x));
    const elig = pool.filter(x => lvl(x.id) <= remain && canReach(pool.filter(y => y !== x), remain - lvl(x.id)));
    if (!elig.length) break;
    const pick = await pickFromOtherTrash(ctx, o, elig, `상대의 트래시에서 덱 아래로 되돌릴 디지몬 카드 선택 (남은 Lv. 합계 ${remain})`);
    chosen.push(pick); remain -= lvl(pick.id);
  }
  if (remain !== 0) { log(ctx, '비용을 전부 지불하지 못해 이후 효과를 처리하지 않음'); return; }
  const returned = chosen.map(x => x.id);
  for (const x of [...chosen].sort((a, b) => b.i - a.i)) opl.trash.splice(x.i, 1);
  opl.deck.push(...returned);
  log(ctx, `${self} 상대의 트래시의 ${returned.map(id => C(id).nameKo).join(', ')}을(를) 덱 아래로 되돌림`);
  const played = [];
  for (const rid of returned) {
    const idxs = pl.trash.map((id, i) => i).filter(i => C(pl.trash[i]).category === 'digimon' && traitOf(pl.trash[i], '고스트형') && lvl(pl.trash[i]) === lvl(rid));
    if (!idxs.length) continue;
    const i = await ctx.choose('pickFromZoneIndex', { player: self, zone: 'trash', eligibleIdxs: idxs, prompt: `트래시에서 코스트 없이 등장시킬 「고스트형」 Lv.${lvl(rid)} 디지몬 선택 (취소=안 함)` });
    if (i == null) continue;
    const st = S.playFreeFromZone(state, self, 'trash', i);
    if (st) played.push(st);
  }
  for (const st of played) { S.grantKeyword(state, self, st.uid, '속공', undefined, 'opponentTurn'); S.grantKeyword(state, self, st.uid, '블로커', undefined, 'opponentTurn'); }
});
// pick one entry { id, i } of the OPPONENT's trash (revealed-list picker: shows the ids, returns the index into `elig`)
async function pickFromOtherTrash(ctx, o, elig, prompt) {
  if (elig.length === 1) return elig[0];
  const ids = elig.map(x => x.id);
  const got = await ctx.choose('pickFromRevealed', { player: ctx.self, revealed: ids, eligible: ids.map((id, i) => ({ id, i })), min: 1, max: 1, required: true, prompt });
  const k = Array.isArray(got) ? got[0] : got;
  return elig[k] || elig[0];
}

// BT20-096 블랙 사바스 — "[트래시]【메인】 자신의 패가 4장 이하라면, 6 코스트 지불하는 것으로, 이 카드를 덱 아래로 되돌리고, 액티브 상태인 상대의 디지몬 1마리를 소멸시킨다."
sc('BT20-096::메인@6 코스트', async (ctx, R) => {
  const { state, self } = ctx;
  const pl = state.players[self];
  if (!pl.trash.includes(ctx.sourceCardId) || pl.hand.length > 4 || !S.canPayCost(state, 6)) { log(ctx, `${self} 조건/코스트를 만족하지 못해 효과를 처리하지 않음`); return; }
  if (!await ask(ctx, '6 코스트를 지불하고 이 카드를 트래시에서 덱 아래로 되돌려 효과를 발휘할까요?')) return;
  S.spendMemory(state, 6);
  await payReturnSelfToDeckBottom(ctx);
  await runOp(ctx, R, { op: 'destroy', target: 'opponent', mode: 'choose', filter: { suspended: false } });
});

// ================================================================== 《딜레이》 bullets (run with tags ['메인'] and the bullet text; keyed by a needle unique to the bullet)
// BT13-110 숙청의 로얄 나이츠 — 육성 에어리어의 자신의 디지몬의 진화원에서 「로얄 나이츠」 카드 1장을 코스트 없이 등장(【등장 시】는 발휘하지 않음, 턴 종료까지 《속공》)
sc('BT13-110::메인@육성 에어리어의 자신의 디지몬의 진화원에서', async (ctx) => {
  const { state, self } = ctx, pl = state.players[self];
  const ra = pl.raising;
  if (!ra || !isDig(ra)) { log(ctx, `${self} 육성 에어리어에 디지몬이 없음`); return; }
  const idxs = ra.sources.map((id, i) => i).filter(i => C(ra.sources[i]).category === 'digimon' && traitOf(ra.sources[i], '로얄 나이츠'));
  if (!idxs.length) { log(ctx, `${self} 육성 에어리어의 디지몬의 진화원에 「로얄 나이츠」 카드가 없음`); return; }
  const k = await pickFromList(ctx, self, ra.sources.slice(), idxs, '코스트 없이 등장시킬 진화원의 「로얄 나이츠」 카드 선택');
  if (k == null) return;
  const [id] = ra.sources.splice(k, 1);
  if (S.fdCount(ra) > k) ra.s5fd = S.fdCount(ra) - 1;
  S.recomputeStackGrants(ra);
  pl.trash.push(id);
  const st = S.playFreeFromZone(state, self, 'trash', pl.trash.length - 1, { fromSources: true, noTriggers: true });
  if (st) S.grantKeyword(state, self, st.uid, '속공', undefined, 'turn');
});
// ST14-12 견원의 흉탄 — 자신의 트래시에서 퍼플인 디지몬 카드/테이머 카드 1장을 패로 되돌린다.
sc('ST14-12::메인@퍼플인 디지몬 카드/테이머 카드', async (ctx) => {
  const { state, self } = ctx, pl = state.players[self];
  const idxs = pl.trash.map((id, i) => i).filter(i => ['digimon', 'tamer'].includes(C(pl.trash[i]).category) && (C(pl.trash[i]).colors || []).includes('purple'));
  if (!idxs.length) { log(ctx, `${self} 트래시에 퍼플인 디지몬/테이머 카드가 없음`); return; }
  const i = await ctx.choose('pickFromZoneIndex', { player: self, zone: 'trash', eligibleIdxs: idxs, prompt: '트래시에서 패로 되돌릴 퍼플인 디지몬/테이머 카드 선택' });
  if (i == null) return;
  const [id] = pl.trash.splice(i, 1); pl.hand.push(id);
  log(ctx, `${self} 트래시의 ${C(id).nameKo}을(를) 패로 되돌림`);
});
// EX4-070 더럽혀진 영웅 — 상대는 본인의 패에서 옵션 카드 1장을 파기할 수 있다. 파기하지 않았다면, 메모리 +2.
sc('EX4-070::메인@상대는 본인의 패에서 옵션 카드', async (ctx, R) => {
  const { state, opp: o } = ctx, opl = state.players[o];
  const idxs = opl.hand.map((id, i) => i).filter(i => C(opl.hand[i]).category === 'option');
  let discarded = false;
  if (idxs.length && await ask(ctx, `${C('EX4-070').nameKo}: 패의 옵션 카드 1장을 파기할까요? (파기하지 않으면 상대의 메모리 +2)`, o)) {
    const i = idxs.length === 1 ? idxs[0] : await ctx.choose('pickFromZoneIndex', { player: o, zone: 'hand', eligibleIdxs: idxs, prompt: '파기할 옵션 카드 선택' });
    if (i != null) { S.trashFromHand(state, o, i); discarded = true; }
  }
  if (!discarded) await runOp(ctx, R, { op: 'gainMemory', who: 'self', n: 2 });
});
// BT17-098 해커의 긍지 — 「펄스몬」이 기술되어 있는 Lv.4 이상의 자신의 디지몬에 겹쳐져 있는 카드를 위에서부터 1장 시큐리티 위에 놓는 것으로, 메모리 +2.
sc('BT17-098::메인@겹쳐져 있는 카드를 위에서부터 1장 시큐리티 위에', async (ctx, R) => {
  const { state, self } = ctx;
  const cands = ownDigimonWhere(state, self, s => (C(s.cardId).level || 0) >= 4 && S.cardMentions(s.cardId, '펄스몬') && s.sources.length > S.fdCount(s));
  if (!cands.length) { log(ctx, `${self} 조건을 만족하는 「펄스몬」 디지몬(진화원 있음)이 없어 비용을 지불할 수 없음`); return; }
  const st = await pickStack(ctx, self, cands, '진화원의 맨 위 카드를 시큐리티 위에 놓을 「펄스몬」 디지몬 선택');
  if (!st) return;
  const id = st.sources.pop();
  S.recomputeStackGrants(st);
  S.addToSecurity(state, self, id, 'top');
  log(ctx, `${self} ${C(st.cardId).nameKo}의 진화원 맨 위 ${C(id).nameKo}을(를) 시큐리티 위에 놓음`);
  await runOp(ctx, R, { op: 'gainMemory', who: 'self', n: 2 });
});
// P-155 폰 디바이스 — 배틀 에어리어의 레드 이외의 자신의 옵션 카드 1장을 파기하는 것으로, 메모리 +1.
sc('P-155::메인@배틀 에어리어의 레드 이외의 자신의 옵션 카드', async (ctx, R) => {
  const { state, self } = ctx, pl = state.players[self];
  const cands = pl.battle.filter(s => C(s.cardId).category === 'option' && !(C(s.cardId).colors || []).includes('red'));
  if (!cands.length) { log(ctx, `${self} 배틀 에어리어에 레드 이외의 옵션 카드가 없어 비용을 지불할 수 없음`); return; }
  const st = await pickStack(ctx, self, cands, '파기할 배틀 에어리어의 옵션 카드 선택');
  if (!st) return;
  S.deleteStack(state, self, st.uid, 'trash', 'ownEffect');
  await runOp(ctx, R, { op: 'gainMemory', who: 'self', n: 1 });
});
// EX9-070 고기 — 자신의 패 1장을 특징 「DM」를 가진 자신의 디지몬의 진화원 아래에 뒷면으로 놓는 것으로, 그 디지몬을 패의 특징 「DM」 디지몬 카드로 지불하는 코스트 -2 하여 진화시킬 수 있다.
sc('EX9-070::메인@뒷면으로 놓는 것으로', async (ctx) => {
  const { state, self } = ctx, pl = state.players[self];
  const dm = ownDigimonWhere(state, self, s => traitOf(s.cardId, 'DM'));
  if (!dm.length || !pl.hand.length) { log(ctx, `${self} 조건(패 / 「DM」 디지몬)을 만족하지 못해 비용을 지불할 수 없음`); return; }
  if (!await ask(ctx, '패 1장을 「DM」 디지몬의 진화원 아래에 뒷면으로 놓고 진화시킬까요?')) return;
  const hi = await ctx.choose('pickFromZoneIndex', { player: self, zone: 'hand', eligibleIdxs: pl.hand.map((_, i) => i), prompt: '뒷면으로 진화원 아래에 놓을 패의 카드 선택' });
  if (hi == null) return;
  const st = await pickStack(ctx, self, dm, '카드를 뒷면으로 진화원 아래에 놓을 「DM」 디지몬 선택');
  if (!st) return;
  const [id] = pl.hand.splice(hi, 1);
  st.sources.unshift(id); st.s5fd = S.fdCount(st) + 1; st.s5fdFlag = true;
  S.recomputeStackGrants(st);
  log(ctx, `${self} 패 1장을 ${C(st.cardId).nameKo}의 진화원 아래에 뒷면으로 놓음`);
  await evolvePinned(ctx, st, 'hand', (id2) => traitOf(id2, 'DM'), 2, '진화할 「DM」 디지몬 카드 선택');
});
// EX9-071 프로틴 — 특징 「DM」 자신의 디지몬 1마리의 뒷면의 진화원을 아래에서부터 2장 파기하는 것으로, 그 디지몬을 액티브로 한다.
sc('EX9-071::메인@뒷면의 진화원을 아래에서부터 2장', async (ctx) => {
  const { state, self } = ctx;
  const cands = ownDigimonWhere(state, self, s => traitOf(s.cardId, 'DM') && S.fdCount(s) >= 2);
  if (!cands.length) { log(ctx, `${self} 뒷면의 진화원이 2장 이상인 「DM」 디지몬이 없어 비용을 지불할 수 없음`); return; }
  const st = await pickStack(ctx, self, cands, '뒷면의 진화원을 2장 파기할 「DM」 디지몬 선택');
  if (!st) return;
  S.trashEvoSources(state, self, st.uid, 2, 'bottom');
  S.unsuspendStack(state, self, st.uid);
});
// P-205 광기의 합성 마수 — 등장 코스트 7 이하의 자신의 디지몬 1마리를 소멸시키는 것으로, 자신의 트래시에서 「키메라몬」/「밀레니엄몬」 포함 디지몬 카드 1장을 지불하는 등장 코스트 -3으로 등장시킬 수 있다.
sc('P-205::메인@등장 코스트 7 이하의 자신의 디지몬 1마리를 소멸', async (ctx, R) => {
  const { state, self } = ctx;
  const n0 = digs(state, self).length;
  await runOp(ctx, R, { op: 'destroy', target: 'self', mode: 'choose', filter: { costMax: 7 } });
  if (digs(state, self).length >= n0) return; // cost not paid
  await runOp(ctx, R, { op: 'n5_playPaid', zone: 'trash', filter: { category: 'digimon', nameAny: ['키메라몬', '밀레니엄몬'] }, delta: -3, kinds: ['digimon', 'tamer'], optional: true });
});

// ================================================================== 옵션 자신의 파기 트리거 ("이 카드가 <영역>에서 [효과로] 파기되었을 때, …" — state.queueOwnDiscardTriggers)
// The card is in the trash by the time this pending item runs. Bodies the generic compiler cannot express are handled here.
SCRIPTS['*::__ownDiscard'] = [fn(async (ctx, R) => {
  const { state, self } = ctx, pl = state.players[self];
  const id = ctx.sourceCardId, text = String(ctx.trigger?.text || '').trim();
  if (/^이\s*카드를\s*배틀\s*에어리어에\s*놓을\s*수\s*있다/.test(text)) { // 덱에서 파기되었을 때 (ST14-12, BT19-097)
    if (pl.trash.includes(id) && await ask(ctx, `${C(id).nameKo}: 이 카드를 배틀 에어리어에 놓을까요?`)) S.placeThisInBattle(state, self, id);
    return;
  }
  if (/이\s*카드의\s*【시큐리티】\s*효과를\s*발휘한다/.test(text)) { // 시큐리티에서 효과로 파기되었을 때 (BT15-092, BT18-098, ST22-10)
    const Fx = await import('../effects.js');
    const seg = S.parseEffectSegments(C(id).effectKo || '').segments.find(sg => sg.tags.some(t => t === '시큐리티'));
    if (!seg) { log(ctx, `${C(id).nameKo}: 【시큐리티】 효과가 없어 처리할 효과가 없음`); return; }
    await R.runScript(Fx.lookupCardSpecific(id, seg.tags, seg.body) || Fx.compileToScript(seg.body), ctx);
    return;
  }
  if (/트래시에서\s*특징으로\s*「디바이스」를\s*가진\s*사용\s*코스트\s*3의\s*옵션\s*카드\s*1장을\s*배틀\s*에어리어에\s*놓는다/.test(text)) { // BT19-098 (배틀 에어리어에서 파기되었을 때)
    const idxs = pl.trash.map((x, i) => i).filter(i => C(pl.trash[i]).category === 'option' && traitOf(pl.trash[i], '디바이스') && C(pl.trash[i]).cost === 3);
    if (!idxs.length) return;
    const i = await ctx.choose('pickFromZoneIndex', { player: self, zone: 'trash', eligibleIdxs: idxs, prompt: '배틀 에어리어에 놓을 「디바이스」 옵션 카드 선택' });
    if (i != null) S.placeThisInBattle(state, self, pl.trash[i]);
    return;
  }
  const script = R.compileToScript(text);
  if (!script.length) { log(ctx, `${C(id).nameKo}: 자동 처리할 수 없는 효과 — ${text}`); return; }
  await R.runScript(script, ctx);
})];

// ================================================================== [시큐리티] 앞면 옵션의 지속 효과 (시큐리티 아래/위에 앞면으로 놓인 옵션 — 배틀 에어리어가 아니라 SECURITY 영역에서 작동)
// "[시큐리티]【서로의 턴】 … 자신의 디지몬 전부는 …" — descriptors with zone:'security' are active only while the card is a FACE-UP card in its owner's
// security (state.activeHooks). The battle-area holder path (zone-less descriptors) never sees these cards, which is why they used to do nothing.
const dgStack = (target) => !!target && isDig(target);
const mineTarget = (hp, tp, target) => tp === hp && dgStack(target);
const colorAny = (target, cols) => S.stackColors(target).some(c => cols.includes(c));
const ownBattleNamed = (state, hp, ...names) => state.players[hp].battle.some(s => names.includes(C(s.cardId).nameKo));
const ownBattleNameIncl = (state, hp, n) => state.players[hp].battle.some(s => C(s.cardId).nameKo.includes(n));
const ownMemory = (state, hp) => (hp === 'p1' ? state.memory : -state.memory);
const lvOfStack = (s) => C(s.cardId).level || 0;
const secHook = (id, tag, d) => { (HOOKS[id] ||= []).push({ tag, zone: 'security', ...d }); };
// { pred(target): base target set, dp, kw: [names], kw2: { when(state,hp), names } }
function contSec(id, tag, o) {
  secHook(id, tag, {
    ...(o.dp ? { dp: (state, hp, h, target, tp) => (mineTarget(hp, tp, target) && o.pred(target) ? o.dp : 0) } : {}),
    ...(o.link ? { linkPlus: (state, hp, h, target) => (dgStack(target) && o.pred(target) && o.link.when(state, hp) ? o.link.n : 0) } : {}),
    ...(o.kw || o.kw2 ? { grantKw: (state, hp, h, target) => {
      if (!dgStack(target) || !o.pred(target)) return [];
      const out = [...(o.kw || [])];
      if (o.kw2 && o.kw2.when(state, hp)) out.push(...o.kw2.names);
      return out;
    } } : {}),
  });
}
const TS = (s) => hasType(C(s.cardId), 'TS');
contSec('ST20-15', '서로의 턴', { pred: (s) => lvOfStack(s) >= 3, dp: 2000 });
contSec('ST21-15', '자신의 턴', { pred: (s) => lvOfStack(s) >= 3, dp: 3000 });
contSec('BT22-100', '서로의 턴', { pred: (s) => hasType(C(s.cardId), 'CS'), dp: 2000 });
contSec('BT21-095', '자신의 턴', { pred: (s) => hasType(C(s.cardId), 'WG'), kw: ['볼텍스'] });
contSec('EX8-069', '서로의 턴', { pred: (s) => hasType(C(s.cardId), 'NSp'), kw: ['연계'] });
contSec('EX8-071', '서로의 턴', { pred: (s) => hasType(C(s.cardId), 'NSo') && lvOfStack(s) >= 4, kw: ['스케이프고트'] });
contSec('EX12-072', '서로의 턴', { pred: (s) => hasType(C(s.cardId), 'ME'), kw: ['수호'] });
contSec('BT24-094', '서로의 턴', { pred: (s) => TS(s) && colorAny(s, ['green', 'yellow']), dp: 2000, kw2: { when: (st, hp) => ownBattleNamed(st, hp, '메르크리몬', '미네르바몬'), names: ['연계'] } });
contSec('BT25-095', '서로의 턴', { pred: (s) => TS(s) && colorAny(s, ['red', 'green']), dp: 2000, kw2: { when: (st, hp) => ownBattleNamed(st, hp, '마르스몬', '칼리스몬'), names: ['속공'] } });
contSec('BT24-090', '서로의 턴', { pred: (s) => TS(s) && colorAny(s, ['blue', 'yellow']), kw: ['블로커'], kw2: { when: (st, hp) => ownBattleNamed(st, hp, '넵튠몬', '베누스몬'), names: ['연계'] } });
contSec('BT25-094', '자신의 턴', { pred: (s) => TS(s) && colorAny(s, ['red', 'blue']), kw: ['연계'], kw2: { when: (st, hp) => ownBattleNamed(st, hp, '아폴로몬', '디아나몬'), names: ['속공'] } });
contSec('BT25-099', '자신의 턴', { pred: (s) => TS(s) && colorAny(s, ['green', 'black']), kw: ['연계'], kw2: { when: (st, hp) => ownBattleNamed(st, hp, '바쿠스몬', '케레스몬'), names: ['관통'] } });
contSec('BT25-102', '서로의 턴', { pred: (s) => TS(s) && colorAny(s, ['black', 'red']), kw: ['블로커'], link: { n: 1, when: (st, hp) => ownBattleNamed(st, hp, '불카누스몬') } });
contSec('BT25-097', '서로의 턴', { pred: (s) => TS(s) && colorAny(s, ['yellow', 'purple']), kw: ['연계'], kw2: { when: (st, hp) => ownBattleNameIncl(st, hp, '유노몬'), names: ['스케이프고트'] } });
secHook('BT26-100', '서로의 턴', {
  grantKw: (state, hp, h, target) => (dgStack(target) && hasType(C(target.cardId), '타이탄족') ? ['블로커'] : []),
  dp: (state, hp, h, target, tp) => (mineTarget(hp, tp, target) && hasType(C(target.cardId), '타이탄족') && (ownBattleNameIncl(state, hp, '플루토몬') || ownBattleNameIncl(state, hp, '타이타몬')) ? 3000 : 0),
});
// EX8-068: 메모리가 1 이상인 동안, 「DS」 자신의 디지몬 전부는 배틀에서 소멸하지 않는다.
secHook('EX8-068', '서로의 턴', { battleImmune: (state, hp, h, target) => dgStack(target) && hasType(C(target.cardId), 'DS') && ownMemory(state, hp) >= 1 });
// P-181: [턴 1회] 자신의 디지몬이 「로얄 베이스」 디지몬 카드로 진화할 때, 지불하는 코스트 -1 (확인 후 적용; 턴당 1회)
secHook('P-181', '자신의 턴', {
  evoOption: (state, hp, h, stack, targetCardId) => {
    if (!targetCardId || C(targetCardId).category !== 'digimon' || !hasType(C(targetCardId), '로얄 베이스')) return null;
    const key = `p181:${state.turnNumber}:${hp}`;
    if ((state.s19Once || {})[key]) return null;
    return { label: `${C('P-181').nameKo}(시큐리티): ${C(targetCardId).nameKo}로 진화하는 코스트 -1 (턴 1회)?`, apply() { (state.s19Once ||= {})[key] = true; return -1; } };
  },
});

// ---- [시큐리티] 앞면 옵션의 어택 반응 ("…이 어택했을 때, …")
const onceThisTurn = (state, key) => { const k = `${key}:${state.turnNumber}`; if ((state.s19Once ||= {})[k]) return false; state.s19Once[k] = true; return true; };
secHook('EX12-074', '자신의 턴', { has: '어택했을 때', events: { attack: (state, hp, h, info) => info.owner === hp && !!info.stack && hasType(C(info.stack.cardId), '샴발라') && !(state.s19Once || {})[`ex12074:${state.turnNumber}`] } });
sc('EX12-074::자신의 턴', async (ctx) => {
  const { state, self } = ctx;
  const st = stacksOf(state, self).find(s => s.uid === ctx.trigger?.evt?.stackUid);
  if (!st || !await ask(ctx, `${C('EX12-074').nameKo}: ${C(st.cardId).nameKo}을(를) 패의 「샴발라」 디지몬 카드로 코스트 -1 하여 진화시킬까요? (턴 1회)`)) return;
  if (!onceThisTurn(state, 'ex12074')) return;
  await evolvePinned(ctx, st, 'hand', (id) => traitOf(id, '샴발라'), 1, '진화할 「샴발라」 디지몬 카드 선택');
});
secHook('EX12-069', '자신의 턴', { has: '어택했을 때', events: { attack: (state, hp, h, info) => info.owner === hp && !!info.stack && hasType(C(info.stack.cardId), 'VB') && lvOfStack(info.stack) >= 4 } });
sc('EX12-069::자신의 턴', async (ctx, R) => {
  const { state, self } = ctx;
  const st = stacksOf(state, self).find(s => s.uid === ctx.trigger?.evt?.stackUid);
  if (!st) return;
  await runOp(ctx, R, { op: 'n5_playPaid', zone: 'hand', filter: { category: 'digimon', traitAny: ['VB'], level: lvOfStack(st) }, delta: -3, kinds: ['digimon'], optional: true });
});
secHook('BT19-100', '상대의 턴', { has: '어택했을 때', events: { attack: (state, hp, h, info) => info.owner !== hp && !!info.stack } });
sc('BT19-100::상대의 턴', async (ctx) => {
  const { state, self, opp: o } = ctx;
  const att = stacksOf(state, o).find(s => s.uid === ctx.trigger?.evt?.stackUid);
  const mine = state.players[self].battle.filter(s => isDig(s) || isTam(s));
  if (!att || !mine.every(s => traitOf(s.cardId, '디·리퍼'))) return;
  const mothers = state.players[self].battle.filter(s => isDig(s) && C(s.cardId).nameKo === '마더 디·리퍼');
  const m = await pickStack(ctx, self, mothers, 'DP를 내릴 기준이 되는 「마더 디·리퍼」 선택');
  if (!m || !m.sources.length) return;
  S.modifyDP(state, o, att.uid, -1000 * m.sources.length, 'turn');
  log(ctx, `${o} ${C(att.cardId).nameKo}: 「마더 디·리퍼」의 진화원 ${m.sources.length}장 → DP -${1000 * m.sources.length}`);
});

// ================================================================== 《딜레이》 bullets of event-triggered placed Options (generic flow: main.js runPendingScript → Effects.delayBulletPlan)
// SCRIPTS['ID::딜레이'] = the bullet effect only; the engine has already confirmed + discarded the option (16-17) and checked it was placed on an earlier turn.
const evoBoth = (...traits) => (id) => traits.every(t => hasType(C(id), t));
const stackTypeIncl = (...ts) => (s) => isDig(s) && (C(s.cardId).types || []).some(x => ts.some(t => x.includes(t)));
const stackTypeIs = (...ts) => (s) => isDig(s) && hasType(C(s.cardId), ...ts);
const delayEvolve = (id, subjPred, cardPred, discount, zone = 'hand') => {
  SCRIPTS[`${id}::딜레이`] = [fn(async (ctx, R) => {
    await R.runOne({ op: 's4_evolve', subject: { pred: subjPred }, pred: cardPred, zone, cost: discount === 'free' ? { mode: 'free' } : { mode: 'discount', n: discount } }, ctx);
  })];
};
delayEvolve('BT22-096', stackTypeIncl('수생'), evoBoth('수생형', '리버레이터'), 3);
delayEvolve('BT22-098', stackTypeIs('퍼펫형'), evoBoth('퍼펫형', '리버레이터'), 3);
delayEvolve('EX10-069', stackTypeIs('광물형', '광석형'), (id) => hasType(C(id), '리버레이터') && hasType(C(id), '광물형'), 3);
delayEvolve('BT23-098', stackTypeIs('고스트형'), evoBoth('고스트형', '리버레이터'), 3);
delayEvolve('EX11-072', (s) => isDig(s) && ((C(s.cardId).types || []).some(x => ['조', '새', '병아리'].some(t => x.includes(t))) || hasType(C(s.cardId), '볼텍스 워리어')), evoBoth('조룡형', '리버레이터'), 3);
delayEvolve('BT24-089', (s) => isDig(s) && (C(s.cardId).types || []).some(x => x.includes('파충류형') || x.includes('용인형')), (id) => hasType(C(id), '리버레이터') && (hasType(C(id), '파충류형') || hasType(C(id), '용인형')), 3);
delayEvolve('BT17-099', (s) => isDig(s), (id) => C(id).nameKo.includes('샤인그레이몬'), 'free');
delayEvolve('BT21-091', (s) => isTam(s), (id) => hasType(C(id), '하이브리드체'), 'free');
SCRIPTS['P-232::딜레이'] = [fn(async (ctx, R) => { // 패/트래시의 「리버레이터」 Lv.6 이하 디지몬 카드 (진화 코스트 -3)
  const zi = await ctx.choose('multipleChoice', { player: ctx.self, prompt: '어디의 카드로 진화시킬까요?', options: ['패', '트래시'] });
  await R.runOne({ op: 's4_evolve', subject: { pred: (s) => isDig(s) }, pred: (id) => hasType(C(id), '리버레이터') && (C(id).level || 0) <= 6, zone: zi === 1 ? 'trash' : 'hand', cost: { mode: 'discount', n: 3 } }, ctx);
})];
SCRIPTS['BT23-092::딜레이'] = [fn(async (ctx, R) => { // 상대의 턴 종료까지, 상대의 디지몬과 테이머 1마리(명)씩은 레스트할 수 없다.
  await R.runOne({ op: 'preventRest', target: 'opponent', n: 1, filter: { category: 'digimon' }, expiresAfterTurn: 'opponentTurn' }, ctx);
  await R.runOne({ op: 'preventRest', target: 'opponent', n: 1, filter: { category: 'tamer' }, expiresAfterTurn: 'opponentTurn' }, ctx);
})];
SCRIPTS['BT23-093::딜레이'] = [{ op: 'n5_link', zones: ['hand'], filter: { category: 'digimon', traitAny: ['어플몬'] }, free: true, host: 'pick', max: 1 }];

// event triggers for delay options the generic watcher cannot parse
const delayReadyHolder = (state, holder) => !!holder && state.turnNumber > holder.placedTurn;
// BT21-091: 진화원 효과를 가진 자신의 테이머가 등장했을 때
HOOKS['BT21-091'] = (HOOKS['BT21-091'] || []).concat([{ tag: '서로의 턴', has: '딜레이', events: { play: (state, hp, holder, info) => info.owner === hp && !!info.stack && isTam(info.stack) && !!C(info.stack.cardId).inheritedKo && delayReadyHolder(state, holder) } }]);
// EX12-070: 특징 「TB」를 가진 Lv.5 이상의 자신의 디지몬이 배틀 에어리어를 벗어날 때
HOOKS['EX12-070'] = (HOOKS['EX12-070'] || []).concat([{ tag: '서로의 턴', has: '딜레이', events: { leaveBattle: (state, hp, holder, info) => info.owner === hp && !!info.stack && isDig(info.stack) && hasType(C(info.stack.cardId), 'TB') && lvOfStack(info.stack) >= 5 && delayReadyHolder(state, holder) } }]);
