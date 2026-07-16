import { bootstrapDatabase } from './infrastructure/db/bootstrap.js';
import { openDatabase } from './infrastructure/db/database.js';
import { loadRuntimeConfig } from './infrastructure/runtime-config.js';
import { createServer } from './http/server.js';
import { ModelBindingService } from './application/agents/model-binding-service.js';
import { SystemClock, UuidGenerator } from './domain/ids.js';

const config = loadRuntimeConfig();
const database = openDatabase(config.databasePath);
bootstrapDatabase(database, config);
new ModelBindingService(database, new UuidGenerator(), new SystemClock(), config.modelRuntime.roleProfiles).bindAllBooks();
const app = await createServer(config, database);

const shutdown = async (): Promise<void> => {
  await app.close();
  database.close();
};
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

await app.listen({ host: config.apiHost, port: config.apiPort });
