/**
 * Sample question bank used by `npm run seed` (variant 5, UCP 1 + UCP 2).
 * sample_answers is the readable answer key; tests/unit/answerKeyExamples.test.js
 * checks every example against its pattern with the real grader.
 */
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
    sample_answers: ['cat mahasiswa.txt', 'less mahasiswa.txt', 'more mahasiswa.txt'],
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
    sample_answers: ['mkdir laporan'],
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
    sample_answers: ['chmod 600 mahasiswa.txt', 'chmod u=rw,go= mahasiswa.txt'],
  },
];

module.exports = sampleQuestions;
