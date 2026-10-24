const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required to apply the Telegram migration.');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const migration of [
      'telegram.sql',
      'telegram_document_storage.sql',
      'create_taxflow_storage_bucket.sql',
      'client_portal.sql',
      'client_portal_invites.sql',
      'create_api_rate_limits.sql',
      'decommission_telegram_file_transfer.sql',
    ]) {
      const sql = await fs.readFile(path.join(__dirname, migration), 'utf8');
      await client.query(sql);
    }
    await client.query('commit');
    console.log('Telegram text/link, private client-portal Storage, and rate-limit migrations applied successfully.');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  if (error.code === '28P01') {
    console.error('Supabase rejected the PostgreSQL login. Copy the complete connection string from this project’s Dashboard → Connect and replace only [YOUR-PASSWORD] with the current database password. Do not guess the pooler username: session-pooler usernames include the project reference. URL-encode reserved password characters. This command did not apply the migrations.');
  }
  console.error(error.message || error);
  process.exitCode = 1;
});
