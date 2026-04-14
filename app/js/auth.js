// ─────────────────────────────────────────────────────
// ailekhani/app/js/auth.js  v3
// Google OAuth login — authorization code flow
// ─────────────────────────────────────────────────────
'use strict';

const GOOGLE_CLIENT_ID = '914285653377-i0mttb01b7008g42l4q6h8vq9ggka8k4.apps.googleusercontent.com';
const REDIRECT_URI     = window.location.origin + '/app/';
const AUTH_ENDPOINT    = '/api/auth/google';
const STATS_ENDPOINT   = '/api/auth/stats';
const VISITOR_ENDPOINT = '/api/auth/visitor';
const SCOPE            = 'openid email profile';

// ── User state ────────────────────────────────────────
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

function getUser()    { return _currentUser; }
function isLoggedIn() { return !!_currentUser?.email; }
function isPro()      { return _currentUser?.plan === 'pro'; }

// ── CSRF state ────────────────────────────────────────
function generateState() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2,'0')).join('');
}

// ── Start Google login ────────────────────────────────
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
  window.location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + params;
}

// ── Handle OAuth callback ─────────────────────────────
async function handleOAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const code   = params.get('code');
  const state  = params.get('state');
  const error  = params.get('error');

  // No code = not a callback
  if (!code) return false;

  // Clear URL immediately
  window.history.replaceState({}, '', window.location.pathname);

  if (error) {
    console.warn('Google OAuth error:', error);
    return false;
  }

  // CSRF check
  const savedState = localStorage.getItem('al_oauth_state');
  if (state !== savedState) {
    console.error('OAuth state mismatch — possible CSRF');
    return false;
  }
  localStorage.removeItem('al_oauth_state');

  // Show loading
  showAuthLoading(true);

  try {
    console.log('Calling auth endpoint:', AUTH_ENDPOINT);
    const res = await fetch(AUTH_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ code, redirect_uri: REDIRECT_URI })
    });

    console.log('Auth response status:', res.status);
    const data = await res.json();
    console.log('Auth response data:', JSON.stringify(data));

    if (!res.ok || data.error) {
      throw new Error(data.error || 'Auth failed — status ' + res.status);
    }

    const user = {
      email:      data.email,
      name:       data.name || data.email.split('@')[0],
      country:    data.country,
      plan:       data.plan || 'free',
      userId:     data.userId,
      isNew:      data.isNew,
      loggedInAt: new Date().toISOString()
    };

    saveUser(user);
    showAuthLoading(false);
    updateAuthUI();

    if (data.isNew) {
      toast('Welcome to AI Lekhani! 🎉');
    } else {
      toast('Welcome back, ' + (user.name || user.email.split('@')[0]) + ' ✓');
    }

    return true;

  } catch(e) {
    showAuthLoading(false);
    console.error('Auth callback error:', e.message);
    toast('Sign-in failed: ' + e.message, 'error', 6000);
    return false;
  }
}

// ── Sign out ──────────────────────────────────────────
function signOut() {
  clearUser();
  updateAuthUI();
  // Show sign in screen
  if (typeof showSignInScreen === 'function') showSignInScreen();
  toast('Signed out ✓');
}

// ── Visitor tracking ──────────────────────────────────
async function trackVisit() {
  try { await fetch(VISITOR_ENDPOINT, { method: 'POST' }); } catch(e) {}
}

// ── Stats ─────────────────────────────────────────────
async function loadStats() {
  try {
    const res  = await fetch(STATS_ENDPOINT);
    const data = await res.json();
    return { visitors: data.visitors || 0, users: data.users || 0 };
  } catch(e) {
    return { visitors: 0, users: 0 };
  }
}

async function updateStatsDisplay() {
  const stats = await loadStats();
  const vc = document.getElementById('visitor-count');
  if (vc) vc.textContent = formatCount(stats.visitors);
  const uc = document.getElementById('user-count');
  if (uc) uc.textContent = formatCount(stats.users);
}

