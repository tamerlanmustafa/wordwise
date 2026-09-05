/**
 * SettingsUI — the grouped-list primitives the Settings screen is built from.
 *
 * Settings had grown one bespoke row shape per control: a `notifRow` with a
 * hand-rolled ON/OFF pill, a `selectButton` with a "▼" glyph, a `settingsLink`
 * with an arrow, and a `segmented` strip — four different heights, three
 * different ways of showing "this is tappable", and a custom toggle that looks
 * like nothing either platform ships.
 *
 * These replace all of it with one grouped-inset list, the shape both platforms
 * actually use for settings, and with the real `Switch`, which renders as a
 * UISwitch on iOS and a Material switch on Android without us drawing either.
 *
 * Everything is theme-token-driven — `background`, `paper`, `border`, `text`,
 * `textSecondary`, and **gold** for the accent, because gold is what Home,
 * Explore and Practice use. Purple (`primary`) is the older token and reads as
 * a different app. Ink on a gold fill is `goldDeep`, never white: white on gold
 * measures about 2:1.
 */

import { useMemo, type ReactNode } from 'react';
import {
  Image,
  Platform,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { FORWARD_ARROW } from '../../../i18n/rtl';
import { useThemeColors, type ThemeColors } from '../../../theme/tokens';

/** A titled group. The card is what makes the rows read as one set. */
export function Section({
  title,
  footer,
  children,
}: {
  title?: string;
  /** Explanatory line under the card, in the platform's usual quiet grey. */
  footer?: string;
  children: ReactNode;
}) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  return (
    <View style={s.section}>
      {title ? <Text style={s.sectionTitle}>{title}</Text> : null}
      <View style={s.card}>{children}</View>
      {footer ? <Text style={s.sectionFooter}>{footer}</Text> : null}
    </View>
  );
}

/** Hairline between rows, inset past the label so the group reads as a unit. */
function Separator() {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  return <View style={s.separator} />;
}

/**
 * Wraps children with separators between them — so a Section's rows are
 * divided without every caller remembering to add dividers by hand.
 */
export function Rows({ children }: { children: ReactNode }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : [children];
  return (
    <>
      {items.map((child, i) => (
        <View key={i}>
          {i > 0 ? <Separator /> : null}
          {child}
        </View>
      ))}
    </>
  );
}

interface BaseRowProps {
  label: string;
  description?: string;
  /** Muted styling for a row that should not draw the eye — see the account
   *  deletion row, which is required to exist but should not invite a tap. */
  muted?: boolean;
}

/** Label + description on the left, whatever you pass on the right. */
export function Row({
  label,
  description,
  muted,
  right,
  onPress,
}: BaseRowProps & { right?: ReactNode; onPress?: () => void }) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  const body = (
    <View style={s.row}>
      <View style={s.rowText}>
        <Text style={[s.rowLabel, muted && s.rowLabelMuted]}>{label}</Text>
        {description ? <Text style={s.rowDesc}>{description}</Text> : null}
      </View>
      {right}
    </View>
  );
  if (!onPress) return body;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.6}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {body}
    </TouchableOpacity>
  );
}

/** A row whose control is the platform's own switch. */
export function SwitchRow({
  label,
  description,
  value,
  onValueChange,
}: BaseRowProps & { value: boolean; onValueChange: (v: boolean) => void }) {
  const tc = useThemeColors();
  return (
    <Row
      label={label}
      description={description}
      right={
        <Switch
          value={value}
          onValueChange={onValueChange}
          accessibilityLabel={label}
          // iOS colours the whole track; Android colours the thumb and needs
          // the track given both states explicitly or the "off" track is a
          // near-invisible grey on a dark ground.
          trackColor={{ false: tc.border, true: tc.gold }}
          thumbColor={
            Platform.OS === 'android' ? (value ? tc.goldDeep : tc.paper) : undefined
          }
          ios_backgroundColor={tc.border}
        />
      }
    />
  );
}

