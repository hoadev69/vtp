const session = require('express-session');

class SQLiteSessionStore extends session.Store {
    constructor(database) {
        super();
        this.database = database;
        this.getSession = database.prepare('SELECT session, expires_at FROM sessions WHERE sid = ?');
        this.saveSession = database.prepare(`
            INSERT INTO sessions (sid, session, expires_at) VALUES (?, ?, ?)
            ON CONFLICT(sid) DO UPDATE SET session = excluded.session, expires_at = excluded.expires_at
        `);
        this.deleteSession = database.prepare('DELETE FROM sessions WHERE sid = ?');
        this.deleteExpiredSessions = database.prepare('DELETE FROM sessions WHERE expires_at <= ?');

        this.deleteExpiredSessions.run(Date.now());
        this.cleanupTimer = setInterval(() => {
            try {
                this.deleteExpiredSessions.run(Date.now());
            } catch (error) {
                console.error('Không thể dọn session hết hạn khỏi SQLite.', error);
            }
        }, 60 * 60 * 1000).unref();
    }

    get(sid, callback) {
        try {
            const row = this.getSession.get(sid);
            if (!row || (row.expires_at !== null && row.expires_at <= Date.now())) {
                if (row) this.deleteSession.run(sid);
                return callback(null, null);
            }
            callback(null, JSON.parse(row.session));
        } catch (error) {
            callback(error);
        }
    }

    set(sid, sessionData, callback) {
        try {
            const cookieExpiry = sessionData.cookie?.expires;
            const expiresAt = cookieExpiry ? new Date(cookieExpiry).getTime() : null;
            this.saveSession.run(
                sid,
                JSON.stringify(sessionData),
                Number.isFinite(expiresAt) ? expiresAt : null,
            );
            callback?.(null);
        } catch (error) {
            callback?.(error);
        }
    }

    touch(sid, sessionData, callback) {
        this.set(sid, sessionData, callback);
    }

    destroy(sid, callback) {
        try {
            this.deleteSession.run(sid);
            callback?.(null);
        } catch (error) {
            callback?.(error);
        }
    }

    destroyUserSessions(userId) {
        const rows = this.database.prepare('SELECT sid, session FROM sessions').all();
        const sessionIds = [];
        for (const row of rows) {
            try {
                if (Number(JSON.parse(row.session)?.user?.id) === Number(userId)) sessionIds.push(row.sid);
            } catch {
                // Keep malformed rows untouched; their owner cannot be identified safely.
            }
        }

        const destroySessions = this.database.transaction(ids => {
            for (const sid of ids) this.deleteSession.run(sid);
        });
        destroySessions(sessionIds);
        return sessionIds.length;
    }
}

module.exports = SQLiteSessionStore;