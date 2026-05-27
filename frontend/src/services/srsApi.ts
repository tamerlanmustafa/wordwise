/**
 * SRS API — spaced-repetition review sessions ("Practice").
 *
 * Mirrors apps/mobile/src/services/api.ts → srsApi + dailyApi. Endpoints:
 *   GET  /srs/stats
 *   POST /srs/session/start?kind=&movie_id=
 *   POST /srs/review
 *   POST /srs/session/complete
 *   GET  /srs/today?skip=&target_lang=
 *   GET  /daily/state
 *
 * Special case: POST /srs/session/start returns 402 with structured
 * detail when the user hits the daily cap or runs out of free previews.
 * We translate that into an `SrsPaywallError` so screens can route to
 * the paywall instead of showing a generic error.
 */

import { AxiosError } from 'axios';
import { apiClient } from './api';

// ─── Session-kind & paywall ──────────────────────────────────────────

/** Practice-tab tile picked by the user (one per UTC day). */
export type SessionKind =
  | 'quick_recall'
  | 'synonym_round'
  | 'tough_words'
  | 'movie_deep_dive';

export type SrsPaywallKind = 'preview_exhausted' | 'daily_cap_reached';

export class SrsPaywallError extends Error {
  kind: SrsPaywallKind;
  previews_used: number;
  previews_limit: number;
  constructor(
    message: string,
    previews_used: number,
    previews_limit: number,
    kind: SrsPaywallKind = 'preview_exhausted',
  ) {
    super(message);
    this.name = 'SrsPaywallError';
    this.kind = kind;
    this.previews_used = previews_used;
    this.previews_limit = previews_limit;
  }
}

// ─── Types ───────────────────────────────────────────────────────────

interface SynonymChoice {
  word: string;
  is_correct: boolean;
}

export interface SrsReviewCard {
  user_word_id: number;
  word: string;
  movie_id: number | null;
  movie_title: string | null;
  srs_box: number;
  srs_due_at: string;
  definition: string | null;
  example_sentence: string | null;
  cefr_level: string | null;
  /** 'synonym_mcq' (4-choice synonym pick) or 'type' (free-text typing).
   *  Legacy 'recall' is no longer emitted. */
  card_type?: 'synonym_mcq' | 'type';
  /** Present iff card_type === 'synonym_mcq'. */
  choices?: SynonymChoice[];
  /** Present iff card_type === 'type' — canonical translation + hints. */
  pos?: string | null;
  translation?: string | null;
  translation_aliases?: string[] | null;
  syllables?: number | null;
  first_letter?: string | null;
}

export interface SrsSessionStart {
  cards: SrsReviewCard[];
  total_due: number;
  session_size: number;
  is_preview: boolean;
  previews_remaining: number;
  /** Echoed back so the client confirms which tile was claimed. */
  kind?: SessionKind;
}

export interface SrsStats {
  total_saved: number;
  due_now: number;
  due_today: number;
  by_box: Record<string, number>;
  is_premium: boolean;
  previews_remaining: number;
  current_streak: number;
  longest_streak: number;
  total_reviews: number;
  total_correct: number;
  retention_pct: number;
}

export type ChestKind = 'xp_small' | 'xp_large' | 'freeze' | 'cosmetic';

export interface ChestPayload {
  kind: ChestKind;
  label: string;
  payload: {
    xp?: number;
    freezes?: number;
    cosmetic_name?: string;
  };
}

export interface SrsCompleteSessionResponse {
  chest: ChestPayload | null;
  already_claimed: boolean;
  correct_count: number;
  total_count: number;
  streak: number;
  /** Full inventory of unlocked milestone slugs — diff against
   *  last-seen to detect new unlocks for the celebration modal. */
  unlocked_cosmetics: string[];
}

export interface TodaysWord {
  word: string;
  translated_word: string | null;
  example_sentence: string | null;
  translated_sentence: string | null;
  cefr_level: string | null;
  movie_title?: string | null;
  movie_poster_url?: string | null;
  movie_id?: number | null;
}

// ─── API ─────────────────────────────────────────────────────────────

export const srsApi = {
  stats: async (): Promise<SrsStats> => {
    const res = await apiClient.get<SrsStats>(`/srs/stats`);
    return res.data;
  },

  startSession: async (
    opts: { kind?: SessionKind; movieId?: number } = {},
  ): Promise<SrsSessionStart> => {
    const qsParts: string[] = [];
    if (opts.kind) qsParts.push(`kind=${encodeURIComponent(opts.kind)}`);
    if (typeof opts.movieId === 'number') qsParts.push(`movie_id=${opts.movieId}`);
    const url = qsParts.length
      ? `/srs/session/start?${qsParts.join('&')}`
      : `/srs/session/start`;
    try {
      const res = await apiClient.post<SrsSessionStart>(url);
      return res.data;
    } catch (err) {
      if (err instanceof AxiosError && err.response?.status === 402) {
        const detail = (err.response.data as { detail?: PaywallDetail })?.detail ?? {};
        const kind: SrsPaywallKind =
          detail.paywall === 'srs_daily_cap_reached'
            ? 'daily_cap_reached'
            : 'preview_exhausted';
        throw new SrsPaywallError(
          detail.message || 'Review session unavailable',
          detail.previews_used ?? 0,
          detail.previews_limit ?? 0,
          kind,
        );
      }
      throw err;
    }
  },

  review: async (userWordId: number, correct: boolean): Promise<void> => {
    await apiClient.post(`/srs/review`, {
      user_word_id: userWordId,
      correct,
    });
  },

  /** Call once after the LAST /srs/review of a daily session. Returns
   *  the variable-reward chest (null on subsequent same-day calls —
   *  `already_claimed=true`). Server picks the reward to keep the
   *  random roll tamper-proof. */
  completeSession: async (
    correctCount: number,
    totalCount: number,
  ): Promise<SrsCompleteSessionResponse> => {
    const res = await apiClient.post<SrsCompleteSessionResponse>(
      `/srs/session/complete`,
      { correct_count: correctCount, total_count: totalCount },
    );
    return res.data;
  },

  /** Today's word — same word for the whole calendar day per language.
   *  Cached in localStorage so a tab switch doesn't re-fetch (and the
   *  server doesn't re-translate). */
  todaysWord: async (
    skip = 0,
    targetLang?: string,
  ): Promise<TodaysWord | null> => {
    const today = new Date().toISOString().slice(0, 10);
    const cacheKey = `todays_word_v1:${today}:${targetLang ?? 'native'}:skip${skip}`;
    try {
      const cached = window.localStorage.getItem(cacheKey);
      if (cached) return JSON.parse(cached) as TodaysWord;
    } catch {
      // localStorage may be disabled (private mode); fall through.
    }

    const qs = `skip=${skip}${
      targetLang ? `&target_lang=${encodeURIComponent(targetLang)}` : ''
    }`;
    try {
      const res = await apiClient.get<TodaysWord | null>(`/srs/today?${qs}`);
      if (res.data) {
        try {
          window.localStorage.setItem(cacheKey, JSON.stringify(res.data));
        } catch {
          // ignore quota / disabled
        }
      }
      return res.data || null;
    } catch {
      return null;
    }
  },
};

interface PaywallDetail {
  message?: string;
  previews_used?: number;
  previews_limit?: number;
  paywall?: string;
}
