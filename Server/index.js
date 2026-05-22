require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const auth       = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 3000;

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
app.use('/api', apiRouter);

// ── Admin panel auth (cookie session) ──────────────────────────────────────
// Login page is the only /admin path that is open without a cookie.
app.get('/admin/login', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
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
app.use('/admin', express.static(path.join(__dirname, 'public')));

app.get('/', (_req, res) => res.redirect('/admin'));

app.listen(PORT, () => {
  console.log(`Mining Intel server running → http://localhost:${PORT}`);
});
