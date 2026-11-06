const migrate = require('../db/migrate');
const Question = require('../models/Question');
const User = require('../models/User');
const Session = require('../models/Session');
const sampleQuestions = require('./sampleQuestions');

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
