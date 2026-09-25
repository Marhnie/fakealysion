// Shard 38 — batch-8 verification fixes (BT22-/BT23-/BT24- cards). See docs/verify-sets-BT22-24.md.
import * as S from '../state.js';

export const SCRIPTS = {}; export const OPS = {}; export const HOOKS = {};

const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
const C = (id) => S.card(id);
const stacksOf = (state, p) => [state.players[p].raising, ...state.players[p].battle].filter(Boolean);
const findStack = (state, p, uid) => stacksOf(state, p).find((s) => s.uid === uid) || null;
const me = (ctx) => findStack(ctx.state, ctx.self, ctx.sourceStackUid);
const fn = (f) => ({ op: 's38_fn', fn: f });
OPS.s38_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
const sc = (key, f) => { SCRIPTS[key] = [fn(f)]; };
// The HK path queues the WHOLE printed body ("<trigger clause>, <effect>") and the generic compiler drops a condition that follows the lead clause
// ("이 디지몬이 링크했을 때, 자신의 테이머가 1명 이하라면, …"), so every event hook compiles only the effect part (after the first "…때,").
const stripLead = (t) => { const m = String(t).match(/^[^]*?(?:했을|되었을|놓였을|늘어났을|줄어들었을|벗어날|소멸할|가\s*되었을)\s*때,\s*([^]*)$/); return m ? m[1] : t; };
const hk = (id, d) => {
  (HOOKS[id] ||= []).push(d);
  if ((d.events || d.onLeave) && d.has && !d.noAuto && !d.zone) SCRIPTS[`${id}::${d.tag}@${d.has}`] = [fn(async (ctx, R) => { await R.runScript(R.compileToScript(stripLead(ctx.trigger?.text || '')), ctx); })];
};
const hasT = (id, ...ts) => (C(id).types || []).some((t) => ts.includes(t));
const typeInc = (id, ...ts) => (C(id).types || []).some((t) => ts.some((x) => t.includes(x)));
const confirm = async (ctx, prompt) => !!(await ctx.choose('confirmEffect', { player: ctx.self, prompt }));
const evtOf = (ctx) => ctx.trigger?.evt || null;

// ---- shared event predicates
const onSelfLinked = (state, hp, holder, info) => info.stack === holder && info.owner === hp;
const onSelfSrcAdded = (pred) => (state, hp, holder, info) => info.stack === holder && info.owner === hp && (info.added || []).some((id) => pred(id));

// =====================================================================================================================
// A. "…했을 때" watchers the generic parsers reject (verified: parseWatcherTrigger / parseEventWatcher return null for these)
// =====================================================================================================================
// BT22-001 (inherited): 이 디지몬의 진화원에 특징으로 「수생」을 포함하는 디지몬 카드가 효과로 놓였을 때, 《1 드로우》.
hk('BT22-001', { tag: '자신의 턴', src: 'inheritedKo', has: '진화원에 특징으로 「수생」', limit: 1, events: { sourcesAdded: onSelfSrcAdded((id) => C(id).category === 'digimon' && typeInc(id, '수생')) } });
// BT22-044 / BT22-054 (effect text): 이 디지몬의 진화원에 특징 「CS」를 가진 디지몬 카드가 효과로 놓였을 때, …
for (const id of ['BT22-044', 'BT22-054']) hk(id, { tag: '자신의 턴', has: '진화원에 특징 「CS」를 가진 디지몬 카드가 효과로', limit: 1, events: { sourcesAdded: onSelfSrcAdded((x) => C(x).category === 'digimon' && hasT(x, 'CS')) } });
// BT22-027: 【서로의 턴】[턴 1회] 이 디지몬의 진화원이 효과로 늘어났을 때 (either player's effect)
hk('BT22-027', { tag: '서로의 턴', has: '진화원이 효과로 늘어났을 때', limit: 1, events: { sourcesAdded: (state, hp, h, info) => info.stack === h && info.owner === hp && !info.rotated } }); // (순환은 진화원 수가 늘지 않는다)
// BT22-006 (inherited): 이 디지몬에 겹쳐져 있는 카드가 위에서부터 1장 이 디지몬의 진화원 아래에 효과로 놓였을 때 (shard20 rotateSource emits 'sourceRotated')
hk('BT22-006', { tag: '자신의 턴', src: 'inheritedKo', has: '진화원 아래에 효과로 놓였을 때', limit: 1, events: { sourceRotated: (state, hp, h, info) => info.stack === h && info.owner === hp } });
// "이 디지몬이 링크했을 때" (【자신의 턴】[턴 1회])
for (const [id, src] of [['BT22-003', 'inheritedKo'], ['BT24-006', 'inheritedKo'], ['BT22-033', 'effectKo'], ['BT23-009', 'effectKo'], ['BT23-016', 'effectKo'], ['BT23-033', 'effectKo'], ['BT24-067', 'effectKo']]) hk(id, { tag: '자신의 턴', src, has: '이 디지몬이 링크했을 때', limit: 1, events: { linked: onSelfLinked } });

