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
 *
 * ## The date sits inside the circle
 *
 * A row of letters says "a week"; the numbers say *which* week, and let a
 * reader place a missed day without counting back from today. They go inside
 * the circle rather than under it so the panel keeps its height — the number
 * is drawn within a box that already exists. `weekDates` reads the number
 * straight from the server's `YYYY-MM-DD` (a `new Date` would label every
 * circle in the Americas with yesterday) and picks an ink that stays readable
 * on each fill.
 */

import { useMemo } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { MONO_FAMILY } from '../../theme/fonts';
import { Ionicons } from '@expo/vector-icons';
import { StreakFlame } from '../ui/StreakFlame';
import { Skeleton } from '../ui/Skeleton';
import { withTap } from '../../utils/feedback';
import { directionalIcon } from '../../i18n/rtl';
import type { DailyState } from '../../services/api';
import { dayNumberTone, dayOfMonth, type DayNumberTone } from './weekDates';

/** One square's diameter. Seven of these plus their gaps have to fit the
 *  narrowest phone we support, which is what caps it. */
const CELL = 26;
/** The flame, the streak number and the freeze count, as sizes both the real
 *  panel and its placeholder read — a placeholder that states its own sizes
 *  drifts from the thing it stands in for (see skeletons.test.ts). */
const FLAME = 22;
const STREAK_SIZE = 18;
const FREEZE_SIZE = 13;
/** Total painted height of the panel. Stated, never derived — see the note
 *  above on why a content-sized header is a bug here rather than a style. */
export const WEEK_PANEL_H = 92;

type WeekDay = NonNullable<DailyState['week']>[number];

/** Monday-first, matching the server's `week_bounds`. Keys rather than letters
 *  so every locale supplies its own initial — `Intl` is not reliable for this
 *  on Hermes, which has shipped without full ICU. */
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

interface Props {
  /**
   * The live answer, or the last one this account saw carried to today
   * (`streakSnapshot`). Null only when there is neither — a first launch, or
   * the first visit after signing in — and then the panel draws a placeholder
   * at the identical height.
   *
   * It used to draw `null` as facts instead: "0 DAYS", an unlit flame,
   * "0/0 FREEZES" and seven empty circles, on every cold start, until the
   * request landed and the real streak replaced it. A local optimistic streak
   * filled the gap and was 0 too, because it had not hydrated either.
   */
  state: DailyState | null;
  /** Open the arming sheet. The freeze readout is the only entry point to it,
   *  which is why that readout is a control rather than a label. */
  onPressFreezes: () => void;
  /**
   * Outer layout only. The header row it shares with the upgrade button sets
   * its width and margins; its height is not the caller's to change (see
   * above).
   */
  style?: StyleProp<ViewStyle>;
}

