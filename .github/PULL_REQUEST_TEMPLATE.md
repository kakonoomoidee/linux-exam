<!-- Judul PR ikut Conventional Commits, mis. feat(auth): ... / fix(admin): ... -->

## Perubahan

<!-- Apa yang berubah dan kenapa. 2-4 kalimat cukup. -->

## Area sensitif

Centang kalau PR ini nyentuh salah satunya — reviewer wajib E2E manual, bukan
cuma andelin CI:

- [ ] **Auth / sesi login** (JWT, forgot-password, role instruktur/asisten)
- [ ] **Timer ujian** (`started_at + durasi`, join telat, sisa waktu)
- [ ] **Container lifecycle** (spawn / exec / destroy, cmd-log webhook, grading pas container mati)
- [ ] **Integrasi Telegram** (bot commands, OTP, binding) — wajib dicoba ke bot beneran
- [ ] Nggak nyentuh area di atas

## Checklist

- [ ] `cd server && npm test` hijau di lokal
- [ ] Commit ngikut Conventional Commits
- [ ] Branch dari `main` terbaru (bukan cabang lama)
- [ ] Screenshot dilampirin di bawah kalau ada perubahan UI
- [ ] Kalau ada env var / step setup baru, `.env.example` + README udah diupdate

## Screenshot (kalau ada perubahan UI)

<!-- before / after -->
