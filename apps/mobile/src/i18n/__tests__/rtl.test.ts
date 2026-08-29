/**
 * RTL layout tests.
 *
 * Two halves, for the two ways RTL breaks:
 *
 *  1. Runtime — the direction helpers must actually flip. Because `rtl.ts`
 *     reads `I18nManager.isRTL` once at module load (correct, since a direction
 *     change always reloads the bundle), every RTL case has to re-require the
 *     module under a mocked native flag rather than mutate one.
 *
 *  2. Source — the physical-edge scan. This is the half that matters over time:
 *     a `marginLeft` added next year would not fail any runtime test, it would
 *     just quietly refuse to mirror. Modelled on `sourceGuards.test.ts`.
 */

import fs from 'fs';
import path from 'path';

import { UI_LANGUAGES } from '../languages';
import { swipeDecision, shouldClaimHorizontalDrag } from '../../components/vocabulary/deckLogic';
import { shouldClaimHorizontal, swipeActionOnRelease } from '../../utils/swipeDecision';

type RtlModule = typeof import('../rtl');

/** Load `rtl.ts` fresh with the native direction flag pinned. */
function loadRtl(isRTL: boolean): { rtl: RtlModule; allowRTL: jest.Mock; forceRTL: jest.Mock } {
  const allowRTL = jest.fn();
  const forceRTL = jest.fn();
  let rtl!: RtlModule;

  jest.isolateModules(() => {
    // rtl.ts only ever touches I18nManager, so a minimal stub is both enough
    // and safer than spreading the real react-native module.
    jest.doMock('react-native', () => ({ I18nManager: { isRTL, allowRTL, forceRTL } }));
    jest.doMock('expo-updates', () => ({ reloadAsync: jest.fn(async () => {}) }), {
      virtual: true,
    });
    rtl = require('../rtl');
  });

  return { rtl, allowRTL, forceRTL };
}

describe('isRtlLanguage', () => {
  const { rtl } = loadRtl(false);

  it('reads the flag off UI_LANGUAGES rather than a second hardcoded list', () => {
    expect(rtl.isRtlLanguage('ar')).toBe(true);
    expect(rtl.isRtlLanguage('en')).toBe(false);
    expect(rtl.isRtlLanguage('ru')).toBe(false);
  });

  it('tolerates the locale shapes the platform hands us', () => {
    expect(rtl.isRtlLanguage('AR')).toBe(true);
    expect(rtl.isRtlLanguage(null)).toBe(false);
    expect(rtl.isRtlLanguage('zz')).toBe(false);
  });
});

describe('syncRtlLayout', () => {
  it('reports a change and forces RTL when switching to Arabic', () => {
    const { rtl, allowRTL, forceRTL } = loadRtl(false);

    expect(rtl.syncRtlLayout('ar')).toBe(true);
    expect(allowRTL).toHaveBeenCalledWith(true);
    expect(forceRTL).toHaveBeenCalledWith(true);
  });

  it('reports a change and un-forces RTL when switching away from Arabic', () => {
    const { rtl, forceRTL } = loadRtl(true);

    expect(rtl.syncRtlLayout('en')).toBe(true);
    expect(forceRTL).toHaveBeenCalledWith(false);
  });

  it('is a no-op when the direction already matches — no spurious reload', () => {
    const ltr = loadRtl(false);
    expect(ltr.rtl.syncRtlLayout('en')).toBe(false);
    expect(ltr.forceRTL).not.toHaveBeenCalled();

    const rtlOn = loadRtl(true);
    expect(rtlOn.rtl.syncRtlLayout('ar')).toBe(false);
    expect(rtlOn.forceRTL).not.toHaveBeenCalled();
  });

  it('still lifts the native RTL opt-out even when nothing changes', () => {
    const { rtl, allowRTL } = loadRtl(false);
    rtl.syncRtlLayout('en');
    expect(allowRTL).toHaveBeenCalledWith(true);
  });

  it('treats an unknown locale as left-to-right', () => {
    const { rtl } = loadRtl(false);
    expect(rtl.syncRtlLayout('zz')).toBe(false);
  });
});

