const mysql = require('mysql2/promise');
const session = require('express-session');
const seed = require('./press-seed.json');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  charset: 'utf8mb4',
  connectionLimit: 5,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined
});

async function initializeDatabase() {
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS posts (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, slug VARCHAR(150) NOT NULL UNIQUE,
      title VARCHAR(180) NOT NULL, excerpt VARCHAR(500) NOT NULL, content_html MEDIUMTEXT NOT NULL,
      cover_image VARCHAR(300) NOT NULL, author VARCHAR(120) NOT NULL, category VARCHAR(80) NOT NULL,
      seo_title VARCHAR(180) NOT NULL, seo_description VARCHAR(300) NOT NULL,
      status ENUM('draft','published') NOT NULL, published_at VARCHAR(24),
      created_at VARCHAR(24) NOT NULL, updated_at VARCHAR(24) NOT NULL,
      INDEX posts_status_date (status, published_at)
    )`,
    `CREATE TABLE IF NOT EXISTS press_articles (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, title VARCHAR(180) NOT NULL,
      outlet VARCHAR(120) NOT NULL, excerpt VARCHAR(500) NOT NULL, url VARCHAR(2000) NOT NULL,
      cover_image VARCHAR(300) NOT NULL, status ENUM('draft','published') NOT NULL,
      published_at VARCHAR(24), updated_at VARCHAR(24) NOT NULL,
      INDEX press_status_date (status, published_at)
    )`,
    `CREATE TABLE IF NOT EXISTS cms_images (
      filename VARCHAR(64) PRIMARY KEY, mime_type VARCHAR(32) NOT NULL, content MEDIUMBLOB NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS cms_sessions (
      sid VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      data TEXT NOT NULL, expires_at BIGINT NOT NULL, INDEX (expires_at)
    )`,
    `CREATE TABLE IF NOT EXISTS cms_migrations (name VARCHAR(100) PRIMARY KEY)`
  ]) {
    await pool.query(`${sql} ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4`);
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [migration] = await connection.execute('INSERT IGNORE INTO cms_migrations (name) VALUES (?)', ['initial-press']);
    if (migration.affectedRows) {
      const now = new Date().toISOString();
      for (const article of seed) {
        await connection.execute(
          "INSERT INTO press_articles (title,outlet,excerpt,url,cover_image,status,published_at,updated_at) VALUES (?,?,?,?,?,'published',?,?)",
          [article.title, article.outlet, article.excerpt, article.url, '/' + article.cover_image, now, now]
        );
      }
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const deleteExpiredSessions = () => pool.execute('DELETE FROM cms_sessions WHERE expires_at <= ?', [Date.now()]);
  await deleteExpiredSessions();
  setInterval(() => deleteExpiredSessions().catch((error) => console.error(error.code)), 3600000).unref();
}

class SessionStore extends session.Store {
  get(sid, callback) {
    pool.execute('SELECT data FROM cms_sessions WHERE sid = ? AND expires_at > ?', [sid, Date.now()])
      .then(([[row]]) => row ? JSON.parse(row.data) : null)
      .then((data) => callback(null, data), callback);
  }

  set(sid, data, callback) {
    const expiresAt = new Date(data.cookie.expires).getTime();
    const payload = JSON.stringify(data);
    pool.execute('INSERT INTO cms_sessions (sid,data,expires_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE data=?,expires_at=?',
      [sid, payload, expiresAt, payload, expiresAt]).then(() => callback(), callback);
  }

  touch(sid, data, callback) {
    pool.execute('UPDATE cms_sessions SET expires_at=? WHERE sid=?',
      [new Date(data.cookie.expires).getTime(), sid]).then(() => callback(), callback);
  }

  destroy(sid, callback) {
    pool.execute('DELETE FROM cms_sessions WHERE sid=?', [sid]).then(() => callback(), callback);
  }
}

module.exports = { pool, initializeDatabase, SessionStore };