export function StreakWeek({ state, onPressFreezes, style }: Props) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  if (!state) return <StreakWeekPlaceholder s={s} t={t} style={style} />;

  const streak = state.streak;
  const held = state.freezes_held ?? 0;
  const equipped = state.freezes_equipped ?? 0;
  const week = state.week ?? [];

  return (
    <View style={[s.panel, style]}>
      <View style={s.topRow}>
        <StreakFlame size={FLAME} lit={streak > 0} style={s.flame} />
        <Text style={s.streakNumber} numberOfLines={1}>{streak}</Text>
        <Text style={s.streakLabel} numberOfLines={1}>
          {t('practice:dayLabel', { count: streak })}
        </Text>

        <View style={s.spacer} />

        {/* Armed out of held. "1/3" says both things the user needs: how much
            mercy they have, and how much of it is actually standing guard —
            a distinction that did not exist while the app spent them all
            automatically.

            It is also the way in to arming one. A separate button would have
            to be labelled, and the panel has no room for a label that competes
            with the streak; the count is already the thing a user reaches for
            when they want to know about freezes, so it is the control. The
            chevron is what says it is pressable at all — without it this reads
            as two more numbers. */}
        <TouchableOpacity
          onPress={withTap(onPressFreezes)}
          style={s.freezeButton}
          hitSlop={{ top: 12, bottom: 12, left: 10, right: 10 }}
          activeOpacity={0.6}
          accessibilityRole="button"
          accessibilityLabel={t('practice:freezeSheet.openA11y')}
        >
          <Text style={s.freezeCount} numberOfLines={1}>
            {equipped}/{held}
          </Text>
          <Text style={s.freezeLabel} numberOfLines={1}>
            {t('practice:freeze', { count: held })}
          </Text>
          <Ionicons
            name={directionalIcon('chevron-forward')}
            size={13}
            color={tc.textFaint}
            style={s.chevron}
          />
        </TouchableOpacity>
      </View>

      <View style={s.strip}>
        {DAY_KEYS.map((key, i) => {
          const day: WeekDay | undefined = week[i];
          const date = dayOfMonth(day?.date);
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
              >
                {/* The frozen fill is its own layer. Its muted look used to be
                    `opacity` on the whole circle, which would have faded the
                    number inside it to 45% along with the fill. */}
                {day?.state === 'frozen' ? <View style={s.frozenFill} /> : null}
                {date ? (
                  <Text
                    style={[s.dayNumber, INK_STYLE[dayNumberTone(day)](s)]}
                    numberOfLines={1}
                    // Inside a fixed 26pt circle: past this, a two-digit date
                    // spills out of the ring at the largest text sizes.
                    maxFontSizeMultiplier={1.25}
                  >
                    {date}
                  </Text>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/**
 * The panel before there is anything true to show.
 *
 * Only reachable with no live answer AND no snapshot — a first launch, or the
 * first visit after signing in. Everything that would be a claim is a shape
 * instead: no number, no unlit flame (which reads as "no streak"), no empty
 * rings (which read as "missed"). The weekday letters stay, because they are
 * the calendar rather than data. Same box, same row geometry, so nothing below
 * moves when the real panel replaces it.
 */
function StreakWeekPlaceholder({
  s,
  t,
  style,
}: {
  s: ReturnType<typeof makeStyles>;
  t: (key: string) => string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[s.panel, style]} accessibilityLabel={t('practice:streakLoading')}>
      <View style={s.topRow}>
        <Skeleton width={FLAME} height={FLAME} radius={FLAME / 2} style={s.flame} />
        <Skeleton width={STREAK_SIZE * 3.4} height={STREAK_SIZE} radius={5} />
        <View style={s.spacer} />
        <Skeleton width={FREEZE_SIZE * 6.5} height={FREEZE_SIZE} radius={4} />
      </View>
      <View style={s.strip}>
        {DAY_KEYS.map((key) => (
          <View key={key} style={s.dayCol}>
            <Text style={s.dayLetter} numberOfLines={1}>
              {t(`practice:weekday.${key}`)}
            </Text>
            <Skeleton width={CELL} height={CELL} radius={CELL / 2} />
          </View>
        ))}
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
      fontSize: STREAK_SIZE,
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
    // The whole readout is one target — count, label and chevron. Tapping the
    // number but not the word beside it would be a 30pt-wide hit area on the
    // only route into the mechanic.
    //
    // It shrinks before the row overflows. Beside the upgrade crown on a small
    // phone, a long freeze word is what runs out of room first, and text that
    // cannot shrink draws past the border instead of ending in an ellipsis.
    freezeButton: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
    chevron: { marginStart: 3, marginTop: 1 },
    freezeCount: {
      fontFamily: MONO_FAMILY,
      fontSize: FREEZE_SIZE,
      fontWeight: '900',
      color: tc.goldOnSurface,
      marginEnd: 5,
    },
    freezeLabel: {
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 0.6,
      color: tc.textFaint,
      flexShrink: 1,
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
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    cellDone: { backgroundColor: tc.gold, borderColor: tc.gold },
    // Distinct from done, and deliberately cooler: a covered day is not a day
    // you practised, and drawing it identically would overstate the week.
    // The fill lives in `frozenFill` so the date on top keeps full strength.
    cellFrozen: { borderWidth: 0 },
    frozenFill: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: tc.goldOnSurface,
      opacity: 0.45,
    },
    cellFuture: { borderColor: tc.divider },
    cellToday: { borderColor: tc.goldOnSurface, borderWidth: 2.5 },

    dayNumber: {
      fontFamily: MONO_FAMILY,
      fontSize: 10.5,
      fontWeight: '800',
      // Android pads text above and below by default, which drops a number
      // visibly below centre in a circle this small.
      includeFontPadding: false,
      textAlignVertical: 'center',
    },
    // Never white on gold: it measures about 2:1. Dark ink reads in both modes.
    inkOnGold: { color: tc.goldDeep },
    inkOnFrozen: { color: tc.text },
    inkToday: { color: tc.goldOnSurface, fontWeight: '900' },
    inkFaint: { color: tc.textFaint },
  });

type Styles = ReturnType<typeof makeStyles>;

/** Tone → style, as a table so every tone must have an entry the compiler checks. */
const INK_STYLE: Record<DayNumberTone, (s: Styles) => Styles[keyof Styles]> = {
  onGold: (s) => s.inkOnGold,
  onFrozen: (s) => s.inkOnFrozen,
  today: (s) => s.inkToday,
  faint: (s) => s.inkFaint,
};