describe('reloadForRtl', () => {
  it('resolves false rather than throwing when expo-updates is unavailable', async () => {
    let rtl!: RtlModule;
    jest.isolateModules(() => {
      jest.doMock('react-native', () => ({
        I18nManager: { isRTL: false, allowRTL: jest.fn(), forceRTL: jest.fn() },
      }));
      jest.doMock('expo-updates', () => {
        throw new Error('native module missing');
      }, { virtual: true });
      rtl = require('../rtl');
    });

    await expect(rtl.reloadForRtl()).resolves.toBe(false);
  });
});

describe('direction-dependent constants', () => {
  it('align to the leading/trailing edge, not left/right', () => {
    expect(loadRtl(false).rtl.alignEnd).toBe('right');
    expect(loadRtl(true).rtl.alignEnd).toBe('left');
    expect(loadRtl(false).rtl.alignStart).toBe('left');
    expect(loadRtl(true).rtl.alignStart).toBe('right');
  });

  it('flip the arrow glyphs that mean "onward" and "back"', () => {
    expect(loadRtl(false).rtl.FORWARD_ARROW).toBe('→');
    expect(loadRtl(true).rtl.FORWARD_ARROW).toBe('←');
    expect(loadRtl(false).rtl.BACK_ARROW).toBe('←');
    expect(loadRtl(true).rtl.BACK_ARROW).toBe('→');
  });

  it('invert the gesture sign so swipes follow the reading direction', () => {
    expect(loadRtl(false).rtl.directionSign).toBe(1);
    expect(loadRtl(true).rtl.directionSign).toBe(-1);
  });

  it('reverse rows that must keep their visual order', () => {
    expect(loadRtl(false).rtl.rowFixed).toBe('row');
    expect(loadRtl(true).rtl.rowFixed).toBe('row-reverse');
  });
});

describe('swipe actions follow the reading direction', () => {
  // The deciders themselves are direction-agnostic on purpose — the caller
  // converts, so the thresholds stay one set of numbers. What this pins down
  // is the composition: the *same* physical finger movement has to commit
  // opposite actions in the two directions, because the panel it uncovers has
  // moved to the other side of the card.
  const ltr = loadRtl(false).rtl.directionSign;
  const rtl = loadRtl(true).rtl.directionSign;
  const FAR_RIGHT = 120;

  it('sends a rightward home-feed swipe to Watched in LTR and to hidden in RTL', () => {
    expect(swipeActionOnRelease(FAR_RIGHT * ltr, 0)).toBe('watched');
    expect(swipeActionOnRelease(FAR_RIGHT * rtl, 0)).toBe('notInterested');
  });

  it('advances the word deck on a trailing-edge swipe in either direction', () => {
    expect(swipeDecision(FAR_RIGHT * ltr)).toBe('next');
    expect(swipeDecision(-FAR_RIGHT * ltr)).toBe('learn');
    // Under RTL the trailing edge is the left one, so the physical signs swap.
    expect(swipeDecision(-FAR_RIGHT * rtl)).toBe('next');
    expect(swipeDecision(FAR_RIGHT * rtl)).toBe('learn');
  });

  it('mirrors a deck FLICK too — velocity is as physical as distance', () => {
    // A flick short enough that only the velocity term commits it (#110). Both
    // components have to be converted at the call site: mirroring `dx` alone
    // and leaving `vx` raw is silent under LTR and gives an Arabic reader the
    // opposite action, which is the whole trap this guard exists for.
    const SHORT = 40;
    const FLICK = 0.9;
    expect(swipeDecision(SHORT * ltr, FLICK * ltr)).toBe('next');
    expect(swipeDecision(-SHORT * ltr, -FLICK * ltr)).toBe('learn');
    // The same physical finger movement, mirrored, means the opposite action.
    expect(swipeDecision(SHORT * rtl, FLICK * rtl)).toBe('learn');
    expect(swipeDecision(-SHORT * rtl, -FLICK * rtl)).toBe('next');
  });

  it('leaves the claim test direction-blind — it only measures steepness', () => {
    expect(shouldClaimHorizontal(40, 5)).toBe(shouldClaimHorizontal(-40, 5));
    expect(shouldClaimHorizontalDrag(40, 5)).toBe(shouldClaimHorizontalDrag(-40, 5));
  });
});

