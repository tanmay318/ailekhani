// ─────────────────────────────────────────────────────
// ailekhani/app/js/auth.js
// Google OAuth login — PKCE flow (browser-safe, no secret exposed)
// Stores: Gmail ID, country, plan in localStorage
// All actual auth happens in netlify/functions/auth.js
// ─────────────────────────────────────────────────────
'use strict';

// ── Config ────────────────────────────────────────────
// Replace GOOGLE_CLIENT_ID with your actual Client ID from
// Google Cloud Console → APIs & Services → Credentials
const GOOGLE_CLIENT_ID = '914285653377-i0mttb01b7008g42l4q6h8vq9ggka8k4.apps.googleusercontent.com';
const REDIRECT_URI     = window.location.origin + '/app/';
const AUTH_ENDPOINT    = '/.netlify/functions/auth/google';
const STATS_ENDPOINT   = '/.netlify/functions/auth/stats';
const VISITOR_ENDPOINT = '/.netlify/functions/auth/visitor';
const SCOPE            = 'openid email profile';

// ── Current user state ────────────────────────────────
// Stored in localStorage as 'al_user'
// Shape: { email, country, plan, userId, loggedInAt }
let _currentUser = null;

function loadUserFromStorage() {
  try {
    const raw = localStorage.getItem('al_user');
    if (raw) _currentUser = JSON.parse(raw);
  } catch(e) {}
  return _currentUser;
}

function saveUser(user) {
  _currentUser = user;
  localStorage.setItem('al_user', JSON.stringify(user));
}

function clearUser() {
  _currentUser = null;
  localStorage.removeItem('al_user');
  localStorage.removeItem('al_oauth_state');
}

function getUser() { return _currentUser; }
function isLoggedIn() { return !!_currentUser?.email; }
function isPro() { return _currentUser?.plan === 'pro'; }

// ── Generate random state for CSRF protection ─────────
function generateState() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2,'0')).join('');
}

// ── Start Google OAuth flow ───────────────────────────
function loginWithGoogle() {
  const state = generateState();
  localStorage.setItem('al_oauth_state', state);

  const params = new URLSearchParams({
    client_id:     GOOGLE_CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    response_type: 'code',
    scope:         SCOPE,
    state,
    access_type:   'online',
    prompt:        'select_account'
  });

  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}
// ✅ Safe toast fallback (prevents crash)
function toast(message, type = 'info') {
  console.log(`[${type.toUpperCase()}]`, message);

  // Optional UI fallback
  if (typeof document !== "undefined") {
    alert(message);
  }
}
// ── Handle OAuth callback (called on page load) ───────
async function handleOAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const code  = params.get('code');
  const state = params.get('state');
  const error = params.get('error');

  if (error) {
    console.warn('OAuth error:', error);
    window.history.replaceState({}, '', window.location.pathname);
    return null;
  }

  if (!code) return null;

  // ✅ Validate state (CSRF protection)
  const savedState = localStorage.getItem('al_oauth_state');

  if (!state || state !== savedState) {
    console.error('OAuth state mismatch', { state, savedState });
    window.history.replaceState({}, '', window.location.pathname);
    return null;
  }

  // Clean URL
  window.history.replaceState({}, '', window.location.pathname);
  localStorage.removeItem('al_oauth_state');

  showAuthLoading(true);

  try {
    const res = await fetch(AUTH_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirect_uri: REDIRECT_URI })
    });

    // ✅ Read raw response first (prevents SyntaxError crash)
    const text = await res.text();
    console.log("RAW RESPONSE:", text);

    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new Error("Invalid JSON response from server");
    }

    if (!res.ok || data.error) {
      throw new Error(data.error || 'Auth failed');
    }

    const user = {
      email:      data.email,
      country:    data.country,
      plan:       data.plan,
      userId:     data.userId,
      isNew:      data.isNew,
      loggedInAt: new Date().toISOString()
    };

    saveUser(user);
    showAuthLoading(false);
    updateAuthUI();
 
