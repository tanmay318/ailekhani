// ─────────────────────────────────────────────────────
// lekhak/js/multilingual.js
// Language config v2, style modes, guardrails,
// Hinglish/Tanglish input handling
// ─────────────────────────────────────────────────────
'use strict';

const LANG_CONFIG_V2 = {
  en: {
    name: 'English', flag: '🇬🇧', label: 'EN',
    script: 'latin', font: '', dir: 'ltr',
    styles: ['literary', 'conversational', 'mythic', 'dramatic', 'children'],
    honorifics: [],
    guardRails: ['no_translation_smell'],
    sys: 'Write all prose, dialogue, and narration in English.'
  },
  hi: {
    name: 'हिंदी', flag: '🇮🇳', label: 'HI',
    script: 'devanagari', font: 'Noto Sans Devanagari', dir: 'ltr',
    styles: ['literary', 'conversational', 'mythic', 'devotional', 'dramatic'],
    honorifics: ['जी', 'श्री', 'श्रीमती', 'दादा', 'दादी', 'चाचा', 'माँ', 'बाबा', 'गुरुजी'],
    guardRails: [
      'no_translation_smell',
      'preserve_honorifics',
      'no_mixed_script_mid_sentence',
      'no_english_sentence_structure'
    ],
    hinglishNormalize: true,
    sys: 'सभी गद्य, संवाद और वर्णन हिंदी में लिखें। वाक्य संरचना हिंदी की हो (SOV), अंग्रेज़ी की नहीं।'
  },
  ta: {
    name: 'தமிழ்', flag: '🌴', label: 'TA',
    script: 'tamil', font: 'Noto Sans Tamil', dir: 'ltr',
    styles: ['literary', 'conversational', 'mythic', 'devotional', 'dramatic'],
    honorifics: ['அய்யா', 'அம்மா', 'தம்பி', 'அக்கா', 'அண்ணா', 'ஐயர்', 'அண்ணாச்சி'],
    guardRails: [
      'no_translation_smell',
      'preserve_honorifics',
      'no_mixed_script_mid_sentence'
    ],
    hinglishNormalize: true,
    sys: 'அனைத்து உரைநடை மற்றும் உரையாடல்களை தமிழில் எழுதுங்கள்.'
  }
};

const STYLE_MODES = {
  literary: {
    en: 'Write in elevated literary prose. Prioritise interiority, precise imagery, and rhythm. Avoid cliché.',
    hi: 'साहित्यिक गद्य में लिखें। अंतर्मन, सटीक बिम्ब और लय को प्राथमिकता दें। क्लिशे से बचें।',
    ta: 'இலக்கியத்தர உரைநடையில் எழுதுங்கள். உள்ளுணர்வு, துல்லியமான உருவகம் மற்றும் தாளம் கொடுங்கள்.'
  },
  mythic: {
    en: 'Write in epic mythic register. Use oral storytelling cadence, epithets, cosmic scale, and invocation.',
    hi: 'महाकाव्यिक पुराण शैली में लिखें। मौखिक कथा की लय, विशेषण, विराट स्तर और आह्वान का प्रयोग करें।',
    ta: 'புராண இதிகாச நடையில் எழுதுங்கள். வாய்மொழிக் கதை ஓட்டம், அடைமொழிகள், பிரபஞ்ச அளவு பயன்படுத்துங்கள்.'
  },
  conversational: {
    en: 'Write in natural, contemporary prose. Prioritise authentic voice, rhythm, and dialogue.',
    hi: 'स्वाभाविक समकालीन भाषा में लिखें। प्रामाणिक आवाज़, लय और संवाद को प्राथमिकता दें।',
    ta: 'இயல்பான நவீன உரைநடையில் எழுதுங்கள். உண்மையான குரல் மற்றும் உரையாடலுக்கு முன்னுரிமை கொடுங்கள்.'
  },
  devotional: {
    en: 'Write with devotional gravity. Language should feel consecrated, not ornate.',
    hi: 'भक्ति-रस में लिखें। भाषा पवित्र हो, अलंकृत नहीं।',
    ta: 'பக்தி ரசத்தில் எழுதுங்கள். மொழி புனிதமாக இருக்கட்டும், அலங்காரமாக அல்ல.'
  },
  dramatic: {
    en: 'Write for dramatic performance. Short sentences, strong beats, stage-ready dialogue.',
    hi: 'नाटकीय प्रदर्शन के लिए लिखें। छोटे वाक्य, मज़बूत लय, मंच-तैयार संवाद।',
    ta: 'நாடக நடையில் எழுதுங்கள். குறுகிய வாக்கியங்கள், வலிமையான தாளம், மேடை-தயார் உரையாடல்.'
  },
  children: {
    en: 'Write for young readers. Simple language, vivid images, gentle pacing.',
    hi: 'बाल पाठकों के लिए लिखें। सरल भाषा, जीवंत चित्र, सौम्य गति।',
    ta: 'இளம் வாசகர்களுக்கு எழுதுங்கள். எளிய மொழி, தெளிவான படங்கள்.'
  }
};

