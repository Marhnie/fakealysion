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