// =====================================================================================================================
// B. event watchers with bespoke handling
// =====================================================================================================================
// run one of this card's own 【진화 시】 effects (BT22-040 / BT22-042 "이 디지몬의 【진화 시】 효과 1개를 발휘할 수 있다")
async function borrowEvoEffect(ctx, R, cardId) {
  const segs = S.parseEffectSegments(C(cardId).effectKo || '').segments.filter((sg) => sg.tags.some((t) => t.includes('진화 시')));
  if (!segs.length) return false;
  let seg = segs[0];
  if (segs.length > 1) { const k = await ctx.choose('multipleChoice', { prompt: '발휘할 【진화 시】 효과 선택', options: segs.map((sg) => sg.body.replace(/\n/g, ' ').slice(0, 60)) }); if (k == null) return false; seg = segs[k] || segs[0]; }
  const text = seg.body.replace(/^[\[〔]턴\s*에?\s*\d+\s*회[\]〕]\s*/, '');
  const script = R.lookupCardSpecific(cardId, seg.tags, text) || R.compileToScript(text);
  if (!script || !script.length) return false;
  await R.runScript(script, { ...ctx, sourceCardId: cardId });
  return true;
}
const ownOtherDeleted = (state, hp, h, info) => info.owner === hp && !!info.stack && info.stack !== h && C(info.stack.cardId).category === 'digimon';
for (const id of ['BT22-040', 'BT22-042']) {
  hk(id, { tag: '서로의 턴', has: '진화 시】 효과 1개를 발휘', limit: 1, events: { delete: ownOtherDeleted } });
  sc(`${id}::서로의 턴@진화 시】 효과 1개를 발휘`, async (ctx, R) => {
    const h = me(ctx); if (!h) return;
    if (!(await confirm(ctx, `${C(h.cardId).nameKo}의 【진화 시】 효과 1개를 발휘할까요?`))) return;
    await borrowEvoEffect(ctx, R, h.cardId);
  });
}
// BT22-002 (inherited): 자신의 토큰 또는 특징 「퍼펫형」을 가진 다른 자신의 디지몬이 소멸했을 때, 《1 드로우》.
hk('BT22-002', { tag: '자신의 턴', src: 'inheritedKo', has: '퍼펫형」을 가진 다른 자신의 디지몬이 소멸했을 때', limit: 1, events: { delete: (state, hp, h, info) => info.owner === hp && !!info.stack && info.stack !== h && (!!C(info.stack.cardId).isToken || hasT(info.stack.cardId, '퍼펫형')) } });
// BT22-052: 【서로의 턴】[턴 1회] 다른 자신의 디지몬이 배틀 에어리어를 벗어날 때, 메모리 +2.
hk('BT22-052', { tag: '서로의 턴', has: '다른 자신의 디지몬이 배틀 에어리어를 벗어날 때', limit: 1, events: { leaveBattle: (state, hp, h, info) => info.owner === hp && !!info.stack && info.stack !== h && C(info.stack.cardId).category === 'digimon' } });
// BT23-069: 【서로의 턴】 다른 디지몬이 어택했을 때 (either side's attack)
hk('BT23-069', { tag: '서로의 턴', has: '다른 디지몬이 어택했을 때', noAuto: true, events: { attack: (state, hp, h, info) => !!info.stack && info.stack !== h && C(info.stack.cardId).category === 'digimon' } });
// BT23-068: 【서로의 턴】[턴 1회] 자신의 디지몬이 트래시에서 진화했을 때
hk('BT23-068', { tag: '서로의 턴', has: '트래시에서 진화했을 때', limit: 1, events: { digivolve: (state, hp, h, info) => info.owner === hp && !!info.stack && info.stack.byEffect?.from === 'trash' } });
// BT24-064: 【서로의 턴】[턴에 1회] 디지몬/테이머가 레스트했을 때 (either player's)
hk('BT24-064', { tag: '서로의 턴', has: '디지몬/테이머가 레스트했을 때', limit: 1, events: { rest: (state, hp, h, info) => !!info.stack && ['digimon', 'tamer'].includes(C(info.stack.cardId).category) } });
// BT24-030: 【서로의 턴】[턴에 1회] 이 디지몬이 레스트가 되었을 때, 이 디지몬을 액티브로 할 수 있다.
hk('BT24-030', { tag: '서로의 턴', has: '이 디지몬이 레스트가 되었을 때', limit: 1, events: { rest: (state, hp, h, info) => info.stack === h } });

