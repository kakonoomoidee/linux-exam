const { Sequelize, QueryTypes } = require('sequelize');
const config = require('../config');

const sequelize = new Sequelize(config.databaseUrl, {
  dialect: 'postgres',
  logging: false,
  pool: { max: 10, idle: 10000 },
});

/**
 * Thin raw-SQL helpers over Sequelize. The rest of the app was written
 * against better-sqlite3's prepare/get/all/run; these keep the same shape
 * (get -> one row, all -> rows, run -> first RETURNING row or undefined)
 * so the models stay hand-written SQL instead of full Sequelize models.
 * Bind params are $1, $2, ... (PostgreSQL positional).
 */
module.exports = {
  sequelize,

  all: (sql, bind = []) => sequelize.query(sql, { bind, type: QueryTypes.SELECT }),

  get: async (sql, bind = []) => {
    const rows = await sequelize.query(sql, { bind, type: QueryTypes.SELECT });
    return rows[0];
  },

  run: async (sql, bind = []) => {
    const [rows] = await sequelize.query(sql, { bind });
    return Array.isArray(rows) ? rows[0] : undefined;
  },
};
