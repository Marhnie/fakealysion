import fs from 'fs';
const f = 'D:/닼웤롴덬/digimon-sim/src/state.js';
let s = fs.readFileSync(f, 'utf8');
const old = `  scheduleEndOfTurn(state, () => {
    const s = state.players[p].battle.find(x => x.uid === uid);
    if (!s || !s.sources.length || card(s.sources[s.sources.length - 1]).category !== 'digimon') return;
    trashEvoSources(state, p, uid, 1, 'top');
  }, { player: p, cardId, label: '버스트 진화한 턴 종료 시, 진화원 위에서 1장 파기' });`;
if (!s.includes(old)) throw new Error('nomatch');
s = s.replace(old, `  scheduleEndOfTurn(state, burstEotFn(state, p, uid), { player: p, cardId, label: '버스트 진화한 턴 종료 시, 진화원 위에서 1장 파기', desc: { kind: 'burst', p, uid } });`);
s += `
// ---- snapshot / save-game support (src/snapshot.js, src/savegame.js) ----
// Held end-of-turn entries carry a serializable \`desc\` so a saved game can rebuild their closures: EOT_REBUILD[kind](state, desc, entry) -> fn.
function burstEotFn(state, p, uid) {
  return () => {
    const s = state.players[p].battle.find(x => x.uid === uid);
    if (!s || !s.sources.length || card(s.sources[s.sources.length - 1]).category !== 'digimon') return;
    trashEvoSources(state, p, uid, 1, 'top');
  };
}
export const EOT_REBUILD = {
  memory: (state, d) => () => grantMemory(state, d.player, -d.n),
  burst: (state, d) => burstEotFn(state, d.p, d.uid),
};
// module-level counters that are part of the game (uids etc.); exact=true restores them verbatim (tests), else they only ever grow.
export function getCounters() { return { uid: uidCounter, pend: pendingUid, fx: fxSeq, ts: TS_COUNTER }; }
export function setCounters(c, exact = false) {
  if (!c) return;
  uidCounter = exact ? c.uid : Math.max(uidCounter, c.uid);
  pendingUid = exact ? c.pend : Math.max(pendingUid, c.pend);
  TS_COUNTER = exact ? c.ts : Math.max(TS_COUNTER, c.ts);
  fxSeq = Math.max(fxSeq, c.fx);
}
// re-install the non-enumerable battle-array splice tracker (structuredClone/JSON drop it) and rebind the module's live-state pointer
export function rebindState(state) { s7Bound(state); return trackLeaves(state); }
`;
fs.writeFileSync(f, s);
