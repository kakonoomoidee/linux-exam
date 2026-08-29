const jwt = require('jsonwebtoken');
const config = require('../config');

function signToken(user) {
  return jwt.sign(
    { id: user.id, nim: user.nim, role: user.role, mustChangePassword: !!user.must_change_password },
    config.jwtSecret,
    { expiresIn: '12h' }
  );
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  // query-string token fallback: needed for plain <a href> downloads (e.g. CSV export)
  // that can't set an Authorization header.
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token || null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    req.user = jwt.verify(token, config.jwtSecret);
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Staff = instruktur (lecturer / super-admin) OR asisten (TA). Both can run
// sessions and grade; only instruktur can touch the question bank or staff
// accounts (see requireInstruktur). The 403 body is kept as 'Admin only' so
// existing clients/tests keyed on that string don't break.
function requireStaff(req, res, next) {
  requireAuth(req, res, () => {
    if (!['instruktur', 'asisten'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Admin only' });
    }
    next();
  });
}

function requireInstruktur(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'instruktur') {
      return res.status(403).json({ error: 'Instruktur only' });
    }
    next();
  });
}

// Back-compat alias: every route that used requireAdmin wants "any staff".
const requireAdmin = requireStaff;

// Students whose password is still the default (or a NULL-hash legacy row) must go through
// the change-password screen before anything else. The endpoint that changes the password
// mounts ahead of this guard. Staff carry the flag too but are never gated on it.
function requirePasswordChanged(req, res, next) {
  if (req.user && req.user.role === 'student' && req.user.mustChangePassword) {
    return res.status(403).json({ error: 'must_change_password', code: 'MUST_CHANGE_PASSWORD' });
  }
  next();
}

module.exports = {
  signToken,
  requireAuth,
  requireAdmin,
  requireStaff,
  requireInstruktur,
  requirePasswordChanged,
};
