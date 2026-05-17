// ─────────────────────────────────────────────────────────────────────────────
// PostgreSQL connection pool.
//
// Cloud Postgres providers (Neon, Supabase, ...) require a TLS connection and
// present publicly-trusted certificates, so Node's built-in CA store verifies
// them automatically — no certificate file is needed.
//
// For a LOCAL PostgreSQL server with no TLS, set PG_SSL=disable in .env.
// ─────────────────────────────────────────────────────────────────────────────

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('[db] DATABASE_URL is not set. Copy server/.env.example to server/.env and fill it in.');
  process.exit(1);
}

const useSsl = process.env.PG_SSL !== 'disable';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: true } : false,
  max: 5, // keep the pool small — cloud free tiers have low connection limits
});

pool.on('error', (err) => {
  console.error('[db] Unexpected error on idle client:', err.message);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
