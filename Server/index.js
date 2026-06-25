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
apiRouter.use('/companies', require('./routes/companies'));
apiRouter.use('/filings',   require('./routes/filings'));
apiRouter.use('/upload',    require('./routes/upload'));
apiRouter.use('/scraper',   require('./routes/scraper'));
apiRouter.use('/seeder',    require('./routes/seeder'));
apiRouter.use('/pipeline',  require('./routes/pipeline'));
apiRouter.use('/market',    require('./routes/market'));
apiRouter.use('/discussions', require('./routes/discussions'));
apiRouter.use('/news',        require('./routes/news'));
apiRouter.use('/jobs',        require('./routes/jobs'));
apiRouter.use('/applications', require('./routes/applications'));
apiRouter.use('/watchlist',    require('./routes/watchlist'));
apiRouter.use('/briefing',     require('./routes/briefing'));
apiRouter.use('/system',       require('./routes/system'));
apiRouter.use('/contact',      require('./routes/contact').publicRouter);

const adminApiRouter = express.Router();
adminApiRouter.use(auth.requireAdminApi);
adminApiRouter.use('/users', require('./routes/admin-users'));
adminApiRouter.use('/va-tasks', require('./routes/admin-va-tasks'));
adminApiRouter.use('/contact-messages', require('./routes/contact').adminRouter);
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
    const { initPipelineConfig } = require('./pipeline/config');
    const { bootstrapSchedulers } = require('./lib/pipeline-schedulers');
    const cfg = await initPipelineConfig();
    bootstrapSchedulers(cfg);
  } catch (err) {
    console.error('[pipeline] Config/schedulers failed to start:', err?.message || err);
  }

  const server = app.listen(PORT, () => {
    console.log(`Mining Intel server running → http://localhost:${PORT}`);
    console.log(`Admin Relay → http://localhost:${PORT}/admin/relay.html`);
    try {
      const { startDailyBriefingScheduler } = require('./lib/daily-briefing-scheduler');
      startDailyBriefingScheduler();
    } catch (err) {
      console.error('[briefing] Scheduler failed to start:', err?.message || err);
    }
    try {
      const { startWatchlistNewsAlertsScheduler } = require('./lib/watchlist-news-alerts-scheduler');
      startWatchlistNewsAlertsScheduler();
    } catch (err) {
      console.error('[watchlist-news] Scheduler failed to start:', err?.message || err);
    }
    try {
      const { startWatchlistFilingAlertsScheduler } = require('./lib/watchlist-filing-alerts-scheduler');
      startWatchlistFilingAlertsScheduler();
    } catch (err) {
      console.error('[watchlist-filing] Scheduler failed to start:', err?.message || err);
    }
    try {
      const { startCompanyQuoteScheduler } = require('./lib/company-quote-scheduler');
      startCompanyQuoteScheduler();
      const { maybeKickInitialRefresh } = require('./lib/company-quote-refresh');
      maybeKickInitialRefresh().catch((err) => {
        console.error('[quotes] Boot refresh check failed:', err?.message || err);
      });
    } catch (err) {
      console.error('[quotes] Scheduler failed to start:', err?.message || err);
    }

    if (process.env.RELAY_ENABLED === 'true') {
      const { initRelay } = require('./relay');
      initRelay(app, server).catch((err) => {
        console.error('[Relay] Failed to start:', err?.message || err);
      });
    }

    try {
      const { syncVaTasks } = require('./lib/va-tasks-sync');
      syncVaTasks().catch((err) => console.error('[VA tasks] Initial sync failed:', err?.message || err));
      setInterval(() => {
        syncVaTasks().catch((err) => console.error('[VA tasks] Sync failed:', err?.message || err));
      }, 60 * 1000);
    } catch (err) {
      console.error('[VA tasks] Scheduler failed to start:', err?.message || err);
    }
  });
}

start();
