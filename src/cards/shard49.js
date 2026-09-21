// Shard 49 — pass-2 batch-8 verification fixes (docs/verify-pass2-b8.md).
import * as S from '../state.js';

export const SCRIPTS = {}; export const OPS = {}; export const HOOKS = {};
const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
const C = (id) => S.card(id);

// EX4-071 【메인】 자신의 디지몬 1마리를 소멸시키는 것으로, 소멸시킨 디지몬의 Lv. 이하의 상대의 디지몬 1마리를 소멸시킨다. 이 효과로 명칭에 「레이브몬」을 포함하는 자신의 디지몬이 소멸하고 있었다면 다음 상대의 턴 종료 시에, 자신의 트래시에서 「레이브몬」 1장을 코스트를 지불하지 않고 등장시킨다.
// (the 「레이브몬」 condition was a manual confirm; now checked against the digimon actually destroyed as cost)
SCRIPTS['EX4-071::메인'] = [
  { op: 'costGroup', cost: [{ op: 'destroy', target: 'self', mode: 'choose' }], then: [{ op: 'destroy', target: 'opponent', mode: 'choose', filter: { ref: 'pick', refStat: 'level' } }] },
  { op: 'condition', if: { test: (ctx) => (ctx._ownDestroyedIds || []).some((id) => C(id).nameKo.includes('레이브몬')) }, then: [{ op: 'atTurnEnd', when: 'opp', then: [{ op: 'playFree', who: 'self', zone: 'trash', filter: { exactAny: ['레이브몬'] }, rested: false, noTriggers: false }] }], else: [] },
];

// "「X」가 기술되어 있는" = the card's name / rules-text mentions 「X」 (not just its own name/trait)
const mentions = (id, n) => C(id).nameKo.includes(n) || `${C(id).effectKo || ''}\n${C(id).inheritedKo || ''}`.replace(/〈룰〉[^\n]*/g, '').includes(`「${n}」`) || (C(id).types || []).includes(n);

// EX7-073 【진화 시】 자신의 패에서 「3총사」가 기술되어 있는 옵션 카드 1장을 코스트를 지불하지 않고 사용할 수 있다.
// (was: name/trait only -> the 3총사 option cards, whose text says 「3총사」, were never offered)
SCRIPTS['EX7-073::진화 시@가 기술되어 있는 옵션'] = [{ op: 's4_useOption', pred: (id) => C(id).category === 'option' && mentions(id, '3총사') }];

const fn = (f) => ({ op: 's49_fn', fn: f });
OPS.s49_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
const sc = (key, f) => { SCRIPTS[key] = [fn(f)]; };
const ask = async (ctx, prompt) => !!(await ctx.choose('confirmEffect', { player: ctx.self, prompt }));
const isDigCard = (id) => C(id).category === 'digimon';