// 🚀 Decide where to go
setTimeout(() => {
  if (data.isNew) {
    // 👉 Show onboarding
    document.getElementById('signin-screen').style.display = 'none';
    document.getElementById('onboarding-screen').classList.remove('hidden');
    document.getElementById('topbar').style.display = 'none';
    document.getElementById('app').style.display = 'none';
  } else {
    // 👉 Go to main app
    document.getElementById('signin-screen').style.display = 'none';
    document.getElementById('onboarding-screen').classList.add('hidden');
    document.getElementById('topbar').style.display = 'flex';
    document.getElementById('app').style.display = 'flex';
  }
}, 300);
    
 // ✅ Safe toast usage
    if (data.isNew) {
      toast(`Welcome to AI Lekhani! Your account is ready.`);
    } else {
      const name = data.email ? data.email.split('@')[0] : 'User';
      toast(`Welcome back! Signed in as ${name}`);
    }

    return user;

  } catch (e) {
    showAuthLoading(false);
    console.error('Auth callback error:', e);

    toast(e.message || 'Sign-in failed. Please try again.', 'error');
    return null;
  }
}

// ── Sign out ──────────────────────────────────────────
function signOut() {
  clearUser();
  updateAuthUI();
  toast('Signed out ✓');
}

// ── Visitor counter (no login needed) ─────────────────
async function trackVisit() {
  try {
    await fetch(VISITOR_ENDPOINT, { method: 'POST' });
  } catch(e) {} // silent fail
}

// ── Load public stats ─────────────────────────────────
async function loadStats() {
  try {
    const res  = await fetch(STATS_ENDPOINT);
    const data = await res.json();
    return { visitors: data.visitors || 0, users: data.users || 0 };
  } catch(e) {
    return { visitors: 0, users: 0 };
  }
}

// ── Update stats counters in DOM ──────────────────────
async function updateStatsDisplay() {
  const stats = await loadStats();

  // Visitor counter
  const vc = document.getElementById('visitor-count');
  if (vc) vc.textContent = formatCount(stats.visitors);

  // User counter
  const uc = document.getElementById('user-count');
  if (uc) uc.textContent = formatCount(stats.users);
}

function formatCount(n) {
  if (n >= 1000) return (n/1000).toFixed(1) + 'k';
  return n.toString();
}

// ── Auth UI update ────────────────────────────────────
function updateAuthUI() {
  const user = getUser();

  // In the app (index.html)
  const authBtn   = document.getElementById('auth-btn');
  const authBadge = document.getElementById('auth-badge');

  if (authBtn) {
    if (user) {
      authBtn.textContent  = user.email.split('@')[0];
      authBtn.title        = `${user.email} · ${user.plan} plan`;
      authBtn.onclick      = () => openUserPanel();
      authBtn.style.color  = 'var(--gold2)';
    } else {
      authBtn.textContent = 'Sign in';
      authBtn.title       = 'Sign in with Google';
      authBtn.onclick     = loginWithGoogle;
      authBtn.style.color = '';
    }
  }

  // Plan badge in topbar
  const freePill = document.getElementById('free-pill');
  if (freePill) {
    freePill.textContent = user?.plan === 'pro' ? 'PRO' : 'FREE';
    freePill.style.color = user?.plan === 'pro' ? 'var(--gold2)' : '';
  }
}

// ── Loading state ─────────────────────────────────────
function showAuthLoading(on) {
  const btn = document.getElementById('auth-btn');
  if (btn) btn.textContent = on ? 'Signing in…' : (getUser()?.email?.split('@')[0] || 'Sign in');
}

