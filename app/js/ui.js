// ─────────────────────────────────────────────────────
// lekhak/js/ui.js
// UI panels for v5 features:
//   - Fact review badge + panel
//   - Continuity warning strip + panel
//   - Memory promotion / dismissal
//   - Patched sendMessage with extraction pipeline
//   - DOM injection helpers
// ─────────────────────────────────────────────────────
'use strict';

// ════════════════════════════════════════════
// FACT REVIEW BADGE + PANEL
// ════════════════════════════════════════════

function showFactReviewBadge(count, facts) {
  if(typeof canUse==='function'&&!canUse('memoryReview'))return;
  const existing = document.getElementById('fact-review-badge');
  if (existing) existing.remove();
  if (!count) return;

  const badge = document.createElement('div');
  badge.id = 'fact-review-badge';
  badge.style.cssText = `
    position:fixed;bottom:80px;right:20px;
    background:var(--gold-dim);color:var(--gold3);
    border:1px solid var(--gold);border-radius:20px;
    padding:6px 14px;font-family:'JetBrains Mono',monospace;
    font-size:11px;cursor:pointer;z-index:500;
    box-shadow:0 4px 16px rgba(0,0,0,0.4);transition:all 0.2s;`;
  badge.textContent = `✦ ${count} fact${count > 1 ? 's' : ''} extracted — review`;
  badge.onclick = () => { openMemoryReview(facts); badge.remove(); };
  document.body.appendChild(badge);

  // Fade after 8 seconds (user can still click)
  setTimeout(() => { if (badge.parentNode) badge.style.opacity = '0.5'; }, 8000);
}

function openMemoryReview(facts) {
  const proj = activeProj();
  if (!facts?.length) { toast('No facts to review'); return; }

  document.getElementById('modal-content').innerHTML = `
    <h2>✦ Review Extracted Facts</h2>
    <p style="font-size:13px;color:var(--text3);margin-bottom:14px;font-style:italic;">
      These facts were automatically extracted from the last AI response.
      Promote the ones you want remembered. Dismiss anything wrong.
    </p>

    <div id="fact-review-list" style="display:flex;flex-direction:column;gap:10px;">
      ${facts.map(f => factCard(f, proj)).join('')}
    </div>

    <div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end;">
      <button onclick="promoteAllFacts(${JSON.stringify(facts.map(f => f.id))},'arc')"
        style="background:var(--gold-dim);border:none;color:var(--gold3);
               padding:7px 14px;border-radius:var(--radius);cursor:pointer;
               font-size:13px;font-family:'Cormorant Garamond',serif;font-style:italic;">
        Accept all as Arc Memory
      </button>
      <button class="modal-cancel" onclick="closeModal()">Close</button>
    </div>`;
  openModal();
}

function factCard(f, proj) {
  const hasConflict = proj?.continuity?.warnings
    ?.some(w => w.proposedMemoryId === f.id && w.status === 'open');

  return `
    <div id="fact-${f.id}"
      style="background:var(--bg3);border:1px solid ${hasConflict ? 'var(--red)' : 'var(--border)'};
             border-radius:var(--radius);padding:12px 14px;">

      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <span style="font-family:'JetBrains Mono',monospace;font-size:9px;
                     background:var(--bg2);color:var(--gold);padding:2px 6px;
                     border-radius:3px;text-transform:uppercase;">
          ${f.type.replace(/_/g, ' ')}
        </span>
        <span style="font-size:13px;color:var(--text2);font-style:italic;">
          ${esc(f.title)}
        </span>
      </div>

      <div style="font-size:13px;color:var(--text1);margin-bottom:8px;line-height:1.6;">
        ${esc(f.content)}
      </div>

      ${hasConflict ? `
        <div style="font-size:11px;color:var(--red);margin-bottom:6px;
                    font-family:'JetBrains Mono',monospace;">
          ⚠ Possible contradiction with existing canon
        </div>` : ''}

      <div style="display:flex;gap:7px;flex-wrap:wrap;">
        <button onclick="promoteFact('${f.id}','canon')"
          style="background:var(--green);border:none;color:#fff;padding:4px 10px;
                 border-radius:4px;cursor:pointer;font-size:11px;
                 font-family:'JetBrains Mono',monospace;">
          Accept as Canon
        </button>
        <button onclick="promoteFact('${f.id}','arc')"
          style="background:var(--gold-dim);border:none;color:var(--gold3);padding:4px 10px;
                 border-radius:4px;cursor:pointer;font-size:11px;
                 font-family:'JetBrains Mono',monospace;">
          Arc Memory
        </button>
        <button onclick="promoteFact('${f.id}','reference')"
          style="background:var(--bg4);border:1px solid var(--border);color:var(--text3);
                 padding:4px 10px;border-radius:4px;cursor:pointer;font-size:11px;
                 font-family:'JetBrains Mono',monospace;">
          Reference
        </button>
        <button onclick="dismissFact('${f.id}')"
          style="background:none;border:1px solid var(--border);color:var(--text4);
                 padding:4px 10px;border-radius:4px;cursor:pointer;font-size:11px;
                 font-family:'JetBrains Mono',monospace;">
          Dismiss
        </button>
      </div>
    </div>`;
}

