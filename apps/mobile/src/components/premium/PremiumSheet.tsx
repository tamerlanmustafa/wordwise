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
 * ## Opening is the easy half; closing is where the bugs are
 *
 * Every exit runs through `dismiss()`: the scrim, the Later button, a
 * successful purchase, and the Android back button. Each one has to leave the
 * sheet in a state the NEXT open can trust, which is why:
 *
 *   * **The exit animation finishes before the content unmounts.** `rendered`
 *     is local state that goes false in the spring's completion callback, not
 *     when `visible` does. Unmounting on `visible` would make the sheet
 *     disappear instantly and the slide-down would never be seen.
 *   * **A purchase in flight cannot write to a closed sheet.** `liveRef` is
 *     cleared on the way out and checked after every await. Without it, a
 *     purchase that resolves after the user dismissed would set `busy`, or pop
 *     a success alert over a screen they had already moved on from.
 *   * **`plan` and `busy` reset on OPEN, not on close.** Resetting on close
 *     would rewrite the plan cards to the default while they are still sliding
 *     down, in full view.
 *   * **The scrim stops taking touches when hidden.** `pointerEvents` on the
 *     wrapper, not opacity alone: a transparent overlay still swallows every
 *     tap on the tab behind it, and the symptom — "the app froze" — points
 *     nowhere near this file.
 *
 * ## Motion
 *
 * Spring up, spring down, both on the native driver so the animation survives
 * a busy JS thread — this app has no Reanimated, so anything on the JS thread
 * stutters under exactly the render work an opening sheet causes. Reduce-motion
 * skips the travel and cross-fades instead, because the point of the setting is
 * vestibular comfort, not "no feedback".
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  BackHandler,
  Easing,
  ScrollView,
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
import { useBottomBarInset } from '../../hooks/useBottomBarInset';
import { withTap } from '../../utils/feedback';
import { PressablePill } from '../ui/PressablePill';
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

