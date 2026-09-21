// Shard 20 — generic "manual fallback" replacements (docs/manual-effects.md) + per-card scripts.
// OPS   ops emitted by the compiler's cost/effect patterns (effects.js compileCostClause) and used by SCRIPTS below.
//       Cost-op protocol: an op used as a costGroup cost sets instr._paid = false at the start and true once it fully paid; an optional
//       OPS['<op>$payable'](instr, ctx, helpers) tells costGroupPayable(...) whether the cost can be paid at all right now (15-7-3).
// state.js is imported lazily (only used inside functions) because state.js imports cards/index.js.
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

const C = (id) => S.card(id);
const stacksOf = (state, p) => [state.players[p].raising, ...state.players[p].battle].filter(Boolean);
const meOf = (ctx) => stacksOf(ctx.state, ctx.self).find(s => s.uid === ctx.sourceStackUid) || null;

// move a whole stack under another stack's sources (bottom, above the face-down block); its own sources/cards go along
function putStackUnder(state, p, moving, target) {
  const pl = state.players[p];
  const i = pl.battle.indexOf(moving);
  if (i >= 0) pl.battle.splice(i, 1);
  else if (pl.raising === moving) pl.raising = null;
  pl.trash.push(...(moving.linkCards || []).map(l => l.cardId));
  target.sources.splice(S.fdCount(target), 0, ...moving.sources, moving.cardId);
  S.recomputeStackGrants(target);
  S.log(state, `${p} ${C(moving.cardId).nameKo}을(를) ${C(target.cardId).nameKo}의 진화원 아래에 놓음`);
}
async function pickOne(ctx, cands, prompt) {
  if (!cands.length) return null;
  if (cands.length === 1) return cands[0];
  const uid = await ctx.choose('pickStack', { player: ctx.self, uids: cands.map(s => s.uid), prompt });
  return cands.find(s => s.uid === uid) || null;
}

// stackMove { mode, filter?, excludeSelf? }
//   'otherUnderThis'   "<조건> 다른 자신의 디지몬 1마리를 이 디지몬의 진화원 아래에 놓는다"
//   'thisUnderOther'   "이 디지몬(테이머)을 <조건> 자신의 (다른) 디지몬 1마리의 진화원 아래에 놓는다"
//   'sourcesUnderTamer' "이 디지몬의 진화원 전부를 자신의 테이머 1명의 아래에 놓는다"
function stackMoveCands(instr, ctx, H) {
  const me = meOf(ctx);
  if (!me) return { me, cands: [] };
  if (instr.mode === 'otherUnderThis') return { me, cands: H.candidateStacks(ctx, ctx.self, { filter: instr.filter, excludeSelf: true }).filter(s => s !== me && C(s.cardId).category === 'digimon') };
  if (instr.mode === 'thisUnderOther') return { me, cands: H.candidateStacks(ctx, ctx.self, { filter: instr.filter, excludeSelf: true, anyKind: !!instr.anyKind }).filter(s => s !== me) };
  if (instr.mode === 'sourcesUnderTamer') return { me, cands: me.sources.length ? stacksOf(ctx.state, ctx.self).filter(s => s !== me && C(s.cardId).category === 'tamer') : [] };
  return { me, cands: [] };
}
OPS.stackMove = async (instr, ctx, H) => {
  instr._paid = false;
  const { state } = ctx;
  const { me, cands } = stackMoveCands(instr, ctx, H);
  if (!me || !cands.length) { S.log(state, `${ctx.self} 진화원 아래에 놓을 대상이 없음`); return; }
  const t = await pickOne(ctx, cands, instr.prompt || '진화원 아래에 놓을 대상 선택');
  if (!t) return;
  if (instr.mode === 'thisUnderOther') ctx._lastPick = { player: ctx.self, uid: t.uid }; // "그 디지몬…" (BT22-018): even when the target was auto-picked (single candidate)
  if (instr.mode === 'otherUnderThis') putStackUnder(state, ctx.self, t, me);
  else if (instr.mode === 'thisUnderOther') putStackUnder(state, ctx.self, me, t);
  else { // sources -> under the chosen Tamer
    const moved = me.sources.splice(0, me.sources.length); me.s5fd = 0;
    t.sources.splice(S.fdCount(t), 0, ...moved);
    S.recomputeStackGrants(me); S.recomputeStackGrants(t);
    S.log(state, `${ctx.self} ${C(me.cardId).nameKo}의 진화원 ${moved.length}장을 ${C(t.cardId).nameKo} 아래에 놓음`);
  }
  instr._paid = true;
};
OPS['stackMove$payable'] = (instr, ctx, H) => stackMoveCands(instr, ctx, H).cands.length > 0;

