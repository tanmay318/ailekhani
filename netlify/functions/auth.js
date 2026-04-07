// netlify/functions/auth.js
// Handles all auth, stats, waitlist, and rate-limit routes.
//
// Schema: users table holds UUID identity.
//         auth_providers table holds login methods (Google etc).
//         Losing a Gmail does not mean losing an account.
//
// Environment variables needed in Netlify dashboard:
//   GOOGLE_CLIENT_ID      — from Google Cloud Console
//   GOOGLE_CLIENT_SECRET  — from Google Cloud Console
//   SUPABASE_URL          — Supabase Project URL
//   SUPABASE_SERVICE_KEY  — service_role key (or sb_secret_...)
//   SITE_URL              — https://ailekhani.com

// ── Fetch helper ─────────────────────────────────────────────
async function fetchJSON(url, options = {}) {
  const { default: fetch } = await import('node-fetch').catch(() => ({
    default: (u, o) => globalThis.fetch(u, o)
  }));

  const res = await fetch(url, options);

  const text = await res.text(); // ✅ read raw response first

  try {
    return JSON.parse(text);
  } catch (err) {
    console.error("Invalid JSON from:", url);
    console.error("Response:", text);

    return {
      error: "Invalid JSON response",
      raw: text
    };
  }
}

// ── Supabase REST helper ──────────────────────────────────────
async function sb(method, table, body, query = '') {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${table}${query}`;
  return fetchJSON(url, {
    method,
    headers: {
      'Content-Type':  'application/json',
      'apikey':        process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Prefer':        method === 'POST' ? 'return=representation' : 'return=minimal'
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

// ── Country from IP ───────────────────────────────────────────
async function getCountry(ip) {
  try {
    const data = await fetchJSON(`https://ipapi.co/${ip}/json/`);
    return data.country_name || data.country || 'Unknown';
  } catch {
    return 'Unknown';
  }
}

// ── Main handler ─────────────────────────────────────────────
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin':  process.env.SITE_URL || 'https://ailekhani.com',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Content-Type':                 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // ── Rate limiter — 10 calls per IP per minute ─────────────
  const _rl = global._rl = global._rl || new Map();
  const ip  = event.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const now = Date.now();
  const hits = (_rl.get(ip) || []).filter(t => now - t < 60000);
  hits.push(now);
  _rl.set(ip, hits);
  if (hits.length > 10) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: 'Too many requests' }) };
  }

  const path = event.path
    .replace('/.netlify/functions/auth', '')
    .replace('/api/auth', '');

  // ── GET /stats ────────────────────────────────────────────
  if (event.httpMethod === 'GET' && path === '/stats') {
    try {
      const [vc, uc] = await Promise.all([
        fetchJSON(`${process.env.SUPABASE_URL}/rest/v1/visitor_counts?select=total_visits`, {
          headers: { 'apikey': process.env.SUPABASE_SERVICE_KEY,
                     'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}` }
        }),
        fetchJSON(`${process.env.SUPABASE_URL}/rest/v1/users?select=id`, {
          headers: { 'apikey': process.env.SUPABASE_SERVICE_KEY,
                     'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}` }
        })
      ]);
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          visitors: vc?.[0]?.total_visits || 0,
          users:    Array.isArray(uc) ? uc.length : 0
        })
      };
    } catch {
      return { statusCode: 200, headers, body: JSON.stringify({ visitors: 0, users: 0 }) };
    }
  }

  // ── POST /visitor ─────────────────────────────────────────
  if (event.httpMethod === 'POST' && path === '/visitor') {
    try {
      await fetchJSON(`${process.env.SUPABASE_URL}/rest/v1/rpc/increment_visitors`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'apikey':        process.env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
        },
        body: JSON.stringify({})
      });
    } catch {}
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  }

  // ── POST /google ──────────────────────────────────────────
  if (event.httpMethod === 'POST' && path === '/google') {
    let body;
    try { body = JSON.parse(event.body); } catch {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid body' }) };
    }

    const { code, redirect_uri } = body;
    if (!code) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing code' }) };

    try {
      // Exchange code for Google token
      const tokenRes = await fetchJSON('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    code,
    client_id:     process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri:  redirect_uri || `${process.env.SITE_URL}/app/`,
    grant_type:    'authorization_code'
  }).toString()
});

