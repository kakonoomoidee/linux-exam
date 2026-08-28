const migrate = require('../db/migrate');
const { importFromFile } = require('../services/importService');

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: npm run import-questions -- /path/to/soal.xlsx');
  process.exit(1);
}

(async () => {
  await migrate();

  const result = await importFromFile(filePath);
  console.log(`[import] ${result.created}/${result.totalRows} soal berhasil diimport`);
  if (result.errors.length) {
    console.log(`[import] ${result.errors.length} baris gagal:`);
    console.table(result.errors.map((e) => ({ sheet: e._sheet, order: e.order_index, error: e.error })));
  }
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