// trashFaceDown { target:'this'|'ownDigimon'|'ownTamer', n }   "이 디지몬의 뒷면의 진화원(자신의 테이머 아래의 뒷면 카드)을 아래에서부터 N장 파기한다"
function fdHolders(instr, ctx) {
  const me = meOf(ctx), n = instr.n || 1;
  if (instr.target === 'this') return me && me.sources.length >= n && S.fdCount(me) >= n ? [me] : [];
  const cat = instr.target === 'ownTamer' ? 'tamer' : 'digimon';
  return stacksOf(ctx.state, ctx.self).filter(s => C(s.cardId).category === cat && (cat === 'tamer' ? s.sources.length >= n : S.fdCount(s) >= n));
}
OPS.trashFaceDown = async (instr, ctx) => {
  instr._paid = false;
  const n = instr.n || 1;
  if (instr.target === 'ownTamer' && n > 1) { // r2 (Q6212): the N cards may come from several tamers (total N), one card per pick
    const held = () => stacksOf(ctx.state, ctx.self).filter(s => C(s.cardId).category === 'tamer' && s.sources.length >= 1);
    if (held().reduce((a, t) => a + t.sources.length, 0) < n) { S.log(ctx.state, `${ctx.self} 파기할 뒷면의 카드가 부족함`); return; }
    for (let k = 0; k < n; k++) { const h = held(); const t = h.length === 1 ? h[0] : await pickOne(ctx, h, '뒷면의 카드를 파기할 테이머 선택'); if (!t) return; S.trashEvoSources(ctx.state, ctx.self, t.uid, 1, 'bottom'); }
    instr._paid = true; return;
  }
  const hs = fdHolders(instr, ctx);
  const st = await pickOne(ctx, hs, '뒷면의 카드를 파기할 대상 선택');
  if (!st) { S.log(ctx.state, `${ctx.self} 파기할 뒷면의 카드가 부족함`); return; }
  const out = S.trashEvoSources(ctx.state, ctx.self, st.uid, n, 'bottom') || []; // b9: via the real trasher so 'sourcesTrashed' (BT26-002/048/094 …) and the face-down bookkeeping fire
  S.log(ctx.state, `${ctx.self} ${C(st.cardId).nameKo}의 뒷면 카드 ${out.length}장을 아래에서부터 파기`);
  instr._paid = true;
};
OPS['trashFaceDown$payable'] = (instr, ctx) => (instr.target === 'ownTamer' && (instr.n || 1) > 1) ? stacksOf(ctx.state, ctx.self).filter(s => C(s.cardId).category === 'tamer').reduce((a, t) => a + t.sources.length, 0) >= instr.n : fdHolders(instr, ctx).length > 0;

// trashLink { n, target?:'own' }  "이 디지몬의(자신의 디지몬의) 링크 카드 N장을 파기한다"
function linkHolders(instr, ctx) {
  const n = instr.n || 1;
  if (instr.target === 'own') return stacksOf(ctx.state, ctx.self).filter(s => C(s.cardId).category === 'digimon' && (s.linkCards || []).length >= n);
  const me = meOf(ctx);
  return me && (me.linkCards || []).length >= n ? [me] : [];
}
OPS.trashLink = async (instr, ctx) => {
  instr._paid = false;
  const n = instr.n || 1;
  const me = await pickOne(ctx, linkHolders(instr, ctx), '링크 카드를 파기할 디지몬 선택');
  if (!me) return;
  for (let i = 0; i < n; i++) { const lc = me.linkCards.pop(); ctx.state.players[ctx.self].trash.push(lc.cardId); S.log(ctx.state, `${ctx.self} ${C(me.cardId).nameKo}의 링크 카드 ${C(lc.cardId).nameKo} 파기`); S.recomputeStackGrants(me); S.emitGameEvent(ctx.state, 'linkDiscarded', { owner: ctx.self, stack: me, cause: 'effect', cardId: lc.cardId }); } // b12: "링크 카드가 효과로 파기되었을 때" watchers (EX10-001/030/043/073 …)
  S.recomputeStackGrants(me);
  instr._paid = true;
};
OPS['trashLink$payable'] = (instr, ctx) => linkHolders(instr, ctx).length > 0;

