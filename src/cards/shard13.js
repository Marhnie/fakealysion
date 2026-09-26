// Shard 13 — dropped-sentence audit, batch 4 (docs/verify-dropped-4.md).
// Generic ops emitted by effects.js compileS13 (s13_trimTo / s13_jogress / s13_placeThis / s13_selfTo) run here, plus per-card scripts
// and HOOKS for effects whose later sentences the generic compiler used to drop silently.
// state.js is imported lazily (only used inside functions) because state.js imports cards/index.js.
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

// ------------------------------------------------------------------ helpers
const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
const C = (id) => S.card(id);
const isDig = (st) => S.isDigimonLike(st);
const isTam = (st) => !!st && C(st.cardId).category === 'tamer';
const stacksOf = (state, p) => [state.players[p].raising, ...state.players[p].battle].filter(Boolean);
const digs = (state, p) => state.players[p].battle.filter(isDig);
const tams = (state, p) => state.players[p].battle.filter(isTam);
const findStack = (state, p, uid) => stacksOf(state, p).find(s => s.uid === uid) || null;
const me = (ctx) => findStack(ctx.state, ctx.self, ctx.sourceStackUid);
const hasType = (c, ...ts) => ts.some(t => (c.types || []).includes(t));
const nameIncl = (c, ...ns) => ns.some(n => c.nameKo.includes(n));
const mention = (c, n) => c.nameKo.includes(n) || `${c.effectKo || ''}\n${c.inheritedKo || ''}`.replace(/〈룰〉[^\n]*/g, '').includes(`「${n}」`);
const oppTurnEnd = (state, self) => (state.activePlayer === opp(self) ? state.turnNumber : state.turnNumber + 1);
const fn = (f) => ({ op: 's13_fn', fn: f });
OPS.s13_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
const sc = (key, f) => { SCRIPTS[key] = [fn(f)]; };
const hk = (id, d) => { (HOOKS[id] ||= []).push(d); };
const log = (ctx, msg) => S.log(ctx.state, msg);

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
  pl.s13tmp = ids;
  try { return await ctx.choose('pickFromZoneIndex', { player: who, zone: 's13tmp', eligibleIdxs: idxs, prompt }); } finally { delete pl.s13tmp; }
}
async function runText(ctx, R, text) { const sc0 = R.compileToScript(text); if (sc0.length) await R.runScript(sc0, ctx); }

// ------------------------------------------------------------------ generic ops (compiled by effects.js compileS13)
// "자신의 패가 N장이 되도록 파기한다" / "상대는 자신의 패가 …" / "서로는 각각 시큐리티가 N장이 되도록 위에서부터 파기한다"
OPS.s13_trimTo = async (instr, ctx) => {
  const { state } = ctx;
  const who = instr.who === 'both' ? [ctx.self, ctx.opp] : [instr.who === 'opponent' ? ctx.opp : ctx.self];
  for (const p of who) {
    const pl = state.players[p];
    if (instr.zone === 'hand') {
      const excess = pl.hand.length - instr.n;
      if (excess <= 0) continue;
      const chosen = await ctx.choose('pickFromHandIndexes', { player: p, eligibleIdxs: pl.hand.map((_, i) => i), n: excess, prompt: `패가 ${instr.n}장이 되도록 ${excess}장 파기` });
      (chosen || []).slice().sort((a, b) => b - a).forEach(i => S.trashFromHand(state, p, i));
    } else {
      while (pl.security.length > instr.n) { if (!S.trashTopSecurityByEffect(state, p)) break; }
    }
  }
};

// a card can only be jogress-evolved into when it actually has a 〔조그레스〕 line (S.canJogress is permissive for cards without one)
const hasJogLine = (id) => /〔조그레스〕/.test(C(id).effectKo || '');
// "자신의 디지몬 2마리로 패의 <카드>로 조그레스 진화할 수 있다" — o.a fixes one of the two Digimon (optional)
async function jogress(ctx, R, o) {
  const { state } = ctx, who = ctx.self, pl = state.players[who];
  const okCards = (a, b) => pl.hand.map((id, i) => i).filter(i => C(pl.hand[i]).category === 'digimon' && hasJogLine(pl.hand[i]) && (!o.filter || R.matchesFilter(S, pl.hand[i], o.filter)) && S.canJogress(a, b, pl.hand[i]).ok);
  const pool = digs(state, who);
  const pairs = [];
  for (const a of (o.a ? [o.a] : pool)) for (const b of pool) if (a !== b && (o.a || pool.indexOf(a) < pool.indexOf(b)) && okCards(a, b).length) pairs.push([a, b]);
  if (!pairs.length) { log(ctx, `${who} 조그레스 진화 가능한 조합이 없음`); return null; }
  let pair = pairs[0];
  if (pairs.length > 1) {
    const first = await pickStack(ctx, who, [...new Set(pairs.map(p => p[0]))], '조그레스 진화할 디지몬 선택');
    if (!first) return null;
    const second = await pickStack(ctx, who, pairs.filter(p => p[0] === first).map(p => p[1]), '조그레스 진화할 상대 디지몬 선택');
    if (!second) return null;
    pair = [first, second];
  }
  const idx = await ctx.choose('pickFromZoneIndex', { player: who, zone: 'hand', eligibleIdxs: okCards(pair[0], pair[1]), prompt: '조그레스 진화할 패의 카드 선택' });
  if (idx == null) return null;
  const id = pl.hand[idx];
  const j = S.parseJogress(id);
  return S.fuseJogress(state, who, pair[0], pair[1], id);
}
OPS.s13_jogress = async (instr, ctx, R) => { await jogress(ctx, R, { filter: instr.filter }); };

// "이 카드를 시큐리티 위에 (앞면으로) 놓는다" / "이 카드를 <조건> 자신의 디지몬 1마리의 진화원 아래에 놓는다" (the option card being resolved sits in the trash meanwhile)
OPS.s13_placeThis = async (instr, ctx, R) => {
  const { state } = ctx, p = ctx.self, pl = state.players[p], id = ctx.sourceCardId;
  const i = pl.trash.lastIndexOf(id);
  if (i < 0) { log(ctx, `${C(id).nameKo}: 이미 그 영역을 벗어나 있어 놓을 수 없음`); return; }
  if (instr.dest === 'security') {
    pl.trash.splice(i, 1);
    if (instr.faceUp) S.secAddFaceUp(state, p, id, 'top'); else S.addToSecurity(state, p, id, 'top');
    log(ctx, `${p} ${C(id).nameKo}을(를) 시큐리티 위에${instr.faceUp ? ' 앞면으로' : ''} 놓음`);
  } else {
    const cands = R.candidateStacks(ctx, p, { filter: instr.filter });
    const st = await pickStack(ctx, p, cands, '카드를 진화원 아래에 놓을 디지몬 선택');
    if (!st) return;
    pl.trash.splice(pl.trash.lastIndexOf(id), 1);
    st.sources.splice(S.fdCount(st), 0, id);
    S.recomputeStackGrants(st);
    log(ctx, `${p} ${C(id).nameKo}을(를) ${C(st.cardId).nameKo}의 진화원 아래에 놓음`);
  }
};

// "이 테이머를 덱 아래로 되돌린다" / "이 디지몬을 시큐리티 위에 놓는다" (the source stack itself; its sources are trashed)
OPS.s13_selfTo = async (instr, ctx) => {
  const { state } = ctx, p = ctx.self, pl = state.players[p], st = me(ctx);
  if (!st || pl.raising === st) return;
  const i = pl.battle.indexOf(st);
  if (i < 0) return;
  pl.battle.splice(i, 1);
  const linkIds = (st.linkCards || []).map(l => l.cardId);
  const inTrash = [...st.sources, ...linkIds].filter(id => !C(id).isToken);
  pl.trash.push(...inTrash);
  if (!C(st.cardId).isToken) { if (instr.dest === 'security') S.addToSecurity(state, p, st.cardId, 'top'); else pl.deck.push(st.cardId); }
  S.applyOverflowBatch(state, p, [...st.sources, st.cardId]);
  log(ctx, `${p} ${C(st.cardId).nameKo}을(를) ${instr.dest === 'security' ? '시큐리티 위에 놓음' : '덱 아래로 되돌림'}`);
};

