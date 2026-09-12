/**
 * FreezeSheet — where a streak freeze gets armed.
 *
 * The freeze stopped being something the app does to you and became something
 * you decide, which only works if there is somewhere to decide it. The server
 * side of that shipped first — `POST /daily/freeze/equip` and `/unequip`, a
 * cap of two armed at once, and a consume path that only ever spends an armed
 * one. Until this sheet existed those endpoints had no caller, so the mechanic
 * was reachable by the API and by nobody holding a phone.
 *
 * ## Why arming is in advance, and why the copy says so
 *
 * A freeze is spent on a day you were not in the app. By the time it matters
 * you are, by definition, not there to be asked. So the decision has to be
 * made beforehand, and the sheet has to explain that in a sentence or the
 * control reads as a pointless extra tap before something automatic.
 *
 * ## The server is the source of truth for both counts
 *
 * Every mutation here replaces `held` and `equipped` with what the endpoint
 * returned rather than adjusting the local numbers — the cap lives on the
 * server, another device may have armed one, and the response already carries
 * the settled values. `changed: false` means the server declined (at the cap,
 * or nothing left to arm); that is reported as a toast rather than treated as
 * an error, because it is a normal answer to a reasonable tap.
 *
 * The buttons are also disabled when the client can already tell the tap would
 * be declined. Both layers are wanted: the disable is the honest affordance,
 * and the toast covers the case where this screen's numbers are stale.
 *
 * Styling follows `NotificationsSheet` — absolute overlay rather than a Modal
 * so the bottom bar behind it stays interactive, paper surface, gold accents,
 * drawn icons. The frost shield is the same `ShieldIcon` the reward chest
 * shows when a freeze is won, so the thing you earn and the thing you arm look
 * like each other.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { MONO_FAMILY } from '../../theme/fonts';
import { PressablePill } from '../ui/PressablePill';
import { LockIcon, ShieldIcon } from '../ui/icons';
import { withTap } from '../../utils/feedback';
import { alignEnd } from '../../i18n/rtl';
import { showToast } from '../../stores/toastStore';
import { dailyApi, type FreezeState } from '../../services/api';
import { armedSlots, canArm, canDisarm, lockedSlots, reserveCount } from './freezeArming';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Freezes owned, armed or not. */
  held: number;
  /** Of those, how many are standing guard. */
  equipped: number;
  /** This account's armed-slot cap, from `/daily/state`. Undefined until the
   *  server answers; the helpers fall back to the free tier's one slot. */
  maxEquipped?: number;
  /** Tapped on the locked slot. Undefined for an account that has no locked
   *  slot, which is how the sheet knows not to make it pressable. */
  onUpsell?: () => void;
  /** Settled counts from the server, for the caller to fold into its own
   *  copy of `/daily/state`. */
  onChange: (next: FreezeState) => void;
  /** Height of GlobalBottomBar — sheet and scrim stop above it. */
  bottomOffset: number;
}