// =====================================================================================================================
// C. "이 디지몬이 (자신의 효과 이외로) 배틀 에어리어를 벗어날 때, 이 디지몬의 진화원/링크 카드에서 … 등장" — printed "벗어날 때" (prospective
//    tense) is 즉시형 (15-8-5-1), not 유발형: it must interrupt BEFORE the stack actually leaves, reading the still-live evolution
//    sources / link cards, and it must NOT by itself stop the leave (the leave still happens afterward — same "passive immediate
//    effect" shape as ≪머티리얼 세이브≫, see applyMaterialSave in state.js). Wired as a `preventLeaveOptions` candidate with
//    `passive: true` so it plugs into the SAME 18-2 replacement gate as ≪회피≫/≪방벽≫/etc: every eligible card is its own candidate,
//    the player may pick this ability, decline it, or (per official Q6250 for BT23-032/シャッコウモン) instead pick a genuine
//    "prevent leaving" candidate like ≪방벽≫ granted by an evolution source. Order matters exactly like the ruling describes: if the
//    player resolves THIS ability first and plays away the very source card that was granting ≪방벽≫, a fresh probe (see
//    resumeReplacement's post-passive re-run) correctly finds ≪방벽≫ no longer available. (The reverse — using ≪방벽≫ first and
//    STILL getting to use this ability afterward, per the full Q6250 answer — is not modelled: once a non-passive survive candidate
//    succeeds, deleteStackCore returns immediately and no further candidates for this stack are offered. See
//    docs/effect-classification-rules.md 후속 조치 for this known remaining gap.)
function leaveBonusOptions(listKey, pred, limit, causeOk) {
  return (state, hp, holder, target, tp, cause, mode, cid) => {
    if (!holder || target !== holder) return []; // "이 디지몬이 ~벗어날 때": only the holder's own leave
    if (causeOk && !causeOk(cause)) return [];
    const d = { tag: '서로의 턴', has: listKey === 'linkCards' ? '이 디지몬의 링크 카드' : '이 디지몬의 진화원' };
    if (limit != null && S.turnUsesRemaining(holder, S.onceLimitKey(cid, [d.tag, d.has]), limit) <= 0) return [];
    const list = listKey === 'linkCards'
      ? (holder.linkCards || []).map((l) => l.cardId)
      : holder.sources.filter((_, i) => i >= S.fdCount(holder));
    const seen = new Set(), out = [];
    for (const cardId of list) {
      if (seen.has(cardId) || !pred(cardId)) continue; // identical duplicate cards are the same choice
      seen.add(cardId);
      out.push({
        passive: true,
        apply() {
          if (limit != null && !S.hookUseOnce(holder, cid, d, limit)) return false;
          const pl = state.players[hp];
          if (listKey === 'linkCards') {
            const at = holder.linkCards.findIndex((l) => l.cardId === cardId);
            if (at < 0) return false;
            pl.trash.push(holder.linkCards.splice(at, 1)[0].cardId);
          } else {
            const at = holder.sources.lastIndexOf(cardId); // topmost matching source (identical duplicates are interchangeable)
            if (at < S.fdCount(holder)) return false;
            holder.sources.splice(at, 1);
            S.recomputeStackGrants(holder);
            pl.trash.push(cardId);
          }
          const st = S.playFreeFromZone(state, hp, 'trash', pl.trash.length - 1, { fromSources: true });
          if (st) S.log(state, `${hp} ${C(holder.cardId).nameKo} — 배틀 에어리어를 벗어나기 전, ${listKey === 'linkCards' ? '링크 카드' : '진화원'} ${C(cardId).nameKo}을(를) 코스트 없이 등장`);
          return !!st;
        },
      });
    }
    return out;
  };
}
const notOwnEffect = (cause) => cause !== 'ownEffect';
{ // BT23-023 / BT23-032: 자신의 효과 이외로 …, 이 디지몬의 진화원에서 Lv.4 이하의, 특징 「CS」를 가지거나 <색>인 디지몬 카드 1장 (both the card's own text and inherited copy)
  const cfg = { 'BT23-023': ['blue'], 'BT23-032': ['yellow', 'black'] };
  for (const [id, cols] of Object.entries(cfg)) {
    const pred = (x) => C(x).category === 'digimon' && (C(x).level ?? 99) <= 4 && (hasT(x, 'CS') || (C(x).colors || []).some((c) => cols.includes(c)));
    const opts = leaveBonusOptions('sources', pred, 1, notOwnEffect);
    for (const src of ['effectKo', 'inheritedKo']) hk(id, { tag: '서로의 턴', src, has: '자신의 효과 이외로 배틀 에어리어를 벗어날 때', preventLeaveOptions: opts });
  }
}
// BT22-081 / BT22-082: 【서로의 턴】 이 디지몬이 배틀 에어리어를 벗어날 때, 이 디지몬의 진화원에서 「…」 1장을 코스트를 지불하지 않고 등장시킬 수 있다.
for (const [id, nm] of [['BT22-081', '카미시로 유코'], ['BT22-082', '사나다 아라타']]) {
  hk(id, { tag: '서로의 턴', has: '이 디지몬이 배틀 에어리어를 벗어날 때', preventLeaveOptions: leaveBonusOptions('sources', (x) => S.cardNames(x).includes(nm), null, null) });
}
// BT22-075: 【서로의 턴】[턴 1회] 이 디지몬이 배틀 에어리어를 벗어날 때, 이 디지몬의 링크 카드 1장을 코스트를 지불하지 않고 등장시킬 수 있다.
hk('BT22-075', { tag: '서로의 턴', has: '이 디지몬이 배틀 에어리어를 벗어날 때', preventLeaveOptions: leaveBonusOptions('linkCards', (x) => C(x).category === 'digimon', 1, null) });