// ------------------------------------------------------------------ delay options (in the battle area, usable from the turn after placement)
const delayReady = (state, holder) => holder && holder.placedTurn < state.turnNumber;
function discardOption(state, p, holder) {
  const pl = state.players[p];
  const i = pl.battle.indexOf(holder);
  if (i < 0) return false;
  pl.battle.splice(i, 1);
  pl.trash.push(...holder.sources, holder.cardId);
  S.log(state, `${p} ${C(holder.cardId).nameKo} 딜레이 발동 (파기)`);
  return true;
}
async function delayOnly(ctx, f) {
  const { state } = ctx, h = me(ctx);
  if (!h || C(h.cardId).category !== 'option' || !delayReady(state, h)) return;
  if (!(await ask(ctx, '《딜레이》 — 이 카드를 파기하고 효과를 발휘할까요?'))) return;
  if (!discardOption(state, ctx.self, h)) return;
  await f();
}

// play a card out of `st`'s evolution sources (face-up ones) for free
async function playFromSources(ctx, st, pred, prompt, opts = {}) {
  const { state } = ctx, p = ctx.self, pl = state.players[p];
  const idxs = st.sources.map((id, i) => i).filter(i => i >= S.fdCount(st) && pred(C(st.sources[i])));
  if (!idxs.length) return null;
  const k = await pickFromList(ctx, p, st.sources, idxs, prompt);
  if (k == null) return null;
  const [id] = st.sources.splice(k, 1);
  S.recomputeStackGrants(st);
  pl.trash.push(id);
  return S.playFreeFromZone(state, p, 'trash', pl.trash.length - 1, { fromSources: true, ...opts });
}
// evolve `st` into a card taken from `zones` (hand/trash) — cost mode free|printed
function evoCands(ctx, o) {
  const { state, E } = ctx, who = ctx.self, pl = state.players[who], st = o.stack;
  const restr = S.evolveTargetRestriction(state, who, st);
  if (restr && restr.cannotEvolve) return [];
  const raw = [];
  for (const z of o.zones) pl[z].forEach((id, i) => raw.push({ zone: z, idx: i, id }));
  return raw.filter(c => C(c.id).category === 'digimon' && (!o.pred || o.pred(C(c.id), c.id))
    && (o.ignoreCond ? E.evoRestrictionCheck(c.id, restr).ok : E.canEvolveAny(st.cardId, c.id, S.evoExtraArg(state, null, st), restr).ok));
}
async function evolveInto(ctx, o) {
  const { state, E } = ctx, who = ctx.self, pl = state.players[who], st = o.stack;
  if (!st) return null;
  const cands = evoCands(ctx, o);
  if (!cands.length) { log(ctx, `${who} 진화시킬 수 있는 카드가 없음`); return null; }
  const zones = [...new Set(cands.map(c => c.zone))];
  let zone = zones[0];
  if (zones.length > 1) { const k = await ctx.choose('multipleChoice', { prompt: '진화할 카드의 위치 선택', options: zones.map(z => ({ hand: '패', trash: '트래시' }[z])) }); if (k == null) return null; zone = zones[k]; }
  const zc = cands.filter(c => c.zone === zone);
  const idx = await ctx.choose('pickFromZoneIndex', { player: who, zone, eligibleIdxs: zc.map(c => c.idx), prompt: o.prompt || '진화할 카드 선택' });
  if (idx == null) return null;
  const pick = zc.find(c => c.idx === idx);
  if (!pick) return null;
  const restr = S.evolveTargetRestriction(state, who, st);
  const chk = E.canEvolveAny(st.cardId, pick.id, S.evoExtraArg(state, null, st), restr);
  const printed = chk.ok ? chk.cost : (C(pick.id).evoNormal?.cost ?? 0);
  const m = o.cost || { mode: 'printed' };
  let cost = m.mode === 'free' ? 0 : m.mode === 'fixed' ? m.n : printed;
  if (m.mode === 'printed') cost = Math.max(0, cost + S.hookEvoCostDiscount(state, who, st, pick.id));
  if (zone === 'trash') pl.trash.splice(pick.idx, 1); // (digivolve takes a hand card out of the hand itself)
  return S.digivolve(state, who, st.uid, pick.id, cost, zone) || null;
}

// ------------------------------------------------------------------ 딜레이 (trigger + 《딜레이》 + bullet): the generic ~했을 때 watcher only ever queued the bare "《딜레이》." — these run the bullet.
// Watchers that parseWatcherTrigger understands (attack / delete / digivolve) reach the script through the pending item; the others get an events hook.
const CS_DELAY = { 'BT23-091': '가장 DP가 낮은 상대의 디지몬 1마리를 소멸시킨다.', 'BT23-095': '레스트 상태인 상대의 디지몬 1마리를 덱 아래로 되돌린다.', 'BT23-096': '상대의 디지몬 1마리를 《퇴화 4》.' };
for (const [id, text] of Object.entries(CS_DELAY)) sc(`${id}::자신의 턴`, (ctx, R) => delayOnly(ctx, () => runText(ctx, R, text)));
sc('BT23-099::자신의 턴', (ctx, R) => delayOnly(ctx, () => runText(ctx, R, '자신의 패/트래시에서, 명칭에 「시스터몬」을 포함하는 카드 1장을 코스트를 지불하지 않고 등장시킬 수 있다.')));
sc('BT21-098::자신의 턴', (ctx, R) => delayOnly(ctx, () => runText(ctx, R, '가장 등장 코스트가 낮은 상대의 디지몬 1마리를 소멸시킨다. 이 효과로 소멸하지 않았다면, 상대의 시큐리티가 1장이 되도록 위에서부터 파기한다.')));

// BT23-094 나노머신 브레이크: 《S 어택 -1》을 주고, 그 디지몬의 【진화 시】/【어택 시】 효과는 발휘하지 않는다 (같은 대상)
async function nanoBreak(ctx, until) {
  const { state } = ctx, o = opp(ctx.self);
  const t = await pickStack(ctx, o, digs(state, o), '《S 어택 -1》을 주고 【진화 시】/【어택 시】를 봉인할 상대의 디지몬 선택');
  if (!t) return;
  S.grantKeyword(state, o, t.uid, '시큐리티어택', -1, until === 'opp' ? 'opponentTurn' : 'turn');
  const u = until === 'opp' ? oppTurnEnd(state, ctx.self) : state.turnNumber;
  t.s13NoTrig = { ...(t.s13NoTrig || {}), digivolve: u, attack: u };
  log(ctx, `${o} ${C(t.cardId).nameKo}: ${until === 'opp' ? '상대의 턴' : '턴'} 종료까지 【진화 시】/【어택 시】 효과 발휘 불가`);
}
SCRIPTS['BT23-094::메인'] = [fn((ctx) => nanoBreak(ctx, 'opp')), { op: 'placeThisInBattle' }];
SCRIPTS['BT23-094::시큐리티'] = [fn((ctx) => nanoBreak(ctx, 'turn')), { op: 'placeThisInBattle' }];
sc('BT23-094::자신의 턴', (ctx) => delayOnly(ctx, () => nanoBreak(ctx, 'opp')));

