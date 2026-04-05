// ─────────────────────────────────────────────────────
// lekhak/js/schema.js
// State management, data constructors, v4→v5 migration
// ─────────────────────────────────────────────────────
'use strict';

const SK = 'ailekhani_v1';

// ── Global state ──────────────────────────────────────
let S = {
  onboarded: false,
  writingLang: 'en',
  inputLang: 'auto',
  activeProvider: 'anthropic',
  activeModel: '',
  keys: { anthropic: '', openai: '', gemini: '' },
  deviceId: null,
  devices: [],
  licenceKey: null,
  plan: 'free',
  activeProjectId: null,
  activeChapterId: null,
  projects: {}
};

// ── Persistence ───────────────────────────────────────
function save() {
  try { localStorage.setItem(SK, JSON.stringify(S)); } catch(e) {
    console.warn('Save failed — localStorage full?', e);
  }
}

function load() {
  try {
    let raw = localStorage.getItem(SK);
    if (!raw) {
      // Try migrating from v4
      raw = localStorage.getItem('ailekhani_v0');
      if (raw) {
        const old = JSON.parse(raw);
        if (old) {
          Object.assign(S, old);
          migrateProjectsToV2();
          save();
          console.log('[Lekhak] Migrated from v4 → v5');
        }
      }
    } else {
      const d = JSON.parse(raw);
      if (d) Object.assign(S, d);
    }
  } catch(e) {
    console.warn('[Lekhak] Load failed:', e);
  }
}

// ── Helpers ───────────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function activeProj() {
  return S.activeProjectId ? S.projects[S.activeProjectId] : null;
}

function activeChap() {
  const p = activeProj();
  if (!p || !S.activeChapterId) return null;
  return (p.chapters || []).find(c => c.id === S.activeChapterId) || null;
}

// ── Constructors ──────────────────────────────────────
function newProject(id, title, genre, premise, lang) {
  const firstChap = newChapter('ch_' + uid(), 'Chapter 1', 1);
  firstChap.messages = [{
    role: 'assistant',
    content: lang === 'hi'
      ? `"${title}" में आपका स्वागत है। अपना स्टोरी कोडेक्स भरें, फिर बताएं पहला अध्याय कैसे शुरू होता है।`
      : lang === 'ta'
      ? `"${title}"-க்கு வரவேற்கிறோம். உங்கள் கோடெக்ஸை நிரப்பி, முதல் அத்தியாயம் எவ்வாறு தொடங்குகிறது என்று சொல்லுங்கள்.`
      : `Welcome to "${title}". Fill your Story Codex, then tell me how Chapter 1 begins — or say "draft it" and I'll start from your premise.`
  }];

  return {
    id,
    title,
    genre: genre || '',
    premise: premise || '',
    lang: { manuscript: lang || 'en', ui: 'en', input: 'auto', style: 'literary' },
    arc: {
      current: 'arc_001',
      arcs: [{
        id: 'arc_001', title: 'Act I', summary: '',
        chapterRange: [1, null], centralConflict: '',
        openThreads: [], keyCharacters: [], keyLocations: [], status: 'active'
      }]
    },
    chapters: [firstChap],
    memory: { canon: [], arc: [], working: [], reference: [] },
    entities: { characters: {}, locations: {}, objects: {}, factions: {} },
    timeline: [],
    continuity: { warnings: [], openThreads: [], resolvedThreads: [] },
    chapterArchive: {},
    meta: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      wordCount: 0,
      chapterCount: 1
    }
  };
}

function newChapter(id, title, order) {
  return {
    id, title,
    arcId: 'arc_001',
    order,
    status: 'draft',
    manuscript: '',
    messages: [],
    extractedFacts: [],
    continuityWarnings: [],
    wordCount: 0,
    voiceNotes: [],
    meta: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      model: '', provider: ''
    }
  };
}

function newMemoryObject(type, title, content, opts = {}) {
  return {
    id: 'mem_' + uid(),
    type,
    title,
    content,
    sourceChapterId: opts.sourceChapterId || null,
    sourceExcerpt: opts.sourceExcerpt || null,
    status: opts.status || 'proposed',
    confidence: opts.confidence || 0.8,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tags: opts.tags || [],
    lang: opts.lang || 'en',
    relevanceHooks: opts.relevanceHooks || [],
    layer: opts.layer || 'working'
  };
}

function newWarning(type, proposedFact, canonFact, message) {
  return {
    id: 'warn_' + uid(),
    type,
    severity: type === 'dead_character' ? 'error' : 'warning',
    message,
    sourceChapterId: proposedFact?.sourceChapterId,
    sourceExcerpt: proposedFact?.sourceExcerpt || '',
    conflictingMemoryId: canonFact?.id,
    proposedMemoryId: proposedFact?.id,
    status: 'open',
    createdAt: new Date().toISOString()
  };
}

// ── Migration: v4 flat codex → v5 memory graph ───────
function migrateProjectsToV2() {
  Object.values(S.projects).forEach(proj => {
    if (proj.memory) return; // already v5

    const oldCodex = proj.codex || {};
    const memory = { canon: [], arc: [], working: [], reference: [] };

    const blobMap = [
      ['characters', 'Characters (imported)', ['characters','imported']],
      ['plot',       'Plot outline (imported)', ['plot','imported']],
      ['timeline',   'Timeline (imported)',     ['timeline','imported']],
      ['world',      'World & setting (imported)', ['world','imported']]
    ];

    blobMap.forEach(([key, title, tags]) => {
      if (oldCodex[key]?.trim()) {
        memory.reference.push(newMemoryObject(
          'reference_note', title, oldCodex[key],
          { status: 'proposed', layer: 'reference', tags }
        ));
      }
    });

    const langStr = typeof proj.lang === 'string' ? proj.lang : 'en';
    proj.lang = { manuscript: langStr, ui: 'en', input: 'auto', style: 'literary' };
    proj.memory = memory;
    proj.entities = { characters: {}, locations: {}, objects: {}, factions: {} };
    proj.timeline = [];
    proj.continuity = { warnings: [], openThreads: [], resolvedThreads: [] };
    proj.arc = {
      current: 'arc_001',
      arcs: [{
        id: 'arc_001', title: 'Act I', summary: '',
        chapterRange: [1, null], centralConflict: '',
        openThreads: [], keyCharacters: [], keyLocations: [], status: 'active'
      }]
    };
    proj.meta = {
      createdAt: proj.createdAt || '',
      updatedAt: proj.updatedAt || '',
      wordCount: 0,
      chapterCount: proj.chapters?.length || 0
    };

    (proj.chapters || []).forEach((ch, i) => {
      if (!ch.meta) ch.meta = { createdAt: '', updatedAt: '', model: '', provider: '' };
      if (!ch.extractedFacts) ch.extractedFacts = [];
      if (!ch.continuityWarnings) ch.continuityWarnings = [];
      if (!ch.voiceNotes) ch.voiceNotes = [];
      if (!ch.manuscript) ch.manuscript = '';
      if (!ch.order) ch.order = i + 1;
      if (!ch.status) ch.status = 'draft';
    });

    console.log(`[Lekhak] Migrated project: "${proj.title}"`);
  });
}
