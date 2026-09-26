// Shard 151 — wave-10 recheck (official Q&A idx 6003-6672): card effects the generic compiler could only leave as "수동으로 처리하세요".
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

const C = (id) => S.card(id);
const PL = (ctx, p) => ctx.state.players[p];
const findStack = (state, p, uid) => { const pl = state.players[p]; return pl.raising?.uid === uid ? pl.raising : pl.battle.find((s) => s.uid === uid) || null; };
const isDig = (st) => !!st && C(st.cardId).category === 'digimon';
const mentions = (id, n) => S.cardMentions(id, n);
const sc = (key, f) => { SCRIPTS[key] = [{ op: 's150_fn', fn: f }]; };
OPS.s150_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
async function ask(ctx, prompt) { return !!(await ctx.choose('confirmEffect', { player: ctx.self, prompt })); }

// P-239 피코데블몬 【소멸 시】 자신의 트래시에 있는 이 카드를 「묘티스몬」이 기술되어 있는 자신의 디지몬 1마리의 진화원 아래에 놓는 것으로, 그 디지몬을 패의 명칭에 「묘티스몬」을 포함하는 디지몬 카드로 코스트를 지불하지 않고 진화시킬 수 있다.
// (the compiler had no "this card (in trash) → under a digimon" cost; the evolution keeps its normal evolution CONDITION — only the cost is waived)
sc('P-239::소멸 시', async (ctx, R) => {
  const { state } = ctx; const pl = PL(ctx, ctx.self);
  const ti = pl.trash.lastIndexOf('P-239');
  if (ti < 0) { S.log(state, `${ctx.self} 트래시에 「피코데블몬」이 없어 효과를 건너뜀`); return; }
  const hosts = pl.battle.filter((s) => isDig(s) && mentions(s.cardId, '묘티스몬'));
  if (!hosts.length) { S.log(state, `${ctx.self} 「묘티스몬」이 기술되어 있는 자신의 디지몬이 없어 효과를 건너뜀`); return; }
  if (!pl.hand.some((id) => C(id).category === 'digimon' && C(id).nameKo.includes('묘티스몬'))) { S.log(state, `${ctx.self} 패에 명칭에 「묘티스몬」을 포함하는 디지몬 카드가 없어 효과를 건너뜀`); return; }
  if (!(await ask(ctx, '트래시의 이 카드를 「묘티스몬」이 기술된 디지몬의 진화원 아래에 놓고 패의 「묘티스몬」으로 코스트 없이 진화시킵니까?'))) { ctx._declined = true; return; }
  let host = hosts[0];
  if (hosts.length > 1) { const uid = await ctx.choose('pickStack', { player: ctx.self, uids: hosts.map((s) => s.uid), prompt: '이 카드를 진화원 아래에 놓을 「묘티스몬」 기술 디지몬 선택' }); host = hosts.find((s) => s.uid === uid) || null; }
  if (!host) { ctx._declined = true; return; }
  const [id] = pl.trash.splice(ti, 1);
  host.sources.splice(S.fdCount(host), 0, id); S.recomputeStackGrants(host);
  S.log(state, `${ctx.self} ${C(id).nameKo}을(를) ${C(host.cardId).nameKo}의 진화원 아래에 놓음`);
  const save = ctx.sourceStackUid; ctx.sourceStackUid = host.uid;
  try { await R.runOne({ op: 'evolveEffect', who: 'self', subject: { thisStack: true }, zone: 'hand', cardFilter: { category: 'digimon', nameAny: ['묘티스몬'] }, cost: { mode: 'free' }, ignoreCond: false, ignoreLevel: false }, ctx); } finally { ctx.sourceStackUid = save; }
});