// BT20-094: 상대의 시큐리티가 줄어들었을 때 → 진화원의 「황제드라몬: 드래곤 모드」를 등장
hk('BT20-094', { tag: '서로의 턴', events: { securityDecrease: (state, hp, h, info) => info.owner === opp(hp) && delayReady(state, h) } });
sc('BT20-094::서로의 턴', (ctx) => delayOnly(ctx, async () => {
  const has = (s) => s.sources.some((id, i) => i >= S.fdCount(s) && C(id).nameKo === '황제드라몬: 드래곤 모드');
  const st = await pickStack(ctx, ctx.self, digs(ctx.state, ctx.self).filter(s => C(s.cardId).nameKo === '황제드라몬: 파이터 모드' && has(s)), '진화원에서 등장시킬 「황제드라몬: 파이터 모드」 선택');
  if (st) await playFromSources(ctx, st, c => c.nameKo === '황제드라몬: 드래곤 모드', '진화원에서 등장시킬 「황제드라몬: 드래곤 모드」 선택');
}));

// BT20-095: 「크로니클」 디지몬이 소멸했을 때 → 육성 에어리어의 Lv.3+ 디지몬을 배틀 에어리어로 이동시키는 것으로, 패/트래시의 「크로니클」 디지몬 카드로 무료 진화
sc('BT20-095::서로의 턴', (ctx) => delayOnly(ctx, async () => {
  const { state } = ctx, p = ctx.self, pl = state.players[p], r = pl.raising;
  if (!r || !isDig(r) || (C(r.cardId).level || 0) < 3) return;
  const o = { stack: r, zones: ['hand', 'trash'], pred: c => hasType(c, '크로니클'), cost: { mode: 'free' }, prompt: '진화할 「크로니클」 디지몬 카드 선택' };
  if (!(await ask(ctx, '육성 에어리어의 디지몬을 배틀 에어리어로 이동시키고 「크로니클」 디지몬 카드로 진화시킬까요?'))) return;
  S.moveRaisingToBattle(state, p);
  const moved = pl.battle.find(s => s.uid === r.uid);
  if (moved) await evolveInto(ctx, { ...o, stack: moved });
}));

// BT20-097: 「데크스도루고라몬」이 배틀 에어리어를 벗어날 때(소멸) → 그 디지몬의 진화원의 「도루몬」 1장을 패로 되돌리는 것으로, 트래시의 「데크스몬」 1장을 코스트 없이 등장
hk('BT20-097', { tag: '서로의 턴', events: { delete: (state, hp, h, info) => {
  if (info.owner !== hp || !info.stack || C(info.stack.cardId).nameKo !== '데크스도루고라몬' || !delayReady(state, h)) return false;
  h.s13snap = { hasDoru: info.stack.sources.some((id, i) => i >= S.fdCount(info.stack) && C(id).nameKo === '도루몬') };
  return true;
} } });
sc('BT20-097::서로의 턴', async (ctx) => {
  const { state } = ctx, p = ctx.self, pl = state.players[p], h = me(ctx);
  const snap = h && h.s13snap;
  if (!h || !snap || !snap.hasDoru) return;
  const doru = () => pl.trash.map((id, i) => i).filter(i => C(pl.trash[i]).nameKo === '도루몬');
  const dex = () => pl.trash.map((id, i) => i).filter(i => C(pl.trash[i]).nameKo === '데크스몬');
  if (!doru().length || !dex().length) return;
  await delayOnly(ctx, async () => {
    if (!(await ask(ctx, '그 디지몬의 진화원이었던 「도루몬」 1장을 패로 되돌리고, 트래시의 「데크스몬」을 등장시킬까요?'))) return;
    const k = await ctx.choose('pickFromZoneIndex', { player: p, zone: 'trash', eligibleIdxs: doru(), prompt: '패로 되돌릴 「도루몬」 선택' });
    if (k == null) return;
    const [id] = pl.trash.splice(k, 1); pl.hand.push(id);
    const d = await ctx.choose('pickFromZoneIndex', { player: p, zone: 'trash', eligibleIdxs: dex(), prompt: '등장시킬 「데크스몬」 선택' });
    if (d != null) S.playFreeFromZone(state, p, 'trash', d, {});
  });
});

// ST20-14: Lv.5 이상의 자신의 디지몬이 배틀 에어리어를 벗어날 때(소멸) → 패의 「어드벤처」 Lv.5 이하 디지몬 1장을 등장
hk('ST20-14', { tag: '서로의 턴', events: { leaveBattle: (state, hp, h, info) => info.owner === hp && !!info.stack && isDig(info.stack) && (C(info.stack.cardId).level || 0) >= 5 && delayReady(state, h) } });
sc('ST20-14::서로의 턴', (ctx, R) => delayOnly(ctx, () => runText(ctx, R, '자신의 패에서 특징 「어드벤처」를 가진 Lv.5 이하의 디지몬 카드 1장을 코스트를 지불하지 않고 등장시킬 수 있다.')));

// ------------------------------------------------------------------ helpers (part 2)
const attacking = (ctx) => !!ctx.state.attackCtx; // "어택 중이라면" = ANY attack in progress, the opponent's too (Q4715/4716/4721/4724 BT20-015/018/053/056)
const fdN = (st) => S.fdCount(st);
const tamerColorN = (state, p) => new Set(tams(state, p).flatMap(t => S.stackColors(t))).size;
const restedOthers = (ctx) => [...digs(ctx.state, ctx.self), ...digs(ctx.state, ctx.opp)].filter(s => s.suspended && s.uid !== ctx.sourceStackUid).length;
const trashBoth = (state) => state.players.p1.trash.length + state.players.p2.trash.length;
function putFD(state, st, id) { st.sources.unshift(id); st.s5fd = S.fdCount(st) + 1; S.recomputeStackGrants(st); S.emitGameEvent(state, 'faceDownSource', { owner: (state.players.p1.battle.includes(st) || state.players.p1.raising === st) ? 'p1' : 'p2', stack: st, cause: 'effect' }); }
function shield(state, p, st, kinds, until, fromCategory) { S.grantShield(state, p, st.uid, { kinds, until, ...(fromCategory ? { fromCategory } : {}) }); }
async function pickOwnCard(ctx, zone, pred, prompt) { const pl = ctx.state.players[ctx.self]; const idxs = pl[zone].map((id, i) => i).filter(i => pred(C(pl[zone][i]))); if (!idxs.length) return null; return ctx.choose('pickFromZoneIndex', { player: ctx.self, zone, eligibleIdxs: idxs, prompt }); }
// place a card from `zone` (hand/trash/deck top) face-down under `st`
async function placeFD(ctx, st, zone, pred, prompt) {
  const { state } = ctx, pl = state.players[ctx.self];
  const idx = await pickOwnCard(ctx, zone, pred, prompt);
  if (idx == null) return false;
  const [id] = pl[zone].splice(idx, 1);
  putFD(state, st, id);
  return true;
}
// "이 효과로 등장한 디지몬은 진화할 수 없으며, 상대의 턴 종료 시, 소멸한다"
function markTempPlayed(ctx) {
  const { state } = ctx, lp = ctx._lastPick;
  if (!(ctx._res && ctx._res.played > 0) || !lp) return;
  const st = findStack(state, lp.player, lp.uid); if (!st) return;
  st.cannotEvolveUntil = oppTurnEnd(state, ctx.self);
  (state.endOfTurnEffects ||= []).push({ turnNumber: oppTurnEnd(state, ctx.self), player: ctx.self, cardId: ctx.sourceCardId, label: '상대의 턴 종료 시 소멸', fn: () => { if (findStack(state, lp.player, lp.uid)) S.deleteStack(state, lp.player, lp.uid, 'trash', 'ownEffect'); } });
}
async function borrowEvoEffect(ctx, R, cardId) {
  const segs = S.parseEffectSegments(C(cardId).effectKo || '').segments.filter(sg => sg.tags.some(t => t.includes('진화 시')));
  if (!segs.length) return false;
  let seg = segs[0];
  if (segs.length > 1) { const k = await ctx.choose('multipleChoice', { prompt: '발휘할 【진화 시】 효과 선택', options: segs.map(sg => sg.body.replace(/\n/g, ' ').slice(0, 60)) }); if (k == null) return false; seg = segs[k]; }
  const script = R.lookupCardSpecific(cardId, seg.tags, seg.body) || R.compileToScript(seg.body);
  if (!script || !script.length) { log(ctx, `${C(cardId).nameKo} 【진화 시】 효과를 자동 처리할 수 없음: ${seg.body}`); return false; }
  await R.runScript(script, { ...ctx, sourceCardId: cardId });
  return true;
}

