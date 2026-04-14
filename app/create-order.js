// functions/api/create-order.js — Cloudflare Pages Function

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || 'https://ailekhani.com';

  const headers = {
    'Content-Type':                 'application/json',
    'Access-Control-Allow-Origin':  origin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid body' }), { status: 400, headers });
  }

  const { plan, email } = body;
  if (!plan || !email) {
    return new Response(JSON.stringify({ error: 'Missing plan or email' }), { status: 400, headers });
  }

  const amounts = { monthly: 39900, annual: 349900 };
  const amount  = amounts[plan];
  if (!amount) {
    return new Response(JSON.stringify({ error: 'Invalid plan' }), { status: 400, headers });
  }

  try {
    const credentials = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Basic ${credentials}`
      },
      body: JSON.stringify({
        amount,
        currency: 'INR',
        receipt:  `al_${Date.now()}_${email.split('@')[0].slice(0,8)}`,
        notes:    { plan, email, product: 'AI Lekhani Pro' }
      })
    });

    const order = await response.json();
    if (!response.ok || order.error) {
      return new Response(JSON.stringify({ error: order.error?.description || 'Could not create order' }),
        { status: 502, headers });
    }

    return new Response(JSON.stringify({
      orderId: order.id, amount: order.amount, currency: order.currency, plan, email
    }), { status: 200, headers });

  } catch (e) {
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