// =====================================================================================================================
// D. compile fixes (generic compile dropped a clause / mis-ordered / lost a "대신")
// =====================================================================================================================
// compile a printed text with the generic compiler, let `patch(script)` amend it, run it
const compiled = (text, patch) => async (ctx, R) => { const script = R.compileToScript(text); if (patch) patch(script); await R.runScript(script, ctx); };
OPS.s38_immuneLast = async (instr, ctx) => { const lp = ctx._lastPick; if (lp) S.grantBattleImmunity(ctx.state, lp.player, lp.uid); }; // "그 디지몬은 …배틀에서 소멸하지 않는다" (last picked stack)
OPS.s38_immuneThis = async (instr, ctx) => { const h = me(ctx); if (h) S.grantBattleImmunity(ctx.state, ctx.self, h.uid); };
// BT22-018 【등장 시】: …상대의 턴 종료까지 그 디지몬은 《블로커》를 얻고, 배틀에서 소멸하지 않는다 (generic dropped the 2nd clause)
sc('BT22-018::등장 시', compiled('이 디지몬을 특징으로 「수생」을 포함하는 다른 자신의 디지몬의 진화원 아래에 놓는 것으로, 상대의 턴 종료까지 그 디지몬은 《블로커》를 얻는다.', (s) => s[0].then.push({ op: 's38_immuneLast' })));
// BT24-028 【등장 시】【진화 시】: …이 디지몬은 《블로커》를 얻고, 배틀로는 소멸하지 않는다
sc('BT24-028::등장 시', compiled('자신의 패에서, 특징 「TS」를 가진 블루인 Lv.5 이하의 디지몬 카드 1장을 이 디지몬의 진화원 아래에 놓는 것으로, 상대의 턴 종료까지, 이 디지몬은 《블로커》를 얻는다.', (s) => s[0].then.push({ op: 's38_immuneThis' })));
// BT22-015 【진화 시】: 이 디지몬에 겹쳐져 있는 Lv.이 같은 카드 2장마다 상대의 디지몬 1마리를 덱 아래로 되돌린다. 그 후, 이 디지몬으로 어택할 수 있다.
const sameLvPairs = (st) => { const cnt = {}; for (const id of st.sources.slice(S.fdCount(st))) { const lv = C(id).level; if (lv != null) cnt[lv] = (cnt[lv] || 0) + 1; } return Object.values(cnt).reduce((a, v) => a + Math.floor(v / 2), 0); };
sc('BT22-015::진화 시', async (ctx, R) => {
  const h = me(ctx); if (!h) return;
  for (let i = 0, n = sameLvPairs(h); i < n; i++) await R.runOne({ op: 'returnToHandStripSources', target: 'opponent', n: 1, filter: {}, requireSuspended: null, dest: 'deckBottom' }, ctx);
  await R.runOne({ op: 'attackNow', who: 'self', thisStack: true }, ctx);
});
// BT22-034 【등장 시】【진화 시】: 상대의 디지몬 1마리를 DP -3000. 자신의 시큐리티를 위에서부터 1장 파기하는 것으로, 대신 …DP -6000 (replaces, not adds)
sc('BT22-034::등장 시', async (ctx, R) => {
  const pl = ctx.state.players[ctx.self];
  let amount = -3000;
  if (pl.security.length > 0 && (await confirm(ctx, '자신의 시큐리티를 위에서부터 1장 파기하여 DP -3000 대신 DP -6000으로 할까요?'))) { if (S.trashTopSecurityByEffect(ctx.state, ctx.self)) amount = -6000; }
  await R.runOne({ op: 'modifyDP', target: 'opponent', amount, duration: 'opponentTurn' }, ctx);
});
// BT22-074 【메인】[턴 1회]: 3 코스트 지불하는 것으로, Lv.5 이하 소멸. 소멸하지 않았다면 S 어택 +1. 또한 이 디지몬으로 어택할 수 있다. (all of it is behind the cost)
sc('BT22-074::메인', async (ctx, R) => {
  const then = [...R.compileToScript('Lv.5 이하의 상대의 디지몬 1마리를 소멸시킨다.'), ...R.compileToScript('이 효과로 소멸하지 않았다면, 턴 종료까지 이 디지몬은 《S 어택 +1》을 얻는다.'), { op: 'attackNow', who: 'self', thisStack: true }];
  await R.runOne({ op: 'costGroup', cost: [{ op: 'gainMemory', who: 'self', n: -3 }], then }, ctx);
});

