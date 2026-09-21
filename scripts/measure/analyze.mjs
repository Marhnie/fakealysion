// node scripts/measure/analyze.mjs <exp> [--dir=out]   -> prints result tables (Wilson 95% CIs) for one experiment's raw output
import * as fs from 'fs';
import * as L from './lib.mjs';
import * as S from '../../src/state.js';
const exp = process.argv[2];
const dirArg = process.argv.find((a) => a.startsWith('--dir='));
const DIR = dirArg ? dirArg.slice(6) : 'D:/measure-out';
await L.init();
const all = JSON.parse(fs.readFileSync(`${DIR}/${exp}.json`, 'utf8'));
const ok = all.filter((r) => !r.err && !r.stall && (r.winner === 'p1' || r.winner === 'p2'));
console.log(`## ${exp}: ${all.length} games, valid decided ${ok.length}, errors ${all.filter((r) => r.err).length}, stalls ${all.filter((r) => r.stall).length}, draws/loops ${all.filter((r) => r.winner === 'draw').length}`);
const { fmtCI, wilson, pct, diffCI } = L;
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const q = (a, f) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '-');
const arms = [...new Set(ok.map((r) => r.meta.arm))];

// ---------- baseline ----------
function baseline() {
  for (const arm of arms) {
    const g = ok.filter((r) => r.meta.arm === arm);
    const tn = g.map((r) => r.turnNumber), ac = g.map((r) => r.actions);
    const ends = {}; for (const r of g) ends[r.end] = (ends[r.end] || 0) + 1;
    const firstWin = g.filter((r) => r.winner === r.first).length;
    console.log(`\n### arm=${arm}  N=${g.length}`);
    console.log(`- 총 턴(양측 합산) mean ${f1(mean(tn))}, median ${q(tn, 0.5)}, p10 ${q(tn, 0.1)}, p90 ${q(tn, 0.9)}, min ${Math.min(...tn)}, max ${Math.max(...tn)}; 행동수 mean ${f1(mean(ac))} median ${q(ac, 0.5)} p90 ${q(ac, 0.9)}`);
    console.log(`- 종료 방식: ${Object.entries(ends).map(([k, v]) => `${k} ${v} (${pct(v / g.length)})`).join(', ')}`);
    console.log(`- 선공 승률 ${fmtCI(firstWin, g.length)}`);
    const hist = {}; for (const t of tn) { const b = Math.min(t, 16); hist[b] = (hist[b] || 0) + 1; }
    console.log(`- 총턴 분포: ${Object.keys(hist).sort((a, b) => a - b).map((k) => `${k}${k == 16 ? '+' : ''}:${pct(hist[k] / g.length)}`).join(' ')}`);
  }
  // pooled
  const g = ok;
  const p1w = g.filter((r) => r.winner === 'p1').length;
  console.log(`\n### pooled N=${g.length}: 선공 승률 ${fmtCI(g.filter((r) => r.winner === r.first).length, g.length)}; p1좌석 승률 ${fmtCI(p1w, g.length)} (좌석 편향 점검)`);
  const ends = {}; for (const r of g) ends[r.end] = (ends[r.end] || 0) + 1; console.log(`- 종료방식 전체: ${JSON.stringify(ends)}`);
  // mulligan rate
  const mu = g.flatMap((r) => [r.mull.p1, r.mull.p2]); console.log(`- CPU(hard) 멀리건 비율 ${pct(mean(mu))}`);
  // memory
  const tr = g.flatMap((r) => r.turns.slice(0, -1).map((t) => ({ pass: t[1], mem: t[2], gift: t[3], win: t[0] === (r.winner === 'p1' ? 0 : 1), last: false })));
  const nT = tr.length, passN = tr.filter((t) => t.pass).length;
  console.log(`- 턴 종료 방식(전체 ${nT}턴): 패스 ${pct(passN / nT)}, 메모리 초과 자동종료 ${pct(1 - passN / nT)}`);
  const over = tr.filter((t) => !t.pass && t.gift > 0), gifts = over.map((t) => t.gift);
  console.log(`- 초과 종료 시 상대에게 넘긴 메모리: mean ${f1(mean(gifts))}, 분포 ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((k) => `${k}:${pct(gifts.filter((x) => x === k).length / Math.max(1, gifts.length))}`).join(' ')}`);
  const pw = tr.filter((t) => t.pass).map((t) => t.mem); console.log(`- 패스 시 남긴(버린) 내 메모리 평균 ${f1(mean(pw))}, 0 남김 ${pct(pw.filter((x) => x <= 0).length / pw.length)}, ≥3 남김 ${pct(pw.filter((x) => x >= 3).length / pw.length)}`);
  const allGift = tr.map((t) => t.gift); console.log(`- 다음 턴 상대 시작 메모리(=넘긴 양) 전체 평균 ${f1(mean(allGift))}`);
  // memory gift vs win of the seat that gave it
  const bins = [[0, 0], [1, 2], [3, 3], [4, 5], [6, 10]];
  console.log(`- 넘긴 메모리 크기별 (그 턴 플레이어의) 최종 승률:`);
  for (const [lo, hi] of bins) { const s = tr.filter((t) => t.gift >= lo && t.gift <= hi); console.log(`   gift ${lo}-${hi}: ${fmtCI(s.filter((t) => t.win).length, s.length)}`); }
  // security lead vs win (mover's perspective at end of own turn t)
  console.log(`- 시큐리티 격차(내 시큐리티-상대) vs 승률, 턴번호별 (그 턴을 마친 플레이어 관점):`);
  for (const T of [2, 3, 4, 5, 6, 7, 8]) {
    const rows = []; for (const r of g) { const t = r.turns[T - 1]; if (!t) continue; rows.push({ d: t[4] - t[5], win: t[0] === (r.winner === 'p1' ? 0 : 1) }); }
    const seg = (fn) => { const s = rows.filter(fn); return s.length >= 20 ? `${pct(s.filter((x) => x.win).length / s.length)}(n${s.length})` : '-'; };
    console.log(`   T${T}: 격차≤-2 ${seg((x) => x.d <= -2)} | -1 ${seg((x) => x.d === -1)} | 0 ${seg((x) => x.d === 0)} | +1 ${seg((x) => x.d === 1)} | ≥+2 ${seg((x) => x.d >= 2)}`);
  }
  // mechanics: lv4 by own turn
  console.log(`- Lv4 첫 도달 시점(본인 n번째 턴) vs 승률 (선후공 층화):`);
  const seats = g.flatMap((r) => ['p1', 'p2'].map((p) => ({ o: r.own[p], win: r.winner === p, isFirst: r.first === p, T: r.T, p, r })));
  for (const fst of [true, false]) {
    const ss = seats.filter((s) => s.isFirst === fst);
    const row = (lab, fn) => { const s = ss.filter(fn); return `${lab}: ${fmtCI(s.filter((x) => x.win).length, s.length)}`; };
    console.log(`   ${fst ? '선공' : '후공'} → ${row('Lv4@1턴', (s) => s.o.lv4 === 1)} | ${row('2턴', (s) => s.o.lv4 === 2)} | ${row('3턴', (s) => s.o.lv4 === 3)} | ${row('4턴', (s) => s.o.lv4 === 4)} | ${row('5턴+', (s) => s.o.lv4 >= 5)} | ${row('미도달', (s) => !s.o.lv4)}`);
  }
  console.log(`- 테이머 최대 보유수 vs 승률: ${[0, 1, 2, 3].map((k) => { const s = seats.filter((x) => (k === 3 ? x.o.tamerMax >= 3 : x.o.tamerMax === k)); return `${k}${k === 3 ? '+' : ''}: ${fmtCI(s.filter((x) => x.win).length, s.length)}`; }).join(' | ')}`);
  console.log(`- 최초 부화 턴 vs 승률: ${[1, 2, 3].map((k) => { const s = seats.filter((x) => x.o.hatchT === k); return `${k}턴: ${fmtCI(s.filter((x) => x.win).length, s.length)}`; }).join(' | ')}`);
  // action mix
  const tot = {}, cst = {}; for (const s of seats) { for (const [k, v] of Object.entries(s.T.acts[s.p])) tot[k] = (tot[k] || 0) + v; for (const [k, v] of Object.entries(s.T.cost[s.p])) cst[k] = (cst[k] || 0) + v; }
  console.log(`- 게임당 행동 종류(플레이어 1인 평균): ${Object.keys(tot).map((k) => `${k} ${f1(tot[k] / seats.length)}(평균코스트 ${f1(cst[k] / tot[k])})`).join(', ')}`);
  const dm = seats.map((s) => s.T.connectP[s.p]); console.log(`- 게임당 시큐리티 직접 어택 성사 수(플레이어 평균) ${f1(mean(dm))}; 디지몬 대상 어택 ${f1(mean(seats.map((s) => s.T.attDigi[s.p])))}; 블록 수 ${f1(mean(seats.map((s) => s.T.blocks[s.p])))}; 카운터 ${f1(mean(seats.map((s) => s.T.counters[s.p])))}`);
  // winner vs loser action asymmetries
  const W = seats.filter((s) => s.win), Lz = seats.filter((s) => !s.win);
  console.log(`- 승자 vs 패자 평균: 시큐리티 직접어택성사 ${f1(mean(W.map((s) => s.T.connectP[s.p])))} vs ${f1(mean(Lz.map((s) => s.T.connectP[s.p])))}; 블록 ${f1(mean(W.map((s) => s.T.blocks[s.p])))} vs ${f1(mean(Lz.map((s) => s.T.blocks[s.p])))}; 최대 디지몬보드 ${f1(mean(W.map((s) => s.o.boardMax)))} vs ${f1(mean(Lz.map((s) => s.o.boardMax)))}`);
}

