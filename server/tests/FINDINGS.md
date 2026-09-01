# Findings from the test pass

Real bugs the test suite surfaced. Findings 2–5 are **not fixed** — each has a
test asserting the *current* behaviour, tagged `FINDING:` in the test name.
Fix separately and flip the assertions.

---

## 1. Async route handlers swallow errors → the request hangs forever — ✅ FIXED

**Severity: high.** Every route handler is `async` with no `try/catch`, and the
app runs on **Express 4**, which does *not* forward a rejected promise from an
async handler to the error middleware. So any error thrown after the first
`await` in a handler → unhandled rejection → **no HTTP response is ever sent**.
Not a 500 — the client just waited until it timed out.

Was reproduced with `POST /api/admin/sessions` + `{ "duration_minutes": "abc" }`
(`Session.create` rejects in ~90 ms, the request never responded).

Affected every unguarded async handler: `routes/adminSessions.js`,
`routes/cmdLog.js`, `routes/adminReview.js`, `routes/auth.js`, `routes/student.js`.

**Fix:** `require('express-async-errors')` at the top of `src/app.js` (before
any router is created). It patches the router so every async rejection is
routed to the existing `app.use((err, req, res, next) => …)` handler, which
already replies `500 { error: 'Internal server error' }` as JSON.

Covered by `tests/integration/asyncErrors.test.js` (rejection from two
different routers → fast 500 JSON; resolving handlers unaffected) and the
reworked case in `tests/integration/adminSessions.test.js` ("a DB error inside
the async handler yields a 500 JSON response, not a hung request").

---

## 2. `services/importService.js` — parsed rows are not validated

`tests/unit/importService.test.js`, the three `FINDING:` cases:

- **Non-numeric `point`** (`"abc"`) → `parseFloat` yields `NaN`. Not rejected,
  not defaulted. It then flows into `Question.create` as `NaN`.
- **Unknown `check_type`** (a typo like `"state_chekc"`) → stored verbatim. The
  grader only understands `command_match` / `state_check` / `both`; anything
  else silently makes the question unscoreable.
- **`command_match` question with empty `accepted_patterns`** → imports cleanly
  as a question that can never be answered.

**Fix direction:** validate in `parseWorkbook` / `importFromFile` and push bad
rows into the existing `errors[]` (like the empty-`story_text` check already
does).

---

## 3. `routes/adminSessions.js` — `duration_minutes` not validated on create

`tests/integration/adminSessions.test.js`:

- Negative (`-5`) → stored as-is → a session that is already expired the moment
  it starts.
- `0` → falls through `duration_minutes || config.default` to **10**. Harmless
  but surprising (you asked for 0, you got 10).
- Non-numeric → see finding #1 (hangs).

---

## 4. `routes/auth.js` — NIM is not trimmed server-side

`tests/integration/auth.test.js`: `POST /api/auth/login/student` with
`" 20220140055 "` → 404, even though `20220140055` is registered. The server
relies entirely on the browser trimming the field. A pasted value with a
trailing space fails to log in with a "not registered" message.

---

## 5. `models/User.js` — `findOrCreateStudent` is not race-safe

`tests/unit/user.test.js`: it's check-then-insert with no `ON CONFLICT`. Two
concurrent calls for the same *new* NIM → one throws a unique-constraint error.
Data integrity holds (the `users.nim UNIQUE` constraint prevents a duplicate
row), but the throw propagates: `adminSessions` add-participants iterates NIMs
and a duplicate NIM in the same request would reject → and per finding #1, that
hangs the request.

**Fix direction:** `INSERT ... ON CONFLICT (nim) DO UPDATE SET name =
COALESCE(users.name, EXCLUDED.name) RETURNING *`.

---

## 6. `public/student/js/app.js` — a 401 from `/me/active-participant` is silently ignored — ✅ FIXED

**Severity: medium.** `resume()` (runs on every page load when `localStorage`
has a `tekser_token`) and `checkActiveParticipant()` (polls after joining a
session) both call `GET /api/me/active-participant` and only branched on
`200` / `403 MUST_CHANGE_PASSWORD` / `404`. A **401** ("Invalid or expired
token") fell straight through: `resume()` continued to `enterDashboard()` and
`checkActiveParticipant()` ran `res.json()` → `startExamUi({error: …})`. The
user landed on the dashboard holding a dead token; every later request 401'd
until a manual refresh happened to re-read a now-valid token from
`localStorage`. That's the reported "invalid token right after join, gone
after refresh" symptom — the token is a stateless JWT (`middleware/auth.js`),
so joining can't revoke a good one; the token being sent was already stale.

**Fix:** shared `resetToLogin()` helper (wipes `tekser_token` + `tekser_user`,
reloads — after which `token` is null so `resume()` doesn't re-fire). Both
functions now do `if (res.status === 401) return resetToLogin();` before any
other branch. `logout()` reuses the same helper.

**Not covered by an automated test** — there is no frontend/jsdom harness in
this repo (`testEnvironment: 'node'`) and adding one for a two-line guard isn't
worth it. Manual scenario:

1. Log in as a student, complete the forced password change, reach the
   dashboard. Copy the current `localStorage.tekser_token`.
2. In DevTools console: `localStorage.tekser_token = 'x.y.z'` (any malformed
   JWT) — or wait out / hand-edit a real token so it's expired.
3. Reload the page.
   - **Before:** lands on the dashboard; `GET /api/me/active-participant`
     shows `401` in the Network tab; "Riwayat Nilai" shows a load error.
   - **After:** `localStorage` is cleared and the page reloads once to the
     login screen. No dashboard, no half-rendered state.
4. Full-flow check (login → change password → join → wait for the post-join
   poll): completes into the waiting/exam screen with no 401.

---

## 7. Telegram-OTP password reset — deliberate ceilings (feat/telegram-otp-password-reset)

Shipped simplifications, each with a known upgrade path. None block correctness
for a single-process deployment (which is what this app is).

- **Throttle state is in-memory** (`passwordResetService.js` — `requests` /
  `verifies` Maps, same pattern as `lockService.js`; `telegramActionService.js`
  does the same for the `/unlink` → `/confirm` OTP). A process restart clears the
  per-NIM request (3/hr) and verify (5/window) counters, and the per-(chat,action)
  counters. Upgrade path: move the counters to a table (or Redis) if the app ever
  runs more than one instance.
- **Two OTP tables by design** (`password_reset_otps` vs `telegram_action_otps`).
  A password-reset code and an `/unlink` confirmation code are structurally
  non-interchangeable (different tables, different services). `telegram_action_otps`
  is keyed by `chat_id` + a free-string `action` so a future confirmed action needs
  no migration. `/changepass` deliberately reuses `password_reset_otps` (it *is* a
  password reset) and shares the per-NIM request budget with the website flow.
- **Long-poll offset is in-memory** (`lib/telegram.js` `RealTelegram._offset`).
  After a restart the bot re-reads the last few Telegram updates, so `/start
  <code>` delivery is at-least-once. Safe because link codes are single-use and
  expire; a repeat just hits the "code already used / expired" reply.
- **OTP rows are cleaned per-user, not swept** (`requestReset` deletes that
  user's consumed rows on each new request; `telegram_link_codes` similarly).
  No cron. A student who requests once and never again leaves one consumed row
  behind forever — negligible, revisit only if the tables grow surprisingly.
- **No automated coverage for the new student-facing JS** (forgot-password
  screen, "Hubungkan Telegram" card, the `t.me/…?start=` deep-link button) —
  same reason as finding #6: no jsdom harness. Manual checklist is in the PR
  description (real-bot walkthrough).
