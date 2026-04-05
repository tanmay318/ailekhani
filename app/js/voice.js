// ─────────────────────────────────────────────────────
// lekhak/js/voice.js
// VoiceCapture class   — Web Speech API (free, no server)
// classifyVoiceIntent  — AI intent parsing of transcripts
// readAloud            — SpeechSynthesis proofreading
// ─────────────────────────────────────────────────────
'use strict';

// ── Voice modes ───────────────────────────────────────
const VOICE_MODES = [
  'instruction',     // "Chapter 8 — queen confronts the monk"
  'idea',            // Fleeting idea to store in reference memory
  'scene_dictation', // Direct prose dictation
  'dialogue',        // Character dialogue capture
  'revision',        // Edit instruction for existing text
  'brainstorm'       // Free-form thinking aloud
];

// ── VoiceCapture class ────────────────────────────────
class VoiceCapture {
  constructor() {
    this.recognition = null;
    this.synthesis   = window.speechSynthesis || null;
    this.isListening = false;
    this.available   = false;
    this._setup();
  }

  _setup() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return; // Firefox, older Safari — graceful degradation
    this.recognition = new SR();
    this.recognition.continuous     = false;
    this.recognition.interimResults = true;
    this.available = true;
  }

  // BCP-47 locale codes matched to Lekhak manuscript languages
  _langCode() {
    const proj = activeProj();
    const lang = getLang(proj);
    return { en: 'en-IN', hi: 'hi-IN', ta: 'ta-IN' }[lang] || 'en-IN';
  }

  // start(mode, onInterim, onFinal)
  // onInterim(partialTranscript)  — called while speaking
  // onFinal(fullTranscript, mode) — called when utterance ends
  start(mode, onInterim, onFinal) {
    if (!this.available || this.isListening) return;

    this.recognition.lang = this._langCode();
    this.isListening = true;

    this.recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map(r => r[0].transcript).join('');
      const isFinal = event.results[event.results.length - 1].isFinal;
      if (isFinal) {
        this.isListening = false;
        onFinal(transcript, mode);
      } else {
        onInterim(transcript);
      }
    };

    this.recognition.onerror = (e) => {
      this.isListening = false;
      console.warn('[Lekhak] Speech recognition error:', e.error);
    };

    this.recognition.onend = () => { this.isListening = false; };
    this.recognition.start();
  }

  stop() {
    if (this.recognition && this.isListening) {
      this.recognition.stop();
      this.isListening = false;
    }
  }

  // Read text aloud at 88% speed for proofreading
  readAloud(text, lang) {
    if (!this.synthesis) {
      toast('Text-to-speech not available in this browser.', 'error');
      return;
    }
    this.synthesis.cancel();
    const utterance  = new SpeechSynthesisUtterance(text);
    utterance.lang   = { en: 'en-IN', hi: 'hi-IN', ta: 'ta-IN' }[lang] || 'en-IN';
    utterance.rate   = 0.88;
    utterance.pitch  = 1.0;
    this.synthesis.speak(utterance);
  }

  stopReading() { this.synthesis?.cancel(); }
}

