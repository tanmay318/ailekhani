// netlify/functions/create-order.js
// Creates a Razorpay order on the server BEFORE the user pays.
// This is what enables proper payment signature verification.
//
// Why this matters:
// Without a server-created order, you cannot verify the payment signature.
// With it, you get a 3-way proof: order_id + payment_id + signature.
// A fraudster cannot fake all three.
//
// Environment variables needed (set in Netlify dashboard):
//   RAZORPAY_KEY_ID      — your Razorpay Key ID (starts with rzp_live_ or rzp_test_)
//   RAZORPAY_KEY_SECRET  — your Razorpay Key Secret
//   SITE_URL             — https://ailekhani.com

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin':  process.env.SITE_URL || 'https://ailekhani.com',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { plan, email } = body;

  if (!plan || !email) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing plan or email' }) };
  }

  // ── Amount in paise (₹1 = 100 paise) ─────────────────
  const amounts = {
    monthly: 39900,   // ₹399.00
    annual:  349900   // ₹3,499.00
  };

  const amount = amounts[plan];
  if (!amount) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid plan' }) };
  }

  try {
    // ── Create Razorpay order via their API ───────────────
    // Basic auth: Key ID : Key Secret encoded as Base64
    const credentials = Buffer.from(
      `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`
    ).toString('base64');

    const orderPayload = {
      amount,
      currency: 'INR',
      receipt:  `al_${Date.now()}_${email.split('@')[0].slice(0,8)}`,
      notes: {
        plan,
        email,
        product: 'AI Lekhani Pro'
      }
    };

    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Basic ${credentials}`
      },
      body: JSON.stringify(orderPayload)
    });

    const order = await response.json();

    if (!response.ok || order.error) {
      console.error('Razorpay order creation failed:', order);
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: order.error?.description || 'Could not create order' })
      };
    }

    // ── Return order details to browser ──────────────────
    // The browser uses order.id to open Razorpay checkout
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        orderId:  order.id,
        amount:   order.amount,
        currency: order.currency,
        plan,
        email
      })
    };

  } catch (e) {
    console.error('create-order error:', e.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};
