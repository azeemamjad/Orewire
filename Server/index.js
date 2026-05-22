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

// Protected API routes — accept either an admin cookie session or x-auth-token header
const protectedApi = express.Router();
protectedApi.use(auth.requireAdminApi);
protectedApi.use('/companies', require('./routes/companies'));
protectedApi.use('/filings',   require('./routes/filings'));
protectedApi.use('/upload',    require('./routes/upload'));
protectedApi.use('/scraper',   require('./routes/scraper'));
protectedApi.use('/seeder',    require('./routes/seeder'));
protectedApi.use('/pipeline',  require('./routes/pipeline'));
protectedApi.use('/market',    require('./routes/market'));
app.use('/api', protectedApi);

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