function formatCount(n) {
  if (n >= 1000) return (n/1000).toFixed(1) + 'k';
  return n.toString();
}

// ── Auth UI ───────────────────────────────────────────
function updateAuthUI() {
  const user    = getUser();
  const authBtn = document.getElementById('auth-btn');
  if (authBtn) {
    if (user) {
      authBtn.textContent = user.name || user.email.split('@')[0];
      authBtn.title       = user.email + ' · ' + user.plan + ' plan';
      authBtn.onclick     = () => openUserPanel();
      authBtn.style.color = 'var(--gold2)';
    } else {
      authBtn.textContent = 'Sign in';
      authBtn.title       = 'Sign in with Google';
      authBtn.onclick     = loginWithGoogle;
      authBtn.style.color = '';
    }
  }
  const freePill = document.getElementById('free-pill');
  if (freePill) {
    freePill.textContent = user?.plan === 'pro' ? 'PRO ⭐' : 'FREE';
    freePill.style.color = user?.plan === 'pro' ? 'var(--gold2)' : '';
  }
}

function showAuthLoading(on) {
  const btn = document.getElementById('auth-btn');
  if (btn) btn.textContent = on ? 'Signing in…' : (getUser()?.name || 'Sign in');
}

// ── User panel modal ──────────────────────────────────
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
                    display:flex;align-items:center;justify-content:center;font-size:18px;
                    font-family:'Cormorant Garamond',serif;color:var(--gold3);">
          ${user.email[0].toUpperCase()}
        </div>
        <div>
          <div style="font-size:15px;color:var(--text1);font-style:italic;
                      font-family:'Cormorant Garamond',serif;">${user.name || user.email.split('@')[0]}</div>
          <div style="font-size:11px;color:var(--text4);font-family:'JetBrains Mono',monospace;">
            ${user.email}
          </div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;
                  font-family:'JetBrains Mono',monospace;">
        <div style="color:var(--text4);">Plan</div>
        <div style="color:${user.plan==='pro'?'var(--gold2)':'var(--text2)'}">${user.plan.toUpperCase()}</div>
        <div style="color:var(--text4);">Country</div>
        <div style="color:var(--text2);">${user.country || 'Unknown'}</div>
      </div>
    </div>
    ${user.plan !== 'pro' ? `
    <div style="background:var(--gold-pale);border:1px solid var(--gold-dim);
                border-radius:var(--radius);padding:14px;margin-bottom:16px;">
      <div style="font-family:'Cormorant Garamond',serif;font-size:16px;
                  font-style:italic;color:var(--gold2);margin-bottom:6px;">
        Upgrade to Pro — ₹399/month
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
               font-family:'Cormorant Garamond',serif;font-size:14px;">Close</button>
      <button onclick="signOut();closeModal();"
        style="background:none;border:1px solid var(--border);color:var(--text4);
               padding:9px 16px;border-radius:var(--radius);cursor:pointer;
               font-size:12px;font-family:'JetBrains Mono',monospace;">Sign out</button>
    </div>`;
  if (typeof openModal === 'function') openModal();
}

// ── Init ──────────────────────────────────────────────
async function initAuth() {
  // 1. Load saved user from storage
  loadUserFromStorage();

  // 2. Handle OAuth callback if ?code is in URL
  const hasCode = new URLSearchParams(window.location.search).get('code');
  if (hasCode) {
    const success = await handleOAuthCallback();
    console.log('OAuth callback result:', success);
    // If callback succeeded, user is now in storage
    // Reload user from storage to make sure _currentUser is set
    loadUserFromStorage();
  }

  // 3. Background tasks
  trackVisit();
  updateAuthUI();
  updateStatsDisplay();

  // 4. Signal app to boot — user state is now final
  if (typeof window.onAuthReady === 'function') {
    window.onAuthReady();
  }
}

// Auto-init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAuth);
} else {
  initAuth();
}
