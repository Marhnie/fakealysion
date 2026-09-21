// Master side: a pool of persistent child processes running arena-worker.mjs.  run(tasks) -> results (same order); dynamic scheduling.
import { fork } from 'child_process';
import * as os from 'os';
export class Pool {
  constructor(n = Math.max(1, os.cpus().length - 1)) { this.n = n; this.ws = []; this.ready = null; }
  spawn() {
    return new Promise((res) => {
      const c = fork(new URL('./arena-worker.mjs', import.meta.url), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], execArgv: [] });
      c.once('message', () => res(c));
      this.ws.push(c);
    });
  }
  async start() {
    if (this.ready) return this.ready;
    this.ready = Promise.all(Array.from({ length: this.n }, () => this.spawn()));
    return this.ready;
  }
  // task timeout: a worker stuck inside one game (livelock in a pathological param set) is killed, replaced, and its task counts as an error
  async run(tasks, onDone, timeoutMs = 90000) {
    await this.start();
    const results = new Array(tasks.length);
    let next = 0, done = 0;
    return new Promise((resolve) => {
      if (!tasks.length) return resolve(results);
      const finish = (c, i, val) => {
        results[i] = val; done++; if (onDone) onDone(done, tasks.length);
        if (done === tasks.length) resolve(results); else feed(c);
      };
      const feed = (c) => {
        if (next >= tasks.length) return;
        const i = next++;
        let timer = null;
        const h = (m) => {
          if (m.id !== i) return;
          c.off('message', h); clearTimeout(timer);
          finish(c, i, m.error ? { error: m.error } : m.result);
        };
        timer = setTimeout(async () => {
          c.off('message', h);
          try { c.kill('SIGKILL'); } catch (e) { /* ignore */ }
          this.ws = this.ws.filter((x) => x !== c);
          const nc = await this.spawn();
          finish(nc, i, { error: 'timeout' });
        }, timeoutMs);
        c.on('message', h);
        c.send({ id: i, task: tasks[i] });
      };
      for (const c of this.ws.slice()) feed(c);
    });
  }
  stop() { for (const c of this.ws) { try { c.send('exit'); } catch (e) { /* ignore */ } } }
}
export function wilson(k, n, z = 1.96) {
  if (!n) return [0, 0, 1];
  const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [p, (c - m) / d, (c + m) / d];
}
// summarise results of playPair for A vs B: draws count half
export function summarize(results) {
  const s = { games: 0, aWins: 0, bWins: 0, draws: 0, stalls: 0, errs: 0, turns: 0, msA: 0, nA: 0, msB: 0, nB: 0, maxA: 0, maxB: 0, errList: [] };
  for (const pr of results) {
    if (!pr || pr.error) { s.errs++; if (pr) s.errList.push(pr.error); continue; }
    for (const g of pr.r) {
      s.games++; s.turns += g.turns || 0; s.msA += g.msA; s.nA += g.nA; s.msB += g.msB; s.nB += g.nB; s.maxA = Math.max(s.maxA, g.maxA); s.maxB = Math.max(s.maxB, g.maxB);
      if (g.err) { s.errs++; s.errList.push(...g.errs); continue; }
      if (g.stall) { s.stalls++; continue; }
      if (g.win === 'A') s.aWins++; else if (g.win === 'B') s.bWins++; else s.draws++;
    }
  }
  const dec = s.aWins + s.bWins + s.draws;
  s.rate = dec ? (s.aWins + 0.5 * s.draws) / dec : 0.5;
  const [, lo, hi] = wilson(s.aWins + 0.5 * s.draws, dec);
  s.lo = lo; s.hi = hi; s.decided = dec;
  return s;
}
