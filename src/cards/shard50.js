// Shard 50 — pass-2 verification fixes, batch 3 (BT17-020..102 / BT18-003..080; docs/verify-pass2-b3.md).
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
const C = (id) => S.card(id);
const findStack = (state, p, uid) => { const pl = state.players[p]; return pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid) || null; };
const me = (ctx) => findStack(ctx.state, ctx.self, ctx.sourceStackUid);
const digs = (state, p) => state.players[p].battle.filter(s => C(s.cardId).category === 'digimon');
const tams = (state, p) => state.players[p].battle.filter(s => C(s.cardId).category === 'tamer');
const fn = (f) => ({ op: 's50_fn', fn: f });
OPS.s50_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
const sc = (key, f) => { SCRIPTS[key] = [fn(f)]; };
const hk = (id, d) => { (HOOKS[id] ||= []).push(d); };
void opp; void me; void digs; void tams; void sc; void hk; void findStack;

// BT17-027 이 카드가 등장할 때, 명칭에 「매튜」를 포함하는 자신의 테이머가 있다면, 지불하는 등장 코스트 -3. (hand play)
hk('BT17-027', { tag: '__handPlay', selfPlayDiscount: (state, hp) => (tams(state, hp).some((s) => C(s.cardId).nameKo.includes('매튜')) ? -3 : 0) });

// BT17-068 패의 이 카드가 등장할 때, 자신의 트래시에서 「아포카리몬」 1장을 덱 아래로 되돌리는 것으로, 지불하는 등장 코스트 -3. (optional)
hk('BT17-068', { tag: '__handPlay', handPlayOption: (state, p, cardId) => {
  const pl = state.players[p];
  if (!pl.trash.some((id) => C(id).nameKo === '아포카리몬')) return null;
  return { label: `${C(cardId).nameKo}: 트래시의 「아포카리몬」 1장을 덱 아래로 되돌려 등장 코스트 -3?`, async apply() {
    const i = pl.trash.findIndex((id) => C(id).nameKo === '아포카리몬');
    if (i < 0) return 0;
    const [id] = pl.trash.splice(i, 1); pl.deck.push(id);
    S.log(state, `${p} 트래시의 ${C(id).nameKo}을(를) 덱 아래로`);
    return -3;
  } };
} });

// BT17-086 【메인】 「펄스몬」이 기술되어 있는 자신의 디지몬 1마리에게 《마인드 링크》 — "기술되어 있는" = name OR effect-text mention (shard4 matched the name only)
SCRIPTS['BT17-086::메인'] = [{ op: 's4_mindLink', pred: (s) => S.cardMentions(s.cardId, '펄스몬') }];

// BT18-019 밀레니엄몬 【등장 시】【진화 시】 상대의 디지몬 1마리를 소멸시킨다. 그 후, 조그레스 진화하고 있었다면, 상대의 트래시에서 Lv.이 서로 다른 디지몬 카드 1장씩을 덱 위로 되돌리는 것으로, 되돌린 1장마다 메모리 +1.
// (the generic compile left the "Lv.이 서로 다른 … 1장씩" cost as a manualCost and never returned/gained anything)
sc('BT18-019::등장 시', async (ctx, R) => {
  const { state } = ctx; const op = opp(ctx.self); const h = me(ctx); const pl = state.players[op];
  await R.runOne({ op: 'destroy', target: 'opponent', mode: 'choose' }, ctx);
  if (!h || !h.viaFusion) return;
  const levels = [...new Set(pl.trash.filter((id) => C(id).category === 'digimon').map((id) => C(id).level))].sort((a, b) => a - b);
  let n = 0;
  for (const lv of levels) {
    const idxs = pl.trash.map((id, i) => (C(id).category === 'digimon' && C(id).level === lv ? i : -1)).filter((i) => i >= 0);
    if (!idxs.length) continue;
    const k = idxs.length === 1 ? idxs[0] : await ctx.choose('pickFromZoneIndex', { player: ctx.self, zone: 'trash', owner: op, eligibleIdxs: idxs, prompt: `상대 트래시의 Lv.${lv} 디지몬 카드 1장 선택 (덱 위로)` });
    if (k == null || !idxs.includes(k)) continue;
    const [id] = pl.trash.splice(k, 1); pl.deck.unshift(id); n++;
    S.log(state, `${ctx.self} 상대 트래시의 ${C(id).nameKo}을(를) 덱 위로`);
  }
  if (n) S.grantMemory(state, ctx.self, n, ctx.sourceCardId);
});
