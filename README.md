# Tekser Exam — Ujian Praktikum Linux (Real Sandbox)

Platform ujian praktikum Linux: soal cerita, dikerjakan di container Docker
terisolasi per mahasiswa, dinilai otomatis secara real-time (bahkan untuk
command read-only seperti `cat`), dengan dashboard review manual buat asisten
dosen kasih nilai parsial (0/25/50/75/100%).

## Cara kerja singkat

1. Admin bikin sesi, upload daftar NIM peserta. Variant soal (0-9) otomatis
   ditentukan dari digit terakhir NIM.
2. Admin klik **Start** → tiap peserta dapet container Docker sendiri
   (isolated, no internet, resource-limited). Timer per-peserta mulai begitu
   container-nya siap, bukan pas tombol Start ditekan — supaya boot time
   container gak motong waktu ujian.
3. Mahasiswa ngetik command di terminal browser (xterm.js) yang di-bridge ke
   container mereka lewat WebSocket.
4. Setiap command yang dieksekusi di container otomatis dikirim ke server
   (lewat shell hook, bukan parsing PTY stream) dan dicocokkan ke pola jawaban
   yang diharapkan. Kalau cocok, mahasiswa langsung dapet feedback visual +
   soal itu tercatat lunas.
5. Waktu habis (atau submit manual) → container di-destroy, soal yang
   butuh validasi state (`mkdir`, `chmod`, dll) dicek terakhir kali sebelum
   container mati.
6. Asisten dosen buka dashboard review, lihat command log tiap mahasiswa per
   soal (termasuk command yang salah/typo — bukan cuma yang match), dan bisa
   override nilai jadi 0/25/50/75/100%.

## Struktur folder

```
docker-compose.yml     - app server + PostgreSQL, satu perintah up
server/
  Dockerfile        - image app server (Node + Sequelize + PostgreSQL client)
  src/
    config/        - env var loader
    db/             - schema.sql (PostgreSQL), koneksi (Sequelize), migrasi
    models/         - repository layer (User, Session, Question, Submission)
    services/       - evaluator, container lifecycle, timer, excel importer, exam orchestration
    routes/         - REST API (auth, admin sessions, admin questions, admin review, student, cmd-log webhook)
    sockets/        - Socket.io: terminal I/O bridge + live score broadcast
    scripts/        - seed data, CLI excel importer
  views/            - EJS templates (Tailwind CDN, tanpa build step)
    student/        - halaman ujian mahasiswa
    admin/           - dashboard admin (+ partials per tab)
public/
  student/js/       - frontend logic ujian mahasiswa
  admin/js/         - frontend logic dashboard admin
  shared/i18n.js    - kamus + runtime i18n (ID/EN), dipakai kedua halaman
docker/
  Dockerfile.sandbox - image environment mahasiswa
  bashrc-hook.sh      - hook yang ngirim tiap command ke server
docs/
  contoh-bank-soal.xlsx - contoh format Excel buat import soal
```

## Setup

Semua config ada di **satu file `.env` di root repo** — dipakai bareng oleh
docker-compose dan app server-nya. Copy dulu sekali:

```bash
cp .env.example .env       # atur DB_PORT, JWT_SECRET, dll
```

- **Produksi → Docker Compose** (app + PostgreSQL, satu perintah).
- **Development → `npm run dev`** (hot-reload via nodemon; DB bisa numpang
  container `db` dari compose).

---

## Produksi — Docker Compose

Semuanya jalan sebagai container, termasuk PostgreSQL.

```bash
docker compose up -d --build
docker compose exec app npm run seed   # akun admin (nim=admin, password=admin123) + 3 soal contoh (variant 5)
```

Buka:
- Mahasiswa: `http://localhost:3000/exam`
- Admin: `http://localhost:3000/admin`

Update setelah pull perubahan: `docker compose up -d --build`.
Lihat log: `docker compose logs -f app`.
Stop: `docker compose down` (data DB tetap ada di volume `pgdata`).
Reset database: `docker compose down -v` lalu `up` lagi.

### Port PostgreSQL yang bisa di-custom

Server lo udah ada PostgreSQL lain di `5432`, jadi port Postgres container ini
**tidak** di-hardcode. Atur lewat `.env`:

```
DB_PORT=5434     # port di host — ganti ke apapun yang kosong
```