// EX5-065 【상대의 턴 개시 시】 특징으로 「나이트 클로」/「라이트 팽」을 가진 자신의 디지몬의 진화원에서 그 디지몬과 같은 Lv.의 카드 1장을 코스트를 지불하지 않고 등장시키는 것으로,
// 자신의 디지몬 2마리로 패의 디지몬 카드로 조그레스 진화할 수 있다. 이 효과로 등장한 디지몬은 턴 종료 시에 패로 되돌아간다.
// (was: manual-confirm cost -> nothing was really played, no return-to-hand)
sc('EX5-065::상대의 턴 개시 시', async (ctx, R) => {
  const { state } = ctx, who = ctx.self, pl = state.players[who];
  const faceUp = (s) => s.sources.map((id, i) => ({ id, i })).filter((x) => x.i >= S.fdCount(s));
  const okSrc = (s, x) => isDigCard(x.id) && C(x.id).level != null && C(x.id).level === C(s.cardId).level;
  const cands = pl.battle.filter((s) => isDigCard(s.cardId) && (C(s.cardId).types || []).some((t) => t === '나이트 클로' || t === '라이트 팽') && faceUp(s).some((x) => okSrc(s, x)));
  if (!cands.length) { S.log(state, `${who} 진화원에 같은 Lv.의 카드를 가진 「나이트 클로」/「라이트 팽」 디지몬이 없어 비용을 지불할 수 없음`); return; }
  if (!(await ask(ctx, '「나이트 클로」/「라이트 팽」 디지몬의 진화원에서 같은 Lv.의 카드 1장을 등장시키고 조그레스 진화를 시도할까요?'))) return;
  const uid = cands.length === 1 ? cands[0].uid : await ctx.choose('pickStack', { player: who, uids: cands.map((s) => s.uid), prompt: '진화원에서 카드를 등장시킬 디지몬 선택' });
  const holder = cands.find((s) => s.uid === uid); if (!holder) return;
  const opts = faceUp(holder).filter((x) => okSrc(holder, x));
  const pick = opts.length === 1 ? opts[0].i : await ctx.choose('pickFromZoneIndex', { player: who, zone: 'sources', eligibleIdxs: opts.map((x) => x.i), prompt: '등장시킬 진화원 카드 선택' });
  if (pick == null || !opts.some((x) => x.i === pick)) return;
  const [id] = holder.sources.splice(pick, 1); S.recomputeStackGrants(holder);
  pl.trash.push(id);
  const played = S.playFreeFromZone(state, who, 'trash', pl.trash.length - 1, { fromSources: true });
  let last = played;
  if (played) {
    const digs = pl.battle.filter((s) => isDigCard(s.cardId));
    const hasJog = (h) => /〔조그레스〕/.test(C(h).effectKo || '');
    const legal = (a, b) => pl.hand.map((h, i) => i).filter((i) => isDigCard(pl.hand[i]) && hasJog(pl.hand[i]) && S.canJogress(a, b, pl.hand[i]).ok);
    const pairs = []; for (const a of digs) for (const b of digs) if (a !== b && digs.indexOf(a) < digs.indexOf(b) && legal(a, b).length) pairs.push([a, b]);
    if (!pairs.length) S.log(state, `${who} 조그레스 진화 가능한 조합이 없음`);
    else if (await ask(ctx, '자신의 디지몬 2마리로 조그레스 진화할까요?')) {
      let pair = pairs[0];
      if (pairs.length > 1) {
        const f = await ctx.choose('pickStack', { player: who, uids: [...new Set(pairs.map((p) => p[0].uid))], prompt: '조그레스 진화할 디지몬 선택' });
        const f2 = pairs.filter((p) => p[0].uid === f); if (!f2.length) return;
        const s2 = f2.length === 1 ? f2[0][1].uid : await ctx.choose('pickStack', { player: who, uids: f2.map((p) => p[1].uid), prompt: '조그레스 진화할 상대 디지몬 선택' });
        pair = f2.find((p) => p[1].uid === s2) || f2[0];
      }
      const idx = await ctx.choose('pickFromZoneIndex', { player: who, zone: 'hand', eligibleIdxs: legal(pair[0], pair[1]), prompt: '조그레스 진화할 패의 카드 선택' });
      if (idx != null) { const hid = pl.hand[idx]; const j = S.parseJogress(hid); const fused = S.fuseJogress(state, who, pair[0], pair[1], hid); if (fused && fused.uid) last = fused; }
    }
  }
  if (last && last.uid) { // 이 효과로 등장한 디지몬은 턴 종료 시에 패로 되돌아간다 (a jogress result keeps the identity of the appeared digimon)
    await R.runScript([{ op: 'atTurnEnd', when: 'this', then: [{ op: 'returnToHandStripSources', target: 'self', last: true, n: 1, filter: {}, requireSuspended: null, dest: 'hand' }] }], { ...ctx, _lastPick: { player: who, uid: last.uid } });
  }
});

// EX5-065 【자신의 턴】 자신의 디지몬에 겹쳐져 있는 카드가 디지몬의 진화원에 효과로 놓였을 때, 이 테이머를 레스트시키는 것으로, 메모리 +1.
// (no watcher existed: never triggered.) The 「겹쳐진 카드를 진화원 아래로 옮기는」 effects (EX5-007/016/064 …) emit 'sourceRotated' for the digimon's stack.
(HOOKS['EX5-065'] ||= []).push({ tag: '자신의 턴', has: '진화원에 효과로 놓였을 때', events: { sourceRotated: (state, hp, holder, info) => info.owner === hp && !!info.stack && C(info.stack.cardId).category === 'digimon' && !holder.suspended } });
sc('EX5-065::자신의 턴', async (ctx) => {
  const { state } = ctx, pl = state.players[ctx.self];
  const t = pl.battle.find((s) => s.uid === ctx.sourceStackUid);
  if (!t || t.suspended) return;
  if (!(await ask(ctx, '이 테이머를 레스트시켜 메모리 +1을 얻을까요?'))) return;
  S.restStack(state, ctx.self, t.uid);
  if (!t.suspended) return; // rest was blocked -> cost not paid
  S.grantMemory(state, ctx.self, 1, ctx.sourceCardId);
});
