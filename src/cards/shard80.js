// Shard 80 — "최상단 카드(top stacked card)" fixes. See docs/fix-top-stacked-card.md.
// "이 디지몬에 겹쳐져 있는 카드를 위에서부터 N장" / "이 디지몬의 최상단 카드" (official EN: "this Digimon's top stacked card" / "the top card of this Digimon")
// = the TOP card of the stack (the Digimon card itself), then the next one down — NOT the evolution-source cards under it.
// Core helpers live in state.js: S.detachTopStackCard / S.moveTopStackCard(dest: trash|secTop|secBottom|hand|deckTop|deckBottom) / S.rotateTopStackToBottom.
// Registered LAST in index.js so these per-card scripts win over the older (source-based) ones in shard2/4/5/6/7/10/19/37.
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};
const C = (id) => S.card(id);
const fn = (f) => ({ op: 's80_fn', fn: f });
OPS.s80_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
const sc = (key, f) => { SCRIPTS[key] = [fn(f)]; };
const stacksOf = (state, p) => [state.players[p].raising, ...state.players[p].battle].filter(Boolean);
const findSt = (state, p, uid) => stacksOf(state, p).find(s => s.uid === uid) || null;
const meOf = (ctx) => findSt(ctx.state, ctx.self, ctx.sourceStackUid);
const isDig = (s) => C(s.cardId).category === 'digimon';
// w4 recheck2 (official Q&A 2892 BT17-098 / 4958 BT24-093 / 1247 BT9-083 / 6497 EX13-032): 「겹쳐져 있는 카드」 exists only when at least one (face-up) card lies under the top card; a lone card has none
const hasUnder = (s) => s.sources.length - S.fdCount(s) >= 1;
const ask = async (ctx, prompt, who) => !!(await ctx.choose('confirmEffect', { player: who || ctx.self, prompt }));
async function pick(ctx, who, stacks, prompt, optional = false) {
  if (!stacks.length) return null;
  if (stacks.length === 1 && !optional) return stacks[0];
  const uid = await ctx.choose('pickStack', { player: who, uids: stacks.map(s => s.uid), prompt });
  return stacks.find(s => s.uid === uid) || null;
}
const hasType = (c, ...ts) => ts.some(t => (c.types || []).includes(t));
const cardMentions = (id, x) => C(id).nameKo.includes(x) || `${C(id).effectKo || ''}\n${C(id).inheritedKo || ''}`.includes(`「${x}」`);