// ── Memory promotion / dismissal ──────────────────────
function promoteFact(factId, layer) {
  const proj = activeProj();
  if (!proj) return;

  const idx = proj.memory.working.findIndex(m => m.id === factId);
  if (idx === -1) return;

  const fact = proj.memory.working.splice(idx, 1)[0];
  fact.status    = layer === 'reference' ? 'proposed' : 'canon';
  fact.layer     = layer;
  fact.updatedAt = new Date().toISOString();

  proj.memory[layer].push(fact);
  save();

  const el = document.getElementById('fact-' + factId);
  if (el) {
    el.style.opacity = '0.5';
    el.innerHTML = `
      <div style="font-size:12px;color:var(--green);
                  font-family:'JetBrains Mono',monospace;">
        ✓ Moved to ${layer} memory
      </div>`;
  }
  toast(`Added to ${layer} memory ✓`);
}

function promoteAllFacts(ids, layer) {
  ids.forEach(id => promoteFact(id, layer));
  setTimeout(closeModal, 600);
}

function dismissFact(factId) {
  const proj = activeProj();
  if (!proj) return;
  proj.memory.working = proj.memory.working.filter(m => m.id !== factId);
  save();
  const el = document.getElementById('fact-' + factId);
  if (el) el.remove();
}

// ════════════════════════════════════════════
// CONTINUITY WARNING STRIP + PANEL
// ════════════════════════════════════════════

function showContinuityWarningBadge(count) {
  if(typeof canUse==='function'&&!canUse('continuityWarnings'))return;
  const strip = document.getElementById('continuity-strip');
  if (!strip) return;
  strip.textContent = `⚠ ${count} continuity warning${count > 1 ? 's' : ''} — click to review`;
  strip.style.display = 'flex';
}

function openContinuityWarnings() {
  const proj = activeProj();
  if (!proj) return;
  const open = (proj.continuity?.warnings || []).filter(w => w.status === 'open');

  document.getElementById('modal-content').innerHTML = `
    <h2>⚠ Continuity Warnings</h2>

    ${!open.length
      ? `<div style="color:var(--green);font-family:'JetBrains Mono',monospace;
                    font-size:13px;padding:12px 0;">
           No open warnings. Story is consistent. ✓
         </div>`
      : `<div style="display:flex;flex-direction:column;gap:10px;">
           ${open.map(w => warningCard(w)).join('')}
         </div>`
    }
    <div class="modal-row">
      <button class="modal-cancel" onclick="closeModal()">Close</button>
    </div>`;
  openModal();
}

function warningCard(w) {
  const isError = w.severity === 'error';
  return `
    <div style="background:var(--bg3);
                border:1px solid ${isError ? 'var(--red)' : 'var(--border)'};
                border-radius:var(--radius);padding:12px 14px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <span>${isError ? '🔴' : '🟡'}</span>
        <span style="font-family:'JetBrains Mono',monospace;font-size:9px;
                     color:${isError ? 'var(--red)' : 'var(--gold)'};
                     text-transform:uppercase;">
          ${w.type.replace(/_/g, ' ')}
        </span>
      </div>
      <div style="font-size:13px;color:var(--text1);margin-bottom:6px;">
        ${esc(w.message)}
      </div>
      ${w.sourceExcerpt ? `
        <div style="font-size:12px;color:var(--text3);font-style:italic;margin-bottom:8px;">
          "${esc(w.sourceExcerpt.slice(0, 100))}…"
        </div>` : ''}
      <div style="display:flex;gap:7px;">
        <button onclick="resolveWarning('${w.id}')"
          style="background:var(--green);border:none;color:#fff;padding:3px 9px;
                 border-radius:4px;cursor:pointer;font-size:11px;
                 font-family:'JetBrains Mono',monospace;">
          Mark resolved
        </button>
        <button onclick="dismissWarning('${w.id}')"
          style="background:none;border:1px solid var(--border);color:var(--text4);
                 padding:3px 9px;border-radius:4px;cursor:pointer;font-size:11px;
                 font-family:'JetBrains Mono',monospace;">
          False positive
        </button>
      </div>
    </div>`;
}

// ════════════════════════════════════════════
// PATCHED sendMessage — v5 pipeline
// Adds: retrieval context, fact extraction,
//       chapter archiving, warning count in meta
// ════════════════════════════════════════════

