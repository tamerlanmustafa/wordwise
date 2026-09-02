/**
 * No emoji in the UI. Every one of them is a drawn icon now.
 *
 * An emoji is not an icon we own. It is a request that the operating system
 * draw something, in a font we do not ship, and the result differs between
 * iOS and Android, between OS versions, and between the same glyph rendered
 * at two sizes. Concretely, in this app:
 *
 *   • It ignores the palette. The leaderboard's 🥇🥈🥉 had metal colours from
 *     Apple's font that did not match `MEDAL`, the palette the same row's text
 *     was already using.
 *   • It sits on the text baseline, not in the layout box. Every one of these
 *     lived in a `<Text>` sized in points, so it scaled with the font and
 *     aligned by luck — which is why the filter sheet's icon column was 10pt
 *     wide with a 14pt glyph in it.
 *   • It has no states. `StreakFlame` can be lit or cold; 🔥 is always 🔥.
 *   • Some need a variation selector to render in colour at all, which is why
 *     `ChestReveal` carried '🛡️' rather than '🛡'. Miss it and the reward
 *     overlay shows a monochrome outline.
 *
 * This guard is source-level because none of that fails at runtime. An emoji
 * renders, looks intentional, and is only wrong if you know what it was
 * supposed to look like.
 *
 * Scope: characters with *emoji presentation*. Typographic marks that the
 * system font draws as monochrome text on every platform — ✓ ✕ × → ← ▼ ⋯ ↻ —
 * are not emoji and are deliberately left alone; they sit inside text runs
 * where an SVG would be the wrong tool.
 */

import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..', '..');

/**
 * Emoji-presentation ranges. Kept explicit rather than clever: the first pass
 * of this audit used a narrower set and silently missed 🟢🟡🟠🔴 in the Home
 * filter options, which live in U+1F7E0–U+1F7EB.
 */
const EMOJI = new RegExp(
  '[' +
    '\\u{1F000}-\\u{1FAFF}' + // pictographs, symbols, transport, supplemental
    '\\u{2300}-\\u{23FF}' + // ⌚ ⏰ and friends
    '\\u{2B00}-\\u{2BFF}' + // ⭐ ⬛
    '\\u{2600}-\\u{27BF}' + // misc symbols + dingbats (☆ ★ ♥ ⚐ ✦ ✨ ⚡)
    '\\u{FE0F}' + // variation selector-16 — forces the colour form
    '\\u{1F1E6}-\\u{1F1FF}' + // flags
    ']',
  'u',
);

/** Monochrome typographic marks. Not emoji; used inside text runs. */
const TEXT_MARKS = new Set([
  '✓', '✔', '✕', '✖', '×', '→', '←', '↑', '↓', '⇅', '↻',
  '▼', '▲', '◀', '▶', '·', '•', '—', '–', '…', '⋯', '≥', '≤',
]);

/**
 * Files allowed to contain emoji, because containing them is the job.
 * This test needs real ones as fixtures to prove the detector works — without
 * the exemption the guard fails on itself, which looks exactly like a real
 * violation and teaches the next person to weaken the detector.
 */
const EXEMPT = [path.join('components', '__tests__', 'noEmoji.test.ts')];

function isExempt(file: string): boolean {
  const rel = path.relative(SRC, file);
  return EXEMPT.some((e) => rel === e);
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Strip comments and JSX comment blocks — this guard is about what renders. */
function codeOnly(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function emojiIn(text: string): string[] {
  const found: string[] = [];
  for (const ch of text) {
    if (EMOJI.test(ch) && !TEXT_MARKS.has(ch)) found.push(ch);
  }
  return [...new Set(found)];
}

describe('no emoji renders anywhere in the app', () => {
  const files = sourceFiles(SRC);

  it('finds source to scan (guards the guard)', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('has no emoji in any component source', () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (isExempt(file)) continue;
      const found = emojiIn(codeOnly(fs.readFileSync(file, 'utf8')));
      if (found.length) {
        offenders.push(`${path.relative(SRC, file)} → ${found.join(' ')}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('has no emoji in any locale string', () => {
    // Translators copy the source string's shape; an emoji in `en` becomes an
    // emoji in six languages.
    const locales = path.join(SRC, 'i18n', 'locales');
    const offenders: string[] = [];
    for (const lang of fs.readdirSync(locales)) {
      const dir = path.join(locales, lang);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const f of fs.readdirSync(dir)) {
        const found = emojiIn(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (found.length) offenders.push(`${lang}/${f} → ${found.join(' ')}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('still allows the typographic marks', () => {
    // The line this guard draws, stated so nobody "fixes" a checkmark into an
    // SVG. These are monochrome text on every platform.
    expect(emojiIn('✓ ✕ × → ← ▼ ⋯ ↻')).toEqual([]);
  });

  it('catches the ranges the first audit missed', () => {
    // 🟢🟡🟠🔴 sat in `filterOptions` and the first scan's range did not cover
    // U+1F7E0–U+1F7EB, so they survived a pass that reported itself complete.
    expect(emojiIn('🟢🟡🟠🔴')).toHaveLength(4);
    expect(emojiIn('🥇 🛡️ ⭐ ♥ ⚐ ✦ ⚡ 🎬').length).toBeGreaterThan(6);
  });
});