/** A row that opens a picker, showing the current value. */
export function SelectRow({
  label,
  value,
  onPress,
}: {
  label: string;
  value: string;
  onPress: () => void;
}) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  return (
    <Row
      label={label}
      onPress={onPress}
      right={
        <View style={s.rowEnd}>
          <Text style={s.rowValue} numberOfLines={1}>
            {value}
          </Text>
          <Text style={s.chevron}>{FORWARD_ARROW}</Text>
        </View>
      }
    />
  );
}

/** A row that navigates somewhere. */
export function LinkRow({
  label,
  description,
  muted,
  onPress,
}: BaseRowProps & { onPress: () => void }) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  return (
    <Row
      label={label}
      description={description}
      muted={muted}
      onPress={onPress}
      right={<Text style={[s.chevron, muted && s.chevronMuted]}>{FORWARD_ARROW}</Text>}
    />
  );
}

/**
 * Segmented control — the theme picker.
 *
 * Gold fill with `goldDeep` ink for the active segment, matching every other
 * selected state in the app.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  return (
    <View style={s.segmented}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <TouchableOpacity
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={[s.segment, active && s.segmentActive]}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text style={[s.segmentText, active && s.segmentTextActive]}>{opt.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/**
 * The account's picture, or its initial.
 *
 * `profile_picture_url` is only set for Google sign-ins, so the fallback is not
 * an edge case — it is what every email/Apple account sees, and a broken image
 * icon in its place would look like a bug rather than an absence.
 */
export function Avatar({
  uri,
  name,
  size = 56,
}: {
  uri?: string | null;
  name?: string;
  size?: number;
}) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  const dims = { width: size, height: size, borderRadius: size / 2 };
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={[s.avatar, dims]}
        accessibilityIgnoresInvertColors
        accessible={false}
      />
    );
  }
  const initial = (name ?? '').trim().charAt(0).toUpperCase() || '?';
  return (
    <View style={[s.avatar, s.avatarFallback, dims]} accessible={false}>
      <Text style={[s.avatarInitial, { fontSize: size * 0.4 }]}>{initial}</Text>
    </View>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    section: {
      marginBottom: 22,
    },
    sectionTitle: {
      fontSize: 12.5,
      fontWeight: '700',
      color: tc.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.7,
      marginBottom: 8,
      marginStart: 4,
    },
    sectionFooter: {
      fontSize: 12.5,
      lineHeight: 17,
      color: tc.textFaint,
      marginTop: 7,
      marginHorizontal: 4,
    },
    card: {
      backgroundColor: tc.paper,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: tc.border,
      overflow: 'hidden',
    },
    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: tc.divider,
      marginStart: 16,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: 16,
      // 48pt is the smaller of the two platform minimum touch targets; the
      // vertical padding keeps a two-line row comfortable above it.
      minHeight: 48,
      paddingVertical: 11,
    },
    rowText: {
      flex: 1,
    },
    rowLabel: {
      fontSize: 15.5,
      color: tc.text,
    },
    rowLabelMuted: {
      color: tc.textFaint,
    },
    rowDesc: {
      fontSize: 12.5,
      lineHeight: 17,
      color: tc.textSecondary,
      marginTop: 2,
    },
    rowEnd: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      flexShrink: 1,
    },
    rowValue: {
      fontSize: 15,
      color: tc.textSecondary,
      flexShrink: 1,
    },
    chevron: {
      fontSize: 17,
      color: tc.textFaint,
    },
    chevronMuted: {
      opacity: 0.5,
    },
    segmented: {
      flexDirection: 'row',
      padding: 4,
      gap: 4,
    },
    segment: {
      flex: 1,
      paddingVertical: 9,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    segmentActive: {
      backgroundColor: tc.gold,
    },
    segmentText: {
      fontSize: 14,
      fontWeight: '600',
      color: tc.textSecondary,
    },
    segmentTextActive: {
      // Never white: white on this gold measures ~2:1.
      color: tc.goldDeep,
      fontWeight: '700',
    },
    avatar: {
      backgroundColor: tc.chipBg,
    },
    avatarFallback: {
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: tc.border,
    },
    avatarInitial: {
      fontWeight: '700',
      color: tc.textSecondary,
    },
  });
