/**
 * DUMMY data for developing / screenshotting Review Nilai v2. Every NIM uses
 * the fictional 9999 prefix and every name is made up — never put real
 * student data here. The last NIM digit is the variant (0 or 1), as in prod.
 */

const bank = [
  // ---- variant 0 ----
  { variant_index: 0, order_index: 1, level: 'easy', check_type: 'command_match',
    story_text: 'Tampilkan 5 baris pertama dari file /proc/meminfo.',
    story_text_en: 'Show the first 5 lines of /proc/meminfo.',
    accepted_patterns: ['^head\\s+(-n\\s*5|-5)\\s+/proc/meminfo$', '^cat\\s+/proc/meminfo\\s*\\x7c\\s*head\\s+(-n\\s*5|-5)$'],
    sample_answers: ['head -n 5 /proc/meminfo', 'head -5 /proc/meminfo', 'cat /proc/meminfo | head -n 5'] },
  { variant_index: 0, order_index: 2, level: 'easy', check_type: 'command_match',
    story_text: 'Tampilkan daftar isi direktori "Music".',
    story_text_en: 'List the contents of the "Music" directory.',
    accepted_patterns: ['^ls\\s+Music$'], sample_answers: ['ls Music'] },
  { variant_index: 0, order_index: 3, level: 'medium', check_type: 'state_check',
    story_text: 'Buat folder bernama "laporan" di dalam direktori Desktop.',
    story_text_en: 'Create a folder named "laporan" inside the Desktop directory.',
    accepted_patterns: [], state_checker_script: 'test -d ~/Desktop/laporan && echo PASS || echo FAIL',
    sample_answers: ['mkdir ~/Desktop/laporan', 'mkdir -p Desktop/laporan'] },
  { variant_index: 0, order_index: 4, level: 'medium', check_type: 'command_match',
    story_text: 'Cari file berekstensi ".txt" dari output perintah ls.',
    story_text_en: 'Find the ".txt" files in the output of ls.',
    accepted_patterns: ['^ls\\s*\\x7c\\s*grep\\s+txt$'], sample_answers: ['ls | grep txt'] },
  { variant_index: 0, order_index: 5, level: 'hard', check_type: 'command_match',
    story_text: 'Simpan teks "tekser" ke variabel nama, lalu tampilkan isinya dalam satu baris perintah.',
    story_text_en: 'Store the text "tekser" in a variable named nama, then print it, in one command line.',
    accepted_patterns: ['^nama=tekser\\s*;\\s*echo\\s+\\$nama$', '^nama=tekser\\s*&&\\s*echo\\s+\\$nama$'],
    sample_answers: ['nama=tekser; echo $nama', 'nama="tekser" && echo $nama'] },
  // ---- variant 1 ----
  { variant_index: 1, order_index: 1, level: 'easy', check_type: 'command_match',
    story_text: 'Tampilkan 3 baris terakhir dari file /etc/passwd.',
    story_text_en: 'Show the last 3 lines of /etc/passwd.',
    accepted_patterns: ['^tail\\s+(-n\\s*3|-3)\\s+/etc/passwd$'], sample_answers: ['tail -n 3 /etc/passwd', 'tail -3 /etc/passwd'] },
  { variant_index: 1, order_index: 2, level: 'easy', check_type: 'command_match',
    story_text: 'Masuk ke direktori Documents.',
    story_text_en: 'Change into the Documents directory.',
    accepted_patterns: ['^cd\\s+(~/)?Documents/?$'], sample_answers: ['cd Documents', 'cd ~/Documents/'] },
  { variant_index: 1, order_index: 3, level: 'hard', check_type: 'command_match',
    story_text: 'Buat arsip terkompresi gzip bernama arsip.tar.gz dari folder "laporan".',
    story_text_en: 'Create a gzip-compressed archive named arsip.tar.gz from the "laporan" folder.',
    accepted_patterns: ['^tar\\s+-?[cvz]*c[cvz]*z[cvz]*f\\s+arsip\\.tar\\.gz\\s+laporan/?$'],
    sample_answers: ['tar -czf arsip.tar.gz laporan', 'tar -cvzf arsip.tar.gz laporan/'] },
  { variant_index: 1, order_index: 4, level: 'medium', check_type: 'command_match',
    story_text: 'Tampilkan baris yang mengandung kata "root" di file /etc/passwd.',
    story_text_en: 'Show the lines of /etc/passwd that contain "root".',
    accepted_patterns: ['^grep\\s+root\\s+/etc/passwd$'], sample_answers: ['grep root /etc/passwd'] },
  { variant_index: 1, order_index: 5, level: 'easy', check_type: 'command_match',
    story_text: 'Tampilkan teks "Halo Linux" ke layar.',
    story_text_en: 'Print the text "Halo Linux" to the screen.',
    // the 2nd pattern needs quotes, which the grader strips -> flagged in the summary
    accepted_patterns: ['^echo\\s+Halo Linux$', '^echo\\s+"Halo Linux"$'], sample_answers: ['echo "Halo Linux"'] },
].map((q) => ({ ucp: 1, point: 20, ...q }));

