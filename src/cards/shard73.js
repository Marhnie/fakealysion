// Shard 73 — fixes found by the official card-Q&A round-2 scenario tests (scripts/qa/qa-slice4-r2-*.mjs; Q ids reference data/rulings/slice4.json).
// state.js is imported lazily (only used inside functions) because state.js imports cards/index.js.
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

const C = (id) => S.card(id);
const stacksOf = (state, p) => [state.players[p].raising, ...state.players[p].battle].filter(Boolean);
const me = (ctx) => stacksOf(ctx.state, ctx.self).find(s => s.uid === ctx.sourceStackUid) || null;
const log = (ctx, msg) => S.log(ctx.state, msg);
const fn = (f) => ({ op: 's73_fn', fn: f });
OPS.s73_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
const sc = (key, f) => { SCRIPTS[key] = [fn(f)]; };
const digs = (ctx, who) => ctx.state.players[who].battle.filter(s => C(s.cardId).category === 'digimon');
async function pickOne(ctx, list, prompt) {
  if (!list.length) return null;
  const uid = await ctx.choose('pickStack', { player: ctx.self, uids: list.map(s => s.uid), prompt });
  return list.find(s => s.uid === uid) || null;
}

// EX9-021 【진화 시】 (Q4764): "조그레스 진화하고 있었다면, <상대의 효과를 받지 않는다>. 그 후, 가장 Lv.이 높은 상대의 디지몬 전부를 소멸시킨다." — the 그 후 sentence runs even without a jogress.
// (The whole segment was previously not compiled at all.)
sc('EX9-021::진화 시', async (ctx) => {
  const h = me(ctx); if (!h) return;
  if (h.viaFusion) { S.grantShield(ctx.state, ctx.self, h.uid, { kinds: ['all'], until: ctx.state.turnNumber }); log(ctx, `${ctx.self} ${C(h.cardId).nameKo} 턴 종료까지 상대의 효과를 받지 않음`); }
  const opp = digs(ctx, ctx.opp); if (!opp.length) return;
  const top = Math.max(...opp.map(s => C(s.cardId).level ?? -1));
  for (const s of opp.filter(x => (C(x.cardId).level ?? -1) === top)) S.deleteStack(ctx.state, ctx.opp, s.uid, 'trash', 'effect');
});

// BT17-102 【진화 시】 (Q4713): "이 디지몬의 명칭이 「코로몬」이라면, DP +3000. 그 후, 이 디지몬의 DP 이하의 상대의 디지몬 1마리를 소멸시킨다." — the 그 후 sentence is independent of the name condition.
SCRIPTS['BT17-102::진화 시'] = [
  { op: 'condition', if: { test: (ctx) => { const h = me(ctx); return !!h && S.effectiveInfo(ctx.state, h, ctx.self).names.includes('코로몬'); } },
    then: [{ op: 'modifyDP', target: 'self', thisStack: true, amount: 3000, duration: 'turn' }], else: [] },
  { op: 's4_destroy', kinds: ['digimon'], n: 1, pred: (s, ctx) => { const h = me(ctx); return !!h && S.effectiveDP(ctx.state, ctx.opp, s) <= S.effectiveDP(ctx.state, ctx.self, h) + S.dpDestroyCapBoost(ctx.state, ctx.self, ctx.sourceStackUid); } },
];

// BT20-102 【등장 시】【진화 시】 (Q4725): "진화원에 「오메가몬」/「X항체」가 있다면, 서로의 디지몬 1마리씩을 선택하고 그 이외의 디지몬 전부를 소멸시킨다. 그 후, 상대의 디지몬 1마리를 덱 아래로 되돌린다."
// the 그 후 sentence is processed even when the condition is not met.
const BT20_102 = [fn(async (ctx, R) => {
  const h = me(ctx); if (!h) return;
  if (h.sources.some(id => S.cardNameIs(id, '오메가몬') || S.cardNameIs(id, 'X항체'))) {
    const mine = digs(ctx, ctx.self), theirs = digs(ctx, ctx.opp);
    const keepMine = await pickOne(ctx, mine, '남길 자신의 디지몬 1마리 선택 (나머지는 소멸)');
    const keepOpp = await pickOne(ctx, theirs, '남길 상대의 디지몬 1마리 선택 (나머지는 소멸)');
    const doomed = [];
    for (const [who, list, keep] of [[ctx.self, mine, keepMine], [ctx.opp, theirs, keepOpp]]) for (const s of list) if (s !== keep) doomed.push([who, s.uid]);
    for (const [who, uid] of doomed) S.deleteStack(ctx.state, who, uid, 'trash', 'effect');
  } else log(ctx, `${ctx.self} ${C(h.cardId).nameKo}: 진화원에 「오메가몬」/「X항체」가 없어 첫 처리는 하지 않음 (그 후 처리는 진행)`);
  await R.runScript(R.compileToScript('상대의 디지몬 1마리를 덱 아래로 되돌린다.'), ctx);
})];
SCRIPTS['BT20-102::등장 시'] = BT20_102;
SCRIPTS['BT20-102::진화 시'] = BT20_102;