// EX13-035 킹에테몬 【등장 시】【진화 시】 자신의 패/트래시에서, 명칭에 「츄몬」/「스카몬」/「에테몬」을 포함하는 디지몬 카드를 2장까지, 등장 코스트 합계 6까지 코스트를 지불하지 않고 등장시킬 수 있다.
// 자신의 트래시에서 명칭에 「츄몬」/「스카몬」/「에테몬」을 포함하는 카드 10장을 덱 아래로 되돌리는 것으로, 이 효과의 등장 코스트 상한 +6.
// 공식 Q&A idx6505/6506: 먼저 트래시의 10장을 덱 아래로 되돌릴지 선택하고(9장 이하는 불가), 되돌렸다면 상한이 +6(=12)이 된 뒤에 등장시킨다.
// (the generic compile ignored both the 2-card / cost-sum cap — it happily played a cost-12 card — and ran the "+6" cost AFTER the play, leaving it as a manual note)
sc('EX13-035::등장 시', async (ctx, R) => {
  const { state } = ctx; const pl = PL(ctx, ctx.self);
  const named = (id) => /츄몬|스카몬|에테몬/.test(C(id).nameKo);
  let cap = 6;
  const idxs = () => pl.trash.map((id, i) => i).filter((i) => named(pl.trash[i]));
  if (idxs().length >= 10 && (await ask(ctx, '자신의 트래시의 명칭에 「츄몬」/「스카몬」/「에테몬」을 포함하는 카드 10장을 덱 아래로 되돌려 등장 코스트 상한을 +6 합니까?'))) {
    const picked = [];
    for (let j = 0; j < 10; j++) {
      const el = idxs().filter((i) => !picked.includes(i));
      const i = await ctx.choose('pickFromZoneIndex', { player: ctx.self, zone: 'trash', eligibleIdxs: el, prompt: `덱 아래로 되돌릴 카드 선택 (${j + 1}/10)` });
      if (i == null || !el.includes(i)) break;
      picked.push(i);
    }
    if (picked.length === 10) {
      const ids = picked.slice().sort((a, b) => b - a).map((i) => pl.trash.splice(i, 1)[0]);
      pl.deck.push(...ids.reverse());
      S.log(state, `${ctx.self} 트래시의 카드 10장 → 덱 아래 (등장 코스트 상한 +6)`);
      cap += 6;
    } else S.log(state, `${ctx.self} 카드 10장을 고르지 않아 비용을 지불하지 않음`);
  }
  let left = cap;
  for (let k = 0; k < 2 && left > 0; k++) {
    const before = new Set(pl.battle.map((s) => s.uid));
    await R.runOne({ op: 'playFree', who: 'self', zone: 'any', filter: { category: 'digimon', nameAny: ['츄몬', '스카몬', '에테몬'], costMax: left }, rested: false, noTriggers: false, optional: true }, ctx);
    const st = pl.battle.find((s) => !before.has(s.uid) && isDig(s));
    if (!st) break;
    left -= C(st.cardId).cost || 0;
  }
});
SCRIPTS['EX13-035::진화 시'] = SCRIPTS['EX13-035::등장 시'];

// EX12-060 카오스드라몬 【등장 시】【진화 시】【어택 시】[턴 1회] 상대의 디지몬 전부를 《퇴화 2》. 그 후, 자신의 패/트래시에서, 특징 「머신형」/「사이보그형」/「ME」를 가진 Lv.5 이하의 카드 2장을 이 디지몬의 진화원 아래에 놓는 것으로,
// 등장 코스트가 이 디지몬의 진화원 장수 이하인 상대의 디지몬 2마리를 소멸시킨다.
// (the generic compile dropped the 「등장 코스트가 이 디지몬의 진화원 장수 이하」 bound: it destroyed any two opposing digimon)
const EX12060_MOVE = { op: 'moveEach', who: 'self', from: ['hand', 'trash'], groups: [{ filter: { traitAny: ['머신형', '사이보그형', 'ME'], levelMax: 5 }, max: 2, label: '특징 「머신형」/「사이보그형」/「ME」를 가진 Lv.5 이하의 카드' }], dest: 'thisSources', pos: 'bottom', ordered: false, required: true };
SCRIPTS['EX12-060::등장 시'] = [
  { op: 'retreat', target: 'opponent', n: 2, all: true },
  { op: 'costGroup', cost: [EX12060_MOVE], costText: '그 후, 자신의 패/트래시에서, 특징 「머신형」/「사이보그형」/「ME」를 가진 Lv.5 이하의 카드 2장을 이 디지몬의 진화원 아래에 놓는', thenText: '등장 코스트가 이 디지몬의 진화원 장수 이하인 상대의 디지몬 2마리를 소멸시킨다.',
    then: [{ op: 's150_fn', fn: async (ctx, R) => {
      const st = findStack(ctx.state, ctx.self, ctx.sourceStackUid);
      const cap = st ? st.sources.length : 0; // 「이 디지몬의 진화원 장수」 — read AFTER the 2 cards were placed
      for (let k = 0; k < 2; k++) await R.runOne({ op: 'destroy', target: 'opponent', mode: 'choose', filter: { costMax: cap } }, ctx);
    } }] },
];
SCRIPTS['EX12-060::진화 시'] = SCRIPTS['EX12-060::등장 시'];
SCRIPTS['EX12-060::어택 시'] = SCRIPTS['EX12-060::등장 시'];

// BT26-079 좀비플루토몬 [트래시]【메인】 자신의 패가 5장 이하라면, 이 카드를 지불하는 코스트 -4 하여 등장시킨다. (공식 Q&A idx6302: 이 등장으로 《어셈블리》도 선언해 코스트를 더 마이너스할 수 있다)
// (the printed keyword line right below the sentence got merged into the segment and the generic compile turned it into a stray 《S 어택 +1》 grant — the card itself was never played)
SCRIPTS['BT26-079::메인'] = [{ op: 's150_fn', fn: async (ctx, R) => {
  if (PL(ctx, ctx.self).hand.length > 5) { S.log(ctx.state, `${ctx.self} 패가 6장 이상이라 효과를 처리할 수 없음`); return; }
  await R.runOne({ op: 's8_playOrUse', zones: ['trash'], kinds: ['digimon'], delta: -4, pred: (id) => id === 'BT26-079' }, ctx);
} }];
