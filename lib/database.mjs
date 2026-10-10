import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const schema = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    password_hash TEXT NOT NULL, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dreams (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL, content TEXT NOT NULL, dream_date TEXT NOT NULL,
    emotions TEXT NOT NULL, symbols TEXT NOT NULL, themes TEXT NOT NULL, analysis TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    dream_id TEXT REFERENCES dreams(id) ON DELETE SET NULL, title TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    position INTEGER NOT NULL, role TEXT NOT NULL CHECK(role IN ('user','assistant')),
    content TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(conversation_id, position)
  )`,
  'CREATE INDEX IF NOT EXISTS dreams_owner_date ON dreams(user_id, dream_date)',
  'CREATE INDEX IF NOT EXISTS conversations_owner ON conversations(user_id, updated_at)',
  'CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at)',
];

export async function createDatabase({ url, filename, pool: suppliedPool } = {}) {
  let db;
  if (url || suppliedPool) {
    const { default: pg } = await import('pg');
    const pool = suppliedPool || new pg.Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 10_000 });
    pool.on?.('error', () => console.error('Соединение с PostgreSQL прервано. Пул восстановит подключение при следующем запросе.'));
    const wrap = client => ({
      async query(sql, values = []) {
        let position = 0;
        const result = await client.query(sql.replace(/\?/g, () => `$${++position}`), values);
        return result.rows;
      },
    });
    db = {
      ...wrap(pool),
      async transaction(task) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await task(wrap(client));
          await client.query('COMMIT');
          return result;
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
      },
      close: () => pool.end(),
    };
  } else {
    const path = filename || resolve('data/somnii.sqlite');
    if (path !== ':memory:') await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const { DatabaseSync } = await import('node:sqlite');
    const sqlite = new DatabaseSync(path);
    sqlite.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    let queue = Promise.resolve();
    const run = task => {
      const result = queue.then(task);
      queue = result.catch(() => {});
      return result;
    };
    const connection = { async query(sql, values = []) { return sqlite.prepare(sql).all(...values); } };
    db = {
      query: (sql, values) => run(() => connection.query(sql, values)),
      transaction: task => run(async () => {
        sqlite.exec('BEGIN IMMEDIATE');
        try { const result = await task(connection); sqlite.exec('COMMIT'); return result; }
        catch (error) { sqlite.exec('ROLLBACK'); throw error; }
      }),
      close: () => run(() => sqlite.close()),
    };
  }
  try { for (const sql of schema) await db.query(sql); }
  catch (error) { await db.close(); throw error; }
  return db;
}

let pending;
export function getDatabase() {
  if (process.env.RENDER && !process.env.DATABASE_URL) {
    const error = new Error('Личный кабинет пока недоступен: администратору нужно подключить базу данных.');
    error.statusCode = 503;
    throw error;
  }
  if (!pending) {
    pending = createDatabase({ url: process.env.DATABASE_URL, filename: process.env.SQLITE_PATH })
      .catch(error => { pending = undefined; throw error; });
  }
  return pending;
}
