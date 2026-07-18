import { DatabaseSync } from 'node:sqlite';
import { WorkerHeartbeat } from './health/heartbeat.js';
import { loadWorkerConfig } from './runtime/config.js';
import { TaskClaimer } from './scheduler/task-claimer.js';
import { WorkerLoop } from './runtime/worker-loop.js';
import { ChapterTaskExecutor } from './executors/chapter-task-executor.js';

const config = loadWorkerConfig();
const database = new DatabaseSync(config.databasePath);
database.exec('PRAGMA foreign_keys = ON');
database.exec('PRAGMA journal_mode = WAL');
database.exec('PRAGMA synchronous = FULL');
database.exec('PRAGMA busy_timeout = 5000');

const heartbeat = new WorkerHeartbeat(database, config);
heartbeat.start();
const loop = new WorkerLoop(
  new TaskClaimer(database, config.workerId),
  heartbeat,
  new ChapterTaskExecutor(config.apiBaseUrl, config.workerId, config.workerToken)
);
loop.start();
console.log(JSON.stringify({ service: 'wenmi-worker', status: 'ready', workerId: config.workerId }));

const shutdown = (): void => {
  loop.stop();
  heartbeat.stop();
  database.close();
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
