const jwt = require('jsonwebtoken');
const config = require('../config');

function signToken(user) {
  return jwt.sign(
    { id: user.id, nim: user.nim, role: user.role },
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

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    next();
  });
}

module.exports = { signToken, requireAuth, requireAdmin };
