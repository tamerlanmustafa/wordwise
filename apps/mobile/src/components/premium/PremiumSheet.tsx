/**
 * PremiumSheet — the universal "subscribe to Plus" invite.
 *
 * Mounted ONCE at the app root beside `ConfirmDialog`, driven by
 * `premiumSheetStore`. Anything that wants to ask calls `openPremiumSheet()`;
 * nothing imports this file except the root.
 *
 * It reuses `PAYWALL_FEATURES`, `paywallSubtitle`, the price labels and
 * `services/billing` — the same feature list, the same copy rules and the same
 * purchase path as `PaywallScreen`. A second checkout would be a second place
 * for receipts, restores and trial eligibility to drift.
 *
 * ## It does not scroll
 *
 * The whole pitch fits on the smallest phones we ship to: every block states
 * its height in `premiumSheetMetrics`, and a test holds the sum against real
 * screens. It used to scroll. Each feature carried a line of description, and
 * the bottom was padded by the tab bar's height for a bar this sheet is drawn
 * over, so on an iPhone SE the plans, the buy button and the way out all sat
 * below the fold. `PaywallScreen` is a full page and keeps the descriptions;
 * the sheet shows each feature as its title.
 *
 * Not scrolling is also what lets the whole sheet be the drag handle. There is
 * no scroll view inside it to fight a downward pull.
 *
 * Only the three full-width blocks whose length depends on the language — the
 * headline, the subtitle and the renewal terms — shrink to fit. The short
 * labels inside the cards and buttons do not: on a 3x iPhone, `/year` inside a
 * centred plan card shrank to about 5pt while the same card looked right on a
 * 2x SE.
 *
 * ## Opening is the easy half; closing is where the bugs are
 *
 * Every exit runs through `dismiss()`: the scrim, a pull down, the Later
 * button, a successful purchase, VoiceOver's escape gesture and the Android
 * back button. Each one has to leave the sheet in a state the NEXT open can
 * trust, which is why:
 *
 *   * **The exit animation finishes before the content unmounts.** `rendered`
 *     is local state that goes false in the spring's completion callback, not
 *     when `visible` does. Unmounting on `visible` would make the sheet
 *     disappear instantly and the slide-down would never be seen.
 *   * **A purchase in flight cannot write to a closed sheet.** `liveRef` is
 *     cleared on the way out and checked after every await. Without it, a
 *     purchase that resolves after the user dismissed would set `busy`, or pop
 *     a success alert over a screen they had already moved on from.
 *   * **`plan`, `busy` and the pull reset on OPEN, not on close.** Resetting
 *     on close would rewrite the plan cards to the default while they are
 *     still sliding down, in full view, and would snap a sheet pulled halfway
 *     down back to the top on its way out.
 *   * **The scrim stops taking touches when hidden.** `pointerEvents` on the
 *     wrapper, not opacity alone: a transparent overlay still swallows every
 *     tap on the tab behind it, and the symptom — "the app froze" — points
 *     nowhere near this file.
 *
 * ## Pulling it closed
 *
 * The sheet follows the finger down and resists going up. Letting go past a
 * quarter of its height (at most 120pt), or flicking down, closes it; anything
 * else springs back. The thresholds are pure and live in `utils/sheetDismiss`,
 * the arrangement the toast's swipe uses.
 *
 * The drag is claimed in the capture phase, so a pull that starts on a plan
 * card or on the buy button still moves the sheet, and cancels that press: a
 * pull is not a choice of plan. A tap does not travel, so it still reaches the
 * button.
 *
 * A pull does not buzz. The finger was on the glass the whole way, and the
 * toast's swipe-away is silent for the same reason; the tap exits keep theirs.
 *
 * ## Motion
 *
 * Spring up, spring down, both on the native driver so the animation survives
 * a busy JS thread — this app has no Reanimated, so anything on the JS thread
 * stutters under exactly the render work an opening sheet causes. The pull is
 * a second value added to that travel, so a drag during the entrance never
 * fights the spring. Reduce-motion skips the travel and cross-fades instead,
 * because the point of the setting is vestibular comfort, not "no feedback".
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  BackHandler,
  Easing,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePremiumSheetStore } from '../../stores/premiumSheetStore';
import { useIsPremium } from '../../stores/entitlementsStore';
import { purchaseProduct, restorePurchases, PRODUCTS } from '../../services/billing';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { SERIF_FAMILY } from '../../theme/fonts';
import { directionSign } from '../../i18n/rtl';
import { withTap } from '../../utils/feedback';
import {
  sheetDismissOnRelease,
  sheetDragOffset,
  shouldClaimSheetDrag,
} from '../../utils/sheetDismiss';
import { PressablePill } from '../ui/PressablePill';
import { PREMIUM_SHEET } from './premiumSheetMetrics';
import {
  PAYWALL_FEATURES,
  annualSavingsPercent,
  paywallSubtitle,
  MONTHLY_PRICE_LABEL,
  ANNUAL_PRICE_LABEL,
  LIFETIME_PRICE_LABEL,
} from '../paywallPricing';
import {
  BlockIcon,
  BrainIcon,
  ChartIcon,
  FilmIcon,
  ShieldIcon,
  useReduceMotion,
} from '../ui/icons';

/** `lifetime` is a non-consumable, not a subscription — no renewal and no
 *  trial, which is why the CTA below changes label when it is selected.
 *  Offering "Start 7-day free trial" on a one-off purchase would be a lie the
 *  store itself would then contradict. */
