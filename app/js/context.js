// ─────────────────────────────────────────────────────
// lekhak/js/context.js
// Retrieval-based context assembler.
// Replaces the old "dump full codex" buildSystem().
// Produces ~1,400 tokens instead of ~8,000.
// ─────────────────────────────────────────────────────
'use strict';

// ── Main entry point ──────────────────────────────────
function assembleContext(proj, chap, userInstruction) {
  if (!proj) return '';

  const parts = [
    buildAbsoluteRules(proj),
    buildProjectHeader(proj, chap),
    buildArcSummary(proj),
    buildRecentRecap(proj, chap?.id),
    buildRelevantMemoryBlock(proj, userInstruction, chap),
    buildWorkingMemoryBlock(proj),
    buildOpenThreadsBlock(proj),
    buildLangStyleBlock(proj),
    WRITING_GUIDELINES
  ];

  return parts.filter(Boolean).join('\n\n');
}

// ── Sections ──────────────────────────────────────────

function buildAbsoluteRules(proj) {
  const lc    = getLangConfig(proj);
  const rules = [
    '## ABSOLUTE RULES — NEVER VIOLATE:',
    `- Write ALL prose in ${lc.name}. Never switch language mid-chapter.`
  ];

  // Pin age facts from canon
  const ageFacts = (proj.memory?.canon || []).filter(m =>
    m.type === 'character_fact' &&
    m.content?.match(/\d+\s*(years?\s*old|वर्ष|साल)/i)
  );
  ageFacts.forEach(f => rules.push(`- ${f.title}: ${f.content} — do not contradict.`));

  // Pin dead characters
  (proj.memory?.canon || [])
    .filter(m => m.type === 'death')
    .forEach(d => rules.push(`- ${d.title} — this character is dead. Do not resurrect them.`));

  return rules.join('\n');
}

function buildProjectHeader(proj, chap) {
  return [
    `Novel: "${proj.title}"`,
    proj.genre   ? `Genre: ${proj.genre}` : '',
    proj.premise ? `Premise: ${proj.premise}` : '',
    chap         ? `Current chapter: ${chap.title} (Ch. ${chap.order || ''})` : ''
  ].filter(Boolean).join('\n');
}

function buildArcSummary(proj) {
  const arc = proj.arc?.arcs?.find(a => a.id === proj.arc?.current);
  if (!arc?.summary) return '';
  return `## CURRENT ARC — ${arc.title}:\n${arc.summary}`;
}

function buildRecentRecap(proj, currentChapterId) {
  const chapters = proj.chapters || [];
  const idx = chapters.findIndex(c => c.id === currentChapterId);
  const recent = chapters.slice(Math.max(0, idx - 2), idx);
  const lines = recent
    .map(ch => proj.chapterArchive?.[ch.title]
      ? `${ch.title}: ${proj.chapterArchive[ch.title]}`
      : null)
    .filter(Boolean);
  return lines.length ? `## STORY SO FAR:\n${lines.join('\n')}` : '';
}

function buildRelevantMemoryBlock(proj, instruction, chapter) {
  const pool = [
    ...(proj.memory?.canon   || []),
    ...(proj.memory?.arc     || [])
  ];
  const relevant = retrieveRelevantMemory(pool, instruction, chapter);
  if (!relevant.length) return '';
  return '## KEY FACTS (canon):\n' +
    relevant.map(m => `- [${m.type.toUpperCase().replace(/_/g,' ')}] ${m.title}: ${m.content}`)
            .join('\n');
}

function buildWorkingMemoryBlock(proj) {
  const working = (proj.memory?.working || []).slice(-6);
  if (!working.length) return '';
  return '## RECENT CONTEXT:\n' +
    working.map(m => `- ${m.title}: ${m.content}`).join('\n');
}

function buildOpenThreadsBlock(proj) {
  const threads = (proj.continuity?.openThreads || []).slice(0, 5);
  if (!threads.length) return '';
  return '## OPEN THREADS (keep these in mind):\n' +
    threads.map(t => `- ${t.title || t.content}`).join('\n');
}

const WRITING_GUIDELINES = `## GUIDELINES:
- Stay strictly consistent with all canon facts above.
- When canon conflicts with recent text, canon wins.
- Write the full scene when drafting.
- Never invent facts that contradict the above.`;

// ── Memory retrieval ──────────────────────────────────
function retrieveRelevantMemory(allMemory, instruction, chapter) {
  if (!allMemory?.length) return [];

  const instructionLower = (instruction || '').toLowerCase();
  const keywords = instructionLower
    .split(/\s+/)
    .filter(w => w.length > 3);

  const scored = allMemory.map(mem => {
    let score = 0;

    // Always surface critical types
    if (['injury', 'death', 'open_thread', 'promise'].includes(mem.type)) score += 5;

    // Keyword overlap
    keywords.forEach(kw => {
      if (mem.relevanceHooks?.some(h => h.toLowerCase().includes(kw))) score += 2;
      if (mem.tags?.some(t => t.toLowerCase().includes(kw))) score += 1;
      if (mem.content?.toLowerCase().includes(kw)) score += 1;
    });

    // Chapter proximity
    if (mem.sourceChapterId === chapter?.id) score += 3;

    return { ...mem, _score: score };
  });

  return scored
    .filter(m => m._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, 10);
}

// ── Public buildSystem override ───────────────────────
// Called by sendMessage — uses the last user message as
// the instruction signal for relevance scoring.
function buildSystem() {
  const proj = activeProj();
  const chap = activeChap();
  const lastUserMsg = chap?.messages
    ?.filter(m => m.role === 'user')
    ?.slice(-1)?.[0]?.content || '';
  return assembleContext(proj, chap, lastUserMsg);
}
