const express = require('express');
// Express 4 does NOT forward a rejected promise from an async route handler to
// the error middleware — an un-try/catch'd `await` that throws would otherwise
// leave the request hanging forever with no response. This shim patches the
// router so every async rejection reaches the `app.use((err,...))` handler
// below. Must be required before any router is created.
require('express-async-errors');
const path = require('path');

// UI strings, injected into each page as window.__I18N__ (see views/*/index.ejs).
// Edit server/locales/{id,en}.json and restart — no build step.
const locales = {
  id: require('../locales/id.json'),
  en: require('../locales/en.json'),
};
// JSON is trusted (our own files); only neutralise a literal </script>.
const localesScript = JSON.stringify(locales).replace(/</g, '\\u003c');

const authRoutes = require('./routes/auth');
const adminSessions = require('./routes/adminSessions');
const adminQuestions = require('./routes/adminQuestions');
const adminReview = require('./routes/adminReview');
const adminStaff = require('./routes/adminStaff');
const adminStudents = require('./routes/adminStudents');
const adminAudit = require('./routes/adminAudit');
const studentRoutes = require('./routes/student');
const cmdLogRoutes = require('./routes/cmdLog');

function buildApp() {
  const app = express();
  app.use(express.json());

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '../views'));

  // registered before the routers below so it's never shadowed by their auth middleware
  app.get('/api/health', (req, res) => res.json({ ok: true }));

  app.use('/api/auth', authRoutes);
  app.use('/api/admin/sessions', adminSessions);
  app.use('/api/admin/questions', adminQuestions);
  app.use('/api/admin/review', adminReview);
  app.use('/api/admin/staff', adminStaff);
  app.use('/api/admin/students', adminStudents);
  app.use('/api/admin/audit', adminAudit);
  app.use('/api/cmd-log', cmdLogRoutes); // must come before the generic '/api' mount below
  app.use('/api', studentRoutes);

  // rendered frontends
  app.get('/', (req, res) => res.redirect('/exam'));
  app.get('/exam', (req, res) => res.render('student/index', { localesScript }));
  app.get('/admin', (req, res) => res.render('admin/index', { localesScript }));
  // Standalone (outside the dashboard tab shell): create a session, or manage one
  // (roster + join code + "Mulai Ujian"). Auth is client-side, same as /admin.
  app.get('/admin/sessions/new', (req, res) => res.render('admin/session-form', { localesScript }));
  app.get('/admin/sessions/:id', (req, res) => res.render('admin/session-form', { localesScript }));

  // static JS for those views (kept out of /exam and /admin so those paths stay EJS-only)
  app.use('/exam-assets', express.static(path.join(__dirname, '../../public/student')));
  app.use('/admin-assets', express.static(path.join(__dirname, '../../public/admin')));
  app.use('/shared', express.static(path.join(__dirname, '../../public/shared'))); // i18n.js, shared by both

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = buildApp;
