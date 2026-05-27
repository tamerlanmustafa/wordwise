/**
 * Daily-habit API — streak / freezes / today's session state.
 *
 * Mirrors apps/mobile/src/services/api.ts → dailyApi. Endpoints:
 *   GET  /daily/state
 *   POST /consumables/freeze-pack/debug-grant   (admin-only)
 */

import { apiClient } from './api';
import type { SessionKind } from './srsApi';

export interface DailyState {
  today_done: boolean;
  streak: number;
  longest_streak: number;
  freezes_held: number;
  last_session_date: string | null;
  repair_window_active: boolean;
  auto_granted_weekly: boolean;
  auto_consumed: number;
  unlocked_cosmetics: string[];
  /** Practice tile picked today, or null when today's session hasn't
   *  started yet. Drives the tile-state matrix on PracticeScreen. */
  last_session_kind?: SessionKind | null;
}

export interface CreditedFreezesResponse {
  credited: number;
  freezes_held: number;
  capped: boolean;
}

export const dailyApi = {
  state: async (): Promise<DailyState> => {
    const res = await apiClient.get<DailyState>(`/daily/state`);
    return res.data;
  },

  /** Dev-only shortcut to credit a freeze pack without the IAP.
   *  Returns 401/403 in production for non-admin callers. */
  debugGrantFreezes: async (): Promise<CreditedFreezesResponse> => {
    const res = await apiClient.post<CreditedFreezesResponse>(
      `/consumables/freeze-pack/debug-grant`,
    );
    return res.data;
  },
};
