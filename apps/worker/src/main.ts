import { DatabaseSync } from 'node:sqlite';
import { WorkerHeartbeat } from './health/heartbeat.js';
import { loadWorkerConfig } from './runtime/config.js';

const config = loadWorkerConfig();
const database = new DatabaseSync(config.databasePath);
database.exec('PRAGMA foreign_keys = ON');
database.exec('PRAGMA journal_mode = WAL');
database.exec('PRAGMA synchronous = FULL');
database.exec('PRAGMA busy_timeout = 5000');

const heartbeat = new WorkerHeartbeat(database, config);
heartbeat.start();
console.log(JSON.stringify({ service: 'wenmai-worker', status: 'ready', workerId: config.workerId }));

const shutdown = (): void => {
  heartbeat.stop();
  database.close();
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

