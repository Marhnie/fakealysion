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
const isDig = (st) => !!st && C(st.cardId).category === 'digimon';
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
  return S.fuseStacks(state, who, pair[0].uid, pair[1].uid, id, j ? j.cost : 0, 'hand');
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
hk('ST20-14', { tag: '서로의 턴', events: { delete: (state, hp, h, info) => info.owner === hp && !!info.stack && isDig(info.stack) && (C(info.stack.cardId).level || 0) >= 5 && delayReady(state, h) } });
sc('ST20-14::서로의 턴', (ctx, R) => delayOnly(ctx, () => runText(ctx, R, '자신의 패에서 특징 「어드벤처」를 가진 Lv.5 이하의 디지몬 카드 1장을 코스트를 지불하지 않고 등장시킬 수 있다.')));
