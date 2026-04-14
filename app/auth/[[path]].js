// functions/api/auth/[[path]].js
// Cloudflare Pages Function — handles all auth routes:
// POST /api/auth/google
// GET  /api/auth/stats
// POST /api/auth/visitor
// POST /api/auth/waitlist
// POST /api/auth/check-import
// POST /api/auth/funnel

// ── Supabase REST helper ──────────────────────────────
async function sb(env, method, table, body, query = '') {
  const url = `${env.SUPABASE_URL}/rest/v1/${table}${query}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type':  'application/json',
      'apikey':        env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Prefer':        method === 'POST' ? 'return=representation' : 'return=minimal'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json();
}

// ── Country from IP ───────────────────────────────────
async function getCountry(ip) {
  try {
    const res  = await fetch(`https://ipapi.co/${ip}/json/`);
    const data = await res.json();
    return data.country_name || data.country || 'Unknown';
  } catch {
    return 'Unknown';
  }
}

// ── JSON response helper ──────────────────────────────
function json(data, status = 200, origin = 'https://ailekhani.com') {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type':                 'application/json',
      'Access-Control-Allow-Origin':  origin,
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
    }
  });
}

// ── Rate limiter (in-memory per isolate) ─────────────
const _rl = new Map();
function isRateLimited(ip) {
  const now  = Date.now();
  const hits = (_rl.get(ip) || []).filter(t => now - t < 60000);
  hits.push(now);
  _rl.set(ip, hits);
  return hits.length > 10;
}