describe('directionalIcon', () => {
  it('passes every name through untouched under LTR', () => {
    const { rtl } = loadRtl(false);
    expect(rtl.directionalIcon('chevron-back')).toBe('chevron-back');
    expect(rtl.directionalIcon('chevron-forward')).toBe('chevron-forward');
  });

  it('mirrors navigational glyphs under RTL', () => {
    const { rtl } = loadRtl(true);
    expect(rtl.directionalIcon('chevron-back')).toBe('chevron-forward');
    expect(rtl.directionalIcon('chevron-forward')).toBe('chevron-back');
    expect(rtl.directionalIcon('arrow-back')).toBe('arrow-forward');
    expect(rtl.directionalIcon('arrow-undo')).toBe('arrow-redo');
  });

  it('leaves non-directional icons alone, so blanket use is safe', () => {
    const { rtl } = loadRtl(true);
    expect(rtl.directionalIcon('close')).toBe('close');
    expect(rtl.directionalIcon('chevron-up')).toBe('chevron-up');
    expect(rtl.directionalIcon('star')).toBe('star');
  });

  it('mirrors symmetrically — applying it twice is the identity', () => {
    const { rtl } = loadRtl(true);
    for (const name of ['chevron-back', 'chevron-forward', 'arrow-back', 'arrow-undo']) {
      expect(rtl.directionalIcon(rtl.directionalIcon(name))).toBe(name);
    }
  });
});

describe('every RTL locale is fully shipped', () => {
  it('has a locale directory, so marking rtl can never outrun translation', () => {
    const localesDir = path.join(__dirname, '..', 'locales');
    for (const lang of UI_LANGUAGES.filter((l) => l.rtl)) {
      expect(fs.existsSync(path.join(localesDir, lang.code))).toBe(true);
    }
  });
});

// ─── Source scans ─────────────────────────────────────────────────────────────
//
// The half that matters over time. A `marginLeft` or a raw `g.dx` added next
// year fails no runtime test — it just quietly refuses to mirror. These walk
// the source instead. Shared by the three guards below.