// ------------------------------------------------------------------ BT20
// BT20-035: 진화원에 테이머 카드가 놓였을 때 → 【진화 시】 효과 1개 발휘, 그 후 어택 가능
hk('BT20-035', { tag: '서로의 턴', has: '테이머 카드가 놓였을 때', events: { sourcesAdded: (state, hp, h, info) => info.stack === h && (info.added || []).some(id => C(id).category === 'tamer') } });
sc('BT20-035::서로의 턴@테이머 카드가 놓였을 때', async (ctx, R) => {
  const h = me(ctx); if (!h) return;
  await borrowEvoEffect(ctx, R, h.cardId);
  await R.runOne({ op: 'attackNow', who: 'self', thisStack: false }, ctx);
});
// BT20-037: (per-source rest + memory, then) 상대의 디지몬/테이머 전부: 상대의 턴 종료까지 【등장 시】 효과 발휘 불가 + 액티브가 되지 않는다
sc('BT20-037::진화 시', async (ctx, R) => {
  await runText(ctx, R, '이 디지몬의 진화원의 Lv.6의 카드 1장마다 상대의 디지몬/테이머 1마리(명)를 레스트시키고, 메모리 +1.');
  const { state } = ctx, o = opp(ctx.self), until = oppTurnEnd(state, ctx.self);
  (state.s6NoPlayTrigAll ||= {})[o] = Math.max((state.s6NoPlayTrigAll || {})[o] || 0, until); // QA-W6 Q3690: also covers digimon/tamers that arrive later in the window
  for (const st of [...digs(state, o), ...tams(state, o)]) { if (S.effectBlocked(state, o, st, 'other')) continue; st.s13NoTrig = { ...(st.s13NoTrig || {}), play: until }; st.s2NoActiveUntil = until; }
  log(ctx, `${o} 디지몬/테이머 전부: 상대의 턴 종료까지 【등장 시】 효과 발휘 불가, 액티브가 되지 않음`);
});
// BT20-015 / BT20-053: 패의 「도루몬」/「류우다몬」을 비어 있는 육성 에어리어에 등장 (BT20-053: 그 후 어택 중이라면 효과 면역 + DP +5000)
async function raisingPlay(ctx) {
  const { state } = ctx, p = ctx.self, pl = state.players[p];
  if (pl.raising) { log(ctx, `${p} 육성 에어리어가 비어 있지 않음`); return false; }
  const idx = await pickOwnCard(ctx, 'hand', c => c.category === 'digimon' && ['도루몬', '류우다몬'].includes(c.nameKo), '비어 있는 육성 에어리어에 등장시킬 카드 선택');
  if (idx == null) return false;
  return !!S.playFreeToRaising(state, p, 'hand', idx, {}); // 등장 금지 락(BT9-033/BT9-047/BT14-009)을 존중
}
sc('BT20-015::등장 시', raisingPlay);
sc('BT20-053::등장 시', async (ctx) => {
  await raisingPlay(ctx);
  if (!attacking(ctx)) return;
  const { state } = ctx, p = ctx.self;
  const t = await pickStack(ctx, p, digs(state, p), '상대의 디지몬의 효과를 받지 않고 DP +5000이 될 디지몬 선택');
  if (!t) return;
  shield(state, p, t, ['all'], oppTurnEnd(state, p), 'digimon');
  S.modifyDP(state, p, t.uid, 5000, 'opponentTurn');
});
// BT20-056: 《리커버리 +1》. 그 후, 어택 중이라면 육성 에어리어의 디지몬을 패/트래시의 「크로니클」 Lv.6 이하 디지몬 카드로 무료 진화
sc('BT20-056::등장 시', async (ctx, R) => {
  await R.runOne({ op: 'recoverTop', who: 'self' }, ctx);
  const r = ctx.state.players[ctx.self].raising;
  if (!attacking(ctx) || !r || !isDig(r)) return;
  if (!(await ask(ctx, '육성 에어리어의 디지몬을 「크로니클」 디지몬 카드로 코스트 없이 진화시킬까요?'))) return;
  await evolveInto(ctx, { stack: r, zones: ['hand', 'trash'], pred: c => hasType(c, '크로니클') && (c.level || 0) <= 6, cost: { mode: 'free' }, prompt: '진화할 「크로니클」 디지몬 카드 선택' });
});
// BT20-059: 그 후, 진화원에 「간쿠몬」/「X항체」가 있다면 자신의 디지몬 전부는 상대의 디지몬의 효과를 받지 않는다
sc('BT20-059::진화 시', async (ctx, R) => {
  await runText(ctx, R, '상대의 디지몬 1마리를 《퇴화 2》.');
  const { state } = ctx, h = me(ctx), p = ctx.self;
  if (!h || !h.sources.some((id, i) => i >= fdN(h) && (S.cardNameHas(C(id), '간쿠몬') || hasType(C(id), 'X항체')))) return;
  for (const st of digs(state, p)) shield(state, p, st, ['all'], oppTurnEnd(state, p), 'digimon');
  log(ctx, `${p} 디지몬 전부: 상대의 턴 종료까지 상대의 디지몬의 효과를 받지 않음`);
});
// BT20-077: 패가 4장이 되도록 파기 → 트래시에서 DP 8000 이하 디지몬 등장 (이 효과로 파기한 1장마다 DP 상한 -2000)
sc('BT20-077::등장 시', async (ctx, R) => {
  const pl = ctx.state.players[ctx.self], before = pl.hand.length;
  await R.runOne({ op: 's13_trimTo', zone: 'hand', who: 'self', n: 4 }, ctx);
  const dis = Math.max(0, before - pl.hand.length);
  await R.runOne({ op: 'playFree', who: 'self', zone: 'trash', filter: { category: 'digimon', dpMax: 8000 - 2000 * dis }, rested: false, noTriggers: false }, ctx);
});
// BT20-101: 레스트 → 그 후, 레스트 상태인 디지몬 2마리마다 레스트 상태인 상대의 디지몬 1마리를 덱 아래로
sc('BT20-101::등장 시', async (ctx, R) => {
  await R.runOne({ op: 'rest', target: 'either' }, ctx);
  const { state } = ctx;
  const k = Math.floor([...digs(state, ctx.self), ...digs(state, ctx.opp)].filter(s => s.suspended).length / 2);
  for (let i = 0; i < k; i++) {
    const before = digs(state, ctx.opp).length;
    await R.runOne({ op: 'returnToHandStripSources', target: 'opponent', n: 1, filter: { suspended: true }, requireSuspended: null, dest: 'deckBottom' }, ctx);
    if (digs(state, ctx.opp).length === before) break;
  }
});

