export const SCRIPTS = {}; export const OPS = {}; export const HOOKS = {};
// Shard 15 — verify-reveal-1: deck-reveal cards whose printed follow-ups the generic revealTop/revealPick compiler can't express
// (docs/verify-reveal-1.md). Op names are prefixed s15_.
import * as S from '../state.js';

let FXH = null;
const H = async () => (FXH ||= (await import('../effects.js')).FX_HELPERS);
const P = (ctx, p) => ctx.state.players[p || ctx.self];
const C = (id) => S.card(id);
const isDig = (st) => S.isDigimonLike(st);
const meStack = (ctx) => P(ctx).battle.find(s => s.uid === ctx.sourceStackUid) || null;
async function confirm(ctx, prompt) { return !!(await ctx.choose('confirmEffect', { player: ctx.self, prompt })); }
async function T(ctx, R, text) { const { compileToScript } = await H(); await R.runScript(compileToScript(text), ctx); } // run printed sentences through the generic compiler
OPS.s15_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
const sc = (key, f) => { SCRIPTS[key] = [{ op: 's15_fn', fn: f }]; };
const showReveal = (ctx, ids, prompt) => ctx.choose('pickFromRevealed', { player: ctx.self, revealed: ids, eligible: [], min: 0, max: 0, prompt, dest: 'none' });

// BT4-096 덱 위 3장 오픈. 오픈한 카드가 모두 블랙일 경우 메모리 +1. 남은 카드(=오픈한 카드 전부)는 원하는 순서대로 덱 위로 되돌린다.
sc('BT4-096::등장 시', async (ctx, R) => {
  const pl = P(ctx), n = Math.min(3, pl.deck.length);
  if (!n) { S.log(ctx.state, `${ctx.self} 덱에 카드가 없어 오픈할 수 없음`); return; }
  const revealed = pl.deck.slice(0, n);
  S.log(ctx.state, `${ctx.self} 덱 위 ${n}장 오픈: ${revealed.map(id => C(id).nameKo).join(', ')}`);
  await showReveal(ctx, revealed, `덱 위 ${n}장을 오픈했습니다 — 모두 블랙이면 메모리 +1`);
  if (revealed.every(id => (C(id).colors || []).includes('black'))) await R.runOne({ op: 'gainMemory', who: 'self', n: 1 }, ctx);
  const ord = await S.orderPlacement(ctx.choose, ctx.self, revealed, '덱 위로 되돌릴 카드의 순서를 정하세요 (위쪽부터)');
  pl.deck.splice(0, n, ...ord);
});

// BT4-107 덱 위 3장 오픈, 《디지버스트》 디지몬 카드 전부를 패에. 남은 카드는 덱 아래. 그 후, 이 효과로 패에 추가한 카드 1장마다 상대의 디지몬 1마리를 레스트.
sc('BT4-107::메인', async (ctx, R) => {
  const pl = P(ctx), h0 = pl.hand.length;
  await T(ctx, R, '자신의 덱 위에서부터 3장 오픈한다. 그 중 《디지버스트》 를 갖는 디지몬 카드 전부를 패에 추가한다. 남은 카드는 원하는 순서대로 덱 아래로 되돌린다.');
  const added = Math.max(0, pl.hand.length - h0);
  for (let i = 0; i < added; i++) await R.runOne({ op: 'rest', target: 'opponent', n: 1, skipNextUnsuspend: false, digimonOnly: true }, ctx);
});

// BT8-106 덱 위 3장 오픈, 명칭에 「콩알몬」 디지몬 카드를 등장 코스트 합계 15까지 코스트 없이 등장. 이 효과로 등장한 디지몬 1마리마다 코스트 6 이하 상대 디지몬 1마리 소멸. 남은 카드는 파기.
sc('BT8-106::메인', async (ctx, R) => {
  const pl = P(ctx), b0 = new Set(pl.battle.map(s => s.uid));
  await T(ctx, R, '자신의 덱 위에서부터 3장 오픈한다. 그중 명칭에 「콩알몬」을 포함하는 디지몬 카드를 등장 코스트 합계 15까지 코스트를 지불하지 않고 등장시킬 수 있다. 남은 카드는 파기한다.');
  const played = pl.battle.filter(s => !b0.has(s.uid)).length;
  for (let i = 0; i < played; i++) await R.runOne({ op: 'destroy', target: 'opponent', mode: 'choose', filter: { costMax: 6 } }, ctx);
});

