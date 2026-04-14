// functions/api/verify-payment.js — Cloudflare Pages Function

export async function onRequestPost(context) {
  const { request, env } = context;

  const headers = { 'Content-Type': 'application/json' };

  try {
    const body = await request.json();
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan, email } = body;

    // Verify Razorpay signature using Web Crypto API (Cloudflare compatible)
    const encoder     = new TextEncoder();
    const keyData     = encoder.encode(env.RAZORPAY_KEY_SECRET);
    const message     = encoder.encode(`${razorpay_order_id}|${razorpay_payment_id}`);
    const cryptoKey   = await crypto.subtle.importKey('raw', keyData,
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signatureAb = await crypto.subtle.sign('HMAC', cryptoKey, message);
    const expectedSig = Array.from(new Uint8Array(signatureAb))
      .map(b => b.toString(16).padStart(2,'0')).join('');

    if (expectedSig !== razorpay_signature) {
      return new Response(JSON.stringify({ error: 'Invalid payment signature' }),
        { status: 400, headers });
    }

    // Generate licence key
    const randomBytes = new Uint8Array(16);
    crypto.getRandomValues(randomBytes);
    const licenceKey = 'LK-' + Array.from(randomBytes)
      .map(b => b.toString(16).padStart(2,'0')).join('').toUpperCase();

    // Calculate expiry
    const expiresAt = new Date();
    if (plan === 'annual') expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    else expiresAt.setMonth(expiresAt.getMonth() + 1);

    // Look up user_id via auth_providers
    let userId = null;
    if (email) {
      try {
        const authRes  = await fetch(
          `${env.SUPABASE_URL}/rest/v1/auth_providers?provider=eq.google&provider_email=eq.${encodeURIComponent(email)}&select=user_id`,
          { headers: { 'apikey': env.SUPABASE_SERVICE_KEY,
                       'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
        );
        const authRows = await authRes.json();
        userId = Array.isArray(authRows) ? authRows[0]?.user_id : null;
      } catch {}
    }

    // Write licence to Supabase
    await fetch(`${env.SUPABASE_URL}/rest/v1/licences`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Prefer':        'return=minimal'
      },
      body: JSON.stringify({
        user_id:     userId,
        licence_key: licenceKey,
        plan,
        payment_id:  razorpay_payment_id,
        order_id:    razorpay_order_id,
        paid_at:     new Date().toISOString(),
        expires_at:  expiresAt.toISOString(),
        active:      true
      })
    });

    // Update user plan
    if (userId) {
      await fetch(`${env.SUPABASE_URL}/rest/v1/users?id=eq.${userId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type':  'application/json',
          'apikey':        env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`
        },
        body: JSON.stringify({ plan: 'pro', licence_key: licenceKey })
      });
    }

    return new Response(JSON.stringify({
      success: true, licenceKey, plan, expiresAt: expiresAt.toISOString()
    }), { status: 200, headers });

  } catch (e) {
    console.error('verify-payment error:', e);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers });
  }
}

export async function onRequestOptions() {
  return new Response('', { status: 200, headers: {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  }});
}