// ------------------------------------------------------------------ P- / BT21 / ST21
// P-165: 「사역마」 토큰은 상대의 턴 종료 시 소멸
sc('P-165::등장 시', async (ctx, R) => {
  const { state } = ctx, p = ctx.self, pl = state.players[p], before = new Set(pl.battle.map(s => s.uid));
  await runText(ctx, R, '「사역마」(디지몬·옐로·DP 3000·【소멸 시】 턴 종료까지 상대의 디지몬 1마리를 DP -3000.) 토큰 1마리를 등장시킨다.');
  const toks = pl.battle.filter(s => !before.has(s.uid)).map(s => s.uid);
  if (!toks.length) return;
  (state.endOfTurnEffects ||= []).push({ turnNumber: (state.turnEnding && state.activePlayer === opp(p) ? state.turnNumber + 2 : oppTurnEnd(state, p)), player: p, cardId: ctx.sourceCardId, label: '상대의 턴 종료 시 토큰 소멸', fn: () => { for (const u of toks) if (findStack(state, p, u)) S.deleteStack(state, p, u, 'trash', 'ownEffect'); } });
});
// P-166: 레스트 → 자신의 턴이라면 패의 「조」/「새」/「병아리」 디지몬으로 진화 (레스트 상태인 다른 디지몬 1마리마다 지불 코스트 -1)
sc('P-166::등장 시', async (ctx, R) => {
  await R.runOne({ op: 'rest', target: 'either' }, ctx);
  if (ctx.state.activePlayer !== ctx.self) return;
  await R.runOne({ op: 'evolveEffect', who: 'self', subject: { thisStack: true }, zone: 'hand', cardFilter: { category: 'digimon', traitIncludes: ['조', '새', '병아리'] }, cost: { mode: 'discount', n: restedOthers(ctx) }, ignoreCond: false, ignoreLevel: false }, ctx);
});
// BT21-012: 이 디지몬을 레스트 → 패의 진화원 효과를 가진 레드 테이머 등장, 그랬다면 이 디지몬을 그 테이머 아래에
SCRIPTS['BT21-012::메인'] = [{ op: 'costGroup', cost: [{ op: 'restStack' }], then: [
  { op: 'playFree', who: 'self', zone: 'hand', filter: { category: 'tamer', colors: ['red'], hasInherited: true }, rested: false, noTriggers: false, optional: true },
  fn(async (ctx) => {
    const { state } = ctx, p = ctx.self, pl = state.players[p], lp = ctx._lastPick, mv = me(ctx);
    if (!(ctx._res && ctx._res.played > 0) || !lp || !mv) return;
    const tam = findStack(state, p, lp.uid); if (!tam || tam === mv) return;
    const mvi = pl.battle.indexOf(mv); if (mvi >= 0) pl.battle.splice(mvi, 1); else if (pl.raising === mv) pl.raising = null; else return; // raising-area user: indexOf -1 used to splice off the LAST battle stack = the tamer just played (fuzz)
    pl.trash.push(...(mv.linkCards || []).map(l => l.cardId));
    tam.sources.splice(S.fdCount(tam), 0, ...mv.sources, mv.cardId);
    S.recomputeStackGrants(tam);
    log(ctx, `${p} ${C(mv.cardId).nameKo}을(를) ${C(tam.cardId).nameKo} 아래에 놓음`);
  })] }];
// BT21-058: 덱 위 3장 오픈 → 「벰몬」 기술 카드 1장 패에, 나머지 파기. 그 후 트래시의 「벰몬」 2장까지를 자신의 디지몬 1마리의 진화원 아래에
sc('BT21-058::등장 시', async (ctx, R) => {
  await runText(ctx, R, '자신의 덱 위에서부터 3장 오픈한다. 그중 「벰몬」이 기술되어 있는 카드 1장을 패에 추가한다. 나머지는 파기한다.');
  const { state } = ctx, p = ctx.self, pl = state.players[p];
  if (!pl.trash.some(id => C(id).nameKo === '벰몬')) return;
  const t = await pickStack(ctx, p, digs(state, p), '「벰몬」을 진화원 아래에 놓을 디지몬 선택 (취소=안 함)');
  if (!t) return;
  for (let i = 0; i < 2; i++) {
    const idx = await pickOwnCard(ctx, 'trash', c => c.nameKo === '벰몬', `진화원 아래에 놓을 「벰몬」 선택 (${i + 1}/2, 취소=그만)`);
    if (idx == null) break;
    const [id] = pl.trash.splice(idx, 1);
    t.sources.splice(S.fdCount(t), 0, id); S.recomputeStackGrants(t);
  }
});
// BT21-076: 서로의 트래시 합계 10장마다 지불 코스트 -1
sc('BT21-076::어택 시', (ctx, R) => R.runOne({ op: 'evolveEffect', who: 'self', subject: { thisStack: true }, zone: 'hand', cardFilter: { category: 'digimon', nameAny: ['메기드라몬', '카오스듀크몬'] }, cost: { mode: 'discount', n: Math.floor(trashBoth(ctx.state) / 10) }, ignoreCond: false, ignoreLevel: false }, ctx));
// BT21-079: 서로의 트래시 합계 10장마다 등장 코스트 상한 +2
sc('BT21-079::소멸 시', (ctx, R) => R.runOne({ op: 'playFree', who: 'self', zone: 'trash', filter: { category: 'digimon', nameAny: ['길몬', '그라우몬'], costMax: 3 + 2 * Math.floor(trashBoth(ctx.state) / 10) }, rested: false, noTriggers: false, optional: true }, ctx));
// BT21-081: 이 테이머 레스트 → 「파충류형」/「용인형」 디지몬 1마리 《관통》, 그 디지몬으로 어택한다
sc('BT21-081::자신의 턴 종료 시', async (ctx) => {
  const { state } = ctx, p = ctx.self, t = me(ctx);
  const cands = digs(state, p).filter(s => hasType(C(s.cardId), '파충류형', '용인형'));
  if (!t || t.suspended || !cands.length || !(await ask(ctx, '이 테이머를 레스트시키고 《관통》을 주어 어택할까요?'))) return;
  S.restStack(state, p, t.uid);
  if (!t.suspended) return;
  const st = await pickStack(ctx, p, cands, '《관통》을 얻고 어택할 디지몬 선택');
  if (!st) return;
  S.grantKeyword(state, p, st.uid, '관통', undefined, 'turn');
  if (!st.suspended) ctx.startAttack(p, st.uid);
});
// BT21-096: 「최건우」를 디지몬·DP 12000으로 취급, 진화 불가, 《속공》. 그 후 그 디지몬으로 (액티브 상태인 디지몬에게도) 어택 가능
sc('BT21-096::메인', async (ctx) => {
  const { state } = ctx, p = ctx.self;
  const st = await pickStack(ctx, p, tams(state, p).filter(s => C(s.cardId).nameKo === '최건우'), '디지몬으로 취급할 「최건우」 선택');
  if (!st) return;
  st.s2AsDigimon = true; st.s2NoEvolve = true;
  (st.baseOv ||= []).push({ ts: S.stamp(), until: state.turnNumber, dp: 12000 }); S.refreshBaseInfo(state, st); // (a Tamer has no DP: modifyDP would be refused by 2-5-3)
  S.scheduleEndOfTurn(state, () => { st.s2AsDigimon = false; st.s2NoEvolve = false; }, { expire: true });
  S.grantKeyword(state, p, st.uid, '속공', undefined, 'turn');
  S.grantKeyword(state, p, st.uid, '액티브공격', undefined, 'turn');
  if (await ask(ctx, '그 디지몬으로 상대의 디지몬에게 어택할까요? (액티브 상태에도 가능)')) ctx.startAttack(p, st.uid);
});
// BT21-102: 패의 「어드벤처」/「히어로」 카드 등장 (테이머의 색 1색마다 등장 코스트 상한 +1). 그 후 이 테이머를 덱 아래로
sc('BT21-102::메인', async (ctx, R) => {
  await R.runOne({ op: 'playFree', who: 'self', zone: 'hand', filter: { traitAny: ['어드벤처', '히어로'], costMax: 2 + tamerColorN(ctx.state, ctx.self) }, rested: false, noTriggers: false, optional: true }, ctx);
  await R.runOne({ op: 's13_selfTo', dest: 'deckBottom' }, ctx);
});
// ST21-04: 자신의 테이머의 색 2색마다 상대 디지몬 1마리의 진화원을 선택하여 파기, 그 후 진화원 1장 이하의 상대 디지몬 1마리를 패로
sc('ST21-04::등장 시', async (ctx, R) => {
  const { state } = ctx, o = opp(ctx.self), k = Math.floor(tamerColorN(state, ctx.self) / 2);
  const t = k > 0 ? await pickStack(ctx, o, digs(state, o).filter(s => s.sources.length && !S.effectBlocked(state, o, s, 'other')), '진화원을 파기할 상대 디지몬 선택') : null;
  if (t) {
    const ids = t.sources.slice(fdN(t)), base = fdN(t);
    const chosen = [];
    for (let i = 0; i < Math.min(k, ids.length); i++) {
      const idxs = ids.map((_, j) => j).filter(j => !chosen.includes(j));
      const j = await pickFromList(ctx, ctx.self, ids, idxs, `파기할 진화원 선택 (${i + 1}/${Math.min(k, ids.length)})`);
      if (j == null) break; chosen.push(j);
    }
    if (chosen.length) S.trashEvoSources(state, o, t.uid, chosen.length, 'bottom', chosen.map(j => base + j));
  }
  await R.runOne({ op: 'returnToHandStripSources', target: 'opponent', n: 1, filter: { srcMax: 1 }, requireSuspended: null, dest: 'hand' }, ctx);
});
// ST21-11: 테이머의 색 2색마다 Lv. 상한 +1
sc('ST21-11::등장 시', (ctx, R) => R.runOne({ op: 'returnToHandStripSources', target: 'opponent', n: 1, filter: { levelMax: 4 + Math.floor(tamerColorN(ctx.state, ctx.self) / 2) }, requireSuspended: null, dest: 'deckBottom' }, ctx));