// =====================================================================================================================
// E. printed "이 카드가 (패에서) 등장할 때, <조건>이라면, 지불하는 (등장) 코스트 -N" on the card itself (was not modelled: preamble of the 〔진화〕 line)
// =====================================================================================================================
const battleOf = (state, p) => state.players[p].battle;
const hasNamed = (state, p, ...names) => battleOf(state, p).some((s) => S.cardNames(s.cardId).some((n) => names.includes(n)));
const digCount = (state, p) => battleOf(state, p).filter((s) => C(s.cardId).category === 'digimon').length;
hk('BT23-015', { tag: '__handPlay', selfPlayDiscount: (state, hp) => (battleOf(state, hp).some((s) => C(s.cardId).category === 'tamer' && hasT(s.cardId, '잭슨')) ? -5 : 0) });
hk('BT23-031', { tag: '__handPlay', selfPlayDiscount: (state, hp) => (hasNamed(state, hp, '레이디데블몬', '미카구라 미레이') ? -3 : 0) });
hk('BT23-067', { tag: '__handPlay', selfPlayDiscount: (state, hp) => (hasNamed(state, hp, '엔젤우몬', '미카구라 미레이') ? -3 : 0) });
hk('BT24-030', { tag: '__handPlay', selfPlayDiscount: (state, hp) => (digCount(state, opp(hp)) >= 2 ? -5 : 0) });
hk('BT24-051', { tag: '__handPlay', selfPlayDiscount: (state, hp) => (digCount(state, 'p1') + digCount(state, 'p2') >= 3 ? -5 : 0) }); // "디지몬이 3마리 이상" (no side named: either side's Digimon)
// BT23-057: 자신의 트래시에서, 명칭에 「헉몬」/「시스터몬」/「제스몬」을 포함하는 카드 3장을 덱 위 또는 아래로만 되돌리는 것으로, 지불하는 코스트 -5 (optional, confirmed by the UI)
hk('BT23-057', { tag: '__handPlay', handPlayOption: (state, p, cardId) => {
  const pl = state.players[p];
  const ok = (id) => ['헉몬', '시스터몬', '제스몬'].some((n) => C(id).nameKo.includes(n));
  if (pl.trash.filter(ok).length < 3) return null;
  return { label: `${C(cardId).nameKo}: 트래시의 「헉몬」/「시스터몬」/「제스몬」 카드 3장을 덱 위 또는 아래로 되돌려 등장 코스트 -5?`, async apply(choose) {
    const pos = await choose('multipleChoice', { player: p, prompt: '덱 위 또는 아래?', options: ['덱 위', '덱 아래'] });
    const picked = [];
    for (let n = 0; n < 3; n++) {
      const idxs = pl.trash.map((id, i) => i).filter((i) => ok(pl.trash[i]));
      const i = await choose('pickFromZoneIndex', { player: p, zone: 'trash', eligibleIdxs: idxs, prompt: `덱으로 되돌릴 카드 선택 (${n + 1}/3)` });
      if (i == null) { pl.trash.push(...picked); return 0; } // aborted: nothing paid
      picked.push(pl.trash.splice(i, 1)[0]);
    }
    if (pos === 1) pl.deck.push(...picked); else pl.deck.unshift(...picked);
    S.log(state, `${p} 트래시의 ${picked.map((id) => C(id).nameKo).join(', ')}을(를) 덱 ${pos === 1 ? '아래' : '위'}로 되돌림`);
    return -5;
  } };
} });
// EX10-061 아포카리몬: 이 카드가 등장할 때, 자신의 시큐리티에서, 명칭이 서로 다른 특징 「어둠의 4천왕」을 가진 앞면의 카드 1장씩을 이 카드 아래에 놓는 것으로, 놓은 카드 1장마다, 지불하는 코스트 -4.
// (Q5783/5784: same "명칭이 서로 다른 것 1장씩" rule as its own 【등장 시】 효과 — with 2+ distinct names present, all of them must be placed together, no partial pick.)
hk('EX10-061', { tag: '__handPlay', handPlayOption: (state, p, cardId) => {
  const pl = state.players[p];
  const okC = (id) => C(id).category === 'digimon' && (C(id).types || []).includes('어둠의 4천왕');
  const byName = new Map();
  pl.security.forEach((id) => { if (okC(id) && (pl.secUp && pl.secUp[id]) > 0 && !byName.has(C(id).nameKo)) byName.set(C(id).nameKo, id); });
  if (!byName.size) return null;
  const ids = [...byName.values()];
  return { label: `${C(cardId).nameKo}: 시큐리티의 「어둠의 4천왕」(명칭이 서로 다른 것 ${ids.length}장)을 이 카드 아래에 놓고 등장 코스트 -${4 * ids.length}?`, apply: () => { state._s2PlayMat = ids.map((id) => ({ kind: 'security', cardId: id })); return -4 * ids.length; } };
} });

// =====================================================================================================================
// F. continuous "…자신의 디지몬 전부를 DP +N / 《키워드》를 얻는다" (generic parsers only cover "이 디지몬을 DP ±N"; the rest needs a per-card descriptor)
// =====================================================================================================================
const infoOf = (state, p, st) => S.effectiveInfo(state, st, p);
const ownDigi = (state, hp, tp, t) => tp === hp && C(t.cardId).category === 'digimon';
// BT22-084 (tamer): 【서로의 턴】 명칭에 「그레이몬」/「가루몬」/「오메가몬」을 포함하는 자신의 디지몬 전부를 DP +1000
hk('BT22-084', { tag: '서로의 턴', has: '전부를 DP +1000', dp: (state, hp, h, t, tp) => (ownDigi(state, hp, tp, t) && ['그레이몬', '가루몬', '오메가몬'].some((n) => infoOf(state, tp, t).nameHas(n)) ? 1000 : 0) });
// BT23-090 (tamer): 【서로의 턴】 특징 「후디에」를 가진 자신의 디지몬 전부를 DP +1000
hk('BT23-090', { tag: '서로의 턴', has: '전부를 DP +1000', dp: (state, hp, h, t, tp) => (ownDigi(state, hp, tp, t) && infoOf(state, tp, t).hasTrait('후디에') ? 1000 : 0) });
// BT23-038 / BT23-042: [시큐리티]【서로의 턴】 특징 「로얄 베이스」를 가진 자신의 디지몬 전부를 DP +1000 (acts from the security zone)
for (const id of ['BT23-038', 'BT23-042']) hk(id, { tag: '서로의 턴', zone: 'security', has: '전부를 DP +1000', dp: (state, hp, h, t, tp) => (ownDigi(state, hp, tp, t) && infoOf(state, tp, t).hasTrait('로얄 베이스') ? 1000 : 0) });
// BT24-051: 【자신의 턴】 특징 「일리아스」를 가진 자신의 디지몬 전부는 《속공》과 《관통》을 얻는다
hk('BT24-051', { tag: '자신의 턴', has: '전부는 《속공》과 《관통》', grantKw: (state, hp, h, t) => (C(t.cardId).category === 'digimon' && infoOf(state, hp, t).hasTrait('일리아스') ? ['속공', '관통'] : []) });
// BT24-072 (inherited): 【자신의 턴】 이 디지몬이 「타이타몬」이거나 특징으로 「타이탄족」을 가지는 동안, 이 디지몬은 《S 어택 +1》을 얻는다
hk('BT24-072', { tag: '자신의 턴', src: 'inheritedKo', has: '《S 어택 +1》', kwNum: (state, hp, h) => { const i = infoOf(state, hp, h); return i.nameIs('타이타몬') || i.traits.some((t) => t.includes('타이탄족')) ? 1 : 0; } });
// BT24-069: 【서로의 턴】 상대의 트래시가 10장 이상일 때, 이 디지몬은 《블로커》를 얻고, DP+2000
const trash10 = (state, hp) => state.players[opp(hp)].trash.length >= 10;
hk('BT24-069', { tag: '서로의 턴', has: '상대의 트래시가 10장이상일 때', kw: (state, hp, h, name) => name === '블로커' && trash10(state, hp), dp: (state, hp, h, t, tp) => (t === h && trash10(state, hp) ? 2000 : 0) });

