import {
  CARD_HEIGHT,
  DECK_ZONE_HEIGHT,
  STACK_HEADROOM,
  WORD_SLOT_HEIGHT,
  SENTENCE_LABEL_HEIGHT,
  wordTier,
  wordTranslationTier,
  sentenceTier,
  sentenceTranslationTier,
  movieTitleTier,
  WORD_TIER_MAX_CHARS,
  SENTENCE_TIER_MAX_CHARS,
  MOVIE_TITLE_TIER_MAX_CHARS,
} from '../cardLayout';

// Stress strings from the approved mockup (1a "Ledger reveal").
const LONG_IDIOM = 'burn the candle at both ends'; // 28 chars → small word tier
const LONG_IDIOM_TR = 'quemar la vela por los dos extremos'; // 35 chars
const LONG_SENTENCE =
  'Your subconscious is projecting hostile manifestations because it senses ' +
  'the dreamer tampering with the architecture of the dream.'; // 131 chars
const LONG_SENTENCE_TR =
  'Tu subconsciente proyecta manifestaciones hostiles porque percibe que el ' +
  'soñador está alterando la arquitectura del sueño.'; // 122 chars

describe('CARD_HEIGHT (the fixed-card contract)', () => {
  it('matches the mockup constant — 389px', () => {
    expect(CARD_HEIGHT).toBe(389);
  });

  it('deck zone = headroom for the ghost stack + the card', () => {
    expect(DECK_ZONE_HEIGHT).toBe(STACK_HEADROOM + CARD_HEIGHT);
  });

  it('paid for the EXAMPLE SENTENCE eyebrow out of the word slot', () => {
    // The eyebrow replaced a 1pt divider, so 9pt had to come from somewhere;
    // it came from the word slot (64 → 56) and the gap above it (6 → 5). If a
    // future slot change forgets to rebalance, the assertion above fails and
    // the card stops being the constant height the reveal depends on.
    expect(SENTENCE_LABEL_HEIGHT).toBe(10);
    expect(WORD_SLOT_HEIGHT).toBe(56);
  });

  it('the 56pt word slot still seats both word tiers', () => {
    for (const word of ['hollow', LONG_IDIOM]) {
      const tier = wordTier(word);
      expect(tier.lines * tier.lineHeight).toBeLessThanOrEqual(WORD_SLOT_HEIGHT);
    }
  });
});

describe('movieTitleTier', () => {
  it('short title keeps the display size', () => {
    expect(movieTitleTier('Inception')).toEqual({ fontSize: 26, lineHeight: 29, lines: 2 });
  });

  it('long title steps down one tier rather than shrinking the hero', () => {
    const long = 'The Lord of the Rings: The Fellowship of the Ring';
    expect(long.length).toBeGreaterThan(MOVIE_TITLE_TIER_MAX_CHARS);
    expect(movieTitleTier(long)).toEqual({ fontSize: 22, lineHeight: 25, lines: 2 });
  });

  it('both tiers fit two lines inside the 119pt hero plate', () => {
    for (const title of ['Inception', 'The Lord of the Rings: The Fellowship of the Ring']) {
      const tier = movieTitleTier(title);
      expect(tier.lines * tier.lineHeight).toBeLessThan(119);
    }
  });

  it('boundary: exactly 26 chars stays on the display tier', () => {
    expect(movieTitleTier('a'.repeat(MOVIE_TITLE_TIER_MAX_CHARS)).fontSize).toBe(26);
    expect(movieTitleTier('a'.repeat(MOVIE_TITLE_TIER_MAX_CHARS + 1)).fontSize).toBe(22);
  });
});

describe('wordTier', () => {
  it('short word renders one 32px line', () => {
    expect(wordTier('hollow')).toEqual({ fontSize: 32, lineHeight: 38, lines: 1 });
  });

  it('long idiom steps down to 22px on two lines', () => {
    expect(LONG_IDIOM.length).toBeGreaterThan(WORD_TIER_MAX_CHARS);
    expect(wordTier(LONG_IDIOM)).toEqual({ fontSize: 22, lineHeight: 28, lines: 2 });
  });

  it('boundary: exactly 18 chars stays on the display tier', () => {
    expect(wordTier('a'.repeat(18)).fontSize).toBe(32);
    expect(wordTier('a'.repeat(19)).fontSize).toBe(22);
  });
});

describe('wordTranslationTier', () => {
  it('short translation gets 17px', () => {
    expect(wordTranslationTier('hueco').fontSize).toBe(17);
  });

  it('35-char idiom translation steps down to 14px, still one line', () => {
    const tier = wordTranslationTier(LONG_IDIOM_TR);
    expect(tier.fontSize).toBe(14);
    expect(tier.lines).toBe(1);
  });
});

describe('sentenceTier', () => {
  it('short sentence: 3 lines at 17px', () => {
    expect(sentenceTier('Sometimes a leap of faith is the only way across.')).toEqual({
      fontSize: 17,
      lineHeight: 26,
      lines: 3,
    });
  });

  it('131-char sentence steps down to 14.5px and gains a 4th line', () => {
    expect(LONG_SENTENCE.length).toBeGreaterThan(SENTENCE_TIER_MAX_CHARS);
    expect(sentenceTier(LONG_SENTENCE)).toEqual({ fontSize: 14.5, lineHeight: 22, lines: 4 });
  });

  it('the 4-line small tier fits the 88px slot', () => {
    const tier = sentenceTier(LONG_SENTENCE);
    expect(tier.lines * tier.lineHeight).toBeLessThanOrEqual(88);
  });

  it('boundary: exactly 95 chars stays on the large tier', () => {
    expect(sentenceTier('a'.repeat(SENTENCE_TIER_MAX_CHARS)).fontSize).toBe(17);
    expect(sentenceTier('a'.repeat(SENTENCE_TIER_MAX_CHARS + 1)).fontSize).toBe(14.5);
  });
});

describe('sentenceTranslationTier', () => {
  it('short translation: 3 lines at 14.5px', () => {
    expect(sentenceTranslationTier('A veces un acto de fe es la única forma de cruzar.')).toEqual({
      fontSize: 14.5,
      lineHeight: 22,
      lines: 3,
    });
  });

  it('long translation steps down to 12.5px / 4 lines and fits the 68px slot', () => {
    const tier = sentenceTranslationTier(LONG_SENTENCE_TR);
    expect(tier).toEqual({ fontSize: 12.5, lineHeight: 17, lines: 4 });
    expect(tier.lines * tier.lineHeight).toBeLessThanOrEqual(68);
  });
});
