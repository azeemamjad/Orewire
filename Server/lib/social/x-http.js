/**
 * Minimal X/Twitter HTTP client for credential login + posting threads.
 * Critical: login init returns an `att` header that MUST be sent on every
 * subsequent onboarding subtask (error 366 = Invalid ATT).
 */
const crypto = require('crypto');

const BEARER =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

const WEB = 'https://x.com';
const API = 'https://api.x.com';
const GRAPHQL = `${WEB}/i/api/graphql`;
const ONBOARDING = `${API}/1.1/onboarding/task.json`;
const CREATE_TWEET = { queryId: 'SiM_cAu83R0wnrpmKQQSEw', operationName: 'CreateTweet' };

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const FEATURES = {
  rweb_video_screen_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  rweb_tipjar_consumption_enabled: false,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_grok_annotations_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  responsive_web_grok_show_grok_translated_post: true,
  responsive_web_grok_analysis_button_from_backend: true,
  post_ctas_fetch_enabled: true,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: false,
  responsive_web_enhance_cards_enabled: false,
};

const SUBTASK_VERSIONS = {
  action_list: 2,
  alert_dialog: 1,
  app_download_cta: 1,
  check_logged_in_account: 1,
  choice_selection: 3,
  contacts_live_sync_permission_prompt: 0,
  cta: 7,
  email_verification: 2,
  end_flow: 1,
  enter_date: 1,
  enter_email: 2,
  enter_password: 5,
  enter_phone: 2,
  enter_recaptcha: 1,
  enter_text: 5,
  enter_username: 2,
  generic_urt: 3,
  in_app_notification: 1,
  interest_picker: 3,
  js_instrumentation: 1,
  menu_dialog: 1,
  notifications_permission_prompt: 2,
  open_account: 2,
  open_home_timeline: 1,
  open_link: 1,
  phone_verification: 4,
  privacy_options: 1,
  security_key: 3,
  select_avatar: 4,
  select_banner: 2,
  settings_list: 7,
  show_code: 1,
  sign_up: 2,
  sign_up_review: 4,
  tweet_selection_urt: 1,
  update_users: 1,
  upload_media: 1,
  user_recommendations_list: 4,
  user_recommendations_urt: 1,
  wait_spinner: 3,
  web_modal: 1,
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseCookieString(cookieString) {
  const out = {};
  const raw = String(cookieString || '')
    .replace(/\r/g, '')
    .replace(/\n+/g, ';')
    .trim();

  // Support "auth_token: value" / "ct0 = value" lines as well as "name=value; …"
  for (const part of raw.split(/;|\n/)) {
    let chunk = part.trim();
    if (!chunk) continue;
    // name: value  → name=value
    if (!chunk.includes('=') && chunk.includes(':')) {
      const idx = chunk.indexOf(':');
      chunk = `${chunk.slice(0, idx).trim()}=${chunk.slice(idx + 1).trim()}`;
    }
    const idx = chunk.indexOf('=');
    if (idx === -1) continue;
    const name = chunk.slice(0, idx).trim();
    let value = chunk.slice(idx + 1).trim();
    // Strip wrapping quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (name) out[name] = value;
  }
  return out;
}

function cookieHeader(cookies) {
  return Object.entries(cookies)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

function mergeSetCookie(cookies, response) {
  const setCookies = response.headers.getSetCookie?.() ?? [];
  for (const header of setCookies) {
    const idx = header.indexOf('=');
    if (idx === -1) continue;
    const semi = header.indexOf(';');
    const name = header.slice(0, idx).trim();
    const value = header.slice(idx + 1, semi === -1 ? undefined : semi).trim();
    if (name) cookies[name] = value;
  }
  // Some stacks expose a single set-cookie header only
  if (!setCookies.length) {
    const single = response.headers.get?.('set-cookie');
    if (single) {
      for (const chunk of String(single).split(/,(?=\s*[^;=]+=)/)) {
        const idx = chunk.indexOf('=');
        if (idx === -1) continue;
        const semi = chunk.indexOf(';');
        const name = chunk.slice(0, idx).trim();
        const value = chunk.slice(idx + 1, semi === -1 ? undefined : semi).trim();
        if (name) cookies[name] = value;
      }
    }
  }
  return cookies;
}

class XHttpClient {
  constructor({ fetchFn, cookies } = {}) {
    this.fetchFn = fetchFn || globalThis.fetch;
    this.cookies = cookies ? { ...cookies } : {};
    this.guestToken = null;
    this.att = null;
    this.user = null;
    this._lastSubtasks = [];
  }

  static fromCookieString(cookieString, opts = {}) {
    return new XHttpClient({ ...opts, cookies: parseCookieString(cookieString) });
  }

  isAuthenticated() {
    return Boolean(this.cookies.auth_token && this.cookies.ct0);
  }

  getCookieString() {
    return cookieHeader(this.cookies);
  }

  async ensureGuestToken() {
    if (this.guestToken) return this.guestToken;

    // Seed ct0 if missing — some flows expect it early
    if (!this.cookies.ct0) {
      this.cookies.ct0 = crypto.randomBytes(16).toString('hex');
    }

    const res = await this.fetchFn(`${API}/1.1/guest/activate.json`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${decodeURIComponent(BEARER)}`,
        'user-agent': UA,
        'x-csrf-token': this.cookies.ct0,
        cookie: cookieHeader(this.cookies),
      },
    });
    mergeSetCookie(this.cookies, res);
    if (!res.ok) throw new Error(`Guest token failed (HTTP ${res.status})`);
    const data = await res.json();
    if (!data.guest_token) throw new Error('Guest token missing in response');
    this.guestToken = data.guest_token;
    if (!this.cookies.guest_id) {
      this.cookies.guest_id = `v1%3A${this.guestToken}`;
    }
    return this.guestToken;
  }

  /**
   * Headers for login onboarding (guest) or authenticated GraphQL.
   */
  baseHeaders({ authenticated = false, guest = false } = {}) {
    const headers = {
      authorization: `Bearer ${decodeURIComponent(BEARER)}`,
      'user-agent': UA,
      'content-type': 'application/json',
      accept: '*/*',
      'accept-language': 'en-US,en;q=0.9',
      'x-twitter-client-language': 'en',
      'x-twitter-active-user': 'yes',
      origin: WEB,
      referer: `${WEB}/`,
    };

    if (authenticated && this.isAuthenticated()) {
      headers['x-csrf-token'] = this.cookies.ct0;
      headers['x-twitter-auth-type'] = 'OAuth2Session';
      headers.cookie = cookieHeader(this.cookies);
    } else if (guest) {
      if (this.guestToken) headers['x-guest-token'] = this.guestToken;
      if (this.cookies.ct0) headers['x-csrf-token'] = this.cookies.ct0;
      // ATT must be echoed after login init — without it X returns error 366
      if (this.att) headers.att = this.att;
      headers.cookie = cookieHeader(this.cookies);
    }
    return headers;
  }

  _captureAtt(response) {
    const att =
      response.headers.get?.('att') ||
      response.headers.get?.('Att') ||
      null;
    if (att) {
      this.att = att;
      // Also store as cookie so Cookie jar stays consistent
      this.cookies.att = att;
    }
  }

  async loginWithCredentials(username, password, email = '') {
    const user = String(username || '').replace(/^@/, '').trim();
    if (!user || !password) throw new Error('Username and password are required');

    await this.ensureGuestToken();

    let flowToken = await this._loginInit();
    await sleep(200 + Math.random() * 300);

    // Only run instrumentation if X asked for it
    if (this._hasSubtask('LoginJsInstrumentationSubtask')) {
      flowToken = await this._loginSubtask(flowToken, {
        subtask_id: 'LoginJsInstrumentationSubtask',
        js_instrumentation: { response: '{}', link: 'next_link' },
      });
      await sleep(150);
    }

    flowToken = await this._loginSubtask(flowToken, {
      subtask_id: 'LoginEnterUserIdentifierSSO',
      settings_list: {
        setting_responses: [
          {
            key: 'user_identifier',
            response_data: { text_data: { result: user } },
          },
        ],
        link: 'next_link',
      },
    });
    await sleep(200);

    if (this._hasSubtask('LoginEnterAlternateIdentifierSubtask')) {
      const alt = email || user;
      flowToken = await this._loginSubtask(flowToken, {
        subtask_id: 'LoginEnterAlternateIdentifierSubtask',
        enter_text: { text: alt, link: 'next_link' },
      });
    }

    flowToken = await this._loginSubtask(flowToken, {
      subtask_id: 'LoginEnterPassword',
      enter_password: { password, link: 'next_link' },
    });
    await sleep(200);

    if (this._hasSubtask('AccountDuplicationCheck')) {
      flowToken = await this._loginSubtask(flowToken, {
        subtask_id: 'AccountDuplicationCheck',
        check_logged_in_account: { link: 'AccountDuplicationCheck_false' },
      });
    }

    if (this._hasSubtask('LoginAcid')) {
      if (!email) {
        throw new Error('X requires email confirmation — save the account email and try again');
      }
      flowToken = await this._loginSubtask(flowToken, {
        subtask_id: 'LoginAcid',
        enter_text: { text: email, link: 'next_link' },
      });
    }

    if (this._hasSubtask('LoginTwoFactorAuthChallenge')) {
      throw new Error('Two-factor authentication is required. Disable 2FA on the X account for automated login.');
    }

    // Sometimes auth is in open_account subtask rather than Set-Cookie
    this._extractOpenAccount();

    void flowToken;

    if (!this.cookies.auth_token || !this.cookies.ct0) {
      const next = this._lastSubtasks.map((s) => s.subtask_id).join(', ') || 'none';
      throw new Error(
        `Login finished but auth cookies missing (next challenge: ${next}). Try again, or paste session cookies.`,
      );
    }

    const validation = await this.validateSession();
    if (!validation.valid) {
      throw new Error(`Session invalid after login: ${validation.reason}`);
    }
    this.user = validation.user;
    return { ...validation.user };
  }

  _extractOpenAccount() {
    for (const sub of this._lastSubtasks || []) {
      const acct = sub.open_account;
      if (!acct) continue;
      if (acct.auth_token) this.cookies.auth_token = acct.auth_token;
      if (acct.ct0) this.cookies.ct0 = acct.ct0;
    }
  }

  async validateSession() {
    if (!this.isAuthenticated()) {
      return { valid: false, user: null, reason: 'Missing auth_token or ct0' };
    }
    try {
      const res = await this.fetchFn(`${WEB}/i/api/1.1/account/verify_credentials.json`, {
        method: 'GET',
        headers: this.baseHeaders({ authenticated: true }),
        redirect: 'manual',
      });
      if (!res.ok) {
        return { valid: false, user: null, reason: `HTTP ${res.status}`, status: res.status };
      }
      const data = await res.json();
      const user = {
        id: String(data.id_str ?? data.id ?? ''),
        username: data.screen_name || '',
        name: data.name || '',
      };
      if (!user.id) return { valid: false, user: null, reason: 'Missing user id' };
      this.user = user;
      return { valid: true, user, reason: 'ok' };
    } catch (err) {
      return { valid: false, user: null, reason: err?.message || String(err) };
    }
  }

  async postTweet(text, { replyTo = null } = {}) {
    if (!this.isAuthenticated()) throw new Error('Authentication required');
    if (!text || !String(text).trim()) throw new Error('Tweet text required');
    if (String(text).length > 280) throw new Error(`Tweet too long (${text.length}/280)`);

    const variables = {
      tweet_text: text,
      dark_request: false,
      media: { media_entities: [], possibly_sensitive: false },
      semantic_annotation_ids: [],
    };
    if (replyTo) {
      variables.reply = {
        in_reply_to_tweet_id: replyTo,
        exclude_reply_user_ids: [],
      };
    }

    const url = `${GRAPHQL}/${CREATE_TWEET.queryId}/${CREATE_TWEET.operationName}`;
    const res = await this.fetchFn(url, {
      method: 'POST',
      headers: this.baseHeaders({ authenticated: true }),
      body: JSON.stringify({
        variables,
        features: FEATURES,
        queryId: CREATE_TWEET.queryId,
      }),
    });
    const bodyText = await res.text();
    let json;
    try {
      json = JSON.parse(bodyText);
    } catch {
      throw new Error(`CreateTweet non-JSON (HTTP ${res.status})`);
    }
    if (!res.ok) {
      const msg = json?.errors?.[0]?.message || `CreateTweet HTTP ${res.status}`;
      throw new Error(msg);
    }
    if (json?.errors?.length) {
      throw new Error(json.errors[0].message || 'CreateTweet error');
    }

    return (
      json?.data?.create_tweet?.tweet_results?.result ??
      json?.data?.create_tweet?.tweet_result?.result ??
      json?.data?.create_tweet ??
      json
    );
  }

  async postThread(tweets) {
    if (!Array.isArray(tweets) || !tweets.length) {
      throw new Error('Thread must contain at least one tweet');
    }
    const results = [];
    let previousId = null;
    for (let i = 0; i < tweets.length; i++) {
      const text = typeof tweets[i] === 'string' ? tweets[i] : tweets[i]?.text;
      const result = await this.postTweet(text, { replyTo: previousId });
      results.push(result);
      previousId =
        result?.rest_id ||
        result?.legacy?.id_str ||
        result?.tweet?.rest_id ||
        null;
      if (i < tweets.length - 1) {
        await sleep(1000 + Math.random() * 2000);
      }
    }
    return results;
  }

  async _loginInit() {
    const res = await this.fetchFn(`${ONBOARDING}?flow_name=login`, {
      method: 'POST',
      headers: this.baseHeaders({ guest: true }),
      body: JSON.stringify({
        input_flow_data: {
          flow_context: {
            debug_overrides: {},
            start_location: { location: 'manual_link' },
          },
        },
        subtask_versions: SUBTASK_VERSIONS,
      }),
    });
    mergeSetCookie(this.cookies, res);
    this._captureAtt(res);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Login init failed (HTTP ${res.status}): ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    this._lastSubtasks = data.subtasks || [];
    if (!data.flow_token) throw new Error('Login init missing flow_token');
    if (!this.att) {
      // Soft warn — some regions set att only as cookie
      if (this.cookies.att) this.att = this.cookies.att;
    }
    return data.flow_token;
  }

  async _loginSubtask(flowToken, subtaskInput) {
    const res = await this.fetchFn(ONBOARDING, {
      method: 'POST',
      headers: this.baseHeaders({ guest: true }),
      body: JSON.stringify({
        flow_token: flowToken,
        subtask_inputs: [subtaskInput],
      }),
    });
    mergeSetCookie(this.cookies, res);
    this._captureAtt(res);
    this._lastLoginResponse = res;
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Login step ${subtaskInput.subtask_id} failed (HTTP ${res.status}): ${body.slice(0, 240)}`);
    }
    const data = await res.json();
    this._lastSubtasks = data.subtasks || [];
    this._extractOpenAccount();
    return data.flow_token;
  }

  _hasSubtask(id) {
    return this._lastSubtasks.some((s) => s.subtask_id === id);
  }
}

module.exports = {
  XHttpClient,
  parseCookieString,
};