// ── Intent classifier ─────────────────────────────────
// Sends the transcript to the AI to extract structured
// writing intent. Returns a clean instruction.
async function classifyVoiceIntent(transcript, proj) {
  const chars = Object.values(proj.entities?.characters || {})
    .map(c => c.name).join(', ') || 'none defined yet';
  const locs = Object.values(proj.entities?.locations || {})
    .map(l => l.name).join(', ') || 'none defined yet';

  const prompt = `Classify this voice note from a novel author. Return JSON only — no other text.

Voice note: "${transcript}"

Known characters: ${chars}
Known locations:  ${locs}

Return this exact shape:
{
  "mode": "instruction|scene_dictation|dialogue|revision|brainstorm|idea",
  "chapterTarget": "chapter number/name or null",
  "characters": ["name1", "name2"],
  "location": "location name or null",
  "constraint": "any stated constraint or null",
  "tension": "high|medium|low|null",
  "deferredReveal": true,
  "instruction": "clean, direct instruction for the writing AI"
}`;

  try {
    const result = await callAI(
      [{ role: 'user', content: prompt }],
      'You are a story intent classifier. Return only valid JSON. No markdown, no explanation.'
    );
    const cleaned = result.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (e) {
    // Graceful fallback — treat raw transcript as instruction
    return { mode: 'instruction', instruction: transcript };
  }
}

// ── Module-level state ────────────────────────────────
let _voiceCapture   = null;
let _voiceMode      = 'instruction';
let _lastVoiceIntent = null;

// ── Drawer UI functions ───────────────────────────────
function openVoiceDrawer() {
  if(typeof canUse==='function'&&!canUse('voiceInput')){if(typeof showUpgradePrompt==='function')showUpgradePrompt('voiceInput');return;}
  if (!_voiceCapture) _voiceCapture = new VoiceCapture();

  if (!_voiceCapture.available) {
    toast('Voice input requires Chrome or Edge.', 'error', 4000);
    return;
  }

  document.getElementById('modal-content').innerHTML = `
    <h2>🎤 Voice Input</h2>
    <p style="font-size:13px;color:var(--text3);margin-bottom:14px;font-style:italic;">
      Speak your instruction, scene idea, or dialogue.
      Lekhak will transcribe and convert it to a writing prompt.
    </p>

    <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
      ${VOICE_MODES.map(mode => `
        <button onclick="selectVoiceMode('${mode}')" id="vmode-${mode}"
          style="background:${mode === 'instruction' ? 'var(--gold-dim)' : 'var(--bg3)'};
                 border:1px solid var(--border);
                 color:${mode === 'instruction' ? 'var(--gold3)' : 'var(--text3)'};
                 padding:4px 10px;border-radius:12px;cursor:pointer;
                 font-size:11px;font-family:'JetBrains Mono',monospace;transition:all 0.15s;">
          ${mode.replace(/_/g, ' ')}
        </button>`).join('')}
    </div>

    <div id="voice-transcript"
      style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius);
             padding:14px;min-height:80px;font-size:15px;color:var(--text2);
             font-style:italic;margin-bottom:14px;font-family:'Cormorant Garamond',serif;">
      Press Start and speak…
    </div>

    <div style="display:flex;gap:8px;margin-bottom:14px;">
      <button id="voice-start-btn" onclick="startVoiceCapture()"
        style="flex:1;background:var(--gold-dim);border:1px solid var(--gold-dim);
               color:var(--gold3);padding:11px;border-radius:var(--radius);
               cursor:pointer;font-family:'Cormorant Garamond',serif;
               font-size:16px;font-style:italic;transition:all 0.2s;">
        🎤 Start
      </button>
      <button onclick="stopVoiceCapture()"
        style="background:var(--bg3);border:1px solid var(--border);color:var(--text3);
               padding:11px 16px;border-radius:var(--radius);cursor:pointer;font-size:14px;">
        ■ Stop
      </button>
    </div>

    <div id="voice-intent-block" style="display:none;margin-bottom:14px;">
      <div style="font-size:10px;color:var(--text4);font-family:'JetBrains Mono',monospace;
                  margin-bottom:5px;text-transform:uppercase;letter-spacing:0.1em;">
        Interpreted as:
      </div>
      <div id="voice-intent-text"
        style="background:var(--bg3);border:1px solid var(--green);border-radius:var(--radius);
               padding:10px 13px;font-size:13px;color:var(--text1);">
      </div>
      <button onclick="useVoiceIntent()"
        style="width:100%;margin-top:8px;background:var(--green);border:none;color:#fff;
               padding:9px;border-radius:var(--radius);cursor:pointer;
               font-family:'Cormorant Garamond',serif;font-size:15px;font-style:italic;">
        Use this instruction →
      </button>
    </div>

    <div style="display:flex;gap:8px;">
      <button onclick="readAloudLastResponse()"
        style="flex:1;background:var(--bg3);border:1px solid var(--border);color:var(--text3);
               padding:8px;border-radius:var(--radius);cursor:pointer;font-size:13px;">
        🔊 Read last response aloud
      </button>
      <button class="modal-cancel" onclick="stopVoiceCapture();closeModal();">Close</button>
    </div>`;
  openModal();
}

function selectVoiceMode(mode) {
  _voiceMode = mode;
  document.querySelectorAll('[id^="vmode-"]').forEach(btn => {
    btn.style.background = 'var(--bg3)';
    btn.style.color      = 'var(--text3)';
  });
  const el = document.getElementById('vmode-' + mode);
  if (el) { el.style.background = 'var(--gold-dim)'; el.style.color = 'var(--gold3)'; }
}

function startVoiceCapture() {
  if (!_voiceCapture) _voiceCapture = new VoiceCapture();
  const startBtn = document.getElementById('voice-start-btn');
  if (startBtn) {
    startBtn.textContent      = '🔴 Listening…';
    startBtn.style.background = 'var(--red)';
    startBtn.style.borderColor = 'var(--red)';
  }

  _voiceCapture.start(
    _voiceMode,
    // onInterim
    (interim) => {
      const el = document.getElementById('voice-transcript');
      if (el) el.textContent = interim + '…';
    },
    // onFinal
    async (final, mode) => {
      const el = document.getElementById('voice-transcript');
      if (el) el.textContent = final;
      if (startBtn) {
        startBtn.textContent      = '🎤 Start';
        startBtn.style.background = 'var(--gold-dim)';
        startBtn.style.borderColor = 'var(--gold-dim)';
      }

      const proj = activeProj();
      let intent;
      if (proj && mode === 'instruction') {
        intent = await classifyVoiceIntent(final, proj);
      } else {
        intent = { mode, instruction: final };
      }
      _lastVoiceIntent = intent;

      const intentBlock = document.getElementById('voice-intent-block');
      const intentText  = document.getElementById('voice-intent-text');
      if (intentBlock) intentBlock.style.display = 'block';
      if (intentText)  intentText.textContent = intent.instruction || final;
    }
  );
}

function stopVoiceCapture() {
  _voiceCapture?.stop();
  const startBtn = document.getElementById('voice-start-btn');
  if (startBtn) {
    startBtn.textContent      = '🎤 Start';
    startBtn.style.background = 'var(--gold-dim)';
    startBtn.style.borderColor = 'var(--gold-dim)';
  }
}

function useVoiceIntent() {
  if (!_lastVoiceIntent) return;
  const input = document.getElementById('user-input');
  if (input) {
    input.value = _lastVoiceIntent.instruction || '';
    autoResize(input);
  }
  closeModal();
}

function readAloudLastResponse() {
  if(typeof canUse==='function'&&!canUse('readAloud')){if(typeof showUpgradePrompt==='function')showUpgradePrompt('readAloud');return;}
  if (!_voiceCapture) _voiceCapture = new VoiceCapture();
  const chap = activeChap();
  if (!chap) { toast('No chapter selected'); return; }
  const lastAI = [...(chap.messages || [])].reverse().find(m => m.role === 'assistant');
  if (!lastAI) { toast('No AI response to read aloud'); return; }
  const lang = getLang(activeProj());
  _voiceCapture.readAloud(lastAI.content.slice(0, 2000), lang);
  toast('Reading aloud… open Voice drawer to stop.');
}

// ── DOM injections ────────────────────────────────────
function injectVoiceButton() {
  const inputRow = document.querySelector('.input-row');
  if (!inputRow || document.getElementById('voice-btn')) return;

  const btn = document.createElement('button');
  btn.id       = 'voice-btn';
  btn.title    = 'Voice input';
  btn.textContent = '🎤';
  btn.style.cssText = `
    background:var(--bg3);border:1px solid var(--border);
    border-radius:var(--radius);color:var(--text3);
    width:42px;height:42px;cursor:pointer;font-size:16px;
    flex-shrink:0;transition:all 0.15s;`;
  btn.onclick      = openVoiceDrawer;
  btn.onmouseenter = function() { this.style.borderColor = 'var(--gold-dim)'; this.style.color = 'var(--gold)'; };
  btn.onmouseleave = function() { this.style.borderColor = 'var(--border)';   this.style.color = 'var(--text3)'; };

  inputRow.appendChild(btn);
}

function patchRenderMsgsForReadAloud() {
  const orig = window.renderMsgs;
  if (!orig) return;
  window.renderMsgs = function(messages) {
    orig(messages);
    const lastAIActions = document.querySelector('.msg-wrap.assistant:last-child .msg-actions');
    if (lastAIActions && !lastAIActions.querySelector('.read-aloud-btn')) {
      const btn = document.createElement('button');
      btn.className   = 'msg-act read-aloud-btn';
      btn.textContent = '🔊';
      btn.title       = 'Read aloud';
      btn.onclick     = readAloudLastResponse;
      lastAIActions.appendChild(btn);
    }
  };
}

// ── Init ──────────────────────────────────────────────
function initVoice() {
  _voiceCapture = new VoiceCapture();
  injectVoiceButton();
  patchRenderMsgsForReadAloud();

  if (!_voiceCapture.available) {
    const btn = document.getElementById('voice-btn');
    if (btn) {
      btn.style.opacity = '0.3';
      btn.style.cursor  = 'not-allowed';
      btn.title = 'Voice requires Chrome or Edge';
    }
  }

  console.log('[Lekhak] Voice module ready. Available:', _voiceCapture.available);
}
