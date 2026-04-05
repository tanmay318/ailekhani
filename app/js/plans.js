// ─────────────────────────────────────────────────────
// ailekhani/app/js/plans.js
// Free vs Pro feature gating.
// Single source of truth for all plan limits.
// Every gate check goes through this file.
// ─────────────────────────────────────────────────────
'use strict';

// ── Plan definitions ──────────────────────────────────
const PLANS = {

  free: {
    name: 'Free',
    price: 0,

    // Hard limits
    maxProjects:       1,       // only 1 book
    maxChapters:       20,      // 20 chapters per book on free
    maxCodexSections: 2,        // characters + plot only (no timeline, world)

    // Provider access
    allowedProviders: ['gemini'],  // Gemini only

    // Style modes allowed
    allowedStyles: ['literary', 'conversational'],

    // Feature flags
    features: {
      factExtraction:      false,  // no continuity engine
      continuityWarnings:  false,
      voiceInput:          false,
      exportBackup:        true,   // plain TXT export free
      importBackup:        false,
      readAloud:           false,
      hindiWriting:        true,   // English + Hindi free
      tamilWriting:        false,
      arcDashboard:        false,
      memoryReview:        false,
    }
  },

  pro: {
    name: 'Pro',
    price: 399,

    // No hard limits
    maxProjects:       Infinity,
    maxChapters:       Infinity,
    maxCodexSections:  4,          // all sections

    // All providers
    allowedProviders: ['gemini', 'anthropic', 'openai'],

    // All style modes
    allowedStyles: ['literary', 'conversational', 'mythic', 'devotional', 'dramatic', 'children'],

    // All features
    features: {
      factExtraction:      true,
      continuityWarnings:  true,
      voiceInput:          true,
      exportBackup:        true,
      importBackup:        true,
      readAloud:           true,
      hindiWriting:        true,
      tamilWriting:        true,
      arcDashboard:        true,
      memoryReview:        true,
    }
  }
};

// ── Get current plan object ───────────────────────────
function getCurrentPlan() {
  // Check auth user first (from auth.js)
  const authUser = typeof getUser === 'function' ? getUser() : null;
  const plan = authUser?.plan || S?.plan || 'free';
  return PLANS[plan] || PLANS.free;
}

function isPro() {
  return getCurrentPlan().name === 'Pro';
}

// ── Feature gate checks ───────────────────────────────
// Returns true if allowed, false if blocked
function canUse(feature) {
  return getCurrentPlan().features[feature] === true;
}

function canAddProject() {
  const plan  = getCurrentPlan();
  const count = Object.keys(S?.projects || {}).length;
  return count < plan.maxProjects;
}

function canAddChapter(proj) {
  const plan  = getCurrentPlan();
  const count = (proj?.chapters || []).length;
  return count < plan.maxChapters;
}

function canUseProvider(provider) {
  return getCurrentPlan().allowedProviders.includes(provider);
}

function canUseStyle(style) {
  return getCurrentPlan().allowedStyles.includes(style);
}

function canUseLanguage(lang) {
  if (lang === 'en') return true;
  if (lang === 'hi') return canUse('hindiWriting');
  if (lang === 'ta') return canUse('tamilWriting');
  return false;
}

// ── Gate wrapper — shows upgrade prompt if blocked ────
// Usage: if (!gate('voiceInput')) return;
function gate(feature, customMessage) {
  if (canUse(feature)) return true;
  showUpgradePrompt(feature, customMessage);
  return false;
}

// ── Upgrade prompt ────────────────────────────────────
const FEATURE_MESSAGES = {
  voiceInput:         'Voice input is a Pro feature. Speak your chapter instructions instead of typing.',
  exportBackup:       'Export your writing as a readable .txt file — free for everyone.',
  importBackup:       'Import & restore is a Pro feature. Restore your writing on any device.',
  factExtraction:     'The continuity engine is a Pro feature. Never lose track of story facts again.',
  continuityWarnings: 'Continuity warnings are a Pro feature. Catch plot holes before they happen.',
  readAloud:          'Read aloud is a Pro feature. Proofread by listening to your prose.',
  hindiWriting:       'Hindi writing is included in the free plan.',  // now free
  tamilWriting:       'Writing in Tamil is a Pro feature.',
  memoryReview:       'Memory review is a Pro feature. Accept and manage extracted story facts.',
  arcDashboard:       'The arc dashboard is a Pro feature. Visualise your story structure.',
};