// ---------- variant arms (A = variant seat / variant deck / first-listed level) ----------
function variants() {
  const ctrl = ok.filter((r) => r.meta.arm === 'cpuSelf');
  const isA = (r) => r.winner === r.meta.aSeat;
  console.log(`\n(승률 = 변형측(A)이 이긴 비율; 통제 cpuSelf 는 동일정책 대 동일정책이라 50%여야 함 — 좌석/선공 균형 설계)`);
  console.log(`| arm | N | A 승률 [95% CI] | 50% 대비 Δ(%p) [95% CI] | A선공시 | A후공시 | 평균 총턴 |`);
  console.log(`|---|---|---|---|---|---|---|`);
  const cK = ctrl.filter(isA).length, cN = ctrl.length;
  for (const arm of arms) {
    const g = ok.filter((r) => r.meta.arm === arm);
    const k = g.filter(isA).length;
    const [p, lo, hi] = wilson(k, g.length);
    const d = [p - 0.5, lo - 0.5, hi - 0.5];
    const af = g.filter((r) => r.meta.first === r.meta.aSeat), as = g.filter((r) => r.meta.first !== r.meta.aSeat);
    console.log(`| ${arm} | ${g.length} | ${pct(p)} [${pct(lo)}, ${pct(hi)}] | ${(100 * d[0]).toFixed(1)} [${(100 * d[1]).toFixed(1)}, ${(100 * d[2]).toFixed(1)}] | ${pct(af.filter(isA).length / Math.max(1, af.length))} | ${pct(as.filter(isA).length / Math.max(1, as.length))} | ${f1(mean(g.map((r) => r.turnNumber)))} |`);
  }
  // secondary: memory behaviour of the A seat
  console.log(`\nA측 행동 지표 (A 좌석의 턴만): 패스율 / 초과종료율 / 넘긴메모리 평균 / 패스시 버린메모리 / 게임당 진화수·등장수 / 공격수 / 도달Lv4 턴 / 게임당 시큐리티 직접어택 성사`);
  for (const arm of arms) {
    const g = ok.filter((r) => r.meta.arm === arm);
    const trs = g.flatMap((r) => r.turns.filter((t) => t[0] === (r.meta.aSeat === 'p1' ? 0 : 1)));
    const pass = trs.filter((t) => t[1]).length / trs.length;
    const over = trs.filter((t) => !t[1] && t[3] > 0);
    const gift = mean(trs.map((t) => t[3]));
    const wasted = mean(trs.filter((t) => t[1]).map((t) => t[2]));
    const A = g.map((r) => ({ T: r.T, p: r.meta.aSeat, o: r.own[r.meta.aSeat] }));
    console.log(`- ${arm}: pass ${pct(pass)} / overflow ${pct(1 - pass)} / gift ${f1(gift)} / wasted ${f1(wasted)} / evolve ${f1(mean(A.map((a) => a.T.acts[a.p].evolve || 0)))} play ${f1(mean(A.map((a) => a.T.acts[a.p].play || 0)))} / att ${f1(mean(A.map((a) => a.T.attackDecl[a.p])))} / lv4T ${f1(mean(A.filter((a) => a.o.lv4).map((a) => a.o.lv4)))} / connectP ${f1(mean(A.map((a) => a.T.connectP[a.p])))}`);
  }
  const ends = {}; for (const r of ok) ends[r.end] = (ends[r.end] || 0) + 1; console.log(`\n종료방식: ${JSON.stringify(ends)}`);
}
// mulligan counterfactual: in arm 'keep' A never mulligans, so its initial hand = final hand. For each mulligan rule R, compare
//   win rate of A when its (kept) hand satisfies R's "mulligan condition"  vs  win rate of A in arm R on the games where R actually mulliganed.
function mullDeep() {
  const A = (r) => r.meta.aSeat, won = (r) => r.winner === A(r);
  const hand = (r) => r.hand[A(r)].map((id) => S.card(id));
  const conds = {
    noLv3: (h) => !h.some((c) => c.category === 'digimon' && c.level === 3),
    cost3: (h) => !h.some((c) => c.category === 'digimon' && c.level === 3 && (c.cost || 0) <= 3),
    lv3or4: (h) => !h.some((c) => c.category === 'digimon' && (c.level === 3 || c.level === 4) && (c.cost || 0) <= 4),
  };
  const keep = ok.filter((r) => r.meta.arm === 'keep');
  console.log(`\n#### 멀리건 반사실 비교 (조건에 해당하는 '나쁜 핸드'를 그대로 킵 vs 멀리건)`);
  console.log(`| 규칙 | 조건 해당률 | 킵(그대로) 승률 | 멀리건 승률 | 멀리건 이득 Δ(%p) [95% CI] |\n|---|---|---|---|---|`);
  for (const [name, fn] of Object.entries(conds)) {
    const bad = keep.filter((r) => fn(hand(r)));
    const mg = ok.filter((r) => r.meta.arm === name && r.mull[A(r)] === 1);
    const kw = bad.filter(won).length, mw = mg.filter(won).length;
    const d = diffCI(mw, mg.length, kw, bad.length);
    console.log(`| ${name} | ${pct(bad.length / keep.length)} | ${fmtCI(kw, bad.length)} | ${fmtCI(mw, mg.length)} | ${(100 * d[0]).toFixed(1)} [${(100 * d[1]).toFixed(1)}, ${(100 * d[2]).toFixed(1)}] |`);
  }
  // what a good/bad kept hand is worth (arm keep, forced keep): win rate by hand features
  console.log(`\n#### 강제 킵(arm keep)에서 핸드 구성별 A 승률 (상대는 CPU 기본, n=${keep.length})`);
  const seg = (lab, fn) => { const g = keep.filter((r) => fn(hand(r))); console.log(`- ${lab}: ${fmtCI(g.filter(won).length, g.length)}`); };
  seg('Lv3 0장', (h) => h.filter((c) => c.category === 'digimon' && c.level === 3).length === 0);
  seg('Lv3 1장', (h) => h.filter((c) => c.category === 'digimon' && c.level === 3).length === 1);
  seg('Lv3 2장', (h) => h.filter((c) => c.category === 'digimon' && c.level === 3).length === 2);
  seg('Lv3 3장+', (h) => h.filter((c) => c.category === 'digimon' && c.level === 3).length >= 3);
  seg('코스트≤3 Lv3 0장', (h) => !h.some((c) => c.category === 'digimon' && c.level === 3 && (c.cost || 0) <= 3));
  seg('테이머 ≥1', (h) => h.some((c) => c.category === 'tamer'));
  seg('옵션 ≥2', (h) => h.filter((c) => c.category === 'option').length >= 2);
  seg('Lv5+ ≥2', (h) => h.filter((c) => c.category === 'digimon' && c.level >= 5).length >= 2);
}
function levels() {
  console.log(`| pair (A-B) | N | A 승률 [95% CI] | A선공시 | A후공시 | 평균 총턴 |`); console.log(`|---|---|---|---|---|---|`);
  for (const arm of arms) {
    const g = ok.filter((r) => r.meta.arm === arm); const isA = (r) => r.winner === r.meta.aSeat;
    const af = g.filter((r) => r.meta.first === r.meta.aSeat), as = g.filter((r) => r.meta.first !== r.meta.aSeat);
    console.log(`| ${arm} | ${g.length} | ${fmtCI(g.filter(isA).length, g.length)} | ${pct(af.filter(isA).length / Math.max(1, af.length))} | ${pct(as.filter(isA).length / Math.max(1, as.length))} | ${f1(mean(g.map((r) => r.turnNumber)))} |`);
  }
  const fw = ok.filter((r) => r.winner === r.first).length; console.log(`\n선공 승률(전체): ${fmtCI(fw, ok.length)}`);
  for (const arm of arms) { const g = ok.filter((r) => r.meta.arm === arm); console.log(`- ${arm}: 선공승률 ${fmtCI(g.filter((r) => r.winner === r.first).length, g.length)}, 게임길이 mean ${f1(mean(g.map((r) => r.turnNumber)))}`); }
}
function starters() {
  const names = [...new Set(ok.flatMap((r) => [r.meta.a, r.meta.b]))].sort();
  const row = {}; for (const n of names) row[n] = { w: 0, n: 0, vs: {} };
  for (const r of ok) { const a = r.meta.a, b = r.meta.b; const aw = r.winner === 'p1'; row[a].n++; row[b].n++; if (aw) row[a].w++; else row[b].w++; (row[a].vs[b] ||= [0, 0]); (row[b].vs[a] ||= [0, 0]); row[a].vs[b][1]++; row[b].vs[a][1]++; if (aw) row[a].vs[b][0]++; else row[b].vs[a][0]++; }
  console.log(`| deck | N | 승률 [95% CI] |\n|---|---|---|`);
  for (const n of names.sort((x, y) => row[y].w / row[y].n - row[x].w / row[x].n)) console.log(`| ${n} | ${row[n].n} | ${fmtCI(row[n].w, row[n].n)} |`);
  // spread vs binomial null
  const rates = names.map((n) => row[n].w / row[n].n), m = mean(rates), sd = Math.sqrt(mean(rates.map((x) => (x - m) ** 2)));
  const nAvg = mean(names.map((n) => row[n].n)); console.log(`\n덱 승률 표준편차 ${(100 * sd).toFixed(1)}%p (순수 운 기대 ${(100 * Math.sqrt(0.25 / nAvg)).toFixed(1)}%p) -> 덱 실력 분산 ≈ ${(100 * Math.sqrt(Math.max(0, sd * sd - 0.25 / nAvg))).toFixed(1)}%p`);
}
// ---------- logistic regression ----------
function logit(X, y, ridge = 1e-3, iters = 25) {
  const n = X.length, k = X[0].length; let b = new Array(k).fill(0), H;
  for (let it = 0; it < iters; it++) {
    const g = new Array(k).fill(0); H = Array.from({ length: k }, () => new Array(k).fill(0));
    for (let i = 0; i < n; i++) { let z = 0; for (let j = 0; j < k; j++) z += b[j] * X[i][j]; const p = 1 / (1 + Math.exp(-z)), w = p * (1 - p), r = y[i] - p; for (let j = 0; j < k; j++) { g[j] += r * X[i][j]; for (let l = 0; l <= j; l++) H[j][l] += w * X[i][j] * X[i][l]; } }
    for (let j = 0; j < k; j++) { for (let l = j + 1; l < k; l++) H[j][l] = H[l][j]; H[j][j] += ridge; g[j] -= ridge * b[j]; }
    const d = solve(H, g); let m = 0; for (let j = 0; j < k; j++) { b[j] += d[j]; m = Math.max(m, Math.abs(d[j])); } if (m < 1e-7) break;
  }
  const Hi = invert(H); return { b, se: b.map((_, j) => Math.sqrt(Math.max(0, Hi[j][j]))) };
}
function solve(A, g) { const n = g.length, M = A.map((r, i) => [...r, g[i]]); for (let i = 0; i < n; i++) { let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;[M[i], M[p]] = [M[p], M[i]]; const d = M[i][i] || 1e-12; for (let j = i; j <= n; j++) M[i][j] /= d; for (let r = 0; r < n; r++) if (r !== i) { const f = M[r][i]; for (let j = i; j <= n; j++) M[r][j] -= f * M[i][j]; } } return M.map((r) => r[n]); }
function invert(A) { const n = A.length, M = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]); for (let i = 0; i < n; i++) { let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;[M[i], M[p]] = [M[p], M[i]]; const d = M[i][i] || 1e-12; for (let j = 0; j < 2 * n; j++) M[i][j] /= d; for (let r = 0; r < n; r++) if (r !== i) { const f = M[r][i]; for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[i][j]; } } return M.map((r) => r.slice(n)); }
const dec = (s) => { const [m, d] = s.split('|'); const main = {}, dig = {}; for (const e of m.split(',')) if (e) { const [k, v] = e.split(':'); main[k] = +v; } for (const e of d.split(',')) if (e) { const [k, v] = e.split(':'); dig[k] = +v; } return { main, digitama: dig }; };
function handFeat(ids) { const f = { hLv3: 0, hCheap3: 0, hLv4: 0, hLv5p: 0, hTamer: 0, hOpt: 0, hBlk: 0 }; for (const id of ids) { const c = S.card(id); if (c.category === 'digimon') { if (c.level === 3) { f.hLv3++; if ((c.cost || 0) <= 3) f.hCheap3++; } else if (c.level === 4) f.hLv4++; else if (c.level >= 5) f.hLv5p++; } else if (c.category === 'tamer') f.hTamer++; else if (c.category === 'option') f.hOpt++; if (L.cardKw(id).blocker) f.hBlk++; } return f; }
function rand() {
  const rows = ok.map((r) => { const d1 = L.deckFeatures(dec(r.deckStr.p1)), d2 = L.deckFeatures(dec(r.deckStr.p2)); return { r, d1, d2, h1: handFeat(r.hand.p1), h2: handFeat(r.hand.p2), y: r.winner === 'p1' ? 1 : 0, fp: r.first === 'p1' ? 1 : 0 }; });
  const N = rows.length;
  console.log(`N=${N} 결정 게임. 선공 승률 ${fmtCI(ok.filter((r) => r.winner === r.first).length, N)}`);
  const dk = ['eggs', 'lv4', 'lv5', 'lv6', 'tamers', 'opts', 'blocker', 'jam', 'recovery', 'pierce', 'rush', 'reboot', 'secatk', 'avgCost', 'avgDp'];
  const hk = ['hCheap3', 'hLv4', 'hLv5p', 'hTamer', 'hOpt', 'hBlk'];
  // fit A: deck features only (+first). columns: [first(±1: p1 first=+1), Δfeatures...] standardized by SD of Δ
  const feats = (keys, pick) => keys.map((k) => rows.map((w) => pick(w, k)));
  const run = (keys, pick, title) => {
    const cols = feats(keys, pick); const sds = cols.map((c) => Math.sqrt(mean(c.map((x) => x * x)))) ;
    const X = rows.map((w, i) => [w.fp ? 1 : -1, ...cols.map((c, j) => c[i] / (sds[j] || 1))]);
    const m = logit(X, rows.map((w) => w.y));
    console.log(`\n#### ${title} (로지스틱, p1승리 ~ 선공 + Δ(p1−p2) 표준화 피처; 계수=1SD 변화당 log-odds; Lv3 수는 기준(lv3+lv4+lv5+lv6+테이머+옵션=50-기타)이라 제외 → 각 계수는 'Lv3 1장을 그 카드로 교체'의 효과)`);
    console.log(`| 피처 | 1SD 크기 | 계수 | z | 1SD 당 승률변화(≈%p) |\n|---|---|---|---|---|`);
    const ps = X.map((x) => 1 / (1 + Math.exp(-x.reduce((a, v, j) => a + v * m.b[j], 0)))); const mp = mean(ps), sdp = Math.sqrt(mean(ps.map((p) => (p - mp) ** 2))); const acc = mean(ps.map((p, i) => ((p > 0.5) === (rows[i].y === 1) ? 1 : 0)));
    console.log(`(모델 예측 승률의 표준편차 ${(100 * sdp).toFixed(1)}%p, 표본내 정확도 ${pct(acc)}; 순수 동전던지기=50%)`);
    const all = ['선공(+)', ...keys]; all.forEach((k, j) => { const z = m.b[j] / m.se[j]; console.log(`| ${k} | ${j ? f1(sds[j - 1]) : '-'} | ${m.b[j].toFixed(3)} | ${z.toFixed(1)} | ${(100 * m.b[j] / 4).toFixed(1)} |`); });
  };
  run(dk, (w, k) => w.d1[k] - w.d2[k], '덱 구성 피처');
  run([...dk, ...hk], (w, k) => (k[0] === 'h' && k !== 'hBlk' || k === 'hBlk' ? w.h1[k] - w.h2[k] : w.d1[k] - w.d2[k]), '덱 구성 + 오프닝 핸드(멀리건 후) 피처');
  // per-card
  const cardRows = new Map(); // id -> stats
  const stratWin = {}; // colour stratum win rate (per deck-observation)
  const obs = [];
  for (const w of rows) for (const s of ['p1', 'p2']) { const deck = dec(w.r.deckStr[s]); obs.push({ deck, win: w.r.winner === s ? 1 : 0, strat: w.r.cols[s], hand: w.r.hand[s], fp: w.r.first === s ? 1 : 0 }); }
  for (const o of obs) { const a = (stratWin[o.strat] ||= [0, 0]); a[0] += o.win; a[1]++; }
  const ids = new Set(); for (const o of obs) for (const id of Object.keys(o.deck.main)) ids.add(id);
  const res = [];
  for (const id of ids) {
    const w = obs.filter((o) => o.deck.main[id]); if (w.length < 400) continue;
    // deck effect (colour-stratified excess win rate)
    let ex = 0, var2 = 0; for (const o of w) { const [a, n] = stratWin[o.strat]; const e = a / n; ex += o.win - e; var2 += e * (1 - e); }
    const deckEff = ex / w.length, deckSE = Math.sqrt(var2) / w.length;
    // opening-hand effect within decks containing it (stratified by copies 1..4)
    let num = 0, den = 0, vv = 0, nh = 0;
    for (let c = 1; c <= 4; c++) {
      const g = w.filter((o) => o.deck.main[id] === c); const a = g.filter((o) => o.hand.includes(id)), b = g.filter((o) => !o.hand.includes(id));
      if (a.length < 20 || b.length < 20) continue; const pa = mean(a.map((o) => o.win)), pb = mean(b.map((o) => o.win)); const wt = 1 / (pa * (1 - pa) / a.length + pb * (1 - pb) / b.length + 1e-9);
      num += wt * (pa - pb); den += wt; nh += a.length;
    }
    if (!den) continue;
    const c = S.card(id); res.push({ id, name: c.nameKo, lv: c.level, cat: c.category, cost: c.cost, n: w.length, deckEff, deckZ: deckEff / deckSE, handEff: num / den, handSE: Math.sqrt(1 / den), handZ: (num / den) * Math.sqrt(den), nh });
  }
  const sorted = res.slice().sort((a, b) => b.handZ - a.handZ);
  const fmt = (r) => `| ${r.id} ${r.name} | ${r.cat}${r.lv ? ' Lv' + r.lv : ''}${r.cost != null ? ' c' + r.cost : ''} | ${r.n} | ${(100 * r.deckEff).toFixed(1)} (z ${r.deckZ.toFixed(1)}) | ${(100 * r.handEff).toFixed(1)} ±${(196 * r.handSE).toFixed(1)} (z ${r.handZ.toFixed(1)}, hand n=${r.nh}) |`;
  console.log(`\n#### 카드별 (덱 포함 n≥400인 ${res.length}종). 열: 덱 포함 시 색상층화 초과승률(%p; 교란 큼) / 오프닝핸드에 들어왔을 때 승률차(%p, 같은 덱·같은 장수 내 비교 → 비교적 깨끗)`);
  console.log(`| 카드 | 종류 | 덱포함 n | 덱포함 초과승률 | 오프닝핸드 효과 |\n|---|---|---|---|---|`);
  console.log(`**핸드 효과 상위 15**`); sorted.slice(0, 15).forEach((r) => console.log(fmt(r)));
  console.log(`**핸드 효과 하위 15**`); sorted.slice(-15).forEach((r) => console.log(fmt(r)));
  const byDeck = res.slice().sort((a, b) => b.deckZ - a.deckZ);
  console.log(`**덱 포함 초과승률 상위 15**`); byDeck.slice(0, 15).forEach((r) => console.log(fmt(r)));
  console.log(`**덱 포함 초과승률 하위 10**`); byDeck.slice(-10).forEach((r) => console.log(fmt(r)));
  const zs = res.map((r) => r.handZ); const sdZ = Math.sqrt(mean(zs.map((z) => z * z))); console.log(`\n(참고: 핸드효과 z 의 RMS = ${sdZ.toFixed(2)}; 순수 무작위라면 ≈1.0. 카드 ${res.length}종 검정이라 |z|>3.5 만 유의)`);
  // hand-level aggregated: level groups
  const grp = (fn, lab) => { const rs = res.filter(fn); const w = rs.reduce((a, r) => a + 1 / (r.handSE ** 2), 0); const m = rs.reduce((a, r) => a + r.handEff / (r.handSE ** 2), 0) / w; console.log(`- ${lab}: 카드 ${rs.length}종 가중평균 핸드효과 ${(100 * m).toFixed(2)}%p ±${(196 / Math.sqrt(w)).toFixed(2)}`); };
  console.log(`\n핸드에 들어왔을 때의 평균 효과(종류별, 역분산 가중):`);
  grp((r) => r.cat === 'digimon' && r.lv === 3 && (r.cost || 0) <= 3, 'Lv3 코스트≤3'); grp((r) => r.cat === 'digimon' && r.lv === 3 && (r.cost || 0) > 3, 'Lv3 코스트≥4');
  grp((r) => r.cat === 'digimon' && r.lv === 4, 'Lv4'); grp((r) => r.cat === 'digimon' && r.lv === 5, 'Lv5'); grp((r) => r.cat === 'digimon' && r.lv >= 6, 'Lv6+'); grp((r) => r.cat === 'tamer', '테이머'); grp((r) => r.cat === 'option', '옵션');
  grp((r) => L.cardKw(r.id).blocker === 1, '≪블로커≫ 보유'); grp((r) => L.cardKw(r.id).jam === 1, '≪재밍≫'); grp((r) => L.cardKw(r.id).recovery === 1, '≪리커버리≫'); grp((r) => L.cardKw(r.id).rush === 1, '≪속공≫'); grp((r) => L.cardKw(r.id).pierce === 1, '≪관통≫');
}

if (exp === 'base') baseline(); else if (exp === 'levels' || exp === 'levelsX') levels(); else if (exp === 'starters') starters(); else if (exp === 'rand') rand(); else { variants(); if (exp === 'mull') mullDeep(); }
