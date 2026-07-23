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

describe('no physical edge properties in styles', () => {
  // The regression guard. `marginLeft` does not mirror; `marginStart` does.
  // Nothing at runtime distinguishes them, so this scan is the only thing
  // standing between the app and a half-mirrored screen.
  const SRC = path.join(__dirname, '..', '..');

  const PHYSICAL =
    /\b(?:margin(?:Left|Right)|padding(?:Left|Right)|border(?:Left|Right)(?:Width|Color)|border(?:Top|Bottom)(?:Left|Right)Radius)\b/;

  /** `textAlign: 'left' | 'right'` is physical too — use alignStart/alignEnd. */
  const PHYSICAL_ALIGN = /textAlign:\s*['"](?:left|right)['"]/;

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

  function scan(pattern: RegExp): string[] {
    const offenders: string[] = [];
    for (const file of FILES) {
      fs.readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const trimmed = line.trim();
          // Comments name these properties on purpose — rtl.ts documents them.
          if (trimmed.startsWith('*') || trimmed.startsWith('//')) return;
          if (pattern.test(line)) {
            offenders.push(`${path.relative(SRC, file)}:${i + 1}  ${trimmed.slice(0, 80)}`);
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