async function sendMessage() {
  const input = document.getElementById('user-input');
  const text  = input?.value?.trim();
  if (!text || isLoading) return;

  const hasAnyKey = Object.values(S.keys).some(k => k && k.trim());
  if (!hasAnyKey) { showNoKeyPrompt(); return; }

  const chap = activeChap();
  const proj = activeProj();
  if (!chap || !proj) return;

  // Push user message
  chap.messages.push({ role: 'user', content: text });
  input.value = '';
  autoResize(input);
  renderMsgs(chap.messages);

  // Lock UI
  isLoading = true;
  document.getElementById('send-btn').disabled = true;

  // Typing indicator
  const msgEl  = document.getElementById('messages');
  const typEl  = document.createElement('div');
  const pv     = PROVIDERS[S.activeProvider] || PROVIDERS.anthropic;
  const mInfo  = getModelInfo(S.activeModel, S.activeProvider);
  typEl.className = 'typing';
  typEl.id        = 'typ-ind';
  typEl.innerHTML = `
    <div class="dot"></div><div class="dot"></div><div class="dot"></div>
    <span style="margin-left:6px;font-family:'JetBrains Mono',monospace;font-size:11px;">
      ${pv.logo} ${mInfo?.name || S.activeModel}…
    </span>`;
  msgEl.appendChild(typEl);
  msgEl.scrollTop = msgEl.scrollHeight;

  // Build messages array — skip first welcome message
  const apiMsgs = chap.messages
    .filter((m, i) => !(i === 0 && m.role === 'assistant'))
    .map(m => ({ role: m.role, content: m.content }));

  let reply = '';
  try {
    // buildSystem() now uses the retrieval-based context assembler
    reply = await callAI(apiMsgs, buildSystem());

    chap.messages.push({ role: 'assistant', content: reply });

    // Accumulate manuscript text
    chap.manuscript += (chap.manuscript ? '\n\n' : '') + reply;
    chap.wordCount   = chap.manuscript.split(/\s+/).filter(Boolean).length;
    chap.meta.model    = S.activeModel;
    chap.meta.provider = S.activeProvider;
    chap.meta.updatedAt = new Date().toISOString();

    // Background: extract facts (non-blocking, won't delay the user)
    extractFacts(reply, proj, chap).catch(e =>
      console.warn('[Lekhak] Extraction error:', e.message)
    );

    // Background: archive chapter every 10 AI responses
    const aiCount = chap.messages.filter(m => m.role === 'assistant').length;
    if (aiCount > 0 && aiCount % 10 === 0) {
      archiveChapter(proj, chap).catch(() => {});
    }

  } catch (e) {
    if (e.message === 'NO_KEYS') {
      reply = '⚠️ No API key found.\n\nGo to ⚙ Settings and add a key for Claude, ChatGPT, or Gemini.';
      chap.messages.push({ role: 'assistant', content: reply });
      showNoKeyPrompt();
    } else {
      reply = e.message;
      chap.messages.push({ role: 'assistant', content: reply });
      if (e.classified?.type === 'quota') {
        setTimeout(() => showBillingAction(e.classified), 100);
      }
    }
    toast(reply.slice(0, 60), 'error', 4000);
  }

  proj.meta.updatedAt = new Date().toISOString();
  save();

  // Unlock UI
  isLoading = false;
  document.getElementById('send-btn').disabled = false;
  document.getElementById('typ-ind')?.remove();
  renderMsgs(chap.messages);

  // Update chapter meta — show warning count if any
  const openWarnings = proj.continuity?.warnings?.filter(w => w.status === 'open').length || 0;
  const metaEl = document.getElementById('ch-meta');
  if (metaEl) {
    metaEl.textContent =
      chap.messages.filter(m => m.role === 'assistant').length +
      ' drafts · ' + (mInfo?.name || S.activeModel) +
      (openWarnings ? ` · ⚠ ${openWarnings}` : '');
  }
}

// ════════════════════════════════════════════
// DOM INJECTIONS
// ════════════════════════════════════════════

function injectContinuityStrip() {
  const chatHeader = document.getElementById('chat-header');
  if (!chatHeader || document.getElementById('continuity-strip')) return;

  const strip = document.createElement('div');
  strip.id = 'continuity-strip';
  strip.style.cssText = `
    display:none;padding:6px 16px;background:var(--bg3);
    border-bottom:1px solid var(--border);
    font-family:'JetBrains Mono',monospace;font-size:11px;
    color:var(--gold);cursor:pointer;align-items:center;gap:8px;`;
  strip.onclick = openContinuityWarnings;
  chatHeader.after(strip);
}

// ════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════

function initUI() {
  injectContinuityStrip();
  console.log('[Lekhak] UI module ready.');
}