// ------------------------------------------------------------------ EX9 (face-down sources)
// EX9-030: 트래시의 디지몬 1장을 뒷면으로 진화원 아래에 놓는 것으로 상대 디지몬 1마리 DP -3000 (뒷면의 진화원 1장마다 -2000)
sc('EX9-030::등장 시', async (ctx, R) => {
  const h = me(ctx); if (!h) return;
  if (!(await placeFD(ctx, h, 'trash', c => c.category === 'digimon', '뒷면으로 진화원 아래에 놓을 트래시의 디지몬 카드 선택 (취소=안 함)'))) return;
  await R.runOne({ op: 'modifyDP', target: 'opponent', amount: -3000 - 2000 * fdN(h), duration: 'opponentTurn' }, ctx);
});
// EX9-039: 패 1장을 뒷면으로 (선택) → 뒷면의 진화원 1장마다 상대 디지몬 1마리 레스트 → 어택 가능
sc('EX9-039::등장 시', async (ctx, R) => {
  const h = me(ctx); if (!h) return;
  if (ctx.state.players[ctx.self].hand.length && (await ask(ctx, '패 1장을 이 디지몬의 진화원 아래에 뒷면으로 놓을까요?'))) await placeFD(ctx, h, 'hand', () => true, '뒷면으로 놓을 패 선택');
  for (let i = 0; i < fdN(h); i++) { const b = digs(ctx.state, ctx.opp).filter(s => !s.suspended).length; if (!b) break; await R.runOne({ op: 'rest', target: 'opponent', n: 1, skipNextUnsuspend: false, digimonOnly: true }, ctx); }
  await R.runOne({ op: 'attackNow', who: 'self', thisStack: false }, ctx);
});
// EX9-045: 패의 「WG」 등장 후, 조그레스 진화하고 있었다면 상대 디지몬 2마리까지 덱 아래로
sc('EX9-045::진화 시', async (ctx, R) => {
  await runText(ctx, R, '자신의 패에서 특징 「WG」를 가진 등장 코스트 7 이하의 디지몬 카드 1장을 코스트를 지불하지 않고 등장시킬 수 있다.');
  const h = me(ctx);
  if (!h || !h.viaFusion) return;
  for (let i = 0; i < 2; i++) { const b = digs(ctx.state, ctx.opp).length; await R.runOne({ op: 'returnToHandStripSources', target: 'opponent', n: 1, filter: {}, requireSuspended: null, dest: 'deckBottom' }, ctx); if (digs(ctx.state, ctx.opp).length === b) break; }
});
// EX9-053: 덱 위 3장 오픈 → 「DM」 카드 1장 등장 (뒷면의 진화원 1장마다 등장 코스트 상한 +1), 나머지 덱 아래
sc('EX9-053::등장 시', (ctx, R) => R.runOne({ op: 'revealTop', who: 'self', n: 3, pick: { min: 0, max: 1, filter: { traitAny: ['DM'], costMax: 4 + fdN(me(ctx) || { sources: [] }) }, action: 'play', rested: false, noTriggers: false }, restTo: 'bottom' }, ctx));
// EX9-054: 트래시와 디지몬의 진화원에 있는 「네가몬」 합계 2장마다 Lv. 상한 +1
sc('EX9-054::소멸 시', (ctx, R) => {
  const { state } = ctx, p = ctx.self, pl = state.players[p];
  const n = pl.trash.filter(id => C(id).nameKo === '네가몬').length + digs(state, p).reduce((a, s) => a + s.sources.filter((id, i) => i >= fdN(s) && C(id).nameKo === '네가몬').length, 0);
  return R.runOne({ op: 'playFree', who: 'self', zone: 'hand', filter: { category: 'digimon', mentionAny: ['네가몬'], levelMax: 4 + Math.floor(n / 2) }, rested: false, noTriggers: false, optional: true }, ctx);
});
// EX9-061: 덱 위 1장을 뒷면으로 → Lv.3 이하 상대 디지몬 소멸 (뒷면의 진화원 2장마다 Lv. 상한 +1)
sc('EX9-061::어택 시', async (ctx, R) => {
  const h = me(ctx), pl = ctx.state.players[ctx.self]; if (!h || !pl.deck.length) return;
  if (!(await ask(ctx, '덱 위 1장을 이 디지몬의 진화원 아래에 뒷면으로 놓고 상대 디지몬을 소멸시킬까요?'))) return;
  putFD(ctx.state, h, pl.deck.shift());
  await R.runOne({ op: 'destroy', target: 'opponent', mode: 'choose', filter: { levelMax: 3 + Math.floor(fdN(h) / 2) } }, ctx);
});
// EX9-064: 트래시의 디지몬 1장을 뒷면으로 → 등장 코스트 4 이하 상대 디지몬 2마리 소멸 (뒷면의 진화원 1장마다 상한 +1)
sc('EX9-064::등장 시', async (ctx, R) => {
  const h = me(ctx); if (!h) return;
  if (!(await placeFD(ctx, h, 'trash', c => c.category === 'digimon', '뒷면으로 진화원 아래에 놓을 트래시의 디지몬 카드 선택 (취소=안 함)'))) return;
  for (let i = 0; i < 2; i++) await R.runOne({ op: 'destroy', target: 'opponent', mode: 'choose', filter: { costMax: 4 + fdN(h) } }, ctx);
});
// EX9-066: 등장/진화했을 때 이 테이머 레스트 → 「그레이몬」 있으면 메모리 +1, 또한 「가루몬」 있으면 메모리 +1
hk('EX9-066', { tag: '서로의 턴', events: { play: (state, hp, h, info) => info.owner === hp && isDig(info.stack) && !h.suspended, digivolve: (state, hp, h, info) => info.owner === hp && isDig(info.stack) && !h.suspended } });
sc('EX9-066::서로의 턴', async (ctx) => {
  const { state } = ctx, p = ctx.self, t = me(ctx);
  if (!t || t.suspended) return;
  if (!(await ask(ctx, '이 테이머를 레스트시키고 메모리를 얻을까요?'))) return;
  S.restStack(state, p, t.uid);
  if (!t.suspended) return;
  for (const n of ['그레이몬', '가루몬']) if (digs(state, p).some(s => C(s.cardId).nameKo.includes(n))) S.grantMemory(state, p, 1, ctx.sourceCardId);
});
// EX9-068: (이 테이머 레스트) 《1 드로우》, 메모리 +1. 또한 패 1장을 그 디지몬의 진화원 아래에 뒷면으로 놓을 수 있다
sc('EX9-068::자신의 턴', async (ctx) => {
  const { state } = ctx, p = ctx.self;
  S.drawCards(state, p, 1); S.grantMemory(state, p, 1, ctx.sourceCardId);
  const ev = ctx.trigger && ctx.trigger.evtStackUid, t = ev && findStack(state, p, ev);
  if (t && state.players[p].hand.length && (await ask(ctx, '패 1장을 그 디지몬의 진화원 아래에 뒷면으로 놓을까요?'))) await placeFD(ctx, t, 'hand', () => true, '뒷면으로 놓을 패 선택');
});
// EX9-074: 트래시의 「DM」 Lv.4 이하 1장을 진화원 위에 (선택) → 진화원과 같은 색의 상대 디지몬 1마리 소멸 (진화원이 6색 이상이면 대신 색이 서로 다른 상대 디지몬 1마리씩)
// QA (id 5004/5005): mandatory (not "…소멸시킬 수 있다") — one same-colour opponent Digimon per DISTINCT
// colour, chosen so as many opponent Digimon as possible are destroyed (a single colour can't be spent on
// two Digimon). This is a bipartite max-matching (Digimon x colour): a naive "mark every colour on the
// destroyed Digimon as used" greedy can starve a single-colour Digimon that shares its only colour with an
// already-picked multi-colour one (the FAQ's own red-only + red&blue example), so this uses an augmenting-
// path match (Kuhn's algorithm) to guarantee the maximum set is found regardless of pick order.
sc('EX9-074::등장 시', async (ctx) => {
  const { state } = ctx, p = ctx.self, o = opp(p), pl = state.players[p], h = me(ctx); if (!h) return;
  const idx = await pickOwnCard(ctx, 'trash', c => c.category === 'digimon' && hasType(c, 'DM') && (c.level || 0) <= 4, '진화원 위에 놓을 「DM」 Lv.4 이하 디지몬 선택 (취소=안 함)');
  if (idx != null) { const [id] = pl.trash.splice(idx, 1); h.sources.push(id); S.recomputeStackGrants(h); }
  const cols = new Set(h.sources.flatMap(id => C(id).colors || []));
  const opps = () => digs(state, o).filter(s => !S.effectBlocked(state, o, s, 'delete'));
  if (cols.size >= 6) {
    const cand = opps();
    const matchOf = new Map(); // colour -> candidate stack currently assigned to it
    const tryAssign = (s, seen) => {
      for (const c of S.stackColors(s)) {
        if (seen.has(c)) continue;
        seen.add(c);
        const cur = matchOf.get(c);
        if (!cur || tryAssign(cur, seen)) { matchOf.set(c, s); return true; }
      }
      return false;
    };
    for (const s of cand) tryAssign(s, new Set());
    for (const t of new Set(matchOf.values())) if (digs(state, o).includes(t)) S.deleteStack(state, o, t.uid, 'trash', 'effect');
  } else {
    const list = opps().filter(s => S.stackColors(s).some(x => cols.has(x)));
    if (list.length) {
      const uid = await ctx.choose('pickStack', { player: o, uids: list.map(s => s.uid), required: true, prompt: '진화원과 같은 색의 상대 디지몬 소멸' });
      const t = list.find(s => s.uid === uid);
      if (t) S.deleteStack(state, o, t.uid, 'trash', 'effect');
    }
  }
});