// ---- BT13-058 (자신의 턴 종료 시) / BT13-091 (상대의 턴 종료 시): "이 디지몬에 겹쳐져 있는 카드를 위에서부터 1장 파기한다" (shard2 s2_trashTopSource trashed the source under it)
OPS.s2_trashTopSource = async (instr, ctx) => {
  const st = meOf(ctx);
  if (st && hasUnder(st)) S.moveTopStackCard(ctx.state, ctx.self, st, 'trash');
};
// ---- EX10-022 (inherited 상대의 턴 종료 시): 「벨페몬: 슬립 모드」라면 이 디지몬의 최상단 카드를 파기 (슬립 모드 자체가 파기되고 아래 카드가 디지몬이 된다)
sc('EX10-022::상대의 턴 종료 시@벨페몬: 슬립 모드」라면', async (ctx) => {
  const st = meOf(ctx);
  if (!st || C(st.cardId).nameKo !== '벨페몬: 슬립 모드') return;
  S.moveTopStackCard(ctx.state, ctx.self, st, 'trash');
});
// ---- BT9-083 (자신의 턴 개시 시): 이 디지몬에 겹쳐진 카드를 위에서부터 1장 파기한다. 그렇게 했을 때, 상대의 시큐리티를 위에서부터 1장 파기한다.
sc('BT9-083::자신의 턴 개시 시', async (ctx, R) => {
  const st = meOf(ctx); if (!st) return;
  if (!st.sources.length) return; // slice2 r2 (official Q&A 1885): a lone card with no sources has nothing "overlaid" on it -- it is not discarded
  const id = S.moveTopStackCard(ctx.state, ctx.self, st, 'trash');
  if (id != null) await R.runScript([{ op: 'removeSecurity', who: 'opponent', position: 'top' }], ctx);
});
// ---- BT21-085 (메인): 이 테이머를 레스트시키고, 특징 「아머체」를 가진 자신의 디지몬 1마리에 겹쳐져 있는 카드를 위에서부터 1장 파기하는 것으로, 《1 드로우》, 메모리 +1.
sc('BT21-085::메인', async (ctx, R) => {
  const { state } = ctx, p = ctx.self, t = meOf(ctx); if (!t) return;
  const armor = stacksOf(state, p).filter(s => isDig(s) && hasType(C(s.cardId), '아머체') && hasUnder(s));
  if (t.suspended || !armor.length) { S.log(state, '최산해: 비용을 지불할 수 없음 (액티브 테이머 + 「아머체」 디지몬 필요)'); return; }
  if (!(await ask(ctx, '이 테이머를 레스트하고 「아머체」 디지몬의 최상단 카드 1장을 파기하겠습니까?'))) return;
  const d = await pick(ctx, p, armor, '최상단 카드를 파기할 「아머체」 디지몬 선택');
  if (!d) return;
  S.restStack(state, p, t.uid);
  if (S.moveTopStackCard(state, p, d, 'trash') == null) return;
  await R.runScript([{ op: 'draw', who: 'self', n: 1 }, { op: 'gainMemory', who: 'self', n: 1 }], ctx);
});
// ---- BT13-107 (메인 옵션): 그 후, 자신의 「두프트몬: 레오파드 모드」에 겹쳐져 있는 카드를 위에서부터 1장 패로 되돌리는 것으로, 자신의 디지몬 전부를 액티브로 한다.
sc('BT13-107::메인', async (ctx, R) => {
  const { state } = ctx;
  const mine = await pick(ctx, ctx.self, stacksOf(state, ctx.self).filter(isDig), 'DP 기준이 될 자신의 디지몬 선택');
  if (mine) {
    const dp = S.effectiveDP(state, ctx.self, mine);
    await R.runOne({ op: 'returnToHandStripSources', target: 'opponent', n: 1, filter: { suspended: true, dpMax: dp } }, ctx);
  }
  const dup = stacksOf(state, ctx.self).filter(s => isDig(s) && C(s.cardId).nameKo === '두프트몬: 레오파드 모드' && hasUnder(s));
  const d = await pick(ctx, ctx.self, dup, '최상단 카드를 패로 되돌릴 「두프트몬: 레오파드 모드」 선택 (취소 = 안 함)', true);
  if (!d) return;
  const id = S.moveTopStackCard(state, ctx.self, d, 'hand');
  if (id == null) return;
  for (const s of stacksOf(state, ctx.self)) if (isDig(s) || C(s.cardId).category === 'tamer') S.unsuspendStack(state, ctx.self, s.uid);
});
// ---- P-153 (어택 종료 시): 이 디지몬에 겹쳐져 있는 카드를 위에서부터 1장 시큐리티 위에 놓는 것으로, 이 디지몬/테이머를 액티브로 한다.
OPS.s4_topSourceToSecurity = async (instr, ctx) => {
  const { state } = ctx, p = ctx.self, me = meOf(ctx);
  if (!me || !hasUnder(me)) return;
  if (S.moveTopStackCard(state, p, me, 'secTop', { cause: 'ownEffect', checkBlock: false }) == null) return;
  const cands = stacksOf(state, p).filter(s => s.suspended && (s === me || C(s.cardId).category === 'tamer'));
  const t = await pick(ctx, p, cands, '액티브로 할 이 디지몬/테이머 선택');
  if (t) S.unsuspendStack(state, p, t.uid);
};
// ---- BT17-098 (딜레이 옵션): 「펄스몬」이 기술되어 있는 Lv.4 이상의 자신의 디지몬에 겹쳐져 있는 카드를 위에서부터 1장 시큐리티 위에 놓는 것으로, 메모리 +2.
sc('BT17-098::메인@겹쳐져 있는 카드를 위에서부터 1장 시큐리티 위에', async (ctx, R) => {
  const { state } = ctx, self = ctx.self;
  const cands = stacksOf(state, self).filter(s => isDig(s) && (C(s.cardId).level || 0) >= 4 && cardMentions(s.cardId, '펄스몬') && hasUnder(s));
  if (!cands.length) { S.log(state, `${self} 조건을 만족하는 「펄스몬」 디지몬이 없어 비용을 지불할 수 없음`); return; }
  const st = await pick(ctx, self, cands, '최상단 카드를 시큐리티 위에 놓을 「펄스몬」 디지몬 선택');
  if (!st) return;
  if (S.moveTopStackCard(state, self, st, 'secTop', { cause: 'ownEffect', checkBlock: false }) == null) return;
  await R.runScript([{ op: 'gainMemory', who: 'self', n: 2 }], ctx);
});
// ---- EX1-071 (메인): 이 턴 동안 다음에 자신의 디지몬이 진화할 때, 자신의 패에서 진화하는 디지몬과 같은 색의 디지몬 카드 1장을 파기하는 것으로, 지불하는 진화 코스트를 -4 한다.
// (was a manual "수동으로 처리하세요" note.) The option itself is offered by S.hookEvoCostOptions while pl.evoTempOpt is armed for this turn (next battle-area evolution only).
sc('EX1-071::메인', async (ctx) => {
  const pl = ctx.state.players[ctx.self];
  pl.evoTempOpt = { turn: ctx.state.turnNumber, seen: S.digivolvedThisTurn(ctx.state, ctx.self) };
  S.log(ctx.state, `${ctx.self} ${C('EX1-071').nameKo}: 이 턴 다음 진화에서 같은 색의 디지몬 카드 1장을 파기하여 진화 코스트 -4 가능`);
});
// ---- BT19-090 (메인): 이하의 효과에서 1개를 발휘한다. ·자신의 테이머 아래에서 「크로스 하트」 DP 4000 이하 디지몬 1장 등장 ·자신의 「샤우트몬 EX6」와 「슈팅스타몬」 1마리씩을 액티브로 하는 것으로, 자신의 디지몬 1마리로 플레이어에게 어택할 수 있다.
// (generic compile turned the 2nd bullet into a manual note.) Official Q&A 2510: BOTH must be made active — activating only one is not allowed (a 「~ことで」 cost can't be partly paid).
sc('BT19-090::메인', async (ctx, R) => {
  const { state } = ctx, p = ctx.self;
  const k = await ctx.choose('multipleChoice', { player: p, prompt: '이하의 효과에서 1개를 발휘한다', options: ['자신의 테이머 아래에서 「크로스 하트」를 가진 DP 4000 이하의 디지몬 카드 1장을 코스트를 지불하지 않고 등장시킬 수 있다', '자신의 「샤우트몬 EX6」와 「슈팅스타몬」 1마리씩을 액티브로 하는 것으로, 자신의 디지몬 1마리로 플레이어에게 어택할 수 있다'] });
  if (k === 0) { await R.runOne({ op: 'playFreeTamerUnder', who: 'self', zones: [], filter: { category: 'digimon', traitAny: ['크로스 하트'], dpMax: 4000 }, n: 1, rested: false, noTriggers: false, optional: true }, ctx); return; }
  if (k !== 1) return;
  const rested = (nm) => stacksOf(state, p).filter(s => isDig(s) && s.suspended && S.effectiveInfo(state, s, p).nameIs(nm));
  const a = rested('샤우트몬 EX6'), b = rested('슈팅스타몬');
  if (!a.length || !b.length) { S.log(state, `${p} 「샤우트몬 EX6」와 「슈팅스타몬」을 1마리씩 액티브로 할 수 없어 효과를 발휘할 수 없음`); return; }
  const pa = await pick(ctx, p, a, '액티브로 할 「샤우트몬 EX6」 선택'); const pb = pa && await pick(ctx, p, b.filter(s => s !== pa), '액티브로 할 「슈팅스타몬」 선택');
  if (!pa || !pb) { S.log(state, `${p} 「샤우트몬 EX6」와 「슈팅스타몬」을 1마리씩 액티브로 할 수 없어 효과를 발휘할 수 없음`); return; }
  S.unsuspendStack(state, p, pa.uid); S.unsuspendStack(state, p, pb.uid);
  await R.runOne({ op: 's4_attackPlayerWith' }, ctx);
});
// ---- BT24-093 (딜레이): 명칭에 「아이기오투스몬」/「유피테르몬」을 포함한 디지몬의 최상단 카드를 시큐리티 위에 둘 수 있다.
SCRIPTS['BT24-093::서로의 턴'] = [fn(async (ctx) => {
  const { state, self } = ctx;
  const h = meOf(ctx);
  if (!h || state.turnNumber <= h.placedTurn) return;
  const c = stacksOf(state, self).filter(s => isDig(s) && (C(s.cardId).nameKo.includes('아이기오투스몬') || C(s.cardId).nameKo.includes('유피테르몬')) && hasUnder(s));
  if (!c.length || !(await ask(ctx, '《딜레이》 — 이 카드를 파기하여 디지몬의 최상단 카드를 시큐리티 위에 놓을까요?'))) return;
  S.discardForDelay(state, self, h.uid);
  const t = await pick(ctx, self, c, '최상단 카드를 시큐리티 위에 놓을 디지몬 선택');
  if (t) S.moveTopStackCard(state, self, t, 'secTop', { cause: 'ownEffect', checkBlock: false });
})];
// ---- BT20-052 / BT20-055 / EX11-041 / EX11-043 (자신의 턴): 앞면 시큐리티를 체크했을 때, 이 디지몬의 최상단 카드를 시큐리티 아래에 앞면으로 놓을 수 있다.
for (const id of ['BT20-052', 'BT20-055', 'EX11-041', 'EX11-043']) {
  sc(`${id}::자신의 턴`, async (ctx) => {
    const st = meOf(ctx); if (!st) return;
    if (!(await ask(ctx, '이 디지몬의 최상단 카드를 시큐리티 아래에 앞면으로 놓을까요?'))) return;
    S.moveTopStackCard(ctx.state, ctx.self, st, 'secBottom', { faceUp: true, cause: 'ownEffect', checkBlock: false });
  });
}
// ---- BT20-084 (서로의 턴 종료 시): 이 디지몬에 겹쳐져 있는 카드를 위에서부터 1장 시큐리티 위에 놓는다 (강제).
sc('BT20-084::서로의 턴 종료 시', async (ctx) => {
  const st = meOf(ctx); if (!st || !hasUnder(st)) return;
  S.moveTopStackCard(ctx.state, ctx.self, st, 'secTop', { cause: 'ownEffect', checkBlock: false });
});
// ---- BT21-030 (등장 시/진화 시): 상대의 디지몬 1마리의 겹쳐져 있는 카드를 위에서부터 10장 파기한다 (the top card counts; one card always stays — see BT26-060 / official Q7079-7083 reading).
sc('BT21-030::등장 시', async (ctx) => {
  const { state } = ctx, o = ctx.opp;
  const t = await pick(ctx, o, stacksOf(state, o).filter(isDig), '겹쳐져 있는 카드를 위에서부터 파기할 상대 디지몬 선택');
  if (!t) return;
  const n = Math.min(10, t.sources.length - S.fdCount(t)); // total visible - 1: the last card can't be trashed this way
  for (let k = 0; k < n; k++) if (S.moveTopStackCard(state, o, t, 'trash') == null) break;
});
SCRIPTS['BT21-030::진화 시'] = SCRIPTS['BT21-030::등장 시'];
// ---- BT23-008 / BT23-018 (메인 [턴 1회]): 이 디지몬에 겹쳐져 있는 카드를 위에서부터 1장 이 디지몬의 진화원 아래에 놓는 것으로, 패의 지정 카드를 지불하는 코스트 -2 하여 등장시킬 수 있다.
const rotateAndPlay = (names) => async (ctx) => {
  const { state } = ctx, me = ctx.self, pl = state.players[me], st = meOf(ctx);
  if (!st || st.sources.length - S.fdCount(st) < 1) { S.log(state, '겹쳐져 있는 카드가 없어 발휘할 수 없음'); return; }
  const cm = (id) => names.includes(C(id).nameKo);
  const idxs = pl.hand.map((id, i) => i).filter(i => cm(pl.hand[i]));
  if (!idxs.length) { S.log(state, `패에 ${names.map(n => `「${n}」`).join('/')}가 없음`); return; }
  const idx = await ctx.choose('pickFromZoneIndex', { player: me, zone: 'hand', eligibleIdxs: idxs, prompt: '지불하는 코스트 -2 하여 등장시킬 카드 선택' });
  if (idx == null) return;
  const cardId = pl.hand[idx];
  if (S.rotateTopStackToBottom(state, me, st, 'effect') == null) return;
  const i2 = pl.hand.indexOf(cardId); if (i2 < 0) return;
  S.spendMemory(state, Math.max(0, (C(cardId).cost || 0) - 2));
  S.playDigimonFresh(state, me, i2);
};
sc('BT23-008::메인@이 디지몬에 겹쳐져 있는 카드를 위에서부터 1장', rotateAndPlay(['파피몬', '시라미네 노키아']));
sc('BT23-018::메인@이 디지몬에 겹쳐져 있는 카드를 위에서부터 1장', rotateAndPlay(['아구몬', '시라미네 노키아']));
// ---- P-225 (메인 《딜레이》): 특징 「CS」를 가진 Lv.4 이상인 자신의 디지몬 1마리에 겹쳐진 카드를 위에서 1장 그 디지몬의 진화원 (아래)에 놓는 것으로, 메모리 +2.
// (the generic compiler left this as a manual cost) — the top stacked card goes to the bottom of that Digimon's sources.
sc('P-225::메인@겹쳐진 카드를 위에서 1장 그 디지몬의 진화원에', async (ctx, R) => {
  const { state, self } = ctx;
  const cands = stacksOf(state, self).filter(s => isDig(s) && (C(s.cardId).level || 0) >= 4 && (C(s.cardId).types || []).includes('CS') && s.sources.length - S.fdCount(s) >= 1);
  if (!cands.length) { S.log(state, `${self} 조건을 만족하는 「CS」 디지몬이 없어 비용을 지불할 수 없음`); return; }
  const t = await pick(ctx, self, cands, '최상단 카드를 진화원 아래에 놓을 「CS」 디지몬 선택');
  if (!t) return;
  if (S.rotateTopStackToBottom(state, self, t, 'effect') == null) return;
  await R.runScript([{ op: 'gainMemory', who: 'self', n: 2 }], ctx);
});
