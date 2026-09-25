// Shard 64 — fixes found by the official card-Q&A scenario tests (scripts/qa/qa-slice4-*.mjs; Q ids reference data/rulings/slice4.json).
// state.js is imported lazily (only used inside functions) because state.js imports cards/index.js.
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

const C = (id) => S.card(id);
const has = (c, t) => (c.types || []).includes(t);
const stacksOf = (state, p) => [state.players[p].raising, ...state.players[p].battle].filter(Boolean);
const me = (ctx) => stacksOf(ctx.state, ctx.self).find(s => s.uid === ctx.sourceStackUid) || null;
const log = (ctx, msg) => S.log(ctx.state, msg);
const fn = (f) => ({ op: 's64_fn', fn: f });
OPS.s64_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
const sc = (key, f) => { SCRIPTS[key] = [fn(f)]; };
async function ask(ctx, prompt) { return !!(await ctx.choose('confirmEffect', { player: ctx.self, prompt })); }
// pick one card from an id list (temp zone so the stock picker UI works)
async function pickFromList(ctx, ids, idxs, prompt) {
  if (!idxs.length) return null;
  const pl = ctx.state.players[ctx.self];
  pl.s64tmp = ids;
  try { return await ctx.choose('pickFromZoneIndex', { player: ctx.self, zone: 's64tmp', eligibleIdxs: idxs, prompt }); } finally { delete pl.s64tmp; }
}
// play face-up evolution cards of `st` for free; `idxs` = candidate source indexes, returns the played stack (or null)
async function playSourceAt(ctx, st, idxs, prompt) {
  const { state } = ctx, p = ctx.self, pl = state.players[p];
  const k = await pickFromList(ctx, st.sources, idxs, prompt);
  if (k == null) return null;
  const [id] = st.sources.splice(k, 1);
  S.recomputeStackGrants(st);
  pl.trash.push(id);
  return S.playFreeFromZone(state, p, 'trash', pl.trash.length - 1, { fromSources: true });
}
const faceUpIdx = (st, pred) => st.sources.map((id, i) => i).filter(i => i >= S.fdCount(st) && pred(C(st.sources[i])));

// EX9-021 【어택 종료 시】 (official Q&A 4765-4767): play (as many as possible) one card named/typed 「그레이몬」/Ver.1 AND one 「가루몬」/Ver.2 from this digimon's
// evolution cards, free; if anything was played this way, put this digimon on top of the security stack. Both cards must be played when both exist.
const isA = (c) => c.nameKo.includes('그레이몬') || has(c, 'Ver.1');
const isB = (c) => c.nameKo.includes('가루몬') || has(c, 'Ver.2');
sc('EX9-021::어택 종료 시', async (ctx, R) => {
  const h = me(ctx); if (!h) return;
  if (!faceUpIdx(h, isA).length && !faceUpIdx(h, isB).length) return;
  if (!(await ask(ctx, '이 디지몬의 진화원에서 「그레이몬」/Ver.1 카드와 「가루몬」/Ver.2 카드를 코스트 없이 등장시킬까요?'))) return;
  let a = faceUpIdx(h, isA), b = faceUpIdx(h, isB);
  // a card matching both criteria must not steal the only slot of the other criterion
  const soleB = b.length === 1 ? b[0] : null, soleA = a.length === 1 ? a[0] : null;
  if (soleB != null && a.length > 1) a = a.filter(i => i !== soleB);
  if (soleA != null && b.length > 1) b = b.filter(i => i !== soleA);
  let played = 0;
  if (a.length) {
    const st = await playSourceAt(ctx, h, a, '등장시킬 「그레이몬」/Ver.1 카드 선택'); if (st) played++;
    b = faceUpIdx(h, isB); // indexes shifted
  }
  if (b.length && (played === 0 || faceUpIdx(h, isB).length)) {
    const st = await playSourceAt(ctx, h, faceUpIdx(h, isB), '등장시킬 「가루몬」/Ver.2 카드 선택'); if (st) played++;
  }
  if (played) await R.runOne({ op: 's13_selfTo', dest: 'security' }, ctx);
});