export function PremiumSheet() {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  const insets = useSafeAreaInsets();
  const barInset = useBottomBarInset();
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

  useEffect(() => {
    if (visible) {
      // Fresh open: reset the controls BEFORE the first painted frame, so the
      // sheet never slides up showing the previous session's selection.
      setRendered(true);
      setPlan('annual');
      setBusy(false);
      liveRef.current = true;
      anim.setValue(0);
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
  }, [visible, rendered, anim, reduceMotion]);

  const dismiss = useCallback(() => {
    liveRef.current = false;
    close();
  }, [close]);

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
  // A one-off purchase has no trial to start.
  const ctaKey =
    plan === 'lifetime' ? 'billing:paywall.buyLifetime' : 'billing:paywall.startTrial';
  const savings = annualSavingsPercent();
  const translateY = anim.interpolate({
    inputRange: [0, 1],
    // Reduce-motion still fades, but travels a token distance rather than the
    // full height — motion sensitivity is about large displacement.
    outputRange: [reduceMotion ? 24 : OFFSCREEN, 0],
  });

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents={visible ? 'auto' : 'none'}>
      <TouchableWithoutFeedback onPress={withTap(dismiss)} accessible={false}>
        <Animated.View style={[s.scrim, { opacity: anim }]} />
      </TouchableWithoutFeedback>

      <Animated.View
        style={[
          s.sheet,
          { maxHeight: `${86}%`, opacity: anim, transform: [{ translateY }] },
        ]}
        accessibilityViewIsModal
      >
        <View style={s.handle} />

        <ScrollView
          contentContainerStyle={[
            s.content,
            { paddingBottom: 20 + Math.max(barInset, insets.bottom) },
          ]}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <Text style={s.eyebrow}>{t('billing:paywall.title')}</Text>
          <Text style={s.hero}>{t('billing:paywall.heroTitle')}</Text>
          <Text style={s.sub}>{t(subtitle.key, subtitle.params)}</Text>

          <View style={s.features}>
            {PAYWALL_FEATURES.map((f) => (
              <View key={f.title} style={s.featureRow}>
                <View style={s.featureIcon}>
                  {f.icon === 'brain' ? <BrainIcon size={20} color={tc.gold} />
                    : f.icon === 'film' ? <FilmIcon size={20} color={tc.gold} />
                    : f.icon === 'shield' ? <ShieldIcon size={20} animate={false} />
                    : f.icon === 'block' ? <BlockIcon size={20} color={tc.gold} />
                    : <ChartIcon size={20} color={tc.gold} />}
                </View>
                <View style={s.featureText}>
                  <Text style={s.featureTitle}>{f.title}</Text>
                  <Text style={s.featureDesc}>{f.desc}</Text>
                </View>
              </View>
            ))}
          </View>

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
                  {/* Untranslated, exactly as `PaywallScreen` has them. The
                      plan names, the badge and the feature list are all
                      English on that screen, so translating only this one
                      would ship a half-localised pitch where the plan card
                      reads in Turkish and the benefit above it does not.
                      The paywall's i18n gap is real and pre-existing; closing
                      it belongs to both surfaces at once, not to this file. */}
                  <Text style={s.planName}>{p === 'annual' ? 'ANNUAL' : 'MONTHLY'}</Text>
                  <Text style={s.planPrice}>
                    {p === 'annual' ? ANNUAL_PRICE_LABEL : MONTHLY_PRICE_LABEL}
                  </Text>
                  <Text style={s.planCadence}>{p === 'annual' ? '/year' : '/month'}</Text>
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
            <Text style={[s.lifetimeText, plan === 'lifetime' && s.lifetimeTextOn]}>
              {t('billing:paywall.lifetimeOffer', { price: LIFETIME_PRICE_LABEL })}
            </Text>
          </TouchableOpacity>

          <PressablePill
            edge={tc.goldDeep}
            radius={16}
            faceStyle={[s.ctaFace, busy && s.ctaBusy]}
            style={s.cta}
            disabled={busy}
            onPress={withTap(() => void buy())}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            accessibilityLabel={t(ctaKey)}
          >
            <Text style={s.ctaText}>
              {busy ? t('billing:paywall.starting') : t(ctaKey)}
            </Text>
          </PressablePill>

          <View style={s.footer}>
            <TouchableOpacity
              onPress={withTap(() => void restore())}
              accessibilityRole="button"
              accessibilityLabel={t('billing:paywall.restore')}
            >
              <Text style={s.footerLink}>{t('billing:paywall.restore')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={withTap(dismiss)}
              accessibilityRole="button"
              accessibilityLabel={t('action.later')}
            >
              <Text style={s.footerLink}>{t('action.later')}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
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
      paddingTop: 10,
    },
    handle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: tc.border,
      alignSelf: 'center',
      marginBottom: 12,
    },
    content: { paddingHorizontal: 22 },

    eyebrow: {
      fontSize: 9.5,
      fontWeight: '800',
      letterSpacing: 1.2,
      color: tc.goldOnSurface,
      textAlign: 'center',
    },
    hero: {
      fontFamily: SERIF_FAMILY,
      fontSize: 26,
      lineHeight: 32,
      color: tc.text,
      textAlign: 'center',
      paddingTop: 8,
    },
    sub: {
      fontSize: 13.5,
      lineHeight: 19,
      color: tc.textSecondary,
      textAlign: 'center',
      paddingTop: 8,
      paddingBottom: 18,
    },

    features: { paddingBottom: 6 },
    featureRow: { flexDirection: 'row', alignItems: 'flex-start', paddingBottom: 14 },
    featureIcon: { width: 30, paddingTop: 1 },
    featureText: { flex: 1 },
    featureTitle: { fontSize: 14, fontWeight: '800', color: tc.text },
    featureDesc: { fontSize: 12.5, lineHeight: 17, color: tc.textSecondary, paddingTop: 2 },

    plans: { flexDirection: 'row', paddingTop: 8, paddingBottom: 16 },
    plan: {
      flex: 1,
      borderRadius: 16,
      borderWidth: 1.5,
      borderColor: tc.border,
      backgroundColor: tc.paper,
      paddingVertical: 16,
      paddingHorizontal: 12,
      alignItems: 'center',
      marginEnd: 10,
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
    planName: {
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 0.8,
      color: tc.textFaint,
      paddingBottom: 4,
    },
    planPrice: { fontFamily: SERIF_FAMILY, fontSize: 21, color: tc.text },
    planCadence: { fontSize: 11, color: tc.textFaint, paddingTop: 1 },
    radio: {
      width: 18,
      height: 18,
      borderRadius: 9,
      borderWidth: 1.5,
      borderColor: tc.border,
      marginTop: 10,
    },
    radioOn: { backgroundColor: tc.gold, borderColor: tc.gold },

    lifetime: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: tc.border,
      paddingVertical: 11,
      alignItems: 'center',
      marginBottom: 14,
    },
    lifetimeOn: { borderColor: tc.gold, backgroundColor: tc.goldWash },
    lifetimeText: { fontSize: 12.5, fontWeight: '700', color: tc.textSecondary },
    lifetimeTextOn: { color: tc.text },

    cta: { marginBottom: 14 },
    ctaFace: {
      borderRadius: 16,
      backgroundColor: tc.gold,
      paddingVertical: 16,
      alignItems: 'center',
    },
    ctaBusy: { opacity: 0.6 },
    ctaText: { fontSize: 15, fontWeight: '900', color: tc.goldDeep },

    footer: { flexDirection: 'row', justifyContent: 'space-between' },
    footerLink: { fontSize: 12.5, fontWeight: '700', color: tc.textFaint },
  });
