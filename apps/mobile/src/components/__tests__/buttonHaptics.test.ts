/**
 * Every button taps back.
 *
 * The rule is in CLAUDE.md and it had drifted badly: an audit found 86 press
 * handlers written inline with no haptic at all, including every tab in the
 * bottom bar — the app's single most-tapped control. Nothing caught it because
 * nothing was looking, and a convention nobody enforces is a convention that
 * decays at exactly the rate people join the codebase.
 *
 * ## What this checks, and what it deliberately cannot
 *
 * An inline handler — `onPress={() => …}` — is unambiguous: it is declared at
 * the press site, so nobody upstream can have wrapped it, so it must wrap
 * itself. Those are checked exhaustively.
 *
 * `onPress={someIdentifier}` is NOT checked, and cannot be without following
 * the value across files. It may be a local handler that needs a wrap, or a
 * prop whose parent already wrapped it — and wrapping both is two buzzes for
 * one press, which is the failure this rule's second half exists to prevent.
 * A guard that guessed would either miss real gaps or manufacture double
 * buzzes, so it stays quiet and says so here instead.
 *
 * ## Exemptions are named, with reasons
 *
 * A list rather than a count. A count is a number somebody bumps; a named
 * entry is a claim a reviewer can disagree with.
 */

import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..', '..');

/**
 * Press sites that must stay bare, and why. Every entry is a case where a
 * haptic already fires for the same press somewhere else — the double-buzz
 * half of the rule.
 */
const EXEMPT: { file: string; match: string; why: string }[] = [
  {
    file: 'components/quiz/MCQCard.tsx',
    match: 'handleChoicePress',
    why: 'answering fires feedback.correct()/wrong(), which IS the response to this press',
  },
  {
    file: 'components/screens/ListsIndexScreen.tsx',
    match: 'openList(item)',
    why: 'ListRow wraps the callback it is handed (see listRowPill.test.ts)',
  },
  {
    file: 'components/filmFeed/SheetOptionRow.tsx',
    match: 'onPress',
    why: 'FeedFilterSheet wraps before handing the callback down (CLAUDE.md)',
  },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') walk(full, out);
    } else if (entry.name.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

const FILES = walk(SRC).sort();
const rel = (f: string) => path.relative(SRC, f);

/** Strip comments — a comment explaining why a site is bare names `withTap`. */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

interface Site {
  file: string;
  line: number;
  text: string;
}

/** Inline arrow press handlers that are not wrapped. */
function bareInlineHandlers(): Site[] {
  const found: Site[] = [];
  for (const file of FILES) {
    const lines = code(fs.readFileSync(file, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      // `onPress={(` or `onPress={async` — an arrow declared right here.
      if (!/on(?:Press|LongPress)=\{\s*(?:\(|async\b)/.test(line)) return;
      if (/on(?:Press|LongPress)=\{\s*withTap\(/.test(line)) return;
      found.push({ file: rel(file), line: i + 1, text: line.trim() });
    });
  }
  return found;
}

const isExempt = (site: Site) =>
  EXEMPT.some((e) => site.file === e.file && site.text.includes(e.match));

describe('every inline press handler taps back', () => {
  it('leaves no unwrapped inline handler outside the named exemptions', () => {
    const offenders = bareInlineHandlers().filter((s) => !isExempt(s));
    const report = offenders.map((s) => `  ${s.file}:${s.line}  ${s.text.slice(0, 90)}`);
    expect(report).toEqual([]);
  });

  it('keeps every exemption pointing at something that still exists', () => {
    // An exemption for a site that has moved is a hole nobody knows is open.
    for (const e of EXEMPT) {
      const full = path.join(SRC, e.file);
      expect(fs.existsSync(full)).toBe(true);
      expect(fs.readFileSync(full, 'utf8')).toContain(e.match);
      expect(e.why.length).toBeGreaterThan(20);
    }
  });

  it('finds the handlers at all, so a broken matcher cannot pass silently', () => {
    // The failure mode of a source guard: a regex that stops matching anything
    // reports zero offenders and looks like success for ever.
    const wrapped = FILES.filter((f) =>
      /on(?:Press|LongPress)=\{\s*withTap\(/.test(fs.readFileSync(f, 'utf8')),
    );
    expect(wrapped.length).toBeGreaterThan(40);
  });
});

describe('haptics mark a decision, never a movement', () => {
  it('never fires on press-in or press-out', () => {
    // Those fire while a finger is still moving and can fire twice per press.
    // A buzz belongs on the commit, which is `onPress`.
    const offenders: string[] = [];
    for (const file of FILES) {
      const src = code(fs.readFileSync(file, 'utf8'));
      if (/on(?:PressIn|PressOut)=\{\s*withTap\(/.test(src)) offenders.push(rel(file));
    }
    expect(offenders).toEqual([]);
  });

  it('never fires on scroll or on a drag in progress', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const src = code(fs.readFileSync(file, 'utf8'));
      if (/on(?:Scroll|PanResponderMove|ValueChange)=\{\s*withTap\(/.test(src)) {
        offenders.push(rel(file));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('one owner for haptics', () => {
  it('routes every buzz through utils/feedback', () => {
    // A source guard already fails the build on a direct native-module import;
    // this is the component-side half of the same rule, and it also catches a
    // second copy of `withTap` being defined somewhere convenient.
    const offenders: string[] = [];
    for (const file of FILES) {
      const src = code(fs.readFileSync(file, 'utf8'));
      if (/export\s+(?:const|function)\s+withTap\b/.test(src)) offenders.push(rel(file));
    }
    expect(offenders).toEqual([]);
  });

  it('imports withTap from the one module, wherever it is used', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const src = fs.readFileSync(file, 'utf8');
      if (!/\bwithTap\(/.test(code(src))) continue;
      if (!/import \{[^}]*\bwithTap\b[^}]*\} from '[^']*utils\/feedback'/.test(src)) {
        offenders.push(rel(file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
