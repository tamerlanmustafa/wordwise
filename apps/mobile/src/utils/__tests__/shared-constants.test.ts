// Imports through the @wordwise/types alias so a broken path config in either
// tsconfig or Metro/Vite is caught by CI instead of at app boot.
import {
  SUPPORTED_LANGUAGES,
  AVAILABLE_LANGUAGES,
  PROFICIENCY_LEVELS,
} from '@wordwise/types';
import * as mobileTypes from '../../types';

describe('mobile local copy matches @wordwise/types source of truth', () => {
  // Metro can't cross package boundaries without monorepo setup, so mobile
  // keeps a local copy of these constants in src/types/. This test fails if
  // the two drift, forcing an update to both.
  it('SUPPORTED_LANGUAGES matches', () => {
    expect(mobileTypes.SUPPORTED_LANGUAGES).toEqual(SUPPORTED_LANGUAGES);
  });
  it('AVAILABLE_LANGUAGES matches', () => {
    expect(mobileTypes.AVAILABLE_LANGUAGES).toEqual(AVAILABLE_LANGUAGES);
  });
  it('PROFICIENCY_LEVELS matches', () => {
    expect(mobileTypes.PROFICIENCY_LEVELS).toEqual(PROFICIENCY_LEVELS);
  });
});

describe('SUPPORTED_LANGUAGES', () => {
  it('uses lowercase ISO codes (backend contract)', () => {
    SUPPORTED_LANGUAGES.forEach((lang) => {
      expect(lang.code).toMatch(/^[a-z]{2}$/);
    });
  });

  it('has unique codes', () => {
    const codes = SUPPORTED_LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('includes English so new users have a default for native_language', () => {
    expect(SUPPORTED_LANGUAGES.some((l) => l.code === 'en')).toBe(true);
  });
});

describe('AVAILABLE_LANGUAGES', () => {
  it('uses uppercase codes (translation API contract)', () => {
    AVAILABLE_LANGUAGES.forEach((lang) => {
      expect(lang.code).toMatch(/^[A-Z]{2}$/);
    });
  });

  it('has unique codes', () => {
    const codes = AVAILABLE_LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('always provides a native-name fallback for pickers', () => {
    AVAILABLE_LANGUAGES.forEach((lang) => {
      expect(typeof lang.nativeName).toBe('string');
      expect(lang.nativeName!.length).toBeGreaterThan(0);
    });
  });
});

describe('PROFICIENCY_LEVELS', () => {
  it('contains exactly the six CEFR levels in order', () => {
    expect(PROFICIENCY_LEVELS.map((l) => l.code)).toEqual([
      'A1',
      'A2',
      'B1',
      'B2',
      'C1',
      'C2',
    ]);
  });

  it('has a display name for every level', () => {
    PROFICIENCY_LEVELS.forEach((lvl) => {
      expect(lvl.name).toContain(lvl.code);
    });
  });
});
