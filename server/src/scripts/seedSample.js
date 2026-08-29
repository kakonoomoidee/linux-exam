const migrate = require('../db/migrate');
const Question = require('../models/Question');
const User = require('../models/User');
const Session = require('../models/Session');

const sampleQuestions = [
  {
    ucp: 1,
    variant_index: 5,
    order_index: 1,
    story_text:
      'Selamat datang di server baru! Data mahasiswa ada di "mahasiswa.txt" tapi kamu belum tahu isinya. Tampilkan isi file tersebut ke layar.',
    story_text_en:
      'Welcome to the new server! The student data is in "mahasiswa.txt" but you do not know its contents yet. Print that file to the screen.',
    point: 1,
    level: 'easy',
    check_type: 'command_match',
    accepted_patterns: ['^cat\\s+mahasiswa\\.txt$', '^less\\s+mahasiswa\\.txt$', '^more\\s+mahasiswa\\.txt$'],
  },
  {
    ucp: 1,
    variant_index: 5,
    order_index: 2,
    story_text: 'Buat folder baru bernama "laporan" di direktori kerja kamu saat ini.',
    story_text_en: 'Create a new folder named "laporan" in your current working directory.',
    point: 1,
    level: 'medium',
    check_type: 'both',
    accepted_patterns: ['^mkdir\\s+laporan$'],
    state_checker_script: 'test -d ~/laporan && echo PASS || echo FAIL',
  },
  {
    // UCP 2 bank — same variant + order_index as the UCP 1 question above; the
    // (variant_id, ucp, order_index) unique key keeps them distinct.
    ucp: 2,
    variant_index: 5,
    order_index: 1,
    story_text: 'Ubah permission file "mahasiswa.txt" menjadi hanya bisa dibaca oleh owner (600).',
    story_text_en: 'Change the permission of "mahasiswa.txt" so that only the owner can read it (600).',
    point: 1,
    level: 'hard',
    check_type: 'state_check',
    accepted_patterns: [],
    state_checker_script:
      '[ "$(stat -c %a ~/mahasiswa.txt 2>/dev/null)" = "600" ] && echo PASS || echo FAIL',
  },
];

const sampleStudents = [
  { nim: '20220140055', name: 'Budi Santoso', kelas: 'A' },
  { nim: '20220140056', name: 'Siti Rahma', kelas: 'B' },
];

(async () => {
  await migrate(); // also seeds the instruktur account (ADMIN_USER / ADMIN_PASSWORD)

  // --- one example asisten (TA) so role-scoped features are testable ---
  await User.createStaff({
    nim: 'asisten',
    name: 'Asisten Praktikum',
    password: 'asisten123',
    role: 'asisten',
  });
  console.log('[seed] asisten account ready (nim=asisten / password=asisten123)');

  // --- sample students with a Kelas ---
  // findOrCreateStudent sets each new row's default password = its NIM and
  // must_change_password = true, so seeded students match the real flow.
  for (const s of sampleStudents) await User.findOrCreateStudent(s.nim, s.name, s.kelas);
  console.log(`[seed] ${sampleStudents.length} sample students inserted (password = NIM, must change on first login)`);

  // --- sample questions for variant 5 only, so the flow is testable end-to-end ---
  for (const q of sampleQuestions) await Question.create(q);
  console.log(`[seed] ${sampleQuestions.length} sample questions inserted for variant 5 (UCP 1 & UCP 2)`);

  // --- one pending session per UCP so the UCP filtering is exercisable ---
  await Session.create({ name: 'UTS Praktikum — UCP 1', duration_minutes: 15, ucp: 1 });
  await Session.create({ name: 'UTS Praktikum — UCP 2', duration_minutes: 15, ucp: 2 });
  console.log('[seed] 2 pending sessions inserted (one UCP 1, one UCP 2)');

  console.log('[seed] done. Log in as a student with nim=20220140055 and password=20220140055 (you will be asked to change it).');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
