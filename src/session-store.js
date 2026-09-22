const session = require('express-session');
const db = require('./db');

class SqliteSessionStore extends session.Store {
  constructor(options = {}) {
    super();
    this.ttl = options.ttl || 24 * 60 * 60 * 1000;
    this.cleanupTimer = setInterval(() => this.clearExpired(), Math.min(this.ttl, 60 * 60 * 1000));
    this.cleanupTimer.unref();
  }

  get(sid, callback) {
    db.get('SELECT data, expires_at FROM sessions WHERE sid = ?', [sid])
      .then((row) => {
        if (!row || row.expires_at <= Date.now()) {
          if (row) db.run('DELETE FROM sessions WHERE sid = ?', [sid]).catch(() => {});
          return callback(null, null);
        }
        try {
          callback(null, JSON.parse(row.data));
        } catch (error) {
          callback(error);
        }
      })
      .catch(callback);
  }

  set(sid, value, callback = () => {}) {
    const expiresAt = value.cookie && value.cookie.expires
      ? new Date(value.cookie.expires).getTime()
      : Date.now() + this.ttl;
    const data = JSON.stringify(value);
    db.run(`INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)
      ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at`, [sid, data, expiresAt])
      .then(() => callback(null))
      .catch(callback);
  }

  touch(sid, value, callback = () => {}) {
    const expiresAt = value.cookie && value.cookie.expires
      ? new Date(value.cookie.expires).getTime()
      : Date.now() + this.ttl;
    const data = JSON.stringify(value);
    db.run('UPDATE sessions SET data = ?, expires_at = ? WHERE sid = ?', [data, expiresAt, sid])
      .then(() => callback(null))
      .catch(callback);
  }

  destroy(sid, callback = () => {}) {
    db.run('DELETE FROM sessions WHERE sid = ?', [sid])
      .then(() => callback(null))
      .catch(callback);
  }

  clearExpired() {
    db.run('DELETE FROM sessions WHERE expires_at <= ?', [Date.now()]).catch(() => {});
  }

  async length(callback) {
    try {
      const row = await db.get('SELECT COUNT(*) AS count FROM sessions');
      callback(null, row.count);
    } catch (error) {
      callback(error);
    }
  }

  async clear(callback) {
    try {
      await db.run('DELETE FROM sessions');
      callback(null);
    } catch (error) {
      callback(error);
    }
  }
}

module.exports = SqliteSessionStore;
