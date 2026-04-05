// ─────────────────────────────────────────────────────
// lekhak/js/extractor.js
// Post-generation fact extraction.
// Runs as a background call after every AI response.
// Produces structured memory objects staged as "proposed".
// ─────────────────────────────────────────────────────
'use strict';

const EXTRACTION_SYSTEM = `You are a story continuity extractor for a novel.
Extract only facts that matter for future continuity.
Return a JSON array. Each item must follow this shape exactly:
{
  "type": "character_fact|event|injury|death|promise|reveal|world_rule|location|relationship|timeline_marker|object_state|open_thread",
  "title": "short title, max 8 words",
  "content": "one precise sentence",
  "characters": ["name1"],
  "location": "location name or null",
  "confidence": 0.0-1.0,
  "tags": ["tag1","tag2"]
}
Rules:
- Do NOT extract stylistic observations or prose quality notes.
- Only extract facts another writer needs to stay consistent.
- Return only a valid JSON array. No markdown, no explanation.`;

// ── Main entry ────────────────────────────────────────
async function extractFacts(generatedText, proj, chap) {
  if(typeof canUse==='function'&&!canUse('factExtraction'))return;
  if (!generatedText || !proj) return;
  if (!Object.values(S.keys).some(k => k && k.trim())) return;

  const lang = getLang(proj);

  try {
    const result = await callAI(
      [{
        role: 'user',
        content: `Extract continuity facts from this passage:\n\n${generatedText.slice(0, 2000)}`
      }],
      EXTRACTION_SYSTEM
    );

    const facts = parseExtractionResult(result);
    if (!facts.length) return;

    const memObjects = facts.map(f => newMemoryObject(
      f.type || 'event',
      f.title || 'Untitled fact',
      f.content || '',
      {
        sourceChapterId: chap.id,
        sourceExcerpt: generatedText.slice(0, 200),
        status: 'proposed',
        confidence: f.confidence ?? 0.8,
        tags: f.tags || [],
        relevanceHooks: [
          ...(f.characters || []).map(c => c.toLowerCase()),
          ...(f.tags || [])
        ],
        layer: 'working',
        lang
      }
    ));

    // Stage in working memory
    proj.memory.working.push(...memObjects);

    // Check against canon for contradictions
    const warnings = checkContradictions(memObjects, proj.memory.canon);
    if (warnings.length) {
      proj.continuity.warnings.push(...warnings);
      chap.continuityWarnings.push(...warnings.map(w => w.id));
      showContinuityWarningBadge(warnings.length);
    }

    save();
    showFactReviewBadge(memObjects.length, memObjects);

  } catch (e) {
    console.warn('[Lekhak] Fact extraction failed:', e.message);
  }
}

// ── Auto-archive a chapter into chapterArchive ────────
// Called every 10 AI responses to build the recap store.
async function archiveChapter(proj, chap) {
  if (!proj || !chap) return;
  const assistantMsgs = (chap.messages || []).filter(m => m.role === 'assistant');
  if (assistantMsgs.length < 3) return;

  const fullText = assistantMsgs.map(m => m.content).join('\n\n');
  const prompt = `Summarise the key story facts from this chapter in 3-4 sentences.
Include: who appeared, what happened, what was established, where things ended.
Be specific with names and events.

Chapter: ${chap.title}

${fullText.slice(0, 3000)}`;

  try {
    const summary = await callAI(
      [{ role: 'user', content: prompt }],
      'You are a story fact extractor. Be specific, factual, and concise. Max 4 sentences.'
    );
    if (!proj.chapterArchive) proj.chapterArchive = {};
    proj.chapterArchive[chap.title] = summary;
    save();
    toast(`Chapter archived to memory ✓`);
  } catch (e) {
    console.warn('[Lekhak] Archive failed:', e.message);
  }
}

// ── Parse extraction result safely ───────────────────
function parseExtractionResult(raw) {
  try {
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn('[Lekhak] Could not parse extraction result:', e.message);
    return [];
  }
}
