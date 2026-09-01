# Contributing

Internal tool buat tim kecil (instruktur + asisten). Nggak ada proses formal —
dokumen ini cuma nyatetin cara kerja yang udah jalan biar konsisten.

## Alur

1. **Branch dari `main` terbaru.** Satu branch per perubahan, prefixnya:
   - `feat/` fitur baru
   - `fix/` perbaikan bug
   - `refactor/` ubah struktur tanpa ubah behavior
   - `chore/` tooling, config, dependency, CI
   - `test/` nambah / rapiin test
2. **Commit ikut [Conventional Commits](https://www.conventionalcommits.org/):**
   `<type>(<scope>): <deskripsi>` — imperative, huruf kecil, tanpa titik.
   Scope ngikut area kode (`admin`, `auth`, `student`, `kelas`, `telegram`,
   `review`, `compose`, `env`, `ui`, ...).
   Contoh: `feat(auth): add refresh token rotation`
3. **Buka Draft PR dulu** pas masih dikerjain. Jadiin "Ready for review" kalau
   udah beres + CI hijau.
4. **Nggak ada yang di-merge tanpa review manual dari satu orang lain.** Buat
   perubahan yang integrasi ke layanan luar (Telegram OTP, dll) reviewer wajib
   nyoba beneran — test otomatis pakai mock, nggak nyentuh API asli.
5. **Merge lewat GitHub PR** ("Merge pull request"), bukan push langsung ke
   `main`. Hapus branch setelah merge.

## Sebelum push

```bash
cd server
npm ci          # kalau lockfile berubah
npm test        # wajib hijau
```

## CI

Tiap PR ke `main` jalanin (lihat `.github/workflows/`):

- **test** — `npm test` (Jest + Postgres service container). DB `tekser_test`
  dibikin & dimigrate otomatis sama `tests/helpers/global-setup.js`.
- **docker-build** — `docker compose config` + `docker compose build` biar
  salah config compose ketauan sebelum sampe server.
- **CodeQL** — scan keamanan JavaScript.

**PR nggak boleh di-merge sebelum semua job ijo.** Branch protection di
`main` di-enforce di GitHub settings.

## Yang butuh E2E manual (CI nggak nutup ini)

CI jalan full-mock. Kalau PR nyentuh salah satu ini, coba manual sesuai
checklist di `.github/PULL_REQUEST_TEMPLATE.md`:

- auth / sesi login / role
- timer ujian (`started_at + durasi`, join telat)
- container lifecycle (spawn/exec/destroy, cmd-log webhook, grading pas container mati)
- integrasi Telegram