// =====================================================================================================================
// G. effects whose printed condition / cost / target the generic compile dropped, plus event hooks the generic watcher refuses ("UNSAFE")
// =====================================================================================================================
const sameLvPair = (st) => sameLvPairs(st) >= 1;
// BT22-063 【서로의 턴】[턴 1회] 이 디지몬이 레스트했을 때, 이 디지몬의 진화원에 「쿠레미 쿄코」가 있거나, 이 디지몬에 Lv.이 같은 카드가 2장 이상 겹쳐져 있다면, 상대의 턴 종료까지 이 디지몬을 DP +3000. 그 후, 이 디지몬을 액티브로 한다.
sc('BT22-063::서로의 턴@쿠레미 쿄코」가 있거나', async (ctx, R) => {
  const h = me(ctx); if (!h) return;
  const kyoko = h.sources.slice(S.fdCount(h)).some((id) => S.cardNames(id).includes('쿠레미 쿄코'));
  if (!kyoko && !sameLvPair(h)) return;
  await R.runOne({ op: 'modifyDP', target: 'self', thisStack: true, amount: 3000, duration: 'opponentTurn' }, ctx);
  await R.runOne({ op: 'unsuspend', target: 'thisStack' }, ctx);
});
// BT23-035 【서로의 턴】[턴 1회] 자신의 시큐리티가 줄어들었을 때, … (multi-step text is "UNSAFE" for the generic watcher -> explicit hook)
hk('BT23-035', { tag: '서로의 턴', has: '자신의 시큐리티가 줄어들었을 때', limit: 1, events: { securityDecrease: (state, hp, h, info) => info.owner === hp } });
// BT24-022 (inherited) 【자신의 턴】[턴에 1회] 이 디지몬이 액티브가 되었을 때, 자신의 패가 7장 이하라면, 《1 드로우》
hk('BT24-022', { tag: '자신의 턴', src: 'inheritedKo', has: '이 디지몬이 액티브가 되었을 때', limit: 1, events: { active: (state, hp, h, info) => info.stack === h && info.owner === hp, unsuspend: (state, hp, h, info) => info.stack === h && info.owner === hp } });
// BT23-045 【서로의 턴】 이 디지몬이 레스트했을 때, 자신의 앞면의 시큐리티를 위에서부터 1장 뒷면으로 하는 것으로, 자신의 디지몬 1마리를 액티브로 한다.
sc('BT23-045::서로의 턴@앞면의 시큐리티를 위에서부터 1장 뒷면으로', async (ctx, R) => {
  const pl = ctx.state.players[ctx.self];
  const id = pl.security.find((x) => ((pl.secUp && pl.secUp[x]) || 0) > 0);
  if (id == null) return; // no face-up security card: the cost can't be paid
  if (!(await confirm(ctx, '자신의 앞면의 시큐리티를 위에서부터 1장 뒷면으로 하여 자신의 디지몬 1마리를 액티브로 할까요?'))) return;
  pl.secUp[id] -= 1;
  S.log(ctx.state, `${ctx.self} 앞면의 시큐리티 ${C(id).nameKo} 1장을 뒷면으로 함`);
  await R.runOne({ op: 'unsuspend', target: 'self', digimonOnly: true }, ctx);
});
// BT23-076 【자신의 턴】 이 디지몬이 레스트했을 때, 다른 자신의 디지몬 1마리를 패/트래시의 명칭에 「헉몬」을 포함하거나 특징 「로얄 나이츠」/「CS」를 가진 디지몬 카드로 지불하는 코스트 -1 하여 진화시킬 수 있다.
sc('BT23-076::자신의 턴@패/트래시의', async (ctx, R) => {
  const k = await ctx.choose('multipleChoice', { prompt: '진화시킬 카드를 가져올 곳 (패 / 트래시 / 하지 않음)', options: ['패', '트래시', '하지 않음'] });
  if (k !== 0 && k !== 1) return;
  await R.runOne({ op: 'evolveEffect', who: 'self', subject: { thisStack: false, other: true, desc: null, name: null }, zone: k === 0 ? 'hand' : 'trash',
    cardFilter: { category: 'digimon', anyOf: [{ nameAny: ['헉몬'] }, { traitAny: ['로얄 나이츠', 'CS'] }] }, cost: { mode: 'discount', n: 1 }, ignoreCond: false, ignoreLevel: false }, ctx);
});
// BT24-009 / 013 / 026 / 042 (inherited) 【자신의 턴】[턴에 1회] 자신의 패가 파기되었을 때, 특징 「귀인형」/「타이탄족」을 가진 이 디지몬을 트래시의 「타이타몬」이나 특징 「타이탄족」을 가진 디지몬 카드로 지불하는 (진화) 코스트 -1하여 진화시킬 수 있다.
for (const id of ['BT24-009', 'BT24-013', 'BT24-026', 'BT24-042']) sc(`${id}::자신의 턴@이 디지몬을 트래시의`, async (ctx, R) => {
  const h = me(ctx);
  if (!h || C(h.cardId).category !== 'digimon' || !S.effectiveInfo(ctx.state, h, ctx.self).traits.some((t) => t === '귀인형' || t === '타이탄족')) return;
  await R.runOne({ op: 'evolveEffect', who: 'self', subject: { thisStack: true }, zone: 'trash', cardFilter: { category: 'digimon', anyOf: [{ exactAny: ['타이타몬'] }, { traitAny: ['타이탄족'] }] }, cost: { mode: 'discount', n: 1 }, ignoreCond: false, ignoreLevel: false }, ctx);
});
// BT24-082 (tamer) 【자신의 턴】 자신의 디지몬이 특징 「파충류형」/「용인형」을 가진 디지몬으로 진화했을 때, 이 테이머를 레스트시키는 것으로, 턴 종료까지 그 디지몬을 DP +3000. 그 후, 그 디지몬으로 어택할 수 있다.
OPS.s38_attackEvt = async (instr, ctx) => {
  const uid = ctx.trigger?.evtStackUid; const st = uid && ctx.state.players[ctx.self].battle.find((x) => x.uid === uid);
  if (!st || st.suspended) return;
  if (ctx.startAttack) ctx.startAttack(ctx.self, uid);
};
// (the watcher already rested the Tamer as the cost and passes only "턴 종료까지 그 디지몬을 DP +3000. 그 후, …")
sc('BT24-082::자신의 턴@그 디지몬을 DP +3000', async (ctx, R) => {
  await R.runOne({ op: 'modifyDP', target: 'self', last: true, amount: 3000, duration: 'turn' }, ctx);
  await R.runOne({ op: 's38_attackEvt' }, ctx);
});
// BT22-039 【서로의 턴】[턴 1회] 자신의 디지몬이 등장했을 때, 이 디지몬의 진화원에서 특징 「어플몬」을 가진 디지몬 카드 1장을 자신의 디지몬 1마리에게 코스트를 지불하지 않고 링크할 수 있다.
const linkCondOf = (id) => { const m = (C(id).inheritedKo || '').match(/링크\s*(?:[:：]|〉)\s*(.+?)\s*[:：]\s*코스트\s*(\d+)/); return m ? m[1].trim() : null; };
sc('BT22-039::서로의 턴@진화원에서 특징 「어플몬」을 가진 디지몬 카드 1장을 자신의 디지몬 1마리에게', async (ctx) => {
  const { state } = ctx, p = ctx.self, pl = state.players[p], h = me(ctx); if (!h) return;
  const fd = S.fdCount(h);
  const cands = h.sources.map((id, i) => ({ id, i })).filter((x) => x.i >= fd && C(x.id).category === 'digimon' && hasT(x.id, '어플몬') && linkCondOf(x.id) != null);
  const hosts = (id) => pl.battle.filter((s) => C(s.cardId).category === 'digimon' && (() => { const pr = S.cardDescPredicate(linkCondOf(id)); return !pr || pr(C(s.cardId)); })());
  const usable = cands.filter((x) => hosts(x.id).length);
  if (!usable.length) return;
  const r = await ctx.choose('pickFromRevealed', { player: p, revealed: h.sources, eligible: usable, min: 0, max: 1, prompt: '링크할 진화원 카드 선택 (취소=안 함)' });
  const pick = (r || [])[0]; if (pick == null) return;
  const id = h.sources[pick];
  const hs = hosts(id);
  const uid = hs.length === 1 ? hs[0].uid : await ctx.choose('pickStack', { player: p, uids: hs.map((s) => s.uid), prompt: '링크할 디지몬 선택' });
  const host = hs.find((s) => s.uid === uid); if (!host) return;
  h.sources.splice(pick, 1); if (pick < fd) h.s5fd = fd - 1; S.recomputeStackGrants(h);
  S.linkCardTo(state, p, host.uid, id, id, 0, 'other', await S.linkDiscardIdx(state, p, host.uid, ctx.choose));
});
// BT24-015 / BT24-039 【시큐리티】 Lv.6 이상인 상대의 디지몬이 있다면, 배틀을 진행하지 않고, 이 카드를 코스트를 지불하지 않고 등장시킨다. (generic compile played a HAND card instead of this one)
for (const id of ['BT24-015', 'BT24-039']) sc(`${id}::시큐리티`, async (ctx, R) => {
  const o = ctx.state.players[ctx.opp];
  if (!o.battle.some((s) => C(s.cardId).category === 'digimon' && (C(s.cardId).level ?? 0) >= 6)) return;
  await R.runOne({ op: 'playThisFree' }, ctx); // playing it leaves the security limbo -> no battle takes place (13-1-8-3-2)
});