// ── Main handler ──────────────────────────────────────
export async function onRequest(context) {
  const { request, env } = context;
  const url    = new URL(request.url);
  const origin = request.headers.get('Origin') || env.SITE_URL || 'https://ailekhani.com';
  const method = request.method;

  // Preflight
  if (method === 'OPTIONS') {
    return json({}, 200, origin);
  }

  // Rate limit
  const ip = request.headers.get('CF-Connecting-IP') ||
             request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (isRateLimited(ip)) {
    return json({ error: 'Too many requests' }, 429, origin);
  }

  // Extract route from path
  // URL will be /api/auth/google, /api/auth/stats etc
  const parts = url.pathname.replace('/api/auth', '').replace(/^\//, '');
  const route = '/' + (parts || '');

  // ── GET /stats ───────────────────────────────────────
  if (method === 'GET' && route === '/stats') {
    try {
      const [vc, uc] = await Promise.all([
        fetch(`${env.SUPABASE_URL}/rest/v1/visitor_counts?select=total_visits`, {
          headers: { 'apikey': env.SUPABASE_SERVICE_KEY,
                     'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}` }
        }).then(r => r.json()),
        fetch(`${env.SUPABASE_URL}/rest/v1/users?select=id`, {
          headers: { 'apikey': env.SUPABASE_SERVICE_KEY,
                     'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}` }
        }).then(r => r.json())
      ]);
      return json({
        visitors: vc?.[0]?.total_visits || 0,
        users:    Array.isArray(uc) ? uc.length : 0
      }, 200, origin);
    } catch {
      return json({ visitors: 0, users: 0 }, 200, origin);
    }
  }

  // ── POST /visitor ────────────────────────────────────
  if (method === 'POST' && route === '/visitor') {
    try {
      await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/increment_visitors`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'apikey':        env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`
        },
        body: '{}'
      });
    } catch {}
    return json({ ok: true }, 200, origin);
  }

  // ── POST /google ─────────────────────────────────────
  if (method === 'POST' && route === '/google') {
    let body;
    try { body = await request.json(); } catch {
      return json({ error: 'Invalid body' }, 400, origin);
    }

    const { code, redirect_uri } = body;
    if (!code) return json({ error: 'Missing code' }, 400, origin);

    try {
      // Exchange code for token
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id:     env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri:  redirect_uri || `${env.SITE_URL}/app/`,
          grant_type:    'authorization_code'
        }).toString()
      });
      const tokenData = await tokenRes.json();
      if (tokenData.error) throw new Error(tokenData.error_description || tokenData.error);

      // Get user info
      const userRes  = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
      });
      const googleUser = await userRes.json();
      if (!googleUser.email) throw new Error('No email from Google');

      const country = await getCountry(ip);

      // Check existing auth provider
      const existingAuth = await fetch(
        `${env.SUPABASE_URL}/rest/v1/auth_providers?provider=eq.google&provider_email=eq.${encodeURIComponent(googleUser.email)}&select=user_id,id`,
        { headers: { 'apikey': env.SUPABASE_SERVICE_KEY,
                     'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
      ).then(r => r.json());

      let userId, plan, isNew;

      if (Array.isArray(existingAuth) && existingAuth.length > 0) {
        // Returning user
        userId = existingAuth[0].user_id;
        isNew  = false;
        await sb(env, 'PATCH', 'users',
          { last_seen: new Date().toISOString(), country },
          `?id=eq.${userId}`
        );
        await sb(env, 'PATCH', 'auth_providers',
          { last_used_at: new Date().toISOString() },
          `?id=eq.${existingAuth[0].id}`
        );
        const userRows = await fetch(
          `${env.SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=plan`,
          { headers: { 'apikey': env.SUPABASE_SERVICE_KEY,
                       'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
        ).then(r => r.json());
        plan = userRows?.[0]?.plan || 'free';

      } else {
        // New user
        isNew = true;
        const newUser = await fetch(
          `${env.SUPABASE_URL}/rest/v1/users`,
          {
            method: 'POST',
            headers: {
              'Content-Type':  'application/json',
              'apikey':        env.SUPABASE_SERVICE_KEY,
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
              'Prefer':        'return=representation'
            },
            body: JSON.stringify({
              display_name: googleUser.name || googleUser.email.split('@')[0],
              country,
              plan:       'free',
              created_at: new Date().toISOString(),
              last_seen:  new Date().toISOString()
            })
          }
        ).then(r => r.json());

        userId = Array.isArray(newUser) ? newUser[0]?.id : newUser?.id;
        plan   = 'free';

        await sb(env, 'POST', 'auth_providers', {
          user_id:        userId,
          provider:       'google',
          provider_email: googleUser.email,
          created_at:     new Date().toISOString(),
          last_used_at:   new Date().toISOString()
        });
      }

      return json({ ok: true, userId, email: googleUser.email,
                    name: googleUser.name || '', country, plan, isNew }, 200, origin);

    } catch (e) {
      console.error('OAuth error:', e.message);
      return json({ error: e.message }, 500, origin);
    }
  }

  // ── POST /waitlist ───────────────────────────────────
  if (method === 'POST' && route === '/waitlist') {
    try {
      const { email } = await request.json();
      if (!email) return json({ error: 'Missing email' }, 400, origin);
      await fetch(`${env.SUPABASE_URL}/rest/v1/waitlist`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'apikey':        env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          'Prefer':        'return=minimal,resolution=ignore-duplicates'
        },
        body: JSON.stringify({ email, signed_up_at: new Date().toISOString(), source: 'app' })
      });
      return json({ ok: true }, 200, origin);
    } catch {
      return json({ ok: true }, 200, origin);
    }
  }

  // ── POST /check-import ───────────────────────────────
  if (method === 'POST' && route === '/check-import') {
    try {
      const { email } = await request.json();
      if (!email) return json({ allowed: false, message: 'Please sign in first.' }, 200, origin);

      const TWELVE_HRS = 12 * 60 * 60 * 1000;

      const authRows = await fetch(
        `${env.SUPABASE_URL}/rest/v1/auth_providers?provider=eq.google&provider_email=eq.${encodeURIComponent(email)}&select=user_id`,
        { headers: { 'apikey': env.SUPABASE_SERVICE_KEY,
                     'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
      ).then(r => r.json());

      const userId = Array.isArray(authRows) ? authRows[0]?.user_id : null;
      if (!userId) return json({ allowed: true }, 200, origin);

      const userRows = await fetch(
        `${env.SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=plan,last_import_at`,
        { headers: { 'apikey': env.SUPABASE_SERVICE_KEY,
                     'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
      ).then(r => r.json());

      const user = Array.isArray(userRows) ? userRows[0] : null;
      if (!user || user.plan === 'pro') return json({ allowed: true }, 200, origin);

      const lastTs = user.last_import_at ? new Date(user.last_import_at).getTime() : 0;
      const nowTs  = Date.now();

      if (nowTs - lastTs < TWELVE_HRS) {
        const rem  = TWELVE_HRS - (nowTs - lastTs);
        const hrs  = Math.floor(rem / 3600000);
        const mins = Math.floor((rem % 3600000) / 60000);
        return json({
          allowed: false,
          message: `You can import once every 12 hours on the free plan. Next import in ${hrs}h ${mins}m.`
        }, 200, origin);
      }

      await sb(env, 'PATCH', 'users',
        { last_import_at: new Date().toISOString() },
        `?id=eq.${userId}`
      );
      return json({ allowed: true }, 200, origin);

    } catch (e) {
      return json({ allowed: true }, 200, origin);
    }
  }

  // ── POST /funnel ─────────────────────────────────────
  if (method === 'POST' && route === '/funnel') {
    try {
      const { event: evt, email } = await request.json();
      if (!email || !evt) return json({ ok: true }, 200, origin);

      const authRows = await fetch(
        `${env.SUPABASE_URL}/rest/v1/auth_providers?provider=eq.google&provider_email=eq.${encodeURIComponent(email)}&select=user_id`,
        { headers: { 'apikey': env.SUPABASE_SERVICE_KEY,
                     'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
      ).then(r => r.json());

      const userId = Array.isArray(authRows) ? authRows[0]?.user_id : null;
      if (!userId) return json({ ok: true }, 200, origin);

      const colMap = {
        upgrade_viewed:    { upgrade_viewed_at:  new Date().toISOString() },
        payment_started:   { payment_started_at: new Date().toISOString() },
        payment_dismissed: { payment_failed_at:  new Date().toISOString(),
                             payment_failed_reason: 'dismissed' }
      };
      const update = colMap[evt];
      if (update) await sb(env, 'PATCH', 'users', update, `?id=eq.${userId}`);
    } catch {}
    return json({ ok: true }, 200, origin);
  }

  return json({ error: 'Not found' }, 404, origin);
}
