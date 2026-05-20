require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const auth       = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Auth API is always open
app.use('/api/auth', auth.router);

// Protected API routes (require x-auth-token header)
const protectedApi = express.Router();
protectedApi.use(auth.adminAuth);
protectedApi.use('/companies', require('./routes/companies'));
protectedApi.use('/filings',   require('./routes/filings'));
protectedApi.use('/upload',    require('./routes/upload'));
protectedApi.use('/scraper',   require('./routes/scraper'));
protectedApi.use('/seeder',     require('./routes/seeder'));
protectedApi.use('/pipeline',   require('./routes/pipeline'));
protectedApi.use('/market',     require('./routes/market'));
app.use('/api', protectedApi);

// Protected static admin panel
app.use('/admin', auth.adminAuth);
app.use('/admin', express.static(path.join(__dirname, 'public')));
app.get('/', (_req, res) => res.redirect('/admin'));

app.listen(PORT, () => {
  console.log(`Mining Intel server running → http://localhost:${PORT}`);
});
