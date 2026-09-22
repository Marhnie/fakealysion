// EX13 scenario helpers (docs/ex13-new-cards.md). Re-exports lib-s1 + card finders for filler cards.
import { S, E, Fx, mk, put, drain, T, eq, ok, runAll, makeChoose, playCard, evolve, useOption, attack, atkSec, atkDigi, C, FILL, LOW, body, endTurnFull, dp } from './lib-s1.mjs';
export { S, E, Fx, mk, put, drain, T, eq, ok, runAll, makeChoose, playCard, evolve, useOption, attack, atkSec, atkDigi, C, FILL, LOW, body, endTurnFull, dp };
export const all = () => Object.values(S.CARDS).filter((c) => !c.isParallel);
export const mention = (c, n) => S.cardMentions(c, n);
// first card (non-EX13 by default) matching pred
export const find = (pred, { ex13 = false } = {}) => all().find((c) => (ex13 || !c.id.startsWith('EX13-')) && pred(c))?.id;
export const findAll = (pred) => all().filter(pred).map((c) => c.id);
export const V = (color, lv) => body(color, lv); // vanilla digimon
export const setTop = (st, p, ids) => { st.players[p].deck = [...ids, ...st.players[p].deck]; };
export const logs = (st, n0 = 0) => st.log.slice(0, st.log.length - n0).map((l) => l.msg).reverse();
export const errs = (st) => st._qaErr || [];
export const cur = (st, p, s) => st.players[p].battle.find((x) => x.uid === s.uid);
export const clean = (st) => { st._qaErr = []; st._qaAtk = []; return st; };
export const onBoard = (st, p, id) => st.players[p].battle.some((s) => s.cardId === id);
// queue one printed segment of `id` (by tag) on `stack` the way queueTriggersFor does, then resolve it
export async function runSeg(st, p, stack, id, tag, { inherited = false, evt = null, text = null, has = null } = {}) {
  const c = S.card(id);
  const seg = S.parseEffectSegments(inherited ? (c.optionKo || c.inheritedKo) : c.effectKo).segments.find((s) => s.tags.includes(tag) && (!has || s.body.includes(has)));
  if (!seg) throw new Error(`no segment ${tag} on ${id}`);
  st.pending.push({ uid: 'q' + Math.random(), player: p, cardId: id, stackUid: stack ? stack.uid : null, tags: seg.tags, text: text ?? seg.body, resolved: false, topId: stack ? stack.cardId : null, inherited, evt });
  await drain(st);
}