// ── User panel (modal) ────────────────────────────────
function openUserPanel() {
  const user = getUser();
  if (!user) { loginWithGoogle(); return; }

  const modal = document.getElementById('modal-content');
  if (!modal) return;

  modal.innerHTML = `
    <h2>Your Account</h2>
    <div style="background:var(--bg3);border-radius:var(--radius);padding:16px;margin-bottom:16px;">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
        <div style="width:40px;height:40px;border-radius:50%;background:var(--gold-dim);
                    display:flex;align-items:center;justify-content:center;
                    font-size:18px;font-family:'Cormorant Garamond',serif;color:var(--gold3);">
          ${user.email[0].toUpperCase()}
        </div>
        <div>
          <div style="font-size:15px;color:var(--text1);font-style:italic;
                      font-family:'Cormorant Garamond',serif;">${user.email.split('@')[0]}</div>
          <div style="font-size:11px;color:var(--text4);font-family:'JetBrains Mono',monospace;">
            ${user.email}
          </div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;
                  font-family:'JetBrains Mono',monospace;">
        <div style="color:var(--text4);">Plan</div>
        <div style="color:${user.plan==='pro'?'var(--gold2)':'var(--text2)'};">
          ${user.plan.toUpperCase()}
        </div>
        <div style="color:var(--text4);">Country</div>
        <div style="color:var(--text2);">${user.country || 'Unknown'}</div>
        <div style="color:var(--text4);">Member since</div>
        <div style="color:var(--text2);">${new Date(user.loggedInAt).toLocaleDateString('en-IN')}</div>
      </div>
    </div>

    ${user.plan !== 'pro' ? `
    <div style="background:var(--gold-pale);border:1px solid var(--gold-dim);
                border-radius:var(--radius);padding:14px;margin-bottom:16px;">
      <div style="font-family:'Cormorant Garamond',serif;font-size:16px;
                  font-style:italic;color:var(--gold2);margin-bottom:6px;">
        Upgrade to Pro — ₹399/month
      </div>
      <div style="font-size:12px;color:var(--text3);margin-bottom:10px;line-height:1.6;">
        Cloud sync · EPUB export · Analytics · Priority support
      </div>
      <button onclick="closeModal();openUpgrade();"
        style="width:100%;background:var(--gold-dim);border:none;color:var(--gold3);
               padding:9px;border-radius:var(--radius);cursor:pointer;
               font-family:'Cormorant Garamond',serif;font-size:15px;font-style:italic;">
        Upgrade →
      </button>
    </div>` : ''}

    <div style="display:flex;gap:8px;">
      <button onclick="closeModal();"
        style="flex:1;background:none;border:1px solid var(--border);color:var(--text3);
               padding:9px;border-radius:var(--radius);cursor:pointer;
               font-family:'Cormorant Garamond',serif;font-size:14px;">
        Close
      </button>
      <button onclick="signOut();closeModal();"
        style="background:none;border:1px solid var(--border);color:var(--text4);
               padding:9px 16px;border-radius:var(--radius);cursor:pointer;
               font-size:12px;font-family:'JetBrains Mono',monospace;">
        Sign out
      </button>
    </div>`;

  if (typeof openModal === 'function') openModal();
}

// ── Init on page load ─────────────────────────────────
async function initAuth() {
  loadUserFromStorage();
  const params = new URLSearchParams(window.location.search);
  if (params.get('code')) {
    await handleOAuthCallback();
    return;
  }
  const user = getUser();
  if (!user) {
    // 👉 Show sign-in screen
    document.getElementById('signin-screen').style.display = 'flex';
    document.getElementById('onboarding-screen').classList.add('hidden');
    document.getElementById('topbar').style.display = 'none';
    document.getElementById('app').style.display = 'none';
  } else {
    // 👉 Existing user → skip onboarding
    document.getElementById('signin-screen').style.display = 'none';
    document.getElementById('onboarding-screen').classList.add('hidden');
    document.getElementById('topbar').style.display = 'flex';
    document.getElementById('app').style.display = 'flex';
  }
  trackVisit();
  updateAuthUI();
  updateStatsDisplay();
}
  // Track this visit
  trackVisit();

  // Update UI
  updateAuthUI();
  updateStatsDisplay();

  // Signal to app/index.html that auth is ready
  // This triggers the boot sequence which decides what screen to show
  if (typeof window.onAuthReady === 'function') {
    window.onAuthReady();
  }
}

// Auto-init
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAuth);
} else {
  initAuth();
}