// ------------------------------------------------------------------ BT22 / EX10 / BT23
// BT22-007 [육성]: 디지타마 덱 위 1장 확인 → 「마더 이터」면 진화원 위에 (선택). 진화원 10장 이상이면 「마더 이터」 3장 등장
sc('BT22-007::자신의 메인 페이즈 개시 시', async (ctx) => {
  const { state } = ctx, p = ctx.self, pl = state.players[p], h = me(ctx); if (!h) return;
  const top = pl.digitamaDeck[0];
  if (top) { log(ctx, `${p} 디지타마 덱 맨 위 확인: ${C(top).nameKo}`); if (C(top).nameKo === '마더 이터' && (await ask(ctx, `디지타마 덱 맨 위의 「마더 이터」를 이 디지몬의 진화원 위에 놓을까요?`))) { pl.digitamaDeck.shift(); h.sources.push(top); S.recomputeStackGrants(h); } }
  const mothers = () => h.sources.filter((id, i) => i >= fdN(h) && C(id).nameKo === '마더 이터').length;
  if (h.sources.length >= 10 && mothers() >= 3 && (await ask(ctx, '진화원의 「마더 이터」 3장을 코스트 없이 등장시킬까요?'))) for (let i = 0; i < 3; i++) await playFromSources(ctx, h, c => c.nameKo === '마더 이터', `등장시킬 「마더 이터」 선택 (${i + 1}/3)`);
});
// BT22-031: 그 후 Lv.이 같은 카드가 2장 이상 겹쳐져 있다면 패의 「플래티넘워매몬」으로 진화 조건 무시, 진화 코스트 4로 진화
const sameLvPair = (st) => { const seen = new Set(); for (const id of st.sources.slice(fdN(st))) { const lv = C(id).level; if (lv == null) continue; if (seen.has(lv)) return true; seen.add(lv); } return false; };
sc('BT22-031::등장 시', async (ctx, R) => {
  await R.runOne({ op: 'grantKeyword', target: 'opponent', thisStack: false, keyword: '시큐리티어택', value: -2, duration: 'opponentTurn' }, ctx);
  const h = me(ctx); if (!h || !sameLvPair(h)) return;
  await R.runOne({ op: 'evolveEffect', who: 'self', subject: { thisStack: true }, zone: 'hand', cardFilter: { category: 'digimon', exactAny: ['플래티넘워매몬'] }, cost: { mode: 'fixed', n: 4 }, ignoreCond: true, ignoreLevel: false }, ctx);
});
// BT22-059: 그 후 자신의 「사나다 아라타」/「이터 아담」이 있다면 이 디지몬은 상대의 효과로 DP가 마이너스되지 않고 패/덱으로 되돌아가지 않는다
sc('BT22-059::등장 시', async (ctx, R) => {
  await runText(ctx, R, '등장 코스트 5 이하의 상대의 디지몬 1마리를 소멸시킨다.');
  const { state } = ctx, p = ctx.self, h = me(ctx);
  if (!h || !state.players[p].battle.some(s => ['사나다 아라타', '이터 아담'].includes(C(s.cardId).nameKo))) return;
  shield(state, p, h, ['dpDown', 'bounce'], oppTurnEnd(state, p));
});
// BT22-066: 디지몬 1마리를 액티브로 할 수 있다. 그 후 디지몬 1마리를 레스트시킬 수 있다 (양쪽 무관)
sc('BT22-066::등장 시', async (ctx, R) => {
  const { state } = ctx, entries = () => [...digs(state, ctx.self), ...digs(state, ctx.opp)].map(s => ({ player: state.players.p1.battle.includes(s) ? 'p1' : 'p2', uid: s.uid }));
  const pk = await ctx.choose('pickStackAnySide', { entries: entries().filter(e => findStack(state, e.player, e.uid).suspended), prompt: '액티브로 할 디지몬 선택 (취소=안 함)' });
  if (pk) S.unsuspendStack(state, pk.player, pk.uid);
  await R.runOne({ op: 'rest', target: 'either' }, ctx);
});
// BT22-067: DP +3000 → 자신의 디지몬 1마리로 플레이어에게 어택할 수 있다
sc('BT22-067::등장 시', async (ctx, R) => {
  await runText(ctx, R, '상대의 턴 종료까지 자신의 디지몬 1마리를 DP +3000.');
  const { state } = ctx, p = ctx.self;
  const c = digs(state, p).filter(s => !s.suspended && S.canAttackPlayer(state, p, s.uid));
  const st = await pickStack(ctx, p, c, '플레이어에게 어택할 디지몬 선택 (취소=안 함)');
  if (st) ctx.startAttack(p, st.uid, 'PLAYER');
});
// BT22-081 / BT22-082: 이 디지몬이 진화원을 갖지 않는다면 패/트래시의 「…」 1장을 진화원 아래에
for (const [id, first, nm] of [['BT22-081', '상대의 턴 종료까지 상대의 디지몬 1마리는 레스트할 수 없다.', '카미시로 유코'], ['BT22-082', '등장 코스트 7 이하의 상대의 디지몬 1마리를 소멸시킨다.', '사나다 아라타']]) {
  sc(`${id}::등장 시`, async (ctx, R) => {
    await runText(ctx, R, first);
    const { state } = ctx, pl = state.players[ctx.self], h = me(ctx);
    if (!h || h.sources.length) return;
    const zone = pl.hand.some(x => C(x).nameKo === nm) ? (pl.trash.some(x => C(x).nameKo === nm) ? await ctx.choose('multipleChoice', { prompt: `「${nm}」를 놓을 위치`, options: ['패', '트래시'] }) === 1 ? 'trash' : 'hand' : 'hand') : 'trash';
    const idx = await pickOwnCard(ctx, zone, c => c.nameKo === nm, `진화원 아래에 놓을 「${nm}」 선택 (취소=안 함)`);
    if (idx == null) return;
    const [cid] = pl[zone].splice(idx, 1); h.sources.splice(S.fdCount(h), 0, cid); S.recomputeStackGrants(h);
  });
}
// EX10-055: 자신의 디지몬 1마리를 선택 → 그 디지몬의 Lv. 이하의 상대 디지몬 1마리와 선택한 디지몬을 소멸
sc('EX10-055::등장 시', async (ctx) => {
  const { state } = ctx, p = ctx.self, o = opp(p);
  const mine = await pickStack(ctx, p, digs(state, p), '선택할 자신의 디지몬 (취소=안 함)');
  if (!mine) return;
  const lv = C(mine.cardId).level || 0;
  const t = await pickStack(ctx, o, digs(state, o).filter(s => (C(s.cardId).level || 0) <= lv), `Lv.${lv} 이하의 소멸시킬 상대 디지몬 선택`);
  if (t) S.deleteStack(state, o, t.uid, 'trash', 'effect');
  S.deleteStack(state, p, mine.uid, 'trash', 'ownEffect');
});
// BT23-070: 그 후 진화원에 「벨페몬」이 있다면 레스트시키지 않고 어택
sc('BT23-070::진화 시', async (ctx, R) => {
  await runText(ctx, R, '가장 Lv.이 높은 상대의 디지몬 전부를 소멸시킨다.');
  const h = me(ctx);
  if (h && h.sources.some((id, i) => i >= fdN(h) && C(id).nameKo.includes('벨페몬'))) ctx.startAttack(ctx.self, h.uid, undefined, { noRest: true });
});
// BT23-017 / 037 / 048 (상속 어택 시): 등장한 디지몬은 진화할 수 없고 상대의 턴 종료 시 소멸
for (const id of ['BT23-017', 'BT23-037', 'BT23-048']) sc(`${id}::어택 시`, async (ctx, R) => {
  await runText(ctx, R, '자신의 패에서, 특징 「후디에」를 가진 등장 코스트 5 이하의 디지몬 카드 1장을 코스트를 지불하지 않고 등장시킬 수 있다.');
  markTempPlayed(ctx);
});
// BT23-069: 이 디지몬 소멸 → Lv.6 이하 상대 디지몬 소멸, 소멸하지 않았다면 그 어택 종료 가능
sc('BT23-069::서로의 턴', async (ctx, R) => {
  const { state } = ctx, h = me(ctx); if (!h || !(await ask(ctx, '이 디지몬을 소멸시켜 Lv.6 이하의 상대 디지몬을 소멸시킬까요?'))) return;
  S.deleteStack(state, ctx.self, h.uid, 'trash', 'ownEffect');
  if (findStack(state, ctx.self, h.uid)) return;
  await R.runOne({ op: 'destroy', target: 'opponent', mode: 'choose', filter: { levelMax: 6 } }, ctx);
  if (ctx._lastDestroyed === false && state.attackCtx && state.attackCtx.terminate && (await ask(ctx, '그 어택을 종료할까요?'))) state.attackCtx.terminate();
});
// BT23-059: 옵션이 파기되었을 때 액티브로 하고, 턴 종료까지 상대의 디지몬의 효과를 받지 않는다
sc('BT23-059::서로의 턴', async (ctx) => {
  const { state } = ctx, h = me(ctx); if (!h) return;
  S.unsuspendStack(state, ctx.self, h.uid);
  shield(state, ctx.self, h, ['all'], state.turnNumber, 'digimon');
});
// BT23-015: 소멸 후 상대의 트래시에서 디지타마 카드 이외 3장까지를 덱 아래로
sc('BT23-015::등장 시', async (ctx, R) => {
  await R.runOne({ op: 'destroy', target: 'opponent', mode: 'choose', filter: { dpMax: 9000 } }, ctx);
  const { state } = ctx, o = state.players[ctx.opp];
  for (let i = 0; i < 3; i++) {
    const idxs = o.trash.map((id, j) => j).filter(j => C(o.trash[j]).category !== 'digitama');
    const j = await pickFromList(ctx, ctx.self, o.trash, idxs, `상대의 트래시에서 덱 아래로 되돌릴 카드 선택 (${i + 1}/3, 취소=그만)`);
    if (j == null) break;
    const [id] = o.trash.splice(j, 1); o.deck.push(id);
  }
});
// BT23-054: 《1 드로우》. 그 후 「로얄 나이츠」/「CS」 디지몬 1마리는 상대의 턴 종료까지 상대의 효과로 패/덱으로 되돌아가지 않는다
sc('BT23-054::등장 시', async (ctx) => {
  const { state } = ctx, p = ctx.self;
  S.drawCards(state, p, 1);
  const t = await pickStack(ctx, p, digs(state, p).filter(s => hasType(C(s.cardId), '로얄 나이츠', 'CS')), '되돌아가지 않을 「로얄 나이츠」/「CS」 디지몬 선택');
  if (t) shield(state, p, t, ['bounce'], oppTurnEnd(state, p));
});
// BT23-092: 상대의 디지몬 1마리와 테이머 1명은 레스트할 수 없다, 그 후 이 카드를 배틀 에어리어에 놓는다
const lock92 = (dur) => [{ op: 'preventRest', target: 'opponent', n: 1, filter: { category: 'digimon' }, expiresAfterTurn: dur }, { op: 'preventRest', target: 'opponent', n: 1, filter: { category: 'tamer' }, expiresAfterTurn: dur }, { op: 'placeThisInBattle' }];
SCRIPTS['BT23-092::메인'] = lock92('opponentTurn');
SCRIPTS['BT23-092::시큐리티'] = lock92('turn');
// BT23-013: 「아트&르네&포르」 토큰 또는 패/트래시의 「시스터몬」 (자신의 디지몬과 같은 명칭은 불가)
sc('BT23-013::진화 시', async (ctx, R) => {
  const k = await ctx.choose('multipleChoice', { prompt: '등장시킬 대상 선택', options: ['「아트&르네&포르」 토큰', '패/트래시의 「시스터몬」 카드', '하지 않음'] });
  if (k === 0) await runText(ctx, R, '「아트&르네&포르」(디지몬·화이트·DP 6000·《재기동》《블로커》) 토큰 1마리를 등장시킬 수 있다.');
  else if (k === 1) await R.runOne({ op: 'playFree', who: 'self', zone: 'any', filter: { category: 'digimon', nameAny: ['시스터몬'] }, rested: false, noTriggers: false, optional: true, exclSame: 'digimon' }, ctx);
});
SCRIPTS['BT23-013::어택 시'] = SCRIPTS['BT23-013::진화 시'];