export function FreezeSheet({
  visible,
  onClose,
  held,
  equipped,
  maxEquipped,
  onChange,
  onUpsell,
  bottomOffset,
}: Props) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  // One in-flight mutation at a time. Two taps on "arm" before the first
  // response lands would send two requests against a cap of two and leave the
  // sheet showing counts from whichever replied last.
  const [busy, setBusy] = useState(false);

  const slideAnim = useRef(new Animated.Value(900)).current;
  const hiddenY = useRef(900);

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: visible ? 0 : hiddenY.current,
      useNativeDriver: true,
      bounciness: 0,
      speed: 18,
    }).start();
  }, [visible, slideAnim]);

  const onSheetLayout = useCallback(
    (e: LayoutChangeEvent) => {
      hiddenY.current = e.nativeEvent.layout.height + 24;
      if (!visible) slideAnim.setValue(hiddenY.current);
    },
    [visible, slideAnim],
  );

  const mutate = useCallback(
    async (which: 'arm' | 'disarm') => {
      if (busy) return;
      setBusy(true);
      try {
        const next =
          which === 'arm' ? await dailyApi.equipFreeze() : await dailyApi.unequipFreeze();
        onChange(next);
        if (!next.changed) {
          // A declined tap, not a failure. The server knows something this
          // screen did not — usually another device got there first.
          showToast({
            message: t(
              which === 'arm'
                ? next.freezes_held > next.freezes_equipped
                  ? 'practice:freezeSheet.atCap'
                  : 'practice:freezeSheet.noneLeft'
                : 'practice:freezeSheet.noneLeft',
            ),
            // `default`, not `error`: the server declining a tap the user was
            // entitled to make is information, not a fault of theirs.
            tone: 'default',
          });
        }
      } catch (e) {
        console.warn('[FreezeSheet] freeze mutation failed:', (e as Error)?.message);
      } finally {
        setBusy(false);
      }
    },
    [busy, onChange, t],
  );

  const counts = { held, equipped, maxEquipped };
  const armable = !busy && canArm(counts);
  const disarmable = !busy && canDisarm(counts);
  const reserve = reserveCount(counts);
  const slots = armedSlots(counts);
  const locked = lockedSlots(counts);

  return (
    <View
      style={StyleSheet.absoluteFillObject}
      pointerEvents={visible ? 'box-none' : 'none'}
    >
      {visible && (
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={s.scrim} />
        </TouchableWithoutFeedback>
      )}

      <Animated.View
        onLayout={onSheetLayout}
        style={[
          s.sheet,
          { paddingBottom: 22 + bottomOffset },
          { transform: [{ translateY: slideAnim }] },
        ]}
      >
        <View style={s.handle} />

        <View style={s.headerRow}>
          <Text style={s.eyebrow}>{t('practice:freezeSheet.title')}</Text>
          <Text style={s.reserve}>
            {t('practice:freezeSheet.reserve', { count: reserve })}
          </Text>
        </View>

        {/* The slots. Armed ones carry the frost shield; empty ones are a
            dashed outline, so "you could put one here" is legible without
            reading the buttons. */}
        <View style={s.slots}>
          {Array.from({ length: slots }, (_, i) => {
            const armed = i < equipped;
            return (
              <View key={i} style={[s.slot, armed ? s.slotArmed : s.slotEmpty]}>
                {armed ? <ShieldIcon size={30} animate={false} /> : null}
              </View>
            );
          })}

          {/* The slot this account does not have.
              Drawn rather than hidden, because the upsell only lands if the
              user can see the shape of what they are missing — and this is the
              one moment they are already thinking about protecting a streak,
              which is what makes it welcome here and an interruption anywhere
              else. It is a padlock, not a second shield: a greyed shield would
              read as a freeze the app had taken away. */}
          {Array.from({ length: locked }, (_, i) => (
            <TouchableOpacity
              key={`locked-${i}`}
              style={[s.slot, s.slotLocked]}
              onPress={onUpsell ? withTap(onUpsell) : undefined}
              disabled={!onUpsell}
              activeOpacity={0.6}
              accessibilityRole="button"
              accessibilityLabel={t('practice:freezeSheet.lockedA11y')}
            >
              <LockIcon size={18} color={tc.textFaint} />
            </TouchableOpacity>
          ))}

          <View style={s.slotsSpacer} />
          <View>
            <Text style={s.armedCount}>
              {equipped}/{slots}
            </Text>
            <Text style={s.armedLabel}>{t('practice:freezeSheet.armed')}</Text>
          </View>
        </View>

        <Text style={s.body}>
          {held === 0 ? t('practice:freezeSheet.empty') : t('practice:freezeSheet.body')}
        </Text>

        {/* One line, only for an account that has a locked slot. Says what the
            upgrade buys in the unit the sheet is already using — days covered,
            not a feature name. */}
        {locked > 0 ? (
          <TouchableOpacity
            onPress={onUpsell ? withTap(onUpsell) : undefined}
            disabled={!onUpsell}
            activeOpacity={0.6}
            accessibilityRole="button"
            accessibilityLabel={t('practice:freezeSheet.upsell')}
          >
            <Text style={s.upsell}>{t('practice:freezeSheet.upsell')}</Text>
          </TouchableOpacity>
        ) : null}

        <View style={s.actions}>
          <PressablePill
            edge={tc.border}
            radius={14}
            faceStyle={[s.btnFace, s.btnSecondary]}
            style={[s.btn, s.btnGap, !disarmable && s.btnOff]}
            disabled={!disarmable}
            onPress={withTap(() => void mutate('disarm'))}
            accessibilityRole="button"
            accessibilityState={{ disabled: !disarmable }}
            accessibilityLabel={t('practice:freezeSheet.disarm')}
          >
            <Text style={[s.btnText, s.btnTextSecondary]}>
              {t('practice:freezeSheet.disarm')}
            </Text>
          </PressablePill>

          <PressablePill
            edge={tc.goldDeep}
            radius={14}
            faceStyle={[s.btnFace, s.btnPrimary]}
            style={[s.btn, !armable && s.btnOff]}
            disabled={!armable}
            onPress={withTap(() => void mutate('arm'))}
            accessibilityRole="button"
            accessibilityState={{ disabled: !armable }}
            accessibilityLabel={t('practice:freezeSheet.arm')}
          >
            <Text style={[s.btnText, s.btnTextPrimary]}>
              {t('practice:freezeSheet.arm')}
            </Text>
          </PressablePill>
        </View>
      </Animated.View>
    </View>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    scrim: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: tc.scrim,
    },
    sheet: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: tc.paper,
      borderTopStartRadius: 22,
      borderTopEndRadius: 22,
      borderTopWidth: 1,
      borderColor: tc.border,
      paddingHorizontal: 20,
      paddingTop: 10,
    },
    handle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: tc.border,
      alignSelf: 'center',
      marginBottom: 14,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingBottom: 14,
    },
    eyebrow: {
      fontSize: 9.5,
      fontWeight: '800',
      letterSpacing: 1.2,
      color: tc.textFaint,
    },
    reserve: {
      fontSize: 11,
      fontWeight: '700',
      color: tc.textSecondary,
    },

    slots: { flexDirection: 'row', alignItems: 'center' },
    slot: {
      width: 52,
      height: 52,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      marginEnd: 10,
    },
    slotArmed: {
      backgroundColor: tc.goldWash,
      borderWidth: 1.5,
      borderColor: tc.goldOnSurface,
    },
    // Dashed, so an empty slot reads as a place something goes rather than as
    // a disabled control.
    slotEmpty: {
      borderWidth: 1.5,
      borderStyle: 'dashed',
      borderColor: tc.divider,
    },
    // Solid and flat, deliberately unlike `slotEmpty`: a dashed border says
    // "put one here", which is the opposite of what this slot means.
    slotLocked: {
      backgroundColor: tc.wordBoxBg,
      borderWidth: 1,
      borderColor: tc.border,
    },
    slotsSpacer: { flex: 1 },
    armedCount: {
      fontFamily: MONO_FAMILY,
      fontSize: 20,
      fontWeight: '900',
      color: tc.text,
      textAlign: alignEnd,
    },
    armedLabel: {
      fontSize: 9,
      fontWeight: '800',
      letterSpacing: 0.8,
      color: tc.textFaint,
      textAlign: alignEnd,
    },

    body: {
      fontSize: 13,
      lineHeight: 19,
      color: tc.textSecondary,
      paddingTop: 14,
      paddingBottom: 16,
    },

    upsell: {
      fontSize: 12.5,
      fontWeight: '700',
      color: tc.goldOnSurface,
      paddingBottom: 16,
    },

    actions: { flexDirection: 'row' },
    btn: { flex: 1 },
    // On the first button only — a trailing margin on the last one would pull
    // it off the sheet's right padding.
    btnGap: { marginEnd: 10 },
    btnFace: {
      borderRadius: 14,
      paddingVertical: 13,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
    },
    btnPrimary: { backgroundColor: tc.gold, borderColor: tc.gold },
    btnSecondary: { backgroundColor: tc.paper, borderColor: tc.border },
    // On the SLOT, not the face. Dimming only the face leaves the edge
    // beneath it at full strength, and a pale face over a solid edge is
    // exactly what this pill draws when it is PRESSED — so a disabled
    // button read as a held-down one. Face and edge fade together.
    btnOff: { opacity: 0.38 },
    btnText: { fontSize: 13, fontWeight: '800', letterSpacing: 0.3 },
    btnTextPrimary: { color: tc.goldDeep },
    btnTextSecondary: { color: tc.textSecondary },
  });