// ST13-02 / ST13-09: 이 디지몬을 <특징 Legend-Arms를 가지거나 블랙/레드인 자신의 다른 디지몬> 1마리의 진화원 아래에 놓는 것으로, 덱 위 1장 오픈.
// 그 카드가 특징 Legend-Arms의 등장 코스트 7 이하 디지몬 카드라면 코스트 없이 등장시킬 수 있다. 남은 카드는 패에 추가한다.
for (const [id, color] of [['ST13-02', 'black'], ['ST13-09', 'red']]) {
  sc(`${id}::등장 시`, async (ctx, R) => {
    const { matchesFilter } = await H();
    const me = meStack(ctx);
    if (!me) return;
    const f = { anyOf: [{ traitAny: ['Legend-Arms'] }, { colors: [color] }] };
    const targets = P(ctx).battle.filter(s => s !== me && isDig(s) && matchesFilter(S, s, f, ctx.state));
    if (!targets.length) { S.log(ctx.state, `${ctx.self} 진화원 아래에 놓을 수 있는 자신의 다른 디지몬이 없어 효과를 처리하지 않음`); return; }
    if (!(await confirm(ctx, '이 디지몬을 자신의 다른 디지몬의 진화원 아래에 놓고 덱 위 1장을 오픈할까요?'))) return;
    const uid = targets.length === 1 ? targets[0].uid : await ctx.choose('pickStack', { player: ctx.self, uids: targets.map(s => s.uid), prompt: '이 디지몬을 진화원 아래에 놓을 디지몬 선택' });
    const tgt = targets.find(s => s.uid === uid); if (!tgt) return;
    const pl = P(ctx);
    pl.battle.splice(pl.battle.indexOf(me), 1);
    tgt.sources.splice(S.fdCount(tgt), 0, ...me.sources, me.cardId); // the whole stack goes under (its own cards keep their order)
    S.recomputeStackGrants(tgt);
    S.log(ctx.state, `${ctx.self} ${C(me.cardId).nameKo}을(를) ${C(tgt.cardId).nameKo}의 진화원 아래에 놓음`);
    await T(ctx, R, '자신의 덱 위에서부터 1장 오픈한다. 그 카드가 특징으로 「Legend-Arms」를 가진 등장 코스트 7 이하의 디지몬 카드라면 코스트를 지불하지 않고 등장시킬 수 있다. 남은 카드는 패에 추가한다.');
  });
}

// ST13-16 《딜레이》 · 덱 위 4장 오픈. 오픈한 카드는 원하는 순서대로 덱 위 또는 아래로만 되돌린다. (each card goes to the top or the bottom)
// BT7-004 덱 위 1장 오픈하고, 그 카드를 덱의 위 또는 아래로 되돌린다.
const lookTopBottom = (n) => async (ctx, R) => { await R.runOne({ op: 'revealPick', who: 'self', n, optReveal: false, steps: [], restTo: 'topOrBottom' }, ctx); };
SCRIPTS['ST13-16::메인@덱 위에서부터 4장'] = [{ op: 's15_fn', fn: lookTopBottom(4) }];
sc('BT7-004::어택 시', lookTopBottom(1));

// BT10-019 덱 위 4장 오픈, 「블루 플레어」 카드 2장을 패에. 나머지 덱 아래. 자신의 「차도혁」이 있을 때, 대신 자신의 트래시에서 「메탈그레이몬」 1장을 패로 되돌릴 수 있다.
sc('BT10-019::등장 시', async (ctx, R) => {
  const pl = P(ctx);
  const hasTamer = pl.battle.some(s => S.cardNames(s.cardId).includes('차도혁'));
  if (hasTamer && pl.trash.some(id => S.cardNames(id).includes('메탈그레이몬')) && await confirm(ctx, '「차도혁」이 있어 덱 위를 오픈하는 대신, 트래시의 「메탈그레이몬」 1장을 패로 되돌릴까요?')) {
    await R.runOne({ op: 'returnFromTrash', who: 'self', filter: { exactAny: ['메탈그레이몬'] } }, ctx);
    return;
  }
  await T(ctx, R, '자신의 덱 위에서부터 4장 오픈한다. 그중 특징으로 「블루 플레어」를 가진 카드 2장을 패에 추가한다. 나머지는 원하는 순서대로 덱 아래로 되돌린다.');
});