// trashSecurityTo { n }  "자신의 시큐리티를 N장이 될 때까지 위에서부터 파기한다" (already at or below N: nothing to discard, the cost counts as paid)
OPS.trashSecurityTo = async (instr, ctx) => {
  const pl = ctx.state.players[ctx.self];
  let dropped = 0;
  while (pl.security.length > instr.n) { if (!S.trashTopSecurityByEffect(ctx.state, ctx.self)) break; dropped++; }
  ctx._moveEachN = dropped; // "파기한 시큐리티 1장당 …" (BT6-033)
  instr._paid = pl.security.length <= instr.n;
};

// rotateSource { n, condFilter? }  "(<특징>을 가진) 이 디지몬에 겹쳐져 있는 카드를 위에서부터 N장 이 디지몬의 진화원 아래에 놓는다": the top-most face-up source(s) move to the bottom of the sources
function rotatable(instr, ctx, H) {
  const me = meOf(ctx);
  if (!me) return null;
  if (instr.condFilter && !H.matchesFilter(S, me, instr.condFilter, ctx.state)) return null;
  return me.sources.length - S.fdCount(me) >= (instr.n || 1) ? me : null;
}
OPS.rotateSource = async (instr, ctx, H) => {
  instr._paid = false;
  const me = rotatable(instr, ctx, H);
  if (!me) { S.log(ctx.state, `${ctx.self} 진화원 아래로 옮길 겹쳐진 카드가 없음 (또는 조건 불충족)`); return; }
  // "이 디지몬에 겹쳐져 있는 카드를 위에서부터 N장 이 디지몬의 진화원 아래에 놓는다" = the TOP stacked card(s) (official English: "top stacked card as its bottom
  // digivolution card"): the current top card goes to the bottom of the sources and the next card becomes the Digimon.
  const moved = [];
  for (let i = 0; i < (instr.n || 1); i++) {
    if (me.sources.length - S.fdCount(me) < 1) break;
    const oldTop = me.cardId;
    me.cardId = me.sources.pop(); // top-most source = end of the array
    me.sources.splice(S.fdCount(me), 0, oldTop);
    S._s4.discardLinkCardsOnNewCard(ctx.state, ctx.self, me);
    moved.push(oldTop);
  }
  S.recomputeStackGrants(me);
  S._s4.ruleCheckDP(ctx.state, ctx.self, me);
  S.log(ctx.state, `${ctx.self} ${C(moved[0]).nameKo} 등 최상단 카드 ${moved.length}장을 진화원 아래로 이동 (현재 최상단 ${C(me.cardId).nameKo})`);
  instr._paid = true;
  S.emitGameEvent(ctx.state, 'sourceRotated', { owner: ctx.self, stack: me, cause: 'effect', moved }); // BT22-006 (shard38)
  S.emitGameEvent(ctx.state, 'topPlaced', { owner: ctx.self, stack: me, cause: 'effect' }); // EX5-001 (shard3)
  S.emitGameEvent(ctx.state, 'sourcesAdded', { owner: ctx.self, stack: me, cause: 'effect', added: moved, rotated: true, srcPlayer: ctx.self, srcCategory: 'digimon' }); // "진화원에 … 카드가 효과로 놓였을 때" (BT22-044 등)
};
OPS['rotateSource$payable'] = (instr, ctx, H) => !!rotatable(instr, ctx, H);