// BT22-007 (마더 이터) [육성]【자신의 메인 페이즈 개시 시】 (official Q&A 4859/4860): with 10+ evolution cards, play 「마더 이터」 from them as many as possible up to 3
// (2 present -> both; 3 present -> all three, not two). Previously required 3 to be present.
sc('BT22-007::자신의 메인 페이즈 개시 시', async (ctx) => {
  const { state } = ctx, p = ctx.self, pl = state.players[p], h = me(ctx); if (!h) return;
  const top = pl.digitamaDeck[0];
  if (top) { log(ctx, `${p} 디지타마 덱 맨 위 확인: ${C(top).nameKo}`); if (C(top).nameKo === '마더 이터' && (await ask(ctx, '디지타마 덱 맨 위의 「마더 이터」를 이 디지몬의 진화원 위에 놓을까요?'))) { pl.digitamaDeck.shift(); h.sources.push(top); S.recomputeStackGrants(h); } }
  const isMother = (c) => c.nameKo === '마더 이터';
  const n = Math.min(3, faceUpIdx(h, isMother).length);
  if (h.sources.length < 10 || n < 1) return;
  if (!(await ask(ctx, `진화원의 「마더 이터」 ${n}장을 코스트 없이 등장시킬까요?`))) return;
  for (let i = 0; i < n; i++) await playSourceAt(ctx, h, faceUpIdx(h, isMother), `등장시킬 「마더 이터」 선택 (${i + 1}/${n})`);
});

// P-142 팔코몬 【등장 시】 (official Q&A 4249): rest a Lv.6-or-lower opp digimon; then, by placing this digimon under an own 「레이브몬」-named digimon, THAT digimon may attack an opp digimon
// (a rested digimon cannot attack). Previously the second sentence was left as a manual note.
sc('P-142::등장 시', async (ctx, R) => {
  const { state } = ctx, p = ctx.self, pl = state.players[p], h = me(ctx);
  await R.runScript(R.compileToScript('Lv.6 이하의 상대의 디지몬 1마리를 레스트시킨다.'), ctx);
  if (!h || !pl.battle.includes(h)) return;
  const cands = pl.battle.filter(s => s !== h && C(s.cardId).category === 'digimon' && C(s.cardId).nameKo.includes('레이브몬'));
  if (!cands.length) return;
  if (!(await ask(ctx, '이 디지몬을 「레이브몬」을 포함하는 자신의 디지몬의 진화원 아래에 놓고, 그 디지몬으로 어택할까요?'))) return;
  const uid = await ctx.choose('pickStack', { player: p, uids: cands.map(s => s.uid), prompt: '진화원 아래에 놓을 대상 「레이브몬」 선택' });
  const t = cands.find(s => s.uid === uid); if (!t) return;
  pl.battle.splice(pl.battle.indexOf(h), 1);
  const rest = [...h.sources, ...(h.linkCards || []).map(l => l.cardId)].filter(id => !C(id).isToken);
  pl.trash.push(...rest);
  if (!C(h.cardId).isToken) t.sources.splice(S.fdCount(t), 0, h.cardId);
  S.recomputeStackGrants(t);
  log(ctx, `${p} ${C(h.cardId).nameKo}을(를) ${C(t.cardId).nameKo}의 진화원 아래에 놓음`);
  if (!t.suspended && ctx.startAttack) ctx.startAttack(p, t.uid);
});

// P-033 샌드리자몬 【자신의 턴】 (official Q&A 4145): every own BLACK digimon whose DP is 13000+ gets 《관통》 — evaluated live (the DP can cross the threshold mid-attack). No hook existed.
(HOOKS['P-033'] ||= []).push({
  tag: '자신의 턴', src: 'effectKo', has: 'DP 13000 이상의 자신의 디지몬 전부는',
  grantKw: (state, hp, holder, target) => {
    if (!state.players[hp].battle.includes(target) || C(target.cardId).category !== 'digimon') return [];
    if (!S.stackColors(target).includes('black')) return [];
    return S.condFix('p033|' + target.uid, () => S.effectiveDP(state, hp, target) >= 13000) ? ['관통'] : [];
  },
});
// P-033 진화원 효과 (official Q&A 4146): while an evolution source, its own holder gets 《시큐리티 어택 +1》 whenever
// THAT digimon is black with DP 13000+ (evaluated live, same threshold family as the own-effect grant above). This is
// "<색>인 DP N 이상인 동안" — a combined color+DP condition contGrantCond()/parseContGrants() can't parse (only bare
// "DP N 이상의 이 디지몬은" or bare color/name/trait conditions), so the generic continuous-grant scanner silently
// dropped this line and the inherited ability granted nothing at all.
(HOOKS['P-033'] ||= []).push({
  tag: '자신의 턴', src: 'inheritedKo', has: 'DP 13000 이상인 동안, 이 디지몬은',
  kwNum: (state, hp, holder) => {
    if (!holder || C(holder.cardId).category !== 'digimon') return 0;
    if (!S.stackColors(holder).includes('black')) return 0;
    return S.condFix('p033inh|' + holder.uid, () => S.effectiveDP(state, hp, holder) >= 13000) ? 1 : 0;
  },
});

