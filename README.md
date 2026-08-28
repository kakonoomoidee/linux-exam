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

Edit `Dockerfile.sandbox` buat nambah package yang dipelajarin di 8
pertemuan (misal `net-tools`, `cron`, dll — beberapa udah ada, tambahin
sesuai silabus PAW/PDW). Ganti isi `mahasiswa.txt` di situ juga sesuai
konten soal cerita yang sebenarnya.

**Penting soal `CMD_LOG_CALLBACK_URL`:** ini alamat yang dipanggil container
buat lapor command. Di Docker Desktop (Mac/Windows) `host.docker.internal`
udah otomatis kerja. Di Linux, biasanya perlu:
```bash
# tambahin ke docker run / dockerode HostConfig kalau host.docker.internal gak resolve:
--add-host=host.docker.internal:host-gateway
```
(Sudah ada tempatnya di `containerDrivers.js` kalau perlu disesuaikan.)

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