// =====================================================================================================================
// H. leave replacements the printed-ability parser does not understand
// =====================================================================================================================
// BT22-036 (inherited) 【서로의 턴】[턴 1회] 이 디지몬이 자신의 효과 이외로 배틀 에어리어를 벗어날 때, 자신의 토큰 또는 특징 「퍼펫형」을 가진 다른 자신의 디지몬 1마리를 소멸시키는 것으로, 벗어나지 않는다.
{
  const d = { tag: '서로의 턴', src: 'inheritedKo', has: '자신의 효과 이외로 배틀 에어리어를 벗어날 때', noAuto: true,
    preventLeaveOptions: (state, hp, holder, target, tp, cause, mode, id) => {
      if (!holder || target !== holder || cause === 'ownEffect') return [];
      if (S.turnUsesRemaining(holder, S.onceLimitKey(id, [d.tag, d.has || '']), 1) <= 0) return [];
      const victims = state.players[hp].battle.filter((s) => s !== holder && C(s.cardId).category === 'digimon' && (!!C(s.cardId).isToken || hasT(s.cardId, '퍼펫형')));
      return victims.map((v) => ({ apply() { if (!S.hookUseOnce(holder, id, d, 1)) return false; S.deleteStack(state, hp, v.uid, 'trash', 'ownEffect'); return true; } }));
    } };
  hk('BT22-036', d);
}

