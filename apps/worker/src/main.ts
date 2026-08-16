import { DatabaseSync } from 'node:sqlite';
import { CREATION_WORKFLOW_CONTRACT_VERSION } from '@wenmi/contracts';
import { WorkerHeartbeat } from './health/heartbeat.js';
import { loadWorkerConfig } from './runtime/config.js';
import { TaskClaimer } from './scheduler/task-claimer.js';
import { WorkerLoop } from './runtime/worker-loop.js';
import { ChapterTaskExecutor } from './executors/chapter-task-executor.js';
import { ProjectionTaskExecutor } from './executors/projection-task-executor.js';
import { ProjectionLoop } from './runtime/projection-loop.js';
import { loadLocalVectorRuntime } from './adapters/local-vector-runtime.js';
import { CanonIndexTaskExecutor } from './executors/canon-index-task-executor.js';
import { CanonIndexLoop } from './runtime/canon-index-loop.js';

const config = loadWorkerConfig();
const database = new DatabaseSync(config.databasePath);
database.exec('PRAGMA foreign_keys = ON');
database.exec('PRAGMA journal_mode = WAL');
database.exec('PRAGMA synchronous = FULL');
database.exec('PRAGMA busy_timeout = 30000');

const heartbeat = new WorkerHeartbeat(database, config, [`workflow-contract-v${CREATION_WORKFLOW_CONTRACT_VERSION}`, 'vector-projection-starting']);
heartbeat.start();
let vectorRuntime;
try {
  vectorRuntime = await loadLocalVectorRuntime(config.dataDir);
} catch (error) {
  vectorRuntime = undefined;
  console.error(JSON.stringify({ service: 'wenmi-worker', capability: 'vector-projection', status: 'degraded',
    reason: error instanceof Error ? error.name : 'UnknownError' }));
}
heartbeat.setExtraCapabilities(vectorRuntime === undefined
  ? ['vector-projection-degraded']
  : ['vector-projection', 'local-semantic']);
const loop = new WorkerLoop(
  new TaskClaimer(database, config.workerId),
  heartbeat,
  new ChapterTaskExecutor(config.apiBaseUrl, config.workerId, config.workerToken),
  config.maxConcurrency
);
loop.start();
const projectionLoop = new ProjectionLoop(new ProjectionTaskExecutor(database, config.workerId, vectorRuntime));
projectionLoop.start();
const canonIndexLoop = new CanonIndexLoop(new CanonIndexTaskExecutor(
  database, config.apiBaseUrl, config.workerId, config.workerToken
));
canonIndexLoop.start();
console.log(JSON.stringify({ service: 'wenmi-worker', status: 'ready', workerId: config.workerId,
  vectorProjection: vectorRuntime === undefined ? 'degraded' : 'ready' }));

const shutdown = (): void => {
  loop.stop();
  projectionLoop.stop();
  canonIndexLoop.stop();
  heartbeat.stop();
  database.close();
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