Di dalam jaringan compose, app selalu nyambung ke Postgres via `db:5432`
(port internal, gak pernah bentrok). `DB_PORT` cuma nentuin port yang
di-*publish* ke host buat akses dari luar (psql, DBeaver, dsb).

---

## Development — `npm run dev`

App jalan langsung di host (nodemon, restart otomatis tiap file berubah),
DB-nya numpang container `db` dari compose. Pakai `.env` root yang sama —
`DB_HOST=localhost` di situ udah bener buat kasus ini.

```bash
docker compose up -d db     # PostgreSQL aja
cd server
npm install
npm run seed                # sekali, buat akun admin + soal contoh
npm run dev                 # http://localhost:3000  (nodemon)
```

`npm start` = jalan sekali tanpa nodemon. `npm run migrate` = apply schema
doang. Kalau udah punya PostgreSQL sendiri, skip `docker compose up -d db`
dan set `DB_HOST` / `DB_PORT` / kredensial di `.env` ke DB itu.

## Test — `npm test`

Jest (`server/`). Butuh PostgreSQL yang sama kayak dev (`docker compose up -d db`).
Test pakai database terpisah `tekser_test` — **dibuat otomatis** kalau belum
ada (lihat `tests/helpers/global-setup.js`), skema di-apply sekali di awal,
tiap test file nge-`TRUNCATE` semua tabel di `beforeEach`. Override lokasi DB
lewat `DATABASE_URL` (harus berakhiran `_test`, kalau nggak test-nya nolak
jalan).

```bash
cd server
npm test                  # semua suite
npm run test:coverage     # + tabel coverage
npx jest tests/unit       # subset
```

Struktur: `tests/unit/` (evaluator, lockService, User, importService,
containerDrivers) + `tests/integration/` (auth, adminSessions, adminQuestions,
cmd-log webhook, submit flow, review/grades, lockdown sockets, async-error
handling). Helper di `tests/helpers/` — `db.js` (`useTestDb()`), `factory.js`
(row builders), `server.js` (app + Socket.IO di port ephemeral), `sioclient.js`
(klien Socket.IO minimal di atas `ws`, karena repo nggak punya
`socket.io-client`).

**Coverage saat ini** (`npm run test:coverage`, 150 test / 14 suite):

| | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| All files | 85.2% | 73.8% | 79.4% | 87.8% |

Yang sengaja rendah: `containerDrivers.js` (25% — `DockerDriver` butuh daemon
Docker beneran; `MockDriver` 100%), `config/index.js` branch (cuma `||`
fallback env var), sebagian route `adminReview.js` (review board per-soal +
bulk-accept belum ditest). Baseline buat dipantau, bukan target 100%.

Lihat `tests/FINDINGS.md` — bug yang ketemu pas nulis test. #1 (async handler
error bikin request hang) udah difix pakai `express-async-errors`. #2–#5 belum
difix; test-nya assert behavior sekarang + ditandai `FINDING:`.

## Bahasa (i18n)

UI dua bahasa: **Indonesia** & **Inggris**. Switcher `ID / EN` ada di pojok
kanan atas halaman `/exam` dan `/admin`. Pilihan disimpan di `localStorage`;
default ngikut bahasa browser (`id*` → Indonesia, selain itu Inggris).

Semua teks ada di satu file `public/shared/i18n.js` (`DICT.id` / `DICT.en`).
Nambah/ubah teks: edit di situ, gak ada build step. String error dari server
(default Indonesia) diterjemahkan ke Inggris lewat map `ERRORS_EN` di file
yang sama.

## Mode driver container

`.env` punya `CONTAINER_DRIVER`:
- `mock` — gak butuh Docker daemon sama sekali. Buat develop UI/flow/DB tanpa
  install Docker. Terminal interaktif TIDAK akan berfungsi di mode ini
  (dilempar error kalau dicoba), tapi semua alur lain (bikin sesi, tambah
  peserta, start, grading via webhook manual) bisa ditest penuh.
- `docker` — driver asli, wajib buat ujian sungguhan. Butuh Docker daemon
  jalan di server dan image sandbox sudah di-build (lihat bawah).

## Build image sandbox

```bash
cd docker
docker build -t tekser-sandbox:latest -f Dockerfile.sandbox .
```

