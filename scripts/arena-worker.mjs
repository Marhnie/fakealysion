// child process of scripts/arena-pool.mjs: receives { id, task } over IPC, answers { id, result }
import { playPair, init } from './arena-core.mjs';
await init();
process.on('message', async (m) => {
  if (m === 'exit') process.exit(0);
  try { process.send({ id: m.id, result: await playPair(m.task) }); } catch (e) { process.send({ id: m.id, error: String(e && e.stack).slice(0, 500) }); }
});
process.send({ ready: true });
