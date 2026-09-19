const path = require('path');

// Load backend/.env no matter which directory the process was started from.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required. Copy .env.example to .env and set it ' +
      '(see README.md for the Supabase pooler connection string).'
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Supabase terminates TLS with a certificate chain Node does not ship.
  ssl: { rejectUnauthorized: false },
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS || 10_000),
});

// A dropped idle connection should not take the process down.
pool.on('error', (error) => {
  console.error('Unexpected error on idle postgres client:', error.message);
});

async function query(text, params) {
  return pool.query(text, params);
}

/**
 * Run `run(query)` inside a transaction. Rolls back and rethrows on failure,
 * so multi-step writes (create vessel row + link it to a player) stay atomic.
 */
async function withTransaction(run) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await run((text, params) => client.query(text, params));
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