Kalau pakai `docker compose up --build`, ini kejadian otomatis lewat service
`sandbox-image` — build manual di atas cuma perlu kalau lu jalanin
`CONTAINER_DRIVER=docker` di luar compose.

Edit `Dockerfile.sandbox` buat nambah package yang dipelajarin di 8
pertemuan (misal `net-tools`, `cron`, dll — beberapa udah ada, tambahin
sesuai silabus PAW/PDW). Ganti isi `mahasiswa.txt` di situ juga sesuai
konten soal cerita yang sebenarnya.

**Soal jaringan sandbox — kenapa bukan `NetworkMode: none`:** container
mahasiswa butuh lapor tiap command yang dijalankan balik ke server (buat
grading real-time, termasuk command read-only kayak `cat` yang gak
ninggalin jejak di filesystem) — itu lewat `curl` di dalam container ke
`CMD_LOG_CALLBACK_URL`. Tapi container juga harus **gak boleh akses
internet** pas ujian. Dua kebutuhan ini ditangani dengan network Docker
khusus, `tekser-sandbox-net` (didefinisikan di `docker-compose.yml`,
`internal: true`) — network ini gak ada rute ke internet sama sekali, tapi
container yang ada di situ tetap bisa saling nyambung, jadi sandbox
mahasiswa bisa manggil `app` (nama service, resolve otomatis lewat DNS
compose) tanpa bisa browsing keluar. Service `app` join network ini juga
(lihat `docker-compose.yml`), dan `CMD_LOG_CALLBACK_URL` default-nya
`http://app:3000/api/cmd-log`.

Kalau `CONTAINER_DRIVER=docker` dijalankan **di luar** compose (bukan lewat
`docker compose up`), network `tekser-sandbox-net` itu gak otomatis ada —
harus dibikin manual dulu (`docker network create --internal
tekser-sandbox-net`) dan `app`-nya sendiri juga harus join network yang
sama biar bisa dipanggil balik.

## Cleanup Docker setelah ujian

Container sandbox tiap mahasiswa **di-hapus total** (`stop` + `remove`, bukan
cuma stop) otomatis di ketiga skenario: submit manual, timer habis, dan admin
hapus sesi. `driver.destroy()` idempotent — kalau container-nya udah gak ada,
itu dianggap sukses, bukan error. Jadi dalam kondisi normal gak ada yang
numpuk.

Tapi tetap bisa ada sisa: provisioning yang gagal di tengah jalan, daemon
hiccup, atau container yang di-`docker kill` manual. Dan tiap kali lu
jalanin `docker compose up --build`, image lama jadi *dangling* (`<none>`).

### Sapu container sandbox yang nyangkut

```bash
docker compose exec app npm run cleanup            # hapus tekser-* yang exited/dead/created
docker compose exec app npm run cleanup -- --dry   # cuma list, gak hapus apa-apa
docker compose exec app npm run cleanup -- --force # hapus JUGA yang masih running
```

Cuma nyentuh container yang namanya diawali `tekser-` (sandbox mahasiswa) —
gak akan ganggu container `app` / `db`. Tanpa `--force`, container yang masih
`running` **dibiarkan** (bisa jadi ada ujian yang lagi jalan). Jalanin di
host langsung juga bisa (`cd server && npm run cleanup`) selama ada akses
Docker socket.

### Prune image & container yang numpuk

```bash
docker image prune -f       # hapus dangling image (<none>) dari build berulang
docker container prune -f   # hapus semua container yang statusnya exited
```

**Kapan aman:** pas **gak ada sesi yang `running`** — cek dulu di dashboard
admin (tab Sesi) atau:

```bash
docker exec linux-exam-db-1 psql -U tekser -d tekser -c \
  "SELECT id,name,status FROM sessions WHERE status='running';"
```

Kalau kosong, aman. `docker container prune -f` bakal nyapu semua container
exited termasuk `linux-exam-sandbox-image-1` (service build yang emang
langsung exit) — itu wajar, ke-recreate lagi pas `docker compose up`
berikutnya. `docker image prune -f` gak nyentuh image yang lagi kepakai
(`tekser-sandbox:latest`, `postgres`, dll), cuma yang bener-bener dangling.

Buat bersih-bersih lebih agresif (hati-hati — ngehapus SEMUA yang gak
kepakai, bukan cuma punya proyek ini): `docker system prune -f`.

## Import soal dari Excel

