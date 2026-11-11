const { Pool } = require('pg');
const session = require('express-session');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 10000,
  allowExitOnIdle: true
});

pool.on('error', (error) => console.error('Conexão ociosa com o banco:', error.code));

class SessionStore extends session.Store {
  get(sid, callback) {
    pool.query('SELECT data FROM cms_sessions WHERE sid = $1 AND expires_at > $2', [sid, Date.now()])
      .then(({ rows: [row] }) => row ? JSON.parse(row.data) : null)
      .then((data) => callback(null, data), callback);
  }

  set(sid, data, callback) {
    const expiresAt = new Date(data.cookie.expires).getTime();
    pool.query(`
      WITH expired AS (DELETE FROM cms_sessions WHERE expires_at <= $4 AND sid <> $1)
      INSERT INTO cms_sessions (sid,data,expires_at) VALUES ($1,$2,$3)
      ON CONFLICT (sid) DO UPDATE SET data=EXCLUDED.data,expires_at=EXCLUDED.expires_at
    `, [sid, JSON.stringify(data), expiresAt, Date.now()]).then(() => callback(), callback);
  }

  touch(sid, data, callback) {
    pool.query('UPDATE cms_sessions SET expires_at=$1 WHERE sid=$2',
      [new Date(data.cookie.expires).getTime(), sid]).then(() => callback(), callback);
  }

  destroy(sid, callback) {
    pool.query('DELETE FROM cms_sessions WHERE sid=$1', [sid]).then(() => callback(), callback);
  }
}

module.exports = { pool, SessionStore };
