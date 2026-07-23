'use strict';

/**
 * Post an X thread from a dedicated minimized worker window.
 * Never switches tabs in the user's current Chrome window.
 */

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function callTool(manager, name, args = {}) {
  const result = await manager.callTool(name, args);
  if (result.error) throw new Error(result.error);
  return result.data;
}

function unwrapEvaluate(data) {
  if (data && typeof data === 'object' && 'value' in data) return data.value;
  return data;
}

function withTab(tabId, args = {}) {
  return tabId != null ? { ...args, tabId } : { ...args };
}

/**
 * Open compose in OreWire's minimized worker window (separate from the user's window).
 */
async function openComposeQuiet(manager) {
  let tabId = null;

  try {
    const worker = await callTool(manager, 'ensure_worker_window', {
      url: 'https://x.com/compose/post',
    });
    tabId = worker?.tabId ?? null;
  } catch (err) {
    const msg = String(err?.message || err);
    if (!/Unknown tool|ensure_worker_window/i.test(msg)) throw err;
    // Older extension: create a background tab (may still be in user's window)
    const created = await callTool(manager, 'new_tab', {
      url: 'https://x.com/compose/post',
      active: false,
    });
    tabId = created?.id ?? created?.tabId ?? null;
  }

  if (tabId == null) {
    throw new Error('Could not open an X tab for composing');
  }

  await sleep(1200);
  await callTool(manager, 'wait_for', withTab(tabId, {
    type: 'selector',
    value: '[data-testid="tweetTextarea_0"]',
    timeoutMs: 45_000,
  }));
  await sleep(400);
  return tabId;
}

async function postButtonEnabled(manager, tabId) {
  return !!unwrapEvaluate(
    await callTool(manager, 'evaluate', withTab(tabId, {
      expression: `(() => {
        const btn = document.querySelector('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]');
        if (!btn) return false;
        return btn.getAttribute('aria-disabled') !== 'true';
      })()`,
    })),
  );
}

async function composeLen(manager, tabId, index) {
  const sel = `[data-testid="tweetTextarea_${index}"]`;
  return Number(
    unwrapEvaluate(
      await callTool(manager, 'evaluate', withTab(tabId, {
        expression: `(() => {
          const root = document.querySelector(${JSON.stringify(sel)});
          if (!root) return 0;
          const el = root.querySelector('[contenteditable="true"]') || root;
          return (el.innerText || el.textContent || '').replace(/\\u200B/g, '').trim().length;
        })()`,
      })),
    ) || 0,
  );
}

/** Activate tab only inside the (minimized) worker window — never focuses OS/Chrome. */
async function activateInWorker(manager, tabId) {
  try {
    await callTool(manager, 'activate_tab', { tabId });
    await sleep(150);
  } catch (err) {
    const msg = String(err?.message || err);
    if (!/Unknown tool|activate_tab/i.test(msg)) throw err;
  }
}

async function typeViaDomNode(manager, tabId, index, text) {
  const sel = `[data-testid="tweetTextarea_${index}"]`;
  unwrapEvaluate(
    await callTool(manager, 'evaluate', withTab(tabId, {
      expression: `(() => {
        const root = document.querySelector(${JSON.stringify(sel)});
        if (!root) return false;
        const el = root.querySelector('[contenteditable="true"]') || root;
        el.setAttribute('data-wb-compose', ${JSON.stringify(String(index))});
        el.focus();
        return true;
      })()`,
    })),
  );

  const dom = await callTool(manager, 'get_visible_dom', withTab(tabId));
  const nodes = Array.isArray(dom) ? dom : Object.values(dom || {});
  const hit =
    nodes.find((n) => n && (n.ariaLabel === 'Post text' || n.role === 'textbox') && n.id) ||
    nodes.find((n) => n && /post text|textbox/i.test(String(n.ariaLabel || n.role || '')) && n.id);
  if (!hit?.id) throw new Error('Compose textbox node not found in DOM snapshot');

  await callTool(manager, 'type_element', withTab(tabId, {
    nodeId: hit.id,
    text: String(text),
    clearFirst: true,
  }));
  await sleep(400);
}

