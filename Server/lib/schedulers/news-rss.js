const {
  fetchAndStoreRssFeeds,
  drainUnprocessedNews,
} = require('../news/fetch');

let fetchRunning = false;

async function fetchAndStoreNews() {
  if (fetchRunning) return;
  fetchRunning = true;
  try {
    const stats = await fetchAndStoreRssFeeds();
    if (stats.inserted > 0) {
      console.log(
        `[News] Fetched ${stats.total} items, inserted ${stats.inserted} new (${stats.matched} matched to companies), running AI enrichment`
      );
    }
    drainUnprocessedNews().catch((err) => {
      console.error('[News] Backlog enrichment failed:', err?.message || err);
    });
  } catch (err) {
    console.error('[News] Fetch cycle failed:', err?.message || err);
  } finally {
    fetchRunning = false;
  }
}

const FETCH_INTERVAL = 5 * 60 * 1000;

function startNewsRssScheduler() {
  setTimeout(() => fetchAndStoreNews(), 5000);
  setInterval(() => fetchAndStoreNews(), FETCH_INTERVAL);
}

module.exports = { startNewsRssScheduler, fetchAndStoreNews };