// BT22-088 (tamer) 【서로의 턴】 자신의 토큰 또는 특징 「퍼펫형」을 가진 자신의 디지몬이 등장했을 때, 이 테이머를 레스트시키는 것으로, 《1 드로우》. ("토큰 또는" is not understood by the generic subject parser)
hk('BT22-088', { tag: '서로의 턴', has: '자신의 토큰 또는 특징 「퍼펫형」을 가진 자신의 디지몬이 등장했을 때', events: { play: (state, hp, h, info) => info.owner === hp && !!info.stack && C(info.stack.cardId).category === 'digimon' && (!!C(info.stack.cardId).isToken || hasT(info.stack.cardId, '퍼펫형')) } });

// BT24-051 【등장 시】【진화 시】 상대의 디지몬/테이머 2마리(명)를 레스트시킨다. 그 후, 턴 종료까지, 자신의 디지몬 1마리를 DP +5000하고 상대 디지몬에게 어택할 수 있다.
// (generic compile made both rests optional and dropped the "상대 디지몬에게 어택할 수 있다" part)
sc('BT24-051::등장 시', async (ctx, R) => {
  await R.runScript(R.compileToScript('상대의 디지몬/테이머 2마리(명)를 레스트시킨다.'), ctx);
  await R.runOne({ op: 'modifyDP', target: 'self', thisStack: false, amount: 5000, duration: 'turn' }, ctx);
  const lp = ctx._lastPick; if (!lp) return;
  const st = findStack(ctx.state, lp.player, lp.uid);
  if (st && !st.suspended && ctx.startAttack && S.legalDigimonTargets(ctx.state, ctx.self, st.uid).length) ctx.startAttack(ctx.self, st.uid, undefined, { digimonOnly: true });
});

// BT23-084 【자신의 턴 종료 시】 이 테이머를 레스트시키고, 특징 「후디에」를 가진 자신의 디지몬 1마리를 패로 되돌리는 것으로, 자신의 패에서, 특징 「CS」를 가진 Lv.3의 디지몬 카드 1장을 비어 있는 자신의 육성 에어리어에 코스트를 지불하지 않고 등장시킬 수 있다.
// (generic compile lost the card filter and the breeding-area destination)
sc('BT23-084::자신의 턴 종료 시', compiled('이 테이머를 레스트시키고, 특징 「후디에」를 가진 자신의 디지몬 1마리를 패로 되돌리는 것으로, 자신의 패에서, 특징 「CS」를 가진 Lv.3의 디지몬 카드 1장을 코스트를 지불하지 않고 등장시킬 수 있다.', (s) => {
  const g = s[0]; g.then = [{ op: 'playFree', who: 'self', zone: 'hand', filter: { category: 'digimon', traitAny: ['CS'], level: 3 }, rested: false, noTriggers: false, optional: true, toRaising: true }];
}));

// BT22-061 〔진화〕 특징 「Ver.2」를 가진 자신의 디지몬이 이 카드로 진화할 때, 그 디지몬의 뒷면의 진화원 1장마다 지불하는 코스트 -1. (preamble of the 〔진화〕 line)
hk('BT22-061', { tag: '__evo', selfEvoDiscount: (state, p, stack) => (S.effectiveInfo(state, stack, p).hasTrait('Ver.2') ? -S.fdCount(stack) : 0) });