// secLook { action:'hand'|'play', optional, filter?, ifTaken:[ops], ifCard:[{filter, ops}] }
// "자신의 시큐리티를 전부 확인한다. 그중 <카드> 1장을 (오픈하고) 패에 추가 / 코스트를 지불하지 않고 등장" — the player looks at the whole security stack and takes one matching card.
OPS.secLook = async (instr, ctx, H) => {
  const { state } = ctx, pl = state.players[ctx.self];
  ctx._secTaken = false;
  S.log(state, `${ctx.self} 시큐리티 전부 확인: ${pl.security.map(id => C(id).nameKo).join(', ') || '(없음)'}`);
  const ids = pl.security.slice();
  const okAt = (i) => H.matchesFilter(S, ids[i], instr.filter) && (instr.action !== 'play' || ['digimon', 'tamer'].includes(C(ids[i]).category));
  const el = ids.map((_, i) => i).filter(okAt);
  if (!el.length) { S.log(state, `${ctx.self} 조건에 맞는 카드가 시큐리티에 없음`); return; }
  const sel = await ctx.choose('pickFromRevealed', { player: ctx.self, revealed: ids, eligible: el.map(i => ({ id: ids[i], i })), min: instr.optional ? 0 : 1, max: 1, prompt: instr.action === 'play' ? '시큐리티에서 코스트 없이 등장시킬 카드 선택' : '시큐리티에서 패에 추가할 카드 선택', ...(instr.optional ? {} : { required: true }) });
  const i = (sel || []).find(x => el.includes(x));
  if (i == null) return;
  const id = ids[i];
  const at = pl.security.indexOf(id); // (identical copies are interchangeable; face-up bookkeeping is clamped by secFaceUpTake)
  if (at < 0) return;
  pl.security.splice(at, 1); S.secFaceUpTake(pl, id);
  if (instr.action === 'hand') { pl.hand.push(id); S.log(state, `${ctx.self} 시큐리티의 ${C(id).nameKo}을(를) 오픈하고 패에 추가`); }
  else { pl.trash.push(id); const st = S.playFreeFromZone(state, ctx.self, 'trash', pl.trash.length - 1, {}); if (!st) { ctx._secTaken = false; S.emitGameEvent(state, 'securityDecrease', { owner: ctx.self, stack: null, cause: 'effect' }); return; } }
  S.emitGameEvent(state, 'securityDecrease', { owner: ctx.self, stack: null, cause: 'effect' });
  ctx._secTaken = true;
  for (const b of instr.ifCard || []) if (H.matchesFilter(S, id, b.filter)) await H.runScript(b.ops, ctx);
  if ((instr.ifTaken || []).length) await H.runScript(instr.ifTaken, ctx);
};

// ---- 【상대의 턴】[턴에 1회] 상대의 디지몬이 어택했을 때, 다른 자신의 디지몬 1마리를 소멸시키는 것으로, 그 어택을 종료한다. (진화원 효과: EX6-045/048, EX7-052/054, EX9-024/027)
// A defender-side reaction offered in the redirect-timing panel (main.js: opt.pay(...) then opt.endsAttack -> endAttack()).
for (const id of ['EX6-045', 'EX6-048', 'EX7-052', 'EX7-054', 'EX9-024', 'EX9-027']) {
  (HOOKS[id] ||= []).push({
    tag: '상대의 턴', has: '어택을 종료', src: 'inheritedKo',
    redirectOptions: (s, hp, h) => {
      const k = S.onceLimitKey(id, ['s20end']);
      const others = s.players[hp].battle.filter(x => x !== h && C(x.cardId).category === 'digimon');
      if (!others.length || S.turnUsesRemaining(h, k, 1) <= 0) return [];
      return [{ endsAttack: true, label: `${C(h.cardId).nameKo}: 다른 자신의 디지몬 1마리를 소멸시키고 어택 종료`, pay: async (choose) => {
        const cands = s.players[hp].battle.filter(x => x !== h && C(x.cardId).category === 'digimon');
        if (!cands.length) return false;
        const uid = await choose('pickStack', { player: hp, uids: cands.map(x => x.uid), prompt: '소멸시킬 다른 자신의 디지몬 선택' });
        if (!uid) return false;
        S.markTurnEffectUsed(h, k);
        S.deleteStack(s, hp, uid, 'trash', 'ownEffect');
        return !s.players[hp].battle.some(x => x.uid === uid); // slice3 r2 (Q3772/3782/3858/3861): 「~시키는 것으로」 — when the digimon was not really deleted the attack is not ended
      } }];
    },
  });
}

// deckTopToSources { n }  "자신의 덱 위에서부터 N장을 이 디지몬의 진화원 아래에 뒷면으로 놓는다" (EX9-009 …)
OPS.deckTopToSources = async (instr, ctx) => {
  instr._paid = false;
  const me = meOf(ctx), pl = ctx.state.players[ctx.self], n = instr.n || 1;
  if (!me || pl.deck.length < n) return;
  for (let i = 0; i < n; i++) { me.sources.unshift(pl.deck.shift()); me.s5fd = S.fdCount(me) + 1; me.s5fdFlag = true; }
  S.recomputeStackGrants(me);
  S.log(ctx.state, `${ctx.self} 덱 위 ${n}장을 ${C(me.cardId).nameKo}의 진화원 아래에 뒷면으로 놓음`);
  S.emitGameEvent(ctx.state, 'faceDownSource', { owner: ctx.self, stack: me, cause: null });
  instr._paid = true;
};
OPS['deckTopToSources$payable'] = (instr, ctx) => !!meOf(ctx) && ctx.state.players[ctx.self].deck.length >= (instr.n || 1);
