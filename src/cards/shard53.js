// Shard 53 — pass-2 batch-6 verification fixes (BT9-/EX1-/EX10-/EX11-/EX12- cards). See docs/verify-pass2-b6.md.
import * as S from '../state.js';

export const SCRIPTS = {}; export const OPS = {}; export const HOOKS = {};

const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
const C = (id) => S.card(id);
const stacksOf = (state, p) => [state.players[p].raising, ...state.players[p].battle].filter(Boolean);
const findStack = (state, p, uid) => stacksOf(state, p).find((s) => s.uid === uid) || null;
const me = (ctx) => findStack(ctx.state, ctx.self, ctx.sourceStackUid);
const fn = (f) => ({ op: 's53_fn', fn: f });
OPS.s53_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
const sc = (key, f) => { SCRIPTS[key] = [fn(f)]; };
// The HK path queues the WHOLE printed body ("<trigger clause>, <effect>"); every event hook here compiles only the effect part (after the first "…때,").
const stripLead = (t) => { const m = String(t).match(/^[^]*?(?:했을|되었을|놓였을|늘어났을|줄어들었을|벗어날|소멸할|가\s*되었을|진화할)\s*때,\s*([^]*)$/); return m ? m[1] : t; };
const hk = (id, d) => {
  (HOOKS[id] ||= []).push(d);
  if ((d.events || d.onLeave) && d.has && !d.noAuto && !d.zone) SCRIPTS[`${id}::${d.tag}@${d.has}`] = [fn(async (ctx, R) => { await R.runScript(R.compileToScript(stripLead(ctx.trigger?.text || '')), ctx); })];
};
const onSelfActive = (state, hp, h, info) => info.stack === h && info.owner === hp;

// BT9-031 【자신의 턴】[턴에 1회] 이 디지몬이 액티브가 되었을 때, (진화원에 「메탈가루몬」/「X항체」가 있다면) 가장 Lv.이 낮은 상대 디지몬 전부를 패로 (conditional text is "UNSAFE" for the generic watcher -> explicit hook)
hk('BT9-031', { tag: '자신의 턴', has: '이 디지몬이 액티브가 되었을 때', limit: 1, events: { active: onSelfActive, unsuspend: onSelfActive } });

// BT9-050 / BT9-051 【서로의 턴】 이 디지몬이 배틀에서 소멸할 때, 진화원에서 「레오몬」 1장을 코스트 없이 등장 — shard31's script picked the LAST trashed source card
// (any name, e.g. the card right above the 「레오몬」), not the 「레오몬」 itself.
for (const id of ['BT9-050', 'BT9-051']) sc(id + '::서로의 턴', async (ctx) => {
  const pl = ctx.state.players[ctx.self];
  const ids = [...(ctx.trigger?.evt?.sources || [])];
  let i = -1;
  for (let k = pl.trash.length - 1; k >= 0; k--) if (ids.includes(pl.trash[k]) && C(pl.trash[k]).category === 'digimon' && S.cardNameIs(pl.trash[k], '레오몬')) { i = k; break; }
  if (i < 0) return;
  if (!(await ctx.choose('confirmEffect', { player: ctx.self, prompt: '진화원의 「레오몬」을 코스트를 지불하지 않고 등장시키겠습니까?' }))) return;
  S.playFreeFromZone(ctx.state, ctx.self, 'trash', i, { fromSources: true });
});

// EX10-037 【자신의 턴】 / EX10-050 【서로의 턴】 (inherited): 자신의 트래시 10장마다, 이 디지몬을 DP +1000 (the "N장마다" DP line was not parsed at all)
const perTrash10 = (state, hp, h, target, tp) => (target === h && tp === hp ? 1000 * Math.floor(state.players[hp].trash.length / 10) : 0);
HOOKS['EX10-037'] = [...(HOOKS['EX10-037'] || []), { tag: '자신의 턴', src: 'inheritedKo', has: '트래시 10장마다', dp: perTrash10 }];
HOOKS['EX10-050'] = [...(HOOKS['EX10-050'] || []), { tag: '서로의 턴', src: 'inheritedKo', has: '트래시 10장마다', dp: perTrash10 }];
