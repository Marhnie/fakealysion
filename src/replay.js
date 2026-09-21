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

// ---------- 전체 리플레이 파일 (대전이 끝난 뒤 저장 → 나중에 불러와서 처음부터 다시 볼 수 있음) ----------
// format 'digimon-sim-replay' v2: 모든 스텝의 스냅샷(+ 그 스텝에서 생긴 로그 줄)을 담는다. v1(logJSON)은 로그만 있어 화면 재생은 불가.
export function replayFileJSON(state, list = SN.TL.list) {
  const obj = {
    format: 'digimon-sim-replay', v: 2, exportedAt: Date.now(),
    decks: list[0] ? list[0].snap.meta.decks : null, firstPlayer: state && state.firstPlayer, winner: (state && state.winner) || null, turns: state && state.turnNumber,
    steps: list.map((e) => ({ label: e.label, lines: e.lines, snap: SN.snapToObject(e.snap) })),
  };
  return SN.stringify(obj, false);
}
// text -> timeline list [{snap,label,lines,dig}] (throws when it is not a v2 replay file)
export function parseReplayFile(text) {
  const o = SN.parse(text);
  if (!o || o.format !== 'digimon-sim-replay') throw new Error('디지몬 시뮬레이터 리플레이 파일이 아닙니다');
  if (o.v !== 2 || !Array.isArray(o.steps) || !o.steps.length) throw new Error('화면 재생이 가능한 리플레이(v2)가 아닙니다 — 이 파일은 로그만 담고 있습니다');
  const scratch = {};
  const list = o.steps.map((s) => ({ snap: SN.snapFromObject(s.snap, scratch), label: s.label || '', lines: s.lines || [], dig: '' }));
  return { list, meta: { decks: o.decks, winner: o.winner, firstPlayer: o.firstPlayer, turns: o.turns, exportedAt: o.exportedAt } };
}
