// ─────────────────────────────────────────────────────
// lekhak/js/continuity.js
// Contradiction detection engine.
// Compares proposed facts against canon and produces
// typed, severity-graded warnings for the user.
// ─────────────────────────────────────────────────────
'use strict';

// ── Main contradiction checker ────────────────────────
function checkContradictions(proposedFacts, canonFacts) {
  const warnings = [];
  if (!proposedFacts?.length || !canonFacts?.length) return warnings;

  proposedFacts.forEach(proposed => {
    const proposedHooks = buildHookSet(proposed);

    canonFacts.forEach(canon => {
      const canonHooks = buildHookSet(canon);

      // Only compare facts that share an entity
      const sharedEntity = [...proposedHooks].some(h => canonHooks.has(h));
      if (!sharedEntity) return;

      // Age conflict
      checkAgeConflict(proposed, canon, warnings);

      // Dead character reappears
      checkDeadCharacter(proposed, canon, warnings);

      // Location impossibility (same character, same moment, two places)
      checkLocationJump(proposed, canon, warnings);
    });
  });

  return warnings;
}

// ── Individual checks ─────────────────────────────────

function checkAgeConflict(proposed, canon, warnings) {
  if (proposed.type !== 'character_fact' || canon.type !== 'character_fact') return;

  const proposedAge = extractAge(proposed.content);
  const canonAge    = extractAge(canon.content);

  // Numeric age conflict
  if (proposedAge && canonAge && Math.abs(proposedAge - canonAge) > 5) {
    warnings.push(buildWarning(
      'age_conflict', proposed, canon,
      `Age conflict: "${proposed.title}" implies age ${proposedAge} but canon says ${canonAge}`
    ));
    return;
  }

  // Young/old descriptor on a middle-aged character
  if (canonAge && canonAge >= 30) {
    const youngWords = ['young officer', 'young man', 'young woman',
                        'teenager', 'kid', 'boy', 'girl', 'youth'];
    if (youngWords.some(w => proposed.content.toLowerCase().includes(w))) {
      warnings.push(buildWarning(
        'age_conflict', proposed, canon,
        `Descriptor suggests youth but canon age is ${canonAge} for "${proposed.title}"`
      ));
    }
  }
}

function checkDeadCharacter(proposed, canon, warnings) {
  if (canon.type !== 'death') return;
  if (proposed.type === 'death') return; // another death fact is fine

  const deadName = extractCharacterName(canon);
  if (!deadName) return;

  if (proposed.content.toLowerCase().includes(deadName.toLowerCase())) {
    warnings.push(buildWarning(
      'dead_character', proposed, canon,
      `"${deadName}" appears alive in new text but was killed (${canon.sourceChapterId})`
    ));
  }
}

function checkLocationJump(proposed, canon, warnings) {
  // Both must be location-type facts about the same character at the same time
  if (proposed.type !== 'location' || canon.type !== 'location') return;
  if (!proposed.time || !canon.time) return;
  if (proposed.time !== canon.time) return;

  // Same time marker, different location — possible impossible jump
  if (proposed.content !== canon.content) {
    warnings.push(buildWarning(
      'location_jump', proposed, canon,
      `Character appears in two locations at the same time: "${proposed.content}" vs "${canon.content}"`
    ));
  }
}

// ── Warning builder ───────────────────────────────────
function buildWarning(type, proposedFact, canonFact, message) {
  const errorTypes = ['dead_character', 'location_jump'];
  return {
    id: 'warn_' + uid(),
    type,
    severity: errorTypes.includes(type) ? 'error' : 'warning',
    message,
    sourceChapterId:    proposedFact?.sourceChapterId || null,
    sourceExcerpt:      proposedFact?.sourceExcerpt   || '',
    conflictingMemoryId: canonFact?.id                || null,
    proposedMemoryId:   proposedFact?.id              || null,
    status: 'open',
    createdAt: new Date().toISOString()
  };
}

// ── Utility extractors ────────────────────────────────
function extractAge(text) {
  const m = text?.match(/(\d+)\s*(years?\s*old|वर्ष|साल|yrs?|year)/i);
  return m ? parseInt(m[1]) : null;
}

function extractCharacterName(memObj) {
  // First word of the title is typically the character name
  return memObj?.title?.split(/\s+/)?.[0] || null;
}

function buildHookSet(memObj) {
  return new Set([
    ...(memObj.relevanceHooks || []),
    ...(memObj.tags || [])
  ].map(h => h.toLowerCase()));
}

// ── Resolve / dismiss ─────────────────────────────────
function resolveWarning(id) {
  const proj = activeProj();
  const w = proj?.continuity?.warnings?.find(w => w.id === id);
  if (!w) return;
  w.status = 'resolved';
  save();
  toast('Warning resolved ✓');
  openContinuityWarnings(); // refresh panel
}

function dismissWarning(id) {
  const proj = activeProj();
  const w = proj?.continuity?.warnings?.find(w => w.id === id);
  if (!w) return;
  w.status = 'false_positive';
  save();
  openContinuityWarnings();
}
