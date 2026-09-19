// Quick database connectivity check:  node test_db.js
//
// Loads .env through src/db.js so it behaves exactly like the API does, and
// never prints the connection string (it contains the DB password).
const { pool, query } = require('./src/db');

async function main() {
  console.log('Connecting to the database...');

  const { rows } = await query('select now() as current_time, current_database() as db');
  console.log('Connected. db:', rows[0].db, '| server time:', rows[0].current_time);

  const tables = await query(
    `select table_name from information_schema.tables
     where table_schema = 'public' order by table_name`
  );
  console.log('public tables:', tables.rows.map((r) => r.table_name).join(', ') || '(none)');
}

main()
  .catch((error) => {
    console.error('Database check failed:', error.message);
    if (error.code) console.error('code:', error.code);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
