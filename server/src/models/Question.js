const db = require('../db/connection');

const LEVELS = ['easy', 'medium', 'hard'];
const normLevel = (v) => (LEVELS.includes(String(v || '').toLowerCase()) ? String(v).toLowerCase() : 'medium');

const Question = {
  async variantIdForIndex(variantIndex) {
    const row = await db.get(
      'SELECT id FROM question_variants WHERE variant_index = $1',
      [variantIndex]
    );
    return row ? row.id : null;
  },

  // ucp: pass 1 or 2 to serve only that UCP's questions (grading + student payload
  // must always pass the session's ucp). Left null only by the admin "all banks"
  // listing, which segments client-side.
  listForVariantIndex(variantIndex, ucp = null) {
    return db.all(
      `SELECT q.* FROM questions q
       JOIN question_variants qv ON qv.id = q.variant_id
       WHERE qv.variant_index = $1
         AND ($2::smallint IS NULL OR q.ucp = $2)
       ORDER BY q.order_index`,
      [variantIndex, ucp == null ? null : Number(ucp)]
    );
  },

  findById(id) {
    return db.get('SELECT * FROM questions WHERE id = $1', [id]);
  },

  async create({
    variant_index,
    order_index,
    story_text,
    story_text_en,
    point,
    check_type,
    accepted_patterns,
    state_checker_script,
    level,
    ucp,
  }) {
    let variantId = await Question.variantIdForIndex(variant_index);
    if (!variantId) {
      const row = await db.run(
        `INSERT INTO question_variants (variant_index) VALUES ($1)
         ON CONFLICT (variant_index) DO UPDATE SET variant_index = EXCLUDED.variant_index
         RETURNING id`,
        [variant_index]
      );
      variantId = row.id;
    }
    return db.run(
      `INSERT INTO questions
         (variant_id, order_index, story_text, story_text_en, point, check_type,
          accepted_patterns, state_checker_script, level, ucp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (variant_id, ucp, order_index) DO UPDATE SET
         story_text = EXCLUDED.story_text,
         story_text_en = EXCLUDED.story_text_en,
         point = EXCLUDED.point,
         check_type = EXCLUDED.check_type,
         accepted_patterns = EXCLUDED.accepted_patterns,
         state_checker_script = EXCLUDED.state_checker_script,
         level = EXCLUDED.level
       RETURNING *`,
      [
        variantId,
        order_index,
        story_text,
        story_text_en || null,
        point === undefined || point === null || point === '' ? 1 : point,
        check_type || 'command_match',
        JSON.stringify(accepted_patterns || []),
        state_checker_script || null,
        normLevel(level),
        Number(ucp) === 2 ? 2 : 1,
      ]
    );
  },

  async update(id, fields) {
    const allowed = {
      order_index: (v) => parseInt(v, 10),
      story_text: (v) => String(v).trim(),
      story_text_en: (v) => (v ? String(v).trim() : null),
      point: (v) => parseFloat(v),
      check_type: (v) => v,
      accepted_patterns: (v) => JSON.stringify(Array.isArray(v) ? v : []),
      state_checker_script: (v) => v || null,
      level: normLevel,
      ucp: (v) => (Number(v) === 2 ? 2 : 1),
    };
    const keys = Object.keys(fields).filter((k) => k in allowed);
    if (keys.length === 0) return Question.findById(id);
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const values = keys.map((k) => allowed[k](fields[k]));
    return db.run(
      `UPDATE questions SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`,
      [...values, id]
    );
  },

  remove(id) {
    return db.run('DELETE FROM questions WHERE id = $1', [id]);
  },
};

module.exports = Question;