async function typeOnce(manager, tabId, index, text) {
  const sel = `[data-testid="tweetTextarea_${index}"]`;
  const payload = String(text);

  // Only switches tabs inside the minimized worker window — not your main window
  await activateInWorker(manager, tabId);

  try {
    await typeViaDomNode(manager, tabId, index, payload);
  } catch (err) {
    console.warn('[webbridge] type_element path failed, trying in-page insert:', err.message || err);
    const result = unwrapEvaluate(
      await callTool(manager, 'evaluate', withTab(tabId, {
        expression: `(() => {
          const root = document.querySelector(${JSON.stringify(sel)});
          if (!root) return { ok: false, reason: 'missing' };
          const el =
            root.querySelector('[contenteditable="true"]') ||
            (root.getAttribute('contenteditable') === 'true' ? root : null) ||
            root;
          el.focus();
          const selectAll = () => {
            const range = document.createRange();
            range.selectNodeContents(el);
            const selApi = window.getSelection();
            selApi.removeAllRanges();
            selApi.addRange(range);
          };
          const read = () => (el.innerText || el.textContent || '').replace(/\\u200B/g, '').trim();
          selectAll();
          try { document.execCommand('delete', false); } catch (_) {}
          const text = ${JSON.stringify(payload)};
          try {
            const dt = new DataTransfer();
            dt.setData('text/plain', text);
            el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
          } catch (_) {}
          if (!read()) {
            try {
              selectAll();
              document.execCommand('insertText', false, text);
            } catch (_) {}
          }
          return { ok: read().length > 0, len: read().length };
        })()`,
      })),
    );
    if (!result?.ok) {
      throw new Error(`Compose text did not land in box ${index} (Post stays disabled)`);
    }
  }

  await sleep(300);
  for (let i = 0; i < 25; i++) {
    if ((await composeLen(manager, tabId, index)) > 0 && (await postButtonEnabled(manager, tabId))) {
      return;
    }
    await sleep(200);
  }

  if ((await composeLen(manager, tabId, index)) <= 0) {
    throw new Error(`Compose text did not land in box ${index} (Post stays disabled)`);
  }
}

async function clickAddPost(manager, tabId) {
  const ok = unwrapEvaluate(
    await callTool(manager, 'evaluate', withTab(tabId, {
      expression: `(() => {
        const btn =
          document.querySelector('[data-testid="addButton"]') ||
          document.querySelector('button[aria-label="Add post"]') ||
          document.querySelector('button[aria-label*="Add another"]');
        if (!btn) return false;
        btn.click();
        return true;
      })()`,
    })),
  );
  return !!ok;
}

async function clickPostButton(manager, tabId) {
  let last = { ok: false, reason: 'missing' };
  for (let i = 0; i < 25; i++) {
    last = unwrapEvaluate(
      await callTool(manager, 'evaluate', withTab(tabId, {
        expression: `(() => {
          const btns = [
            ...document.querySelectorAll('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]'),
          ];
          const btn =
            btns.find((b) => /post all/i.test((b.innerText || b.textContent || '').trim())) ||
            btns.find((b) => /^(post|reply)$/i.test((b.innerText || b.textContent || '').trim())) ||
            btns[0];
          if (!btn) return { ok: false, reason: 'missing' };
          if (btn.getAttribute('aria-disabled') === 'true') return { ok: false, reason: 'disabled' };
          btn.click();
          return { ok: true };
        })()`,
      })),
    );
    if (last?.ok) {
      await sleep(500);
      return;
    }
    await sleep(200);
  }
  throw new Error(`Post button not found (${last?.reason || 'unknown'})`);
}

async function waitForThreadUrl(manager, tabId, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(800);
    const found = unwrapEvaluate(
      await callTool(manager, 'evaluate', withTab(tabId, {
        expression: `(() => {
          if (/\\/status\\/\\d+/.test(location.href)) return location.href.split('?')[0];
          const toast = document.querySelector('[data-testid="toast"] a[href*="/status/"]');
          if (toast && toast.href) return toast.href.split('?')[0];
          const composeOpen = !!document.querySelector('[data-testid="tweetTextarea_0"]');
          if (!composeOpen) return 'posted';
          return null;
        })()`,
      })),
    );
    if (typeof found === 'string' && found.startsWith('http')) return found;
    if (found === 'posted') return null;
  }
  return null;
}

