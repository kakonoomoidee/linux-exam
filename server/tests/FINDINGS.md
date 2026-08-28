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
