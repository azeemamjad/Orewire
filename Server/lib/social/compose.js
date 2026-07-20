const { pickHashtags } = require('./hashtags');
const { appBase } = require('./select');

const TWEET_LIMIT = 280;

function trimTo(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1)).trim()}…`;
}

/**
 * Build intro + item tweets + closing hashtag tweet.
 * @returns {{ pages: string[], items: object[], hashtags: string[] }}
 */
async function composeThread(items = []) {
  const hashtags = await pickHashtags(items, { count: 4 });
  const tagLine = hashtags.join(' ');
  const base = appBase();
  const n = items.length;
  const filingCount = items.filter((i) => i.kind === 'filing').length;
  const newsCount = items.filter((i) => i.kind === 'news').length;

  const introParts = ['OreWire morning wire'];
  if (filingCount && newsCount) introParts.push(`— ${filingCount} filing${filingCount === 1 ? '' : 's'} & ${newsCount} release${newsCount === 1 ? '' : 's'} worth a look`);
  else if (filingCount) introParts.push(`— ${filingCount} filing${filingCount === 1 ? '' : 's'} worth a look`);
  else introParts.push(`— ${n} release${n === 1 ? '' : 's'} worth a look`);
  const intro = trimTo(introParts.join(' '), TWEET_LIMIT);

  const pages = [intro];
  const logged = [];

  for (const item of items) {
    const link = item.href || base;
    const head = item.label || 'Update';
    const bodyBudget = TWEET_LIMIT - head.length - link.length - 8;
    const body = trimTo(item.summary || item.title || '', Math.max(40, bodyBudget));
    const text = trimTo(`${head} — ${body}\n${link}`, TWEET_LIMIT);
    pages.push(text);
    logged.push({
      kind: item.kind,
      sourceId: item.sourceId,
      tweetText: text,
      position: pages.length,
    });
  }

  const close = trimTo(`Full brief → ${base}\n${tagLine}`, TWEET_LIMIT);
  pages.push(close);

  return {
    pages,
    items: logged,
    hashtags,
    intro,
    close,
  };
}

module.exports = { composeThread, trimTo, TWEET_LIMIT };