async function replyToStatus(manager, tabId, statusUrl, text) {
  await callTool(manager, 'navigate', withTab(tabId, {
    url: statusUrl,
    waitUntil: 'domcontentloaded',
  }));
  await sleep(1200);
  await callTool(manager, 'evaluate', withTab(tabId, {
    expression: `(() => {
      const btn = document.querySelector('[data-testid="reply"]');
      if (!btn) throw new Error('Reply button not found');
      btn.click();
      return true;
    })()`,
  }));
  await sleep(800);
  await callTool(manager, 'wait_for', withTab(tabId, {
    type: 'selector',
    value: '[data-testid="tweetTextarea_0"]',
    timeoutMs: 20_000,
  }));
  await typeOnce(manager, tabId, 0, text);
  await clickPostButton(manager, tabId);
  await sleep(1200);
  return statusUrl;
}

/**
 * @param {object} manager
 * @param {{ tweets?: string[], pages?: string[] }} args
 */
async function postXThread(manager, args = {}) {
  const tweetsRaw = args.tweets ?? args.pages;
  const tweets = Array.isArray(tweetsRaw)
    ? tweetsRaw.map((t) => String(t ?? '').trim()).filter(Boolean)
    : [];
  if (!tweets.length) throw new Error('post_x_thread: tweets (string[]) is required');

  const tabId = await openComposeQuiet(manager);

  if (tweets.length === 1) {
    await typeOnce(manager, tabId, 0, tweets[0]);
    await clickPostButton(manager, tabId);
    const threadUrl = await waitForThreadUrl(manager, tabId);
    return { ok: true, tweetCount: 1, threadUrl, mode: 'single' };
  }

  try {
    for (let i = 0; i < tweets.length; i++) {
      await typeOnce(manager, tabId, i, tweets[i]);
      if (i < tweets.length - 1) {
        const added = await clickAddPost(manager, tabId);
        if (!added) throw new Error('addButton missing');
        await sleep(800);
        let ok = false;
        for (let t = 0; t < 25; t++) {
          ok = !!unwrapEvaluate(
            await callTool(manager, 'evaluate', withTab(tabId, {
              expression: `!!document.querySelector(${JSON.stringify(`[data-testid="tweetTextarea_${i + 1}"]`)})`,
            })),
          );
          if (ok) break;
          await sleep(300);
        }
        if (!ok) throw new Error(`tweetTextarea_${i + 1} not found after add`);
      }
    }
    await clickPostButton(manager, tabId);
    const threadUrl = await waitForThreadUrl(manager, tabId);
    return { ok: true, tweetCount: tweets.length, threadUrl, mode: 'compose_thread' };
  } catch (err) {
    console.warn('[webbridge] Compose-thread failed, reply-chain fallback:', err.message || err);
  }

  await callTool(manager, 'navigate', withTab(tabId, {
    url: 'https://x.com/compose/post',
    waitUntil: 'domcontentloaded',
  }));
  await sleep(1000);
  await callTool(manager, 'wait_for', withTab(tabId, {
    type: 'selector',
    value: '[data-testid="tweetTextarea_0"]',
    timeoutMs: 45_000,
  }));
  await typeOnce(manager, tabId, 0, tweets[0]);
  await clickPostButton(manager, tabId);
  const threadUrl = await waitForThreadUrl(manager, tabId);
  if (!threadUrl) {
    throw new Error('Posted first tweet but could not capture status URL for replies');
  }
  for (let i = 1; i < tweets.length; i++) {
    await replyToStatus(manager, tabId, threadUrl, tweets[i]);
  }
  return { ok: true, tweetCount: tweets.length, threadUrl, mode: 'reply_chain' };
}

module.exports = { postXThread };