const GUARDRAILS = {
  no_translation_smell:
    'Do not produce text that reads like a translation from English. Use native idiom and sentence rhythm.',
  preserve_honorifics:
    'Preserve all honorifics and kinship terms exactly as defined in character cards. Do not anglicise them.',
  no_mixed_script_mid_sentence:
    'Do not switch scripts mid-sentence. Foreign words must appear in the manuscript script.',
  no_english_sentence_structure:
    'Hindi is SOV (Subject-Object-Verb). Do not use English SVO sentence structure.'
};

// ── Build language+style instruction block ────────────
function buildLangStyleBlock(proj) {
  const lang  = getLang(proj);
  const style = getStyle(proj);
  const lc    = LANG_CONFIG_V2[lang] || LANG_CONFIG_V2.en;
  const styleInstr = STYLE_MODES[style]?.[lang] || STYLE_MODES.literary.en;
  const guardText  = (lc.guardRails || [])
    .map(r => GUARDRAILS[r]).filter(Boolean).join(' ');
  return `${lc.sys}\nStyle: ${styleInstr}\n${guardText}`.trim();
}

// ── Hinglish / Tanglish input annotation ─────────────
function annotateHinglishInput(text, targetLang) {
  const hasLatin = /[a-zA-Z]/.test(text);
  if (!hasLatin || targetLang === 'en') return null;
  const lc = LANG_CONFIG_V2[targetLang];
  if (!lc?.hinglishNormalize) return null;
  return `User instruction may contain Hinglish/Tanglish. Interpret their intent and respond in ${lc.name}.`;
}

// ── Quick-access helpers ──────────────────────────────
function getLang(proj) {
  return (typeof proj?.lang === 'object' ? proj.lang.manuscript : proj?.lang) || 'en';
}

function getStyle(proj) {
  return (typeof proj?.lang === 'object' ? proj.lang.style : 'literary') || 'literary';
}

function getLangConfig(proj) {
  return LANG_CONFIG_V2[getLang(proj)] || LANG_CONFIG_V2.en;
}

// ── Style mode selector UI helper ────────────────────
function buildStyleModeSelector(proj) {
  const lang    = getLang(proj);
  const current = getStyle(proj);
  const lc      = getLangConfig(proj);
  const available = lc.styles || Object.keys(STYLE_MODES);
  return available.map(s => `
    <button onclick="setStyleMode('${s}')" id="style-mode-${s}"
      style="background:${s===current?'var(--gold-dim)':'var(--bg3)'};
             border:1px solid ${s===current?'var(--gold-dim)':'var(--border)'};
             color:${s===current?'var(--gold3)':'var(--text3)'};
             padding:4px 11px;border-radius:12px;cursor:pointer;
             font-size:12px;font-family:'JetBrains Mono',monospace;
             transition:all 0.15s;">
      ${s}
    </button>`).join('');
}

function setStyleMode(style) {
  if(typeof canUseStyle==='function'&&!canUseStyle(style)){if(typeof showUpgradePrompt==='function')showUpgradePrompt(null,'The '+style+' writing style is a Pro feature.');return;}
  const proj = activeProj();
  if (!proj) return;
  if (typeof proj.lang === 'object') proj.lang.style = style;
  proj.meta.updatedAt = new Date().toISOString();
  save();
  toast(`Style → ${style} ✓`);
  document.querySelectorAll('[id^="style-mode-"]').forEach(btn => {
    const s = btn.id.replace('style-mode-', '');
    btn.style.background  = s === style ? 'var(--gold-dim)' : 'var(--bg3)';
    btn.style.color       = s === style ? 'var(--gold3)' : 'var(--text3)';
    btn.style.borderColor = s === style ? 'var(--gold-dim)' : 'var(--border)';
  });
}

// ── Quick prompts per language ────────────────────────
const QUICK_PROMPTS = {
  en: ['✍️ Draft chapter', '→ Continue', '🔥 Add tension', '▶ Next scene', '📋 Summarise'],
  hi: ['✍️ अध्याय लिखें', '→ जारी रखें', '🔥 तनाव बढ़ाएं', '▶ अगला दृश्य', '📋 सारांश'],
  ta: ['✍️ அத்தியாயம் எழுதவும்', '→ தொடரவும்', '🔥 பதற்றம் சேர்க்கவும்', '▶ அடுத்த காட்சி', '📋 சுருக்கம்']
};
