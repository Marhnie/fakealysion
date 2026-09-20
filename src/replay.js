// Replay / log export helpers. The replay is simply the undo timeline (src/snapshot.js TL): every stable state after each player
// action, with the log lines that action produced. The viewer (main.js glue) applies snapshot i onto a private scratch state.
import * as SN from './snapshot.js';

const PHASE = { setup: '준비', unsuspend: '언서스펜드', draw: '드로우', breeding: '육성', main: '메인', ended: '종료' };

// readable turn-by-turn text
export function logText(state, list = SN.TL.list) {
  const out = [];
  const d = state ? [state.players.p1.deckName, state.players.p2.deckName] : (list[0] ? list[0].snap.meta.decks : ['?', '?']);
  out.push('=== 디지몬 카드게임 시뮬레이터 대전 기록 ===');
  out.push(`P1 덱: ${d[0]}   /   P2 덱: ${d[1]}`);
  if (state) out.push(`선공: ${state.firstPlayer}   진행: 턴 ${state.turnNumber}${state.winner ? `   결과: ${state.winner === 'draw' ? '무승부' : state.winner + ' 승리'}` : ''}`);
  out.push(`기록 시각: ${new Date().toLocaleString('ko-KR')}`);
  out.push('');
  let lastTurn = null, lastActive = null;
  list.forEach((e, i) => {
    const m = e.snap.meta;
    if (m.turn !== lastTurn || m.active !== lastActive) { out.push(`[턴 ${m.turn} · ${m.active}]`); lastTurn = m.turn; lastActive = m.active; }
    const head = `  #${i} (${PHASE[m.phase] || m.phase}, 메모리 ${m.memory > 0 ? '+' : ''}${m.memory})`;
    if (e.lines && e.lines.length) { out.push(head); for (const l of e.lines) out.push('     - ' + l); } else out.push(head + ' ' + (e.label || ''));
  });
  return out.join('\n');
}

// JSON: step metadata + log lines, plus the first and the last full snapshot (loadable through 불러오기 as `snap`)
export function logJSON(state, list = SN.TL.list) {
  const steps = list.map((e, i) => ({ i, turn: e.snap.meta.turn, active: e.snap.meta.active, phase: e.snap.meta.phase, memory: e.snap.meta.memory, label: e.label, lines: e.lines }));
  const obj = {
    format: 'digimon-sim-replay', v: 1, exportedAt: Date.now(),
    decks: list[0] ? list[0].snap.meta.decks : null, firstPlayer: state && state.firstPlayer, winner: (state && state.winner) || null,
    steps,
    initial: list[0] ? SN.snapToObject(list[0].snap) : null,
    final: list.length ? SN.snapToObject(list[list.length - 1].snap) : null,
  };
  return SN.stringify(obj, true);
}

// human label of a step for the scrubber
export function stepTitle(list, i) {
  const e = list[i]; if (!e) return '';
  const m = e.snap.meta;
  return `${i + 1}/${list.length} · 턴 ${m.turn} (${m.active}) · ${PHASE[m.phase] || m.phase} · 메모리 ${m.memory > 0 ? '+' : ''}${m.memory}`;
}
