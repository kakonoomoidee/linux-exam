const db = require('../db/connection');

const Question = {
  async variantIdForIndex(variantIndex) {
    const row = await db.get(
      'SELECT id FROM question_variants WHERE variant_index = $1',
      [variantIndex]
    );
    return row ? row.id : null;
  },

  listForVariantIndex(variantIndex) {
    return db.all(
      `SELECT q.* FROM questions q
       JOIN question_variants qv ON qv.id = q.variant_id
       WHERE qv.variant_index = $1
       ORDER BY q.order_index`,
      [variantIndex]
    );
  },

  findById(id) {
    return db.get('SELECT * FROM questions WHERE id = $1', [id]);
  },

  async create({ variant_index, order_index, story_text, point, check_type, accepted_patterns, state_checker_script }) {
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
         (variant_id, order_index, story_text, point, check_type, accepted_patterns, state_checker_script)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (variant_id, order_index) DO UPDATE SET
         story_text = EXCLUDED.story_text,
         point = EXCLUDED.point,
         check_type = EXCLUDED.check_type,
         accepted_patterns = EXCLUDED.accepted_patterns,
         state_checker_script = EXCLUDED.state_checker_script
       RETURNING *`,
      [
        variantId,
        order_index,
        story_text,
        point,
        check_type || 'command_match',
        JSON.stringify(accepted_patterns || []),
        state_checker_script || null,
      ]
    );
  },
};

module.exports = Question;
