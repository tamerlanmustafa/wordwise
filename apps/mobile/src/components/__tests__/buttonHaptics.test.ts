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
  // The settings list primitive wraps what it is handed. It did not until the
  // Profile audit — every navigation row in the account area was silent while
  // the theme control two rows below buzzed — and these three call sites were
  // the only ones compensating by wrapping themselves. Now that Row wraps,
  // they must not, or one press is two buzzes.
  {
    file: 'components/screens/SettingsScreen.tsx',
    match: 'setShowNativeLangPicker(true)',
    why: 'SettingsUI Row wraps the callback SelectRow hands it',
  },
  {
    file: 'components/screens/SettingsScreen.tsx',
    match: 'setShowProficiencyPicker(true)',
    why: 'SettingsUI Row wraps the callback SelectRow hands it',
  },
  {
    file: 'components/screens/NotificationSettingsScreen.tsx',
    match: 'setShowHourPicker(true)',
    why: 'SettingsUI Row wraps the callback SelectRow hands it',
  },
  // PlanCard is a local wrapper that forwards `onPress` straight to a
  // PressableScale, so the guard cannot see the self-tapping owner through it.
  {
    file: 'components/PaywallScreen.tsx',
    match: "setPlan('annual')",
    why: 'PlanCard renders a PressableScale, which fires its own haptic on press-in',
  },
  {
    file: 'components/PaywallScreen.tsx',
    match: "setPlan('monthly')",
    why: 'PlanCard renders a PressableScale, which fires its own haptic on press-in',
  },
];

/**
 * Press primitives that fire their own haptic.
 *
 * A handler on one of these must stay BARE: `PressableScale` calls
 * `feedback.tap()` on press-in, so `withTap` around its handler is two buzzes
 * for one press. The paywall's plan cards and lifetime row did exactly that —
 * on the panel people touch most before paying — and the guard could not see
 * it, because it read each line without knowing which element owned it.
 *
 * `PressablePill` is deliberately NOT here: its own docblock says it fires no
 * haptic and expects the caller to wrap. That split is why they are separate
 * components, and it is the one fact this list has to get right.
 */
const SELF_TAPPING = ['PressableScale'];

/**
 * The JSX element a press handler belongs to: the nearest opening tag above it.
 *
 * Props run across lines, so the tag is often several lines up. Bounded, so a
 * handler far from any tag cannot be attributed to something unrelated.
 */
function ownerTag(lines: string[], index: number): string | null {
  for (let i = index; i >= Math.max(0, index - 14); i -= 1) {
    const upTo = i === index ? lines[i].slice(0, lines[i].search(/on(?:Press|LongPress)=/)) : lines[i];
    const tags = [...upTo.matchAll(/<([A-Z][\w.]*)/g)];
    if (tags.length) return tags[tags.length - 1][1];
  }
  return null;
}

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
      // Owned by a primitive that taps on its own — bare is correct here.
      const owner = ownerTag(lines, i);
      if (owner && SELF_TAPPING.includes(owner)) return;
      found.push({ file: rel(file), line: i + 1, text: line.trim() });
    });
  }
  return found;
}

/** `withTap` handed to a primitive that already fires its own haptic. */
function doubleWrapped(): Site[] {
  const found: Site[] = [];
  for (const file of FILES) {
    const lines = code(fs.readFileSync(file, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      if (!/on(?:Press|LongPress)=\{\s*withTap\(/.test(line)) return;
      const owner = ownerTag(lines, i);
      if (owner && SELF_TAPPING.includes(owner)) {
        found.push({ file: rel(file), line: i + 1, text: `<${owner}> ${line.trim()}` });
      }
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

  it('never wraps a handler on a primitive that already taps back', () => {
    // The other half of the rule, and the half nothing checked. One press, two
    // buzzes: indistinguishable from a bug to the person holding the phone.
    const report = doubleWrapped().map((s) => `  ${s.file}:${s.line}  ${s.text.slice(0, 90)}`);
    expect(report).toEqual([]);
  });

  it('attributes a handler to the element that owns it', () => {
    // Pins the owner lookup itself — including props that span lines, which is
    // most of them. Without this a regex that always returned null would let
    // every double-wrap through while the test above stayed green.
    const multi = ['<View>', '  <PressableScale', '    style={s.x}', '    onPress={withTap(go)}'];
    expect(ownerTag(multi, 3)).toBe('PressableScale');
    const inline = ['<PressablePill edge={a} onPress={withTap(go)}>'];
    expect(ownerTag(inline, 0)).toBe('PressablePill');
    // The owner is the NEAREST tag, not the outermost one on the line.
    const nested = ['<View><PressableScale onPress={() => go()}>'];
    expect(ownerTag(nested, 0)).toBe('PressableScale');
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
