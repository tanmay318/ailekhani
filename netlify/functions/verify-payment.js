// netlify/functions/verify-payment.js
// Place this file at: netlify/functions/verify-payment.js in your repo
// This is your Netlify serverless function — runs on Netlify's servers, not the browser
//
// Environment variables to set in Netlify dashboard (Site settings → Environment variables):
//   RAZORPAY_KEY_ID         — from your Razorpay dashboard (public key)
//   RAZORPAY_KEY_SECRET     — from your Razorpay dashboard (secret key)
//   SUPABASE_URL            — from Supabase project settings
//   SUPABASE_SERVICE_KEY    — service_role key OR sb_secret_... key
//                            (Supabase → Project Settings → API → service_role or Secret keys tab)

const crypto = require('crypto');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const body = JSON.parse(event.body);
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      plan,
      email
    } = body;

    // ── STEP 1: Verify Razorpay signature ──
    // This proves the payment actually came from Razorpay, not a fake request
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      console.error('Invalid Razorpay signature — possible fraud attempt');
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid payment signature' })
      };
    }

    // ── STEP 2: Generate a unique licence key for this user ──
    const licenceKey = 'LK-' + crypto.randomBytes(16).toString('hex').toUpperCase();

    // ── STEP 3: Calculate expiry date ──
    const expiresAt = new Date();
    if (plan === 'annual') {
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    } else {
      expiresAt.setMonth(expiresAt.getMonth() + 1);
    }

    // ── STEP 4: Write to Supabase ──
    const supabaseResponse = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/licences`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': process.env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          user_id: userId || null,
          licence_key: licenceKey,
          plan: plan,
          payment_id: razorpay_payment_id,
          order_id: razorpay_order_id,
          paid_at: new Date().toISOString(),
          expires_at: expiresAt.toISOString(),
          active: true
        })
      }
    );

    if (!supabaseResponse.ok) {
      const error = await supabaseResponse.text();
      console.error('Supabase write failed:', error);
      // Payment succeeded but DB write failed — log it, don't fail the user
      // You can still recover from Razorpay dashboard
    }

    // ── STEP 4b: Look up user_id via auth_providers, update plan ──
    if (body.email) {
      try {
        // Find user_id from auth_providers table
        const authRes = await fetch(
          `${process.env.SUPABASE_URL}/rest/v1/auth_providers?provider=eq.google&provider_email=eq.${encodeURIComponent(body.email)}&select=user_id`,
          { headers: {
              'apikey': process.env.SUPABASE_SERVICE_KEY,
              'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
            }
          }
        );
        const authRows = await authRes.json();
        const userId = Array.isArray(authRows) ? authRows[0]?.user_id : null;

        if (userId) {
          // Update the users row via UUID — not email
          await fetch(
            `${process.env.SUPABASE_URL}/rest/v1/users?id=eq.${userId}`,
            {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                'apikey': process.env.SUPABASE_SERVICE_KEY,
                'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
              },
              body: JSON.stringify({ plan: 'pro', licence_key: licenceKey })
            }
          );
        }
      } catch (e2) {
        console.error('Could not update user plan:', e2.message);
        // Payment still succeeded — log and investigate manually
      }
    }

    // ── STEP 5: Return licence key to the browser ──
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        licenceKey,
        plan,
        expiresAt: expiresAt.toISOString()
      })
    };

  } catch (error) {
    console.error('Webhook error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};

// ══════════════════════════════════════════════════════════════
// RECOVERY SCRIPT — run this if your Supabase table gets wiped
// Save as: scripts/rebuild-from-razorpay.js
// Run with: node scripts/rebuild-from-razorpay.js payments.csv
// Get payments.csv from: Razorpay Dashboard → Transactions → Export
// ══════════════════════════════════════════════════════════════

/*
const fs = require('fs');
const crypto = require('crypto');

const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_SERVICE_KEY = 'YOUR_SUPABASE_SERVICE_KEY';

async function rebuildFromCSV(csvPath) {
  const csv = fs.readFileSync(csvPath, 'utf8');
  const lines = csv.split('\n').slice(1); // skip header
  let restored = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = line.split(',');
    const paymentId = cols[0]?.trim();
    const email = cols[4]?.trim(); // adjust column index to match Razorpay's CSV
    const amount = parseInt(cols[2]?.trim() || '0');
    const createdAt = cols[7]?.trim();

    if (!paymentId) continue;

    const plan = amount >= 349900 ? 'annual' : 'monthly';
    const licenceKey = 'LK-RECOVERED-' + crypto.randomBytes(8).toString('hex').toUpperCase();
    const paidAt = new Date(createdAt);
    const expiresAt = new Date(paidAt);
    if (plan === 'annual') expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    else expiresAt.setMonth(expiresAt.getMonth() + 1);

    await fetch(`${SUPABASE_URL}/rest/v1/licences`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      },
      body: JSON.stringify({
        email, licence_key: licenceKey, plan,
        payment_id: paymentId, paid_at: paidAt.toISOString(),
        expires_at: expiresAt.toISOString(), active: true,
        note: 'Recovered from Razorpay CSV'
      })
    });

    restored++;
    console.log(`Restored ${restored}: ${email} (${plan})`);
  }
  console.log(`\nDone. ${restored} records restored.`);
}

rebuildFromCSV(process.argv[2]);
*/
