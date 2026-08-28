const migrate = require('../db/migrate');
const Question = require('../models/Question');

const sampleQuestions = [
  {
    variant_index: 5,
    order_index: 1,
    story_text:
      'Selamat datang di server baru! Data mahasiswa ada di "mahasiswa.txt" tapi kamu belum tahu isinya. Tampilkan isi file tersebut ke layar.',
    point: 1,
    check_type: 'command_match',
    accepted_patterns: ['^cat\\s+mahasiswa\\.txt$', '^less\\s+mahasiswa\\.txt$', '^more\\s+mahasiswa\\.txt$'],
  },
  {
    variant_index: 5,
    order_index: 2,
    story_text: 'Buat folder baru bernama "laporan" di direktori kerja kamu saat ini.',
    point: 1,
    check_type: 'both',
    accepted_patterns: ['^mkdir\\s+laporan$'],
    state_checker_script: 'test -d ~/laporan && echo PASS || echo FAIL',
  },
  {
    variant_index: 5,
    order_index: 3,
    story_text: 'Ubah permission file "mahasiswa.txt" menjadi hanya bisa dibaca oleh owner (600).',
    point: 1,
    check_type: 'state_check',
    accepted_patterns: [],
    state_checker_script:
      '[ "$(stat -c %a ~/mahasiswa.txt 2>/dev/null)" = "600" ] && echo PASS || echo FAIL',
  },
];

(async () => {
  await migrate(); // also seeds the admin account (ADMIN_USER / ADMIN_PASSWORD)

  // --- sample questions for variant 5 only, so the flow is testable end-to-end ---
  for (const q of sampleQuestions) await Question.create(q);
  console.log(`[seed] ${sampleQuestions.length} sample questions inserted for variant 5`);

  console.log('[seed] done. Try logging in as a student with any NIM ending in 5, e.g. nim=20220140055');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