const SRC = path.join(__dirname, '..', '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const FILES = sourceFiles(SRC);

/** Comments name these properties on purpose — rtl.ts documents them. */
function isComment(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*');
}

function readLines(file: string): string[] {
  return fs.readFileSync(file, 'utf8').split('\n');
}

describe('no physical edge properties in styles', () => {
  // `marginLeft` does not mirror; `marginStart` does. Nothing at runtime
  // distinguishes them, so this scan is the only thing standing between the
  // app and a half-mirrored screen.
  const PHYSICAL =
    /\b(?:margin(?:Left|Right)|padding(?:Left|Right)|border(?:Left|Right)(?:Width|Color)|border(?:Top|Bottom)(?:Left|Right)Radius)\b/;

  /** `textAlign: 'left' | 'right'` is physical too — use alignStart/alignEnd. */
  const PHYSICAL_ALIGN = /textAlign:\s*['"](?:left|right)['"]/;

  function scan(pattern: RegExp): string[] {
    const offenders: string[] = [];
    for (const file of FILES) {
      readLines(file).forEach((line, i) => {
        if (isComment(line)) return;
        if (pattern.test(line)) {
          offenders.push(`${path.relative(SRC, file)}:${i + 1}  ${line.trim().slice(0, 80)}`);
        }
      });
    }
    return offenders;
  }

  it('uses marginStart/paddingEnd rather than the physical equivalents', () => {
    expect(scan(PHYSICAL)).toEqual([]);
  });

  it('uses alignStart/alignEnd rather than a hardcoded textAlign', () => {
    expect(scan(PHYSICAL_ALIGN)).toEqual([]);
  });
});

describe('gestures are written in logical direction', () => {
  // The bug class #97 fixed in one component and left in two others. A
  // PanResponder's `dx`/`vx` and `transform: translateX` are physical screen
  // pixels — Yoga mirrors the layout around them and never them. So a handler
  // written against a raw `dx` keeps pointing the LTR way under RTL while the
  // backdrop behind it flips: the panel the drag uncovers is not the action
  // the release commits. Multiplying by `directionSign` on the way in and back
  // out on the way to `translateX` is the fix, and this is the scan that stops
  // the next swipe handler from skipping it.
  const GESTURE_AXIS = /\.\s*(?:dx|vx)\b/;

  it('every file that reads a gesture dx/vx also converts with directionSign', () => {
    const offenders = FILES.filter((file) => {
      const code = readLines(file)
        .filter((line) => !isComment(line))
        .join('\n');
      return GESTURE_AXIS.test(code) && !code.includes('directionSign');
    }).map((file) => path.relative(SRC, file));

    expect(offenders).toEqual([]);
  });

  // The rule above is per FILE, which is one grain too coarse for velocity:
  // a handler that already mirrors `dx` satisfies it while passing a raw `vx`
  // beside it, and that reads as correct in every LTR test (#110). Unlike
  // `dx` — which the direction-blind claim tests read on purpose — `vx` has
  // no legitimate unmirrored consumer, so it can be pinned line by line.
  // Matches the conversion attached to the `vx` read itself, either way round.
  // Deliberately not "the line mentions directionSign somewhere": every real
  // call site mirrors `dx` on that same line, so the loose form is satisfied by
  // the neighbour and lets the raw `vx` through — which is the bug verbatim.
  const VX_READ = /\.\s*vx\b/;
  const VX_CONVERTED =
    /(?:\.\s*vx\s*\*\s*directionSign|directionSign\s*\*\s*[A-Za-z_$][\w$]*\.\s*vx\b)/;

  it('never reads a gesture vx without converting that read', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      readLines(file).forEach((line, i) => {
        if (isComment(line)) return;
        if (VX_READ.test(line) && !VX_CONVERTED.test(line)) {
          offenders.push(`${path.relative(SRC, file)}:${i + 1}  ${line.trim().slice(0, 80)}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe('absolute positioning uses logical offsets', () => {
  // `left`/`right` are physical, but a blanket ban would be almost all false
  // positives: most uses are symmetric pairs (`left: 0, right: 0`) that mirror
  // to the same thing. So the rule flags a *lone* offset — the shape that pins
  // a back button to the same screen side in both reading directions.
  //
  // These place things by geometry rather than by reading order: a rotated
  // diamond, drifting confetti, a poster in flight. Mirroring their
  // coordinates would break the transforms rather than fix them, so they are
  // excluded deliberately (#104), not because the rule is noisy there.
  //
  // GlobalBottomBar joins them for the same reason: the active-tab lens is
  // anchored at `left: 0` and driven entirely by an animated translateX built
  // from the active cell's *measured* frame. React Native's layout
  // coordinates are physical (left-origin) in both reading directions, and
  // transforms are not mirrored, so a physical anchor is what makes the lens
  // land on the right cell under RTL — `start` would anchor it to the opposite
  // edge and send the translate the wrong way. See `lensGeometry`, which
  // exists precisely so this is measured rather than derived from tab index.
  const GEOMETRIC = [
    'components/GlobalBottomBar.tsx',
    'components/PosterFlight.tsx',
    'components/journey/JourneyNode.tsx',
    'components/practice/PracticeBackdrop.tsx',
    'components/practice/PracticeTile.tsx',
    'components/ui/Confetti.tsx',
  ];

  /** How many lines away the mirror declaration may sit. Style objects put the
   *  pair adjacent; anything further apart is a different object. */
  const PAIR_WINDOW = 3;

  const OFFSET = /^(\s*)(left|right)\s*:/;

  it('pairs every absolute left/right, or uses start/end instead', () => {
    const offenders: string[] = [];

    for (const file of FILES) {
      const rel = path.relative(SRC, file);
      if (GEOMETRIC.includes(rel)) continue;

      const lines = readLines(file);
      lines.forEach((line, i) => {
        if (isComment(line)) return;
        const m = OFFSET.exec(line);
        if (!m) return;
        const [, indent, prop] = m;
        const mirror = prop === 'left' ? 'right' : 'left';

        for (let j = Math.max(0, i - PAIR_WINDOW); j <= Math.min(lines.length - 1, i + PAIR_WINDOW); j++) {
          if (j === i) continue;
          const other = OFFSET.exec(lines[j]);
          if (other && other[2] === mirror && other[1] === indent) return;
        }
        offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 80)}`);
      });
    }

    expect(offenders).toEqual([]);
  });

  it('still excludes only the files that are geometric on purpose', () => {
    // A stale allowlist is a silent hole, so fail if one of these is renamed
    // or deleted rather than letting the exclusion quietly stop applying.
    for (const rel of GEOMETRIC) {
      expect(fs.existsSync(path.join(SRC, rel))).toBe(true);
    }
  });
});
