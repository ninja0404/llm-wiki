import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { config } from './config.js';
import * as schema from '../db/schema/index.js';

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 20,
});

export const db = drizzle(pool, { schema });
export type Database = typeof db;
