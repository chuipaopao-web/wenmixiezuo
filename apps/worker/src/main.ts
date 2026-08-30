import { DatabaseSync } from 'node:sqlite';
import { WorkerHeartbeat } from './health/heartbeat.js';
import { loadWorkerConfig } from './runtime/config.js';
import { V7FormalizationExecutor } from './executors/v7-formalization-executor.js';
import { V7FormalizationLoop } from './runtime/v7-formalization-loop.js';

const config = loadWorkerConfig();
const database = new DatabaseSync(config.databasePath);
database.exec('PRAGMA foreign_keys = ON');
database.exec('PRAGMA journal_mode = WAL');
database.exec('PRAGMA synchronous = FULL');
database.exec('PRAGMA busy_timeout = 30000');

const heartbeat = new WorkerHeartbeat(database, config, [
  config.v7FormalizationEnabled ? 'v7-formalization' : 'v7-formalization-disabled'
]);
heartbeat.start();
const v7FormalizationLoop = config.v7FormalizationEnabled
  ? new V7FormalizationLoop(new V7FormalizationExecutor(database, config.apiBaseUrl, config.workerId, config.workerToken))
  : undefined;
v7FormalizationLoop?.start();
console.log(JSON.stringify({ service: 'wenmi-worker', status: 'ready', workerId: config.workerId,
  v7Formalization: config.v7FormalizationEnabled ? 'enabled' : 'disabled' }));

const shutdown = (): void => {
  v7FormalizationLoop?.stop();
  heartbeat.stop();
  database.close();
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
