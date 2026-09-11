/**
 * StreakWeek — the Practice header: your streak, and the week that made it.
 *
 * Replaces the two chips that said "0 FREEZES" and "0 DAYS". A number on its
 * own is a scoreboard; a row of days with a gap in it is feedback you can act
 * on, which is why Duolingo, Strava and the fitness rings all converged on the
 * strip. The number stays — it is the thing people quote — but it now sits
 * next to the evidence for it.
 *
 * ## Why `frozen` is drawn differently from `done`
 *
 * Both keep the streak alive, and collapsing them would be simpler. But a day
 * a freeze paid for, drawn as a gap, reports the freeze as having *failed* —
 * the opposite of what happened, on the one mechanic the user is being asked
 * to trust. It is also the only feedback that a freeze was spent at all, short
 * of noticing the counter is lower.
 *
 * ## The height is fixed, and that is load-bearing
 *
 * `PracticeScreen`'s header has always stated its height rather than letting
 * content size it, with the reason recorded there: everything above the tile
 * path moves every tile below it, and the path bottom-anchors itself once per
 * cursor on `onContentSizeChange`. A panel that grows when the network
 * resolves would shove the path down under the user's thumb mid-scroll. So
 * `WEEK_PANEL_H` is a constant, the skeleton occupies exactly the same box as
 * the loaded state, and nothing here is content-sized.
 */

import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { MONO_FAMILY } from '../../theme/fonts';
import { StreakFlame } from '../ui/StreakFlame';
import type { DailyState } from '../../services/api';

/** One square's diameter. Seven of these plus their gaps have to fit the
 *  narrowest phone we support, which is what caps it. */
const CELL = 26;
/** Total painted height of the panel. Stated, never derived — see the note
 *  above on why a content-sized header is a bug here rather than a style. */
export const WEEK_PANEL_H = 92;

type WeekDay = NonNullable<DailyState['week']>[number];

/** Monday-first, matching the server's `week_bounds`. Keys rather than letters
 *  so every locale supplies its own initial — `Intl` is not reliable for this
 *  on Hermes, which has shipped without full ICU. */
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

interface Props {
  /** Null until `/daily/state` resolves. The panel renders its own skeleton at
   *  the identical height rather than collapsing. */
  state: DailyState | null;
  /** Local optimistic streak, shown for the moment before the server answers.
   *  The server's value wins as soon as there is one. */
  fallbackStreak: number;
}

export function StreakWeek({ state, fallbackStreak }: Props) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  const streak = state?.streak ?? fallbackStreak;
  const held = state?.freezes_held ?? 0;
  const equipped = state?.freezes_equipped ?? 0;
  const week = state?.week ?? [];

  return (
    <View style={s.panel}>
      <View style={s.topRow}>
        <StreakFlame size={22} lit={streak > 0} style={s.flame} />
        <Text style={s.streakNumber} numberOfLines={1}>{streak}</Text>
        <Text style={s.streakLabel} numberOfLines={1}>
          {t('practice:dayLabel', { count: streak })}
        </Text>

        <View style={s.spacer} />

        {/* Armed out of held. "1/3" says both things the user needs: how much
            mercy they have, and how much of it is actually standing guard —
            a distinction that did not exist while the app spent them all
            automatically. */}
        <Text style={s.freezeCount} numberOfLines={1}>
          {equipped}/{held}
        </Text>
        <Text style={s.freezeLabel} numberOfLines={1}>
          {t('practice:freeze', { count: held })}
        </Text>
      </View>

      <View style={s.strip}>
        {DAY_KEYS.map((key, i) => {
          const day: WeekDay | undefined = week[i];
          return (
            <View key={key} style={s.dayCol}>
              <Text style={s.dayLetter} numberOfLines={1}>
                {t(`practice:weekday.${key}`)}
              </Text>
              <View
                style={[
                  s.cell,
                  day?.state === 'done' && s.cellDone,
                  day?.state === 'frozen' && s.cellFrozen,
                  day?.state === 'future' && s.cellFuture,
                  day?.is_today && s.cellToday,
                ]}
              />
            </View>
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    panel: {
      height: WEEK_PANEL_H,
      marginHorizontal: 18,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 18,
      backgroundColor: tc.paper,
      borderWidth: 1,
      borderColor: tc.border,
      justifyContent: 'space-between',
    },
    topRow: { flexDirection: 'row', alignItems: 'center' },
    flame: { marginEnd: 6 },
    streakNumber: {
      fontFamily: MONO_FAMILY,
      fontSize: 18,
      fontWeight: '900',
      color: tc.text,
      marginEnd: 5,
    },
    streakLabel: {
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 0.6,
      color: tc.textFaint,
    },
    spacer: { flex: 1 },
    freezeCount: {
      fontFamily: MONO_FAMILY,
      fontSize: 13,
      fontWeight: '900',
      color: tc.goldOnSurface,
      marginEnd: 5,
    },
    freezeLabel: {
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 0.6,
      color: tc.textFaint,
    },

    strip: { flexDirection: 'row', justifyContent: 'space-between' },
    dayCol: { alignItems: 'center', width: CELL },
    dayLetter: {
      fontSize: 9,
      fontWeight: '800',
      color: tc.textFaint,
      marginBottom: 3,
    },
    // The default IS "missed": a day that has gone by with nothing in it. Every
    // other state is an override, so a day the server did not describe reads as
    // empty rather than as a false claim.
    cell: {
      width: CELL,
      height: CELL,
      borderRadius: CELL / 2,
      borderWidth: 1.5,
      borderColor: tc.border,
      backgroundColor: 'transparent',
    },
    cellDone: { backgroundColor: tc.gold, borderColor: tc.gold },
    // Distinct from done, and deliberately cooler: a covered day is not a day
    // you practised, and drawing it identically would overstate the week.
    cellFrozen: { backgroundColor: tc.goldOnSurface, borderColor: tc.goldOnSurface, opacity: 0.45 },
    cellFuture: { borderColor: tc.divider },
    cellToday: { borderColor: tc.goldOnSurface, borderWidth: 2.5 },
  });