function showUpgradePrompt(feature, customMessage) {
  const message = customMessage || FEATURE_MESSAGES[feature] || 'This is a Pro feature.';
  const modal   = document.getElementById('modal-content');
  if (!modal) { openUpgrade(); return; }

  modal.innerHTML = `
    <div style="text-align:center;padding:8px 0 16px;">
      <div style="font-size:32px;margin-bottom:12px;">⭐</div>
      <h2 style="font-family:'Cormorant Garamond',serif;font-size:22px;
                 font-style:italic;color:var(--gold2);margin-bottom:10px;">
        Pro feature
      </h2>
      <p style="font-size:15px;color:var(--text3);max-width:340px;
                margin:0 auto 20px;line-height:1.7;">
        ${message}
      </p>
      <div style="background:var(--gold-pale);border:1px solid var(--gold-dim);
                  border-radius:var(--radius);padding:16px;margin-bottom:16px;text-align:left;">
        <div style="font-family:'JetBrains Mono',monospace;font-size:10px;
                    color:var(--gold);letter-spacing:0.1em;margin-bottom:10px;">
          EVERYTHING IN PRO
        </div>
        ${[
          'Unlimited books and chapters',
          'Write in Hindi and Tamil',
          'Claude and ChatGPT support',
          'All 6 writing style modes',
          'Continuity engine and fact extraction',
          'Voice input and read aloud',
          'Encrypted backup and restore',
        ].map(f => `
          <div style="display:flex;gap:8px;font-size:13px;color:var(--text2);
                      margin-bottom:6px;align-items:flex-start;">
            <span style="color:var(--green);flex-shrink:0;">✓</span>
            <span>${f}</span>
          </div>`).join('')}
        <div style="margin-top:12px;text-align:center;">
          <div style="font-family:'Cormorant Garamond',serif;font-size:28px;
                      font-style:italic;color:var(--gold2);">
            ₹399<span style="font-size:16px;color:var(--text3);">/month</span>
          </div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:10px;
                      color:var(--text4);margin-top:2px;">
            or ₹3,499/year — save 27%
          </div>
        </div>
      </div>
      <button onclick="closeModal();openUpgrade();"
        style="width:100%;background:var(--gold-dim);border:1px solid var(--gold-dim);
               color:var(--gold3);padding:13px;border-radius:var(--radius);
               cursor:pointer;font-family:'Cormorant Garamond',serif;
               font-size:17px;font-style:italic;margin-bottom:8px;">
        Join Pro Waitlist — First Month Free →
      </button>
      <button onclick="closeModal();"
        style="width:100%;background:none;border:1px solid var(--border);
               color:var(--text4);padding:9px;border-radius:var(--radius);
               cursor:pointer;font-size:12px;font-family:'JetBrains Mono',monospace;">
        Maybe later
      </button>
    </div>`;

  if (typeof openModal === 'function') openModal();
}

// ── Chapter limit prompt ──────────────────────────────
function showChapterLimitPrompt() {
  showUpgradePrompt(null,
    'You have reached the 20-chapter limit on the free plan. Upgrade to Pro for unlimited chapters and continue your story.'
  );
}

// ── Project limit prompt ──────────────────────────────
function showProjectLimitPrompt() {
  showUpgradePrompt(null,
    'The free plan allows 1 book. Upgrade to Pro to write unlimited books simultaneously.'
  );
}

// ── Language lock prompt ──────────────────────────────
function showLanguageLockPrompt(lang) {
  const names = { hi: 'Hindi', ta: 'Tamil' };
  showUpgradePrompt(null,
    `Writing in ${names[lang] || lang} is a Pro feature. Upgrade to unlock all three languages.`
  );
}

// ── Provider lock prompt ──────────────────────────────
function showProviderLockPrompt(provider) {
  const names = { anthropic: 'Claude', openai: 'ChatGPT' };
  showUpgradePrompt(null,
    `${names[provider] || provider} is a Pro feature. Free plan supports Gemini only. Upgrade to use any AI provider.`
  );
}

// ── Free tier UI helpers ──────────────────────────────
// Shows a lock icon on restricted UI elements
function lockIcon(feature) {
  if (canUse(feature)) return '';
  return `<span style="font-size:10px;margin-left:4px;opacity:0.6;"
                title="Pro feature — upgrade to unlock">🔒</span>`;
}

// Shows remaining free tier usage
function freeUsageBadge() {
  if (isPro()) return '';
  const projCount = Object.keys(S?.projects || {}).length;
  const proj      = activeProj();
  const chapCount = (proj?.chapters || []).length;

  const parts = [];
  if (projCount >= 1)  parts.push(`1/1 books`);
  if (chapCount > 0)   parts.push(`${chapCount}/20 chapters`);

  if (!parts.length) return '';

  return `<div style="font-family:'JetBrains Mono',monospace;font-size:9px;
                      color:var(--text4);text-align:center;padding:4px 8px;
                      background:var(--bg3);border-radius:4px;margin-top:4px;">
    FREE: ${parts.join(' · ')}
    <span onclick="openUpgrade()" style="color:var(--gold);cursor:pointer;margin-left:4px;">
      Upgrade →
    </span>
  </div>`;
}

// ── Import rate limit — 1 per 12 hours for free users ──
function canImportFree() {
  if (isPro()) return { allowed: true };
  const key  = 'ailekhani_last_import';
  const last = parseInt(localStorage.getItem(key) || '0', 10);
  const now  = Date.now();
  const TWELVE_HOURS = 12 * 60 * 60 * 1000;
  if (now - last < TWELVE_HOURS) {
    const remaining = TWELVE_HOURS - (now - last);
    const hrs  = Math.floor(remaining / 3600000);
    const mins = Math.floor((remaining % 3600000) / 60000);
    return {
      allowed: false,
      message: `You can import once every 12 hours on the free plan. Next import available in ${hrs}h ${mins}m. Upgrade to Pro for unlimited imports.`
    };
  }
  return { allowed: true };
}

function recordImport() {
  localStorage.setItem('ailekhani_last_import', Date.now().toString());
}