// [command, exit code]; state = which state_check questions pass at the end (by order_index)
const C = (cmd, exit = 0) => [cmd, exit];
const students = [
  { nim: '9999000010', name: 'Andi Saputra', kelas: 'A', state: [3], cmds: [
    C('head -n 5 /proc/meminfo'), C('ls Music'), C('mkdir ~/Desktop/laporan'), C('ls | grep txt'), C('nama=tekser; echo $nama')] },
  { nim: '9999000020', name: 'Bunga Lestari', kelas: 'A', state: [], cmds: [
    C('head -n5 /proc/meminfo'), C('ls Music/'), C('mkdir laporan'), C('ls *.txt'), C('nama=tekser'), C('echo $nama')] },
  { nim: '9999000030', name: 'Citra Maharani', kelas: 'A', state: [3], cmds: [
    C('cat /proc/meminfo | head -5'), C('ls ~/Music'), C('mkdir Desktop/laporan'), C('ls -l | grep txt'), C('nama=tekser && echo $nama')] },
  { nim: '9999000040', name: 'Dimas Prakoso', kelas: 'B', state: [], cmds: [
    C('haed -n 5 /proc/meminfo', 127), C('sl Music', 127), C('ls Music/'), C('whoami'), C('pwd')] },
  { nim: '9999000050', name: 'Eka Wulandari', kelas: 'B', state: [3], cmds: [
    C('head /proc/meminfo'), C('ls Music'), C('mkdir -p ~/Desktop/laporan'), C('ls|grep txt'), C('echo $nama')] },
  { nim: '9999000011', name: 'Fajar Nugroho', kelas: 'A', state: [], cmds: [
    C('tail -n 3 /etc/passwd'), C('cd Documents'), C('tar -czf arsip.tar.gz laporan'), C('grep root /etc/passwd'), C('echo "Halo Linux"')] },
  { nim: '9999000021', name: 'Gita Permata', kelas: 'A', state: [], cmds: [
    C('tail -n3 /etc/passwd'), C('cd /home/student/Documents'), C('tar -zcvf arsip.tar.gz laporan'), C('cat /etc/passwd | grep root'), C('echo Halo Linux')] },
  { nim: '9999000031', name: 'Hendra Kurniawan', kelas: 'B', state: [], cmds: [
    C('tail -3 /etc/pasword', 1), C('cd Documents'), C('tar -cf arsip.tar laporan'), C('grep -i root /etc/passwd'), C('echo Halo Linux')] },
  { nim: '9999000041', name: 'Intan Safitri', kelas: 'B', state: [], cmds: [
    C('tail -n 3 /etc/passwd'), C('cd Documnets', 1), C('tar czf arsip.tar.gz laporan'), C('grep root /etc/passwd')] },
  { nim: '9999000051', name: 'Joko Santoso', kelas: 'B', state: [], cmds: [C('ls'), C('clear')] },
];

const sessions = [
  { name: '[DEMO] UCP 1 — Kelas A', startedAt: '2026-11-03T01:00:00Z', kelas: 'A' },
  { name: '[DEMO] UCP 1 — Kelas B', startedAt: '2026-11-04T06:30:00Z', kelas: 'B' },
];

module.exports = { bank, students, sessions };