// "Lv.이 같은 카드가 2장 이상 겹쳐져 있다" (Q4879 family): the whole stack is looked at, the top card included (Lv.5 digimon + one Lv.5 source = true).
const sameLvPairWhole = (st) => { const seen = new Set(); for (const id of [st.cardId, ...st.sources.slice(S.fdCount(st))]) { const lv = C(id).level; if (lv == null) continue; if (seen.has(lv)) return true; seen.add(lv); } return false; };
// BT22-031 【등장 시】 (…그 후 Lv.이 같은 카드가 2장 이상 겹쳐져 있다면 패의 「플래티넘워매몬」으로 진화 조건 무시, 진화 코스트 4로 진화)
sc('BT22-031::등장 시', async (ctx, R) => {
  await R.runOne({ op: 'grantKeyword', target: 'opponent', thisStack: false, keyword: '시큐리티어택', value: -2, duration: 'opponentTurn' }, ctx);
  const h = me(ctx); if (!h || !sameLvPairWhole(h)) return;
  await R.runOne({ op: 'evolveEffect', who: 'self', subject: { thisStack: true }, zone: 'hand', cardFilter: { category: 'digimon', exactAny: ['플래티넘워매몬'] }, cost: { mode: 'fixed', n: 4 }, ignoreCond: true, ignoreLevel: false }, ctx);
});
// BT22-063 【서로의 턴】[턴 1회] 레스트했을 때, 진화원에 「쿠레미 쿄코」가 있거나 Lv.이 같은 카드가 2장 이상 겹쳐져 있다면, DP +3000 후 액티브
sc('BT22-063::서로의 턴@쿠레미 쿄코」가 있거나', async (ctx, R) => {
  const h = me(ctx); if (!h) return;
  const kyoko = h.sources.slice(S.fdCount(h)).some((id) => S.cardNames(id).includes('쿠레미 쿄코'));
  if (!kyoko && !sameLvPairWhole(h)) return;
  await R.runOne({ op: 'modifyDP', target: 'self', thisStack: true, amount: 3000, duration: 'opponentTurn' }, ctx);
  await R.runOne({ op: 'unsuspend', target: 'thisStack' }, ctx);
});

// trashLink (Q4583/5000 family, 20 cards): "이 디지몬의 링크 카드 1장을 파기하는 것으로 …" — the PLAYER chooses which link card is discarded (any of them, including the card that owns the effect);
// the old op always discarded the most recently attached one.
const linkHolders73 = (instr, ctx) => {
  const n = instr.n || 1;
  if (instr.target === 'own') return stacksOf(ctx.state, ctx.self).filter(s => C(s.cardId).category === 'digimon' && (s.linkCards || []).length >= n);
  const m = me(ctx);
  return m && (m.linkCards || []).length >= n ? [m] : [];
};
OPS.trashLink = async (instr, ctx) => {
  instr._paid = false;
  const n = instr.n || 1, list = linkHolders73(instr, ctx);
  const holder = await pickOne(ctx, list, '링크 카드를 파기할 디지몬 선택');
  if (!holder) return;
  for (let i = 0; i < n; i++) {
    let k = holder.linkCards.length - 1;
    if (holder.linkCards.length > 1) {
      const a = await ctx.choose('pickLinkCard', { player: ctx.self, ids: holder.linkCards.map(l => l.cardId), prompt: '파기할 링크 카드를 선택하세요' });
      if (Number.isInteger(a) && a >= 0 && a < holder.linkCards.length) k = a;
    }
    const [lc] = holder.linkCards.splice(k, 1);
    ctx.state.players[ctx.self].trash.push(lc.cardId);
    log(ctx, `${ctx.self} ${C(holder.cardId).nameKo}의 링크 카드 ${C(lc.cardId).nameKo} 파기`);
    S.recomputeStackGrants(holder);
    S.emitGameEvent(ctx.state, 'linkDiscarded', { owner: ctx.self, stack: holder, cause: 'effect', cardId: lc.cardId });
  }
  S.recomputeStackGrants(holder);
  instr._paid = true;
};
OPS['trashLink$payable'] = (instr, ctx) => linkHolders73(instr, ctx).length > 0;
