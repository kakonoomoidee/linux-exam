const db = require('../db/connection');

/**
 * Oversight trail. Written from a handful of call sites (login, Telegram binding
 * changes, password resets); read only by the instruktur-only audit page.
 * Call sites fire-and-forget: `AuditLog.record(...).catch(...)` — a logging
 * failure must never break the user action it describes.
 */
const AuditLog = {
  record({ actorType, actorId = null, action, targetUserId = null, metadata = {} }) {
    return db.run(
      `INSERT INTO audit_logs (actor_type, actor_id, action, target_user_id, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id`,
      [actorType, actorId, action, targetUserId, JSON.stringify(metadata || {})]
    );
  },

  /** Distinct action strings actually present, for the filter dropdown. */
  actions() {
    return db.all('SELECT DISTINCT action FROM audit_logs ORDER BY action');
  },

  /**
   * Filtered + server-paginated list, newest first. `nim` matches the *target*
   * student by NIM or name (ILIKE); `from`/`to` are inclusive 'YYYY-MM-DD' dates.
   */
  async list({ nim, action, from, to, page = 1, pageSize = 50 } = {}) {
    const where = [];
    const bind = [];
    if (nim) {
      bind.push(`%${nim}%`);
      where.push(`(target.nim ILIKE $${bind.length} OR target.name ILIKE $${bind.length})`);
    }
    if (action) {
      bind.push(action);
      where.push(`a.action = $${bind.length}`);
    }
    if (from) {
      bind.push(from);
      where.push(`a.created_at >= $${bind.length}::date`);
    }
    if (to) {
      bind.push(to);
      where.push(`a.created_at < ($${bind.length}::date + 1)`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const totalRow = await db.get(
      `SELECT count(*)::int AS n
         FROM audit_logs a
         LEFT JOIN users target ON target.id = a.target_user_id
         ${whereSql}`,
      bind
    );
    const total = totalRow ? totalRow.n : 0;
    const size = Math.max(1, Math.min(200, parseInt(pageSize, 10) || 50));
    const pageCount = Math.max(1, Math.ceil(total / size));
    const safePage = Math.min(Math.max(1, parseInt(page, 10) || 1), pageCount);
    const offset = (safePage - 1) * size;

    const rows = await db.all(
      `SELECT a.id, a.actor_type, a.action, a.metadata, a.created_at,
              actor.nim  AS actor_nim,  actor.name  AS actor_name,
              target.nim AS target_nim, target.name AS target_name
         FROM audit_logs a
         LEFT JOIN users actor  ON actor.id  = a.actor_id
         LEFT JOIN users target ON target.id = a.target_user_id
         ${whereSql}
         ORDER BY a.created_at DESC, a.id DESC
         LIMIT ${size} OFFSET ${offset}`,
      bind
    );
    return { rows, total, page: safePage, pageCount };
  },
};

module.exports = AuditLog;