// ---- shared helpers for "place a digimon/tamer of either side into a security stack" costs
const digsOf = (state, p) => state.players[p].battle.filter(s => C(s.cardId).category === 'digimon');
function detachToTrash(state, p, st) { // the stack leaves the battle area; its evolution/link cards go to the trash, the top card is returned
  const pl = state.players[p], i = pl.battle.indexOf(st); if (i === -1) return null;
  pl.battle.splice(i, 1);
  pl.trash.push(...st.sources, ...(st.linkCards || []).map(l => l.cardId));
  S.applyOverflowBatch(state, p, [...st.sources, st.cardId]);
  return st.cardId;
}
async function pickAnySide(ctx, entries, prompt) { return entries.length ? ctx.choose('pickStackAnySide', { entries, prompt }) : null; }
function toSecurity(state, owner, cardId, pos) { if (!C(cardId).isToken) S.addToSecurity(state, owner, cardId, pos); }

// EX9-056 하이안드로몬 【등장 시】【진화 시】 (official Q&A 4813): "DP 8000 이하의 디지몬 1마리를 시큐리티 아래에 놓는 것으로, 상대의 시큐리티를 위에서부터 1장 파기한다." — the digimon may be
// EITHER side's (put under its owner's security); this cost used to be a manual "did you pay?" prompt.
const ex9056 = async (ctx) => {
  const { state } = ctx, me = ctx.self;
  const entries = [];
  for (const p of ['p1', 'p2']) for (const s of digsOf(state, p)) if (S.effectiveDP(state, p, s) <= 8000) entries.push({ player: p, uid: s.uid });
  if (!entries.length) return;
  if (!(await ask(ctx, '「DP 8000 이하의 디지몬 1마리를 시큐리티 아래에 놓는 것으로」 상대의 시큐리티를 위에서부터 1장 파기 — 발휘할까요?'))) return;
  const pick = await pickAnySide(ctx, entries, '시큐리티 아래에 놓을 디지몬 선택 (DP 8000 이하)');
  if (!pick) return;
  const t = stacksOf(state, pick.player).find(s => s.uid === pick.uid); if (!t) return;
  const top = detachToTrash(state, pick.player, t); if (top == null) return;
  toSecurity(state, pick.player, top, 'bottom');
  log(ctx, `${pick.player} ${C(top).nameKo}을(를) 시큐리티 아래에 놓음`);
  S.trashTopSecurityByEffect(state, ctx.opp);
};
sc('EX9-056::등장 시', ex9056); sc('EX9-056::진화 시', ex9056);

// P-187 마스테몬 【진화 시】 (1st sentence block, Q&A 4631/4632): 《리커버리 +1《덱》》 always; then, if it evolved by Jogress, place ANOTHER digimon/tamer (either side) on top of or under its owner's
// security to trash the top card of the opponent's security.
SCRIPTS['P-187::진화 시@리커버리'] = [fn(async (ctx, R) => {
  const { state } = ctx, h = me(ctx);
  await R.runScript(R.compileToScript('《리커버리 +1《덱》》.'), ctx);
  const fused = ctx.trigger && ctx.trigger.evtSnap ? !!ctx.trigger.evtSnap.viaFusion : !!(h && h.viaFusion);
  if (!fused) return;
  const entries = [];
  for (const p of ['p1', 'p2']) for (const s of state.players[p].battle) if (s !== h && ['digimon', 'tamer'].includes(C(s.cardId).category)) entries.push({ player: p, uid: s.uid });
  if (!entries.length) return;
  if (!(await ask(ctx, '다른 디지몬/테이머 1장을 시큐리티의 위나 아래에 놓는 것으로 상대의 시큐리티를 위에서부터 1장 파기 — 발휘할까요?'))) return;
  const pick = await pickAnySide(ctx, entries, '시큐리티에 놓을 다른 디지몬/테이머 선택');
  if (!pick) return;
  const t = stacksOf(state, pick.player).find(s => s.uid === pick.uid); if (!t) return;
  const k = await ctx.choose('multipleChoice', { prompt: '시큐리티의 위/아래 선택', options: ['위', '아래'] });
  const top = detachToTrash(state, pick.player, t); if (top == null) return;
  toSecurity(state, pick.player, top, k === 1 ? 'bottom' : 'top');
  S.trashTopSecurityByEffect(state, ctx.opp);
})];