type Plan = 'annual' | 'monthly' | 'lifetime';

/** Where the sheet starts and returns to. Larger than any phone, so the
 *  first frame is off-screen even before layout has reported a height. */
const OFFSCREEN = 1000;

/** The footer links are one short line of small text; this is their tap area. */
const FOOTER_HIT = { top: 10, bottom: 10, left: 10, right: 10 };

export function PremiumSheet() {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();

  const visible = usePremiumSheetStore((st) => st.visible);
  const reason = usePremiumSheetStore((st) => st.reason);
  const close = usePremiumSheetStore((st) => st.close);
  const isPremium = useIsPremium();

  /** Is anything painted? Trails `visible` on the way down by one animation,
   *  so the exit is seen rather than skipped. */
  const [rendered, setRendered] = useState(false);
  const [plan, setPlan] = useState<Plan>('annual');
  const [busy, setBusy] = useState(false);

  /** False the moment the sheet starts closing. Every async continuation
   *  checks it before touching state — see the docblock. */
  const liveRef = useRef(false);

  const anim = useRef(new Animated.Value(0)).current;
  /** The pull, added to the open/close travel rather than written into it. */
  const drag = useRef(new Animated.Value(0)).current;
  /** Measured on layout, for the release threshold. Zero until then. */
  const sheetHeight = useRef(0);

  useEffect(() => {
    if (visible) {
      // Fresh open: reset the controls BEFORE the first painted frame, so the
      // sheet never slides up showing the previous session's selection — or
      // sitting where the last pull left it.
      setRendered(true);
      setPlan('annual');
      setBusy(false);
      liveRef.current = true;
      anim.setValue(0);
      drag.setValue(0);
      Animated.spring(anim, {
        toValue: 1,
        useNativeDriver: true,
        bounciness: 0,
        speed: 14,
      }).start();
      return;
    }

    liveRef.current = false;
    if (!rendered) return;
    Animated.timing(anim, {
      toValue: 0,
      duration: reduceMotion ? 120 : 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      // Only tear down if the animation actually completed. A re-open mid-exit
      // interrupts this one, and unmounting then would blank a sheet the user
      // just asked for.
      if (finished) setRendered(false);
    });
  }, [visible, rendered, anim, drag, reduceMotion]);

  const dismiss = useCallback(() => {
    liveRef.current = false;
    close();
  }, [close]);

  /** A pull that did not close: back to rest. */
  const settle = useCallback(() => {
    if (reduceMotion) {
      Animated.timing(drag, { toValue: 0, duration: 120, useNativeDriver: true }).start();
      return;
    }
    Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 0, speed: 20 }).start();
  }, [drag, reduceMotion]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Logical dx, as every gesture in the app reads it. The claim only
        // compares its size against dy, so the mirroring never changes the
        // answer — but a raw dx here is the shape the RTL guard exists to catch.
        onMoveShouldSetPanResponder: (_e, g) => shouldClaimSheetDrag(g.dx * directionSign, g.dy),
        onMoveShouldSetPanResponderCapture: (_e, g) =>
          shouldClaimSheetDrag(g.dx * directionSign, g.dy),
        // Once the sheet has the drag, a button under the finger cannot take it back.
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_e, g) => {
          drag.setValue(sheetDragOffset(g.dy));
        },
        onPanResponderRelease: (_e, g) => {
          if (sheetDismissOnRelease(g.dy, g.vy, sheetHeight.current)) {
            // The exit starts from wherever the finger let go: `drag` holds
            // its offset and the close travel adds to it.
            dismiss();
            return;
          }
          settle();
        },
        onPanResponderTerminate: () => settle(),
      }),
    [drag, dismiss, settle],
  );

  // Android's back button is an exit like any other, and one that is easy to
  // forget: without this it would pop the screen BEHIND the sheet, leaving the
  // sheet floating over a tab the user never chose.
  useEffect(() => {
    if (!rendered) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      dismiss();
      return true;
    });
    return () => sub.remove();
  }, [rendered, dismiss]);

  // Someone who subscribed while the sheet was open — on another device, or
  // through the restore link — should not be left looking at a pitch for
  // something they now own.
  useEffect(() => {
    if (rendered && isPremium) dismiss();
  }, [rendered, isPremium, dismiss]);

  const buy = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const product =
        plan === 'lifetime' ? PRODUCTS.LIFETIME
          : plan === 'annual' ? PRODUCTS.ANNUAL
          : PRODUCTS.MONTHLY;
      const success = await purchaseProduct(product);
      // The store sheet is native and can sit open for minutes. By the time it
      // resolves the user may have dismissed this one entirely.
      if (!liveRef.current) return;
      if (success) {
        Alert.alert(t('billing:paywall.welcomeTitle'), t('billing:paywall.welcomeBody'));
        dismiss();
      }
    } finally {
      if (liveRef.current) setBusy(false);
    }
  }, [busy, plan, t, dismiss]);

  const restore = useCallback(async () => {
    const result = await restorePurchases();
    if (!liveRef.current) return;
    Alert.alert(
      result.restored
        ? t('billing:paywall.restoredTitle')
        : t('billing:paywall.notFoundTitle'),
      result.message,
    );
    if (result.restored) dismiss();
  }, [t, dismiss]);

  if (!rendered) return null;

  const subtitle = paywallSubtitle(reason, 0, 0);
  // The trial belongs to the MONTHLY plan now, so the button has to say three
  // different things. A single "Start 7-day free trial" across all three was a
  // promise two of them do not keep — the store would have contradicted it at
  // checkout, which is the worst possible place to be caught out.
  const ctaKey =
    plan === 'lifetime' ? 'billing:paywall.buyLifetime'
      : plan === 'monthly' ? 'billing:paywall.startTrial'
      : 'billing:paywall.getPlus';
  const hint =
    plan === 'lifetime'
      ? t('billing:paywall.lifetimeHint')
      : plan === 'monthly'
        ? t('billing:paywall.hintTrial', { price: MONTHLY_PRICE_LABEL })
        : t('billing:paywall.hintAnnual', { price: ANNUAL_PRICE_LABEL });
  const savings = annualSavingsPercent();
  const translateY = Animated.add(
    anim.interpolate({
      inputRange: [0, 1],
      // Reduce-motion still fades, but travels a token distance rather than the
      // full height — motion sensitivity is about large displacement.
      outputRange: [reduceMotion ? 24 : OFFSCREEN, 0],
    }),
    drag,
  );

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents={visible ? 'auto' : 'none'}>
      <TouchableWithoutFeedback onPress={withTap(dismiss)} accessible={false}>
        <Animated.View style={[s.scrim, { opacity: anim }]} />
      </TouchableWithoutFeedback>

      <Animated.View
        style={[
          s.sheet,
          // Only the safe area. The tab bar is behind this sheet, so reserving
          // its height here was blank space under the footer.
          {
            paddingBottom: PREMIUM_SHEET.padBottom + insets.bottom,
            opacity: anim,
            transform: [{ translateY }],
          },
        ]}
        accessibilityViewIsModal
        // VoiceOver's two-finger scrub: the pull, for someone who cannot see
        // the grabber.
        onAccessibilityEscape={dismiss}
        onLayout={(e) => {
          sheetHeight.current = e.nativeEvent.layout.height;
        }}
        {...pan.panHandlers}
      >
        <View style={s.handle} />

        <Text style={s.eyebrow} numberOfLines={1}>
          {t('billing:paywall.title')}
        </Text>
        <Text
          style={s.hero}
          numberOfLines={PREMIUM_SHEET.hero.lines}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
        >
          {t('billing:paywall.heroTitle')}
        </Text>
        <Text
          style={s.sub}
          numberOfLines={PREMIUM_SHEET.sub.lines}
          adjustsFontSizeToFit
          minimumFontScale={0.75}
        >
          {t(subtitle.key, subtitle.params)}
        </Text>

        <View style={s.plans}>
          {(['annual', 'monthly'] as const).map((p) => {
            const active = plan === p;
            return (
              <TouchableOpacity
                key={p}
                style={[s.plan, active && s.planActive]}
                onPress={withTap(() => setPlan(p))}
                activeOpacity={0.85}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={p === 'annual' ? ANNUAL_PRICE_LABEL : MONTHLY_PRICE_LABEL}
              >
                {p === 'annual' && savings > 0 ? (
                  <View style={s.saveBadge}>
                    <Text style={s.saveText}>{`SAVE ${savings}%`}</Text>
                  </View>
                ) : null}
                {/* The trial rides on monthly, in the same badge slot the
                    annual card uses for its discount — so both cards lead
                    with their own reason to be picked, and neither has to
                    be read to find one. */}
                {p === 'monthly' ? (
                  <View style={[s.saveBadge, s.trialBadge]}>
                    <Text style={[s.saveText, s.trialText]} numberOfLines={1}>
                      {t('billing:paywall.trialBadge')}
                    </Text>
                  </View>
                ) : null}
                {/* Untranslated, exactly as `PaywallScreen` has them. The
                    plan names, the badge and the feature list are all
                    English on that screen, so translating only this one
                    would ship a half-localised pitch where the plan card
                    reads in Turkish and the benefit above it does not.
                    The paywall's i18n gap is real and pre-existing; closing
                    it belongs to both surfaces at once, not to this file. */}
                <Text style={s.planName}>{p === 'annual' ? 'ANNUAL' : 'MONTHLY'}</Text>
                <Text style={s.planPrice} numberOfLines={1}>
                  {p === 'annual' ? ANNUAL_PRICE_LABEL : t('billing:paywall.free')}
                </Text>
                <Text style={s.planCadence} numberOfLines={1}>
                  {p === 'annual'
                    ? '/year'
                    : t('billing:paywall.afterTrial', { price: MONTHLY_PRICE_LABEL })}
                </Text>
                <View style={[s.radio, active && s.radioOn]} />
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Deliberately NOT a third card. Three equal options turn a simple
            "yearly or monthly" into a comparison exercise, and the people who
            want this one are looking for it rather than weighing it. A quiet
            row keeps the default decision two-way and still gives the
            no-subscriptions segment somewhere to go. */}
        <TouchableOpacity
          style={[s.lifetime, plan === 'lifetime' && s.lifetimeOn]}
          onPress={withTap(() => setPlan(plan === 'lifetime' ? 'annual' : 'lifetime'))}
          activeOpacity={0.75}
          accessibilityRole="radio"
          accessibilityState={{ selected: plan === 'lifetime' }}
          accessibilityLabel={t('billing:paywall.lifetimeOffer', { price: LIFETIME_PRICE_LABEL })}
        >
          <Text style={[s.lifetimeText, plan === 'lifetime' && s.lifetimeTextOn]} numberOfLines={1}>
            {t('billing:paywall.lifetimeOffer', { price: LIFETIME_PRICE_LABEL })}
          </Text>
        </TouchableOpacity>

        <PressablePill
          edge={tc.goldDeep}
          radius={16}
          edgeDepth={PREMIUM_SHEET.cta.edge}
          faceStyle={[s.ctaFace, busy && s.ctaBusy]}
          style={s.cta}
          disabled={busy}
          onPress={withTap(() => void buy())}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          accessibilityLabel={t(ctaKey)}
        >
          <Text style={s.ctaText} numberOfLines={1}>
            {busy ? t('billing:paywall.starting') : t(ctaKey)}
          </Text>
        </PressablePill>

        <View style={s.hintBox}>
          <Text
            style={s.hint}
            numberOfLines={PREMIUM_SHEET.hint.lines}
            adjustsFontSizeToFit
            minimumFontScale={0.85}
          >
            {hint}
          </Text>
        </View>

        <View style={s.features}>
          {PAYWALL_FEATURES.map((f) => (
            <View key={f.title} style={s.featureRow}>
              <View style={s.featureIcon}>
                {f.icon === 'brain' ? <BrainIcon size={16} color={tc.gold} />
                  : f.icon === 'film' ? <FilmIcon size={16} color={tc.gold} />
                  : f.icon === 'shield' ? <ShieldIcon size={16} animate={false} />
                  : f.icon === 'block' ? <BlockIcon size={16} color={tc.gold} />
                  : <ChartIcon size={16} color={tc.gold} />}
              </View>
              <Text style={s.featureTitle} numberOfLines={1}>
                {f.title}
              </Text>
            </View>
          ))}
        </View>

        <View style={s.footer}>
          <TouchableOpacity
            onPress={withTap(() => void restore())}
            hitSlop={FOOTER_HIT}
            accessibilityRole="button"
            accessibilityLabel={t('billing:paywall.restore')}
          >
            <Text style={s.footerLink} numberOfLines={1}>
              {t('billing:paywall.restore')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={withTap(dismiss)}
            hitSlop={FOOTER_HIT}
            accessibilityRole="button"
            accessibilityLabel={t('action.later')}
          >
            <Text style={s.footerLink} numberOfLines={1}>
              {t('action.later')}
            </Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: tc.scrim },
    sheet: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: tc.paper,
      borderTopStartRadius: 24,
      borderTopEndRadius: 24,
      borderTopWidth: 1,
      borderColor: tc.border,
      paddingTop: PREMIUM_SHEET.padTop,
      paddingHorizontal: 22,
    },
    handle: {
      width: 40,
      height: PREMIUM_SHEET.grabber.height,
      borderRadius: 2,
      backgroundColor: tc.border,
      alignSelf: 'center',
      marginBottom: PREMIUM_SHEET.grabber.gap,
    },

    eyebrow: {
      fontSize: 9.5,
      lineHeight: PREMIUM_SHEET.eyebrow.line,
      fontWeight: '800',
      letterSpacing: 1.2,
      color: tc.goldOnSurface,
      textAlign: 'center',
    },
    hero: {
      fontFamily: SERIF_FAMILY,
      fontSize: PREMIUM_SHEET.hero.size,
      lineHeight: PREMIUM_SHEET.hero.line,
      color: tc.text,
      textAlign: 'center',
      marginTop: PREMIUM_SHEET.hero.gap,
    },
    sub: {
      fontSize: PREMIUM_SHEET.sub.size,
      lineHeight: PREMIUM_SHEET.sub.line,
      color: tc.textSecondary,
      textAlign: 'center',
      marginTop: PREMIUM_SHEET.sub.gap,
    },

    // `gap` rather than a margin on each card: a trailing margin on both left
    // the pair 10pt short of the sheet's right edge.
    plans: { flexDirection: 'row', gap: 10, marginTop: PREMIUM_SHEET.plans.gap },
    plan: {
      flex: 1,
      height: PREMIUM_SHEET.plans.height,
      borderRadius: 16,
      borderWidth: 1.5,
      borderColor: tc.border,
      backgroundColor: tc.paper,
      paddingHorizontal: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    planActive: { borderColor: tc.gold, backgroundColor: tc.goldWash },
    saveBadge: {
      position: 'absolute',
      top: -10,
      backgroundColor: tc.gold,
      borderRadius: 9,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    saveText: { fontSize: 9, fontWeight: '900', letterSpacing: 0.5, color: tc.goldDeep },
    // The trial badge is the same shape as the savings badge but reads as a
    // gift rather than a discount, so it takes the surface colour rather than
    // the gold one — two identical gold pills side by side would compete.
    trialBadge: { backgroundColor: tc.text },
    trialText: { color: tc.paper },
    planName: {
      fontSize: 10,
      lineHeight: 12,
      fontWeight: '800',
      letterSpacing: 0.8,
      color: tc.textFaint,
    },
    planPrice: {
      fontFamily: SERIF_FAMILY,
      fontSize: 20,
      lineHeight: 25,
      color: tc.text,
      marginTop: 3,
    },
    planCadence: { fontSize: 11, lineHeight: 14, color: tc.textFaint },
    radio: {
      width: 16,
      height: 16,
      borderRadius: 8,
      borderWidth: 1.5,
      borderColor: tc.border,
      marginTop: 7,
    },
    radioOn: { backgroundColor: tc.gold, borderColor: tc.gold },

    lifetime: {
      height: PREMIUM_SHEET.lifetime.height,
      marginTop: PREMIUM_SHEET.lifetime.gap,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: tc.border,
      paddingHorizontal: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    lifetimeOn: { borderColor: tc.gold, backgroundColor: tc.goldWash },
    lifetimeText: { fontSize: 12.5, lineHeight: 16, fontWeight: '700', color: tc.textSecondary },
    lifetimeTextOn: { color: tc.text },

    cta: { marginTop: PREMIUM_SHEET.cta.gap },
    ctaFace: {
      height: PREMIUM_SHEET.cta.height,
      borderRadius: 16,
      backgroundColor: tc.gold,
      paddingHorizontal: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ctaBusy: { opacity: 0.6 },
    ctaText: { fontSize: 15, lineHeight: 18, fontWeight: '900', color: tc.goldDeep },

    hintBox: {
      height: PREMIUM_SHEET.hint.line * PREMIUM_SHEET.hint.lines,
      marginTop: PREMIUM_SHEET.hint.gap,
      justifyContent: 'center',
    },
    hint: {
      fontSize: 11.5,
      lineHeight: PREMIUM_SHEET.hint.line,
      color: tc.textFaint,
      textAlign: 'center',
    },

    features: { marginTop: PREMIUM_SHEET.features.gap },
    featureRow: {
      height: PREMIUM_SHEET.features.row,
      flexDirection: 'row',
      alignItems: 'center',
    },
    featureIcon: { width: 26 },
    featureTitle: { flex: 1, fontSize: 13, fontWeight: '800', color: tc.text },

    footer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: PREMIUM_SHEET.footer.gap,
    },
    footerLink: {
      fontSize: 12.5,
      lineHeight: PREMIUM_SHEET.footer.line,
      fontWeight: '700',
      color: tc.textFaint,
    },
  });