if (!tokenRes || tokenRes.error || !tokenRes.access_token) {
  throw new Error(
    tokenRes?.error_description ||
    tokenRes?.error ||
    "Google token exchange failed"
  );
}

      if (tokenRes.error) throw new Error(tokenRes.error_description || tokenRes.error);

      // Get user info from Google
      const googleUser = await fetchJSON('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { 'Authorization': `Bearer ${tokenRes.access_token}` }
      });

      if (!googleUser.email) throw new Error('Could not get email from Google');

      const country = await getCountry(
        event.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown'
      );

      // ── Look up existing auth_provider row ──────────────
      const existingAuth = await fetchJSON(
        `${process.env.SUPABASE_URL}/rest/v1/auth_providers?provider=eq.google&provider_email=eq.${googleUser.email}&select=user_id,id`,
        { headers: { 'apikey': process.env.SUPABASE_SERVICE_KEY,
                     'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}` } }
      );

      let userId, plan, isNew;

      if (Array.isArray(existingAuth) && existingAuth.length > 0) {
        // ── Returning user — update last_seen ──────────────
        userId = existingAuth[0].user_id;
        isNew  = false;

        await sb('PATCH', 'users',
          { last_seen: new Date().toISOString(), country },
          `?id=eq.${userId}`
        );
        await sb('PATCH', 'auth_providers',
          { last_used_at: new Date().toISOString() },
          `?id=eq.${existingAuth[0].id}`
        );

        const userRows = await fetchJSON(
          `${process.env.SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=plan`,
          { headers: { 'apikey': process.env.SUPABASE_SERVICE_KEY,
                       'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}` } }
        );
        plan = userRows?.[0]?.plan || 'free';

      } else {
        // ── New user — create user row then auth_provider ──
        isNew = true;

        const newUser = await fetchJSON(
          `${process.env.SUPABASE_URL}/rest/v1/users`,
          {
            method: 'POST',
            headers: {
              'Content-Type':  'application/json',
              'apikey':        process.env.SUPABASE_SERVICE_KEY,
              'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
              'Prefer':        'return=representation'
            },
            body: JSON.stringify({
              display_name: googleUser.name || googleUser.email.split('@')[0],
              country,
              plan:         'free',
              created_at:   new Date().toISOString(),
              last_seen:    new Date().toISOString()
            })
          }
        );

        userId = Array.isArray(newUser) ? newUser[0]?.id : newUser?.id;
        plan   = 'free';

        // Link Google login to this user
        await sb('POST', 'auth_providers', {
          user_id:        userId,
          provider:       'google',
          provider_email: googleUser.email,
          created_at:     new Date().toISOString(),
          last_used_at:   new Date().toISOString()
        });
      }

      // Return to browser — email included for app display
      // but it is NOT the user's identity (user_id is)
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          ok:      true,
          userId,
          email:   googleUser.email,
          name:    googleUser.name || '',
          country,
          plan,
          isNew
        })
      };

    } catch (e) {
      console.error('OAuth error:', e.message);
      return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
    }
  }

  // ── POST /waitlist ────────────────────────────────────────
  if (event.httpMethod === 'POST' && path === '/waitlist') {
    try {
      const { email } = JSON.parse(event.body || '{}');
      if (!email) return { statusCode: 400, headers,
        body: JSON.stringify({ error: 'Missing email' }) };

      await fetchJSON(`${process.env.SUPABASE_URL}/rest/v1/waitlist`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'apikey':        process.env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
          'Prefer':        'return=minimal,resolution=ignore-duplicates'
        },
        body: JSON.stringify({
          email,
          signed_up_at: new Date().toISOString(),
          source:       'app'
        })
      });
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    } catch {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }
  }

  // ── POST /check-import ────────────────────────────────────
  // Server-side rate limit — 1 import per 12 hours for free users
  // Cache-proof: stored in Supabase not browser
  if (event.httpMethod === 'POST' && path === '/check-import') {
    try {
      const { email } = JSON.parse(event.body || '{}');
      if (!email) return { statusCode: 200, headers,
        body: JSON.stringify({ allowed: false, message: 'Please sign in first.' }) };

      const TWELVE_HRS = 12 * 60 * 60 * 1000;

      // Look up user via auth_providers
      const authRows = await fetchJSON(
        `${process.env.SUPABASE_URL}/rest/v1/auth_providers?provider=eq.google&provider_email=eq.${encodeURIComponent(email)}&select=user_id`,
        { headers: { 'apikey': process.env.SUPABASE_SERVICE_KEY,
                     'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}` } }
      );

      const userId = Array.isArray(authRows) ? authRows[0]?.user_id : null;
      if (!userId) return { statusCode: 200, headers,
        body: JSON.stringify({ allowed: true }) }; // new user, allow

      const userRows = await fetchJSON(
        `${process.env.SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=plan,last_import_at`,
        { headers: { 'apikey': process.env.SUPABASE_SERVICE_KEY,
                     'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}` } }
      );

      const user = Array.isArray(userRows) ? userRows[0] : null;
      if (!user || user.plan === 'pro') return { statusCode: 200, headers,
        body: JSON.stringify({ allowed: true }) };

      const lastTs = user.last_import_at ? new Date(user.last_import_at).getTime() : 0;
      const now2   = Date.now();

      if (now2 - lastTs < TWELVE_HRS) {
        const rem  = TWELVE_HRS - (now2 - lastTs);
        const hrs  = Math.floor(rem / 3600000);
        const mins = Math.floor((rem % 3600000) / 60000);
        return { statusCode: 200, headers, body: JSON.stringify({
          allowed: false,
          message: `You can import once every 12 hours on the free plan. Next import in ${hrs}h ${mins}m. Upgrade to Pro for unlimited imports.`
        })};
      }

      // Record import
      await sb('PATCH', 'users',
        { last_import_at: new Date().toISOString() },
        `?id=eq.${userId}`
      );
      return { statusCode: 200, headers, body: JSON.stringify({ allowed: true }) };

    } catch (e) {
      console.error('check-import error:', e.message);
      return { statusCode: 200, headers, body: JSON.stringify({ allowed: true }) };
    }
  }

  // ── POST /funnel ──────────────────────────────────────────
  if (event.httpMethod === 'POST' && path === '/funnel') {
    try {
      const { event: evt, email } = JSON.parse(event.body || '{}');
      if (!email || !evt) return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };

      // Get user_id from auth_providers
      const authRows = await fetchJSON(
        `${process.env.SUPABASE_URL}/rest/v1/auth_providers?provider=eq.google&provider_email=eq.${encodeURIComponent(email)}&select=user_id`,
        { headers: { 'apikey': process.env.SUPABASE_SERVICE_KEY,
                     'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}` } }
      );
      const userId = Array.isArray(authRows) ? authRows[0]?.user_id : null;
      if (!userId) return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };

      const colMap = {
        upgrade_viewed:    { upgrade_viewed_at:  new Date().toISOString() },
        payment_started:   { payment_started_at: new Date().toISOString() },
        payment_dismissed: { payment_failed_at:  new Date().toISOString(),
                             payment_failed_reason: 'dismissed' }
      };
      const update = colMap[evt];
      if (update) {
        await sb('PATCH', 'users', update, `?id=eq.${userId}`);
      }
    } catch {}
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  }

  return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) };
};
