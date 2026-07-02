require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const auth       = require('./routes/auth');

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection (non-fatal):', err?.message || err);
});

const app = express();
const PORT = process.env.PORT || 3000;

// Behind nginx / Cloudflare — needed for correct wss:// and view link host
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json());

// Auth JSON API is always open (login/register/check/logout endpoints)
app.use('/api/auth', auth.router);

// JSON API routes — open (admin password only protects /admin/* pages)
const apiRouter = express.Router();
apiRouter.use('/companies', require('./routes/api/companies'));
apiRouter.use('/filings',   require('./routes/api/filings'));
apiRouter.use('/upload',    require('./routes/api/upload'));
apiRouter.use('/scraper',   require('./routes/api/scraper'));
apiRouter.use('/seeder',    require('./routes/api/seeder'));
apiRouter.use('/pipeline',  require('./routes/api/pipeline'));
apiRouter.use('/market',    require('./routes/api/market'));
apiRouter.use('/discussions', require('./routes/api/discussions'));
apiRouter.use('/news',        require('./routes/api/news'));
apiRouter.use('/jobs',        require('./routes/api/jobs'));
apiRouter.use('/applications', require('./routes/api/applications'));
apiRouter.use('/watchlist',    require('./routes/api/watchlist'));
apiRouter.use('/briefing',     require('./routes/api/briefing'));
apiRouter.use('/system',       require('./routes/api/system'));
apiRouter.use('/contact',      require('./routes/api/contact').publicRouter);

const adminApiRouter = express.Router();
adminApiRouter.use(auth.requireAdminApi);
adminApiRouter.use('/users', require('./routes/admin/admin-users'));
adminApiRouter.use('/va-tasks', require('./routes/admin/admin-va-tasks'));
adminApiRouter.use('/proxies', require('./routes/admin/admin-proxies'));
adminApiRouter.use('/ai', require('./routes/admin/admin-ai'));
adminApiRouter.use('/instrument-symbols', require('./routes/admin/admin-instrument-symbols'));
adminApiRouter.use('/storage', require('./routes/admin/admin-storage'));
adminApiRouter.use('/contact-messages', require('./routes/api/contact').adminRouter);
app.use('/api', apiRouter);
app.use('/api/admin', adminApiRouter);
app.use('/api/relay', auth.requireAdminApi, require('./relay/routes'));

// ── Admin panel auth (cookie session) ──────────────────────────────────────
// Login page is the only /admin path that is open without a cookie.
app.get('/admin/login', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/admin/relay', (_req, res) => {
  res.redirect('/admin/relay.html');
});
app.post(
  '/admin/login',
  express.urlencoded({ extended: false }),
  auth.adminLoginSubmit
);
app.get('/admin/logout',  auth.adminLogout);
app.post('/admin/logout', auth.adminLogout);

// Everything else under /admin requires a valid admin cookie.
app.use('/admin', auth.requireAdminPage);
app.use('/admin', express.static(path.join(__dirname, 'public', 'admin'), { index: 'dashboard.html' }));

app.get('/', (_req, res) => res.redirect('/admin/dashboard.html'));

const migrate = require('./db/migrate');

async function start() {
  try {
    await migrate();
    const { restoreLogs } = require('./pipeline/state');
    restoreLogs();
    const { getAllJobs, endJob, isPidAlive } = require('./lib/job-tracker');
    for (const job of getAllJobs()) {
      if (job.status === 'running') {
        endJob(job.id, 'interrupted');
        if (job.pid && job.pid !== process.pid && isPidAlive(job.pid)) {
          try { process.kill(job.pid); } catch { /* ignore */ }
        }
      }
    }
  } catch (err) {
    console.error('[DB] Migration failed (non-fatal):', err?.message || err);
  }

  try {
    const { pruneUsageLogs } = require('./lib/usage-log-retention');
    await pruneUsageLogs();
  } catch (err) {
    console.error('[usage-log] Startup prune failed (non-fatal):', err?.message || err);
  }

  const server = app.listen(PORT, () => {
    console.log(`Mining Intel server running → http://localhost:${PORT}`);
    console.log(`Admin Relay → http://localhost:${PORT}/admin/relay.html`);
    const { startAll } = require('./lib/schedulers');
    startAll({ server, app }).catch((err) => {
      console.error('[schedulers] Failed to start:', err?.message || err);
    });
  });
}

start();