Format ada di `docs/contoh-bank-soal.xlsx` — 1 sheet per variant (nama sheet
harus ada angka 0-9 di akhir, misal "Variant 0", "Variant 5"), kolom:

| Kolom | Wajib? | Keterangan |
|---|---|---|
| `order` | ya | urutan soal dalam variant tsb (1, 2, 3, ...) |
| `story` | ya | teks soal cerita yang ditampilkan ke mahasiswa |
| `point` | tidak (default 1) | bobot nilai soal |
| `check_type` | tidak (default `command_match`) | `command_match` \| `state_check` \| `both` |
| `accepted_patterns` | untuk command_match/both | regex, pisahkan beberapa pola dengan ` \| ` |
| `state_checker` | untuk state_check/both | bash script, baris terakhir output harus `PASS` atau `FAIL` |

Bisa diimport lewat dashboard admin (tab **Bank Soal**) atau CLI:
```bash
npm run import-questions -- /path/ke/soal.xlsx
```

## Keputusan desain penting (baca sebelum modif)

- **Timer server-side, bukan client-side** — biar gak bisa dimanipulasi dari
  browser. Dijadwalkan di `timerService.js`, dipicu begitu container ready.
- **Command match butuh `exit_code === 0`** — command yang gagal (termasuk
  typo) gak pernah dapet poin, meskipun teksnya kebetulan mirip pola yang
  diharapkan.
- **Command logging pakai shell hook (`PROMPT_COMMAND`), bukan parsing PTY
  stream** — parsing raw terminal bytes (ANSI codes, backspace, dll) jauh
  lebih rapuh dibanding container yang aktif lapor command-nya sendiri.
- **Container gak di-destroy saat socket disconnect** — WiFi putus atau
  refresh browser gak menggugurkan ujian; timer tetep jalan di server dan
  mahasiswa bisa reconnect ke container yang sama.
- **Command yang gak match soal manapun tetep dicatat** (`question_id: null`)
  — supaya asisten bisa lihat command salah/typo di dashboard review lewat
  tombol "Lihat semua command peserta ini", bukan cuma command yang
  kebetulan match.
- **Auto-grade adalah starting point, bukan nilai final** — `final_score`
  di tabel `submissions` nullable; kalau belum di-review manual, sistem
  fallback ke `auto_score` buat total nilai.
- **`require('express-async-errors')` di paling atas `app.js`** — Express 4
  gak nge-forward rejected promise dari async route handler ke error
  middleware, jadi tanpa ini `await` yang throw di handler bikin request
  hang selamanya (bukan 500). Dengan shim ini semua async rejection nyampe
  ke `app.use((err,...))` yang balesin `500 { error }` JSON. Jangan dicabut.
- **Lockdown on tab-switch itu deteksi + deterrent + audit trail, BUKAN
  lockdown OS-level.** Client dengerin `visibilitychange` + `window.blur`,
  langsung nutup terminal & soal pas mahasiswa pindah tab / alt-tab, lalu
  lapor `student:violation`. Server generate kode unlock 6 digit baru tiap
  pelanggaran (kode lama otomatis invalid), naikin `violation_count`, dan
  nolak `terminal:input` selama status locked (gak cuma andelin disable di
  client). Timer server-side **tetep jalan** selama locked — pindah tab gak
  nambah waktu. Batas: browser gak bisa nyegah app-switching secara fisik,
  dan mahasiswa yang niat masih bisa pakai device kedua. Asisten lihat kode
  real-time di tab "Sesi" dan bisa "Buka Paksa".

## Yang masih perlu disesuaikan sebelum dipakai ujian beneran

- [ ] Ganti password admin default (`admin123`) — lihat `seedSample.js` atau
      bikin akun admin manual lewat DB.
- [ ] Build image sandbox sesuai isi 8 pertemuan yang sebenarnya (package,
      fixture file, dll).
- [ ] Import soal cerita yang sebenarnya (bukan 3 soal contoh di variant 5).
- [ ] Tes `CONTAINER_DRIVER=docker` di server yang beneran ada Docker
      daemon-nya — semua yang di README ini udah ditest pakai `mock` driver
      karena sandbox development ini gak punya akses Docker socket.
- [ ] Pertimbangkan ganti login admin default (nim/password sederhana) kalau
      bakal dipakai lebih dari 1 asisten dosen.
