const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required to apply the Telegram migration.');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    const sql = await fs.readFile(path.join(__dirname, 'telegram.sql'), 'utf8');
    await client.query('begin');
    await client.query(sql);
    await client.query('commit');
    console.log('Telegram migration applied successfully.');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => { console.error(error.message || error); process.exitCode = 1; });
