import { bootstrapDatabase } from './bootstrap.js';
import { openDatabase } from './database.js';
import { loadRuntimeConfig } from '../runtime-config.js';

const config = loadRuntimeConfig();
const database = openDatabase(config.databasePath);
try {
  const result = bootstrapDatabase(database, config);
  console.log(JSON.stringify({ databasePath: config.databasePath, ...result }));
} finally {
  database.close();
}

