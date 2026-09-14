/**
 * PaywallScreen — WordWise Plus upgrade (States §D). Premium feature list,
 * selectable annual (with a computed "SAVE N%" badge) vs monthly plan cards,
 * a "Start 7-day free trial" CTA and a restore link.
 *
 * Migrated off the hard-coded COLORS snapshot onto useThemeColors/makeStyles.
 * Purchases go through the existing billing service; premium state is read from
 * entitlementsStore (useIsPremium) — no new purchase path is invented.
 */

import { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { TopInsetView } from './common/TopInsetView';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { purchaseProduct, restorePurchases, PRODUCTS } from '../services/billing';
import { useIsPremium } from '../stores/entitlementsStore';
import { useThemeColors, type ThemeColors } from '../theme/tokens';
import { SERIF_FAMILY } from '../theme/fonts';
import { PressableScale } from './ui/PressableScale';
import {
  PAYWALL_FEATURES,
  annualSavingsPercent,
  paywallSubtitle,
  MONTHLY_PRICE_LABEL,
  ANNUAL_PRICE_LABEL,
  LIFETIME_PRICE_LABEL,
  type PaywallReason,
} from './paywallPricing';
import { directionalIcon } from '../i18n/rtl';
import { BlockIcon, BrainIcon, ChartIcon, FilmIcon, ShieldIcon } from './ui/icons';
import { useBottomBarInset } from '../hooks/useBottomBarInset';
import { useAuthStore } from '../stores/authStore';

export interface PaywallScreenProps {
  onBack: () => void;
  previewsUsed: number;
  previewsLimit: number;
  /** Why the screen opened. `/srs/session/start` 402s for two different
   *  reasons and they need different copy — the subtitle used to be a
   *  single hard-coded sentence about the legacy preview budget, which the
   *  daily-cap path renders as "You've used 0 of 0 free review sessions"
   *  because that payload carries no counts. Optional: the entry points
   *  that just browse the upgrade pass nothing. */
  reason?: PaywallReason;
}

/** `lifetime` is a non-consumable: no renewal, and therefore no trial — which
 *  is why the CTA changes label when it is picked. */
type Plan = 'annual' | 'monthly' | 'lifetime';

export function PaywallScreen({ onBack, previewsUsed, previewsLimit, reason = null }: PaywallScreenProps) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  const isPremium = useIsPremium();
  const [plan, setPlan] = useState<Plan>('annual');
  const [busy, setBusy] = useState(false);
  const savings = annualSavingsPercent();
  const subtitle = paywallSubtitle(reason, previewsUsed, previewsLimit);
  // The trial belongs to MONTHLY now, so one label across all three plans
  // would be a promise two of them do not keep.
  const ctaKey =
    plan === 'lifetime' ? 'billing:paywall.buyLifetime'
      : plan === 'monthly' ? 'billing:paywall.startTrial'
      : 'billing:paywall.getPlus';
  const barInset = useBottomBarInset();

  const buy = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const product =
        plan === 'lifetime' ? PRODUCTS.LIFETIME
          : plan === 'annual' ? PRODUCTS.ANNUAL
          : PRODUCTS.MONTHLY;
      const success = await purchaseProduct(product);
      if (success) {
        Alert.alert(t('billing:paywall.welcomeTitle'), t('billing:paywall.welcomeBody'));
        onBack();
      }
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    const result = await restorePurchases();
    if (result.restored) await useAuthStore.getState().refreshUser();
    Alert.alert(
      result.restored ? t('billing:paywall.restoredTitle') : t('billing:paywall.notFoundTitle'),
      // The key, not the English `message` — the same fix Account got. This
      // screen had its own copy of the old call and kept printing English
      // under a translated title.
      result.messageKey ? t(result.messageKey) : result.message,
    );
    if (result.restored) onBack();
  };

  return (
    <TopInsetView style={s.container}>
      <View style={s.header}>
        <PressableScale onPress={onBack} accessibilityRole="button" accessibilityLabel={t('action.back')}>
          <Ionicons name={directionalIcon('chevron-back')} size={22} color={tc.text} />
        </PressableScale>
        <Text style={s.headerTitle}>{t('billing:paywall.title')}</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={[
          s.content,
          // With the buy footer on screen, the footer is what sits above the
          // bar — so the scroll only needs its own breathing room. Without it
          // (a Plus account sees "Done" in the scroll instead) the scroll is
          // the last thing above the bar and has to reserve it itself.
          { paddingBottom: isPremium ? barInset + 24 : 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={s.heroTitle}>{t('billing:paywall.heroTitle')}</Text>
        {isPremium ? (
          <Text style={s.heroSub}>{t('billing:paywall.alreadyPlus')}</Text>
        ) : (
          <Text style={s.heroSub}>{t(subtitle.key, subtitle.params)}</Text>
        )}

        {/* Plans before features, the same order as PremiumSheet. The choice is
            what this screen is for, and with the buy button pinned in the
            footer, plans placed under a five-row feature list rested cut in half
            by it — the button visible, the thing it buys not. */}
        {!isPremium ? (
          <>
            {/* No `withTap` on these. PressableScale fires its own haptic on
                press-in, so wrapping the handler as well was two buzzes per
                press — the double-wrap CLAUDE.md warns about, on the panel
                people touch most before paying. */}
            <View style={s.plans}>
              <PlanCard
                tc={tc}
                selected={plan === 'annual'}
                onPress={() => setPlan('annual')}
                title="Annual"
                price={ANNUAL_PRICE_LABEL}
                cadence="/year"
                badge={`SAVE ${savings}%`}
              />
              <PlanCard
                tc={tc}
                selected={plan === 'monthly'}
                onPress={() => setPlan('monthly')}
                title="Monthly"
                price={t('billing:paywall.free')}
                cadence={t('billing:paywall.afterTrial', { price: MONTHLY_PRICE_LABEL })}
                badge={t('billing:paywall.trialBadge')}
                badgeTone="trial"
              />
            </View>

            {/* Not a third card — see PremiumSheet for the reasoning. The two
                surfaces have to offer the same prices in the same shape, or
                the one a user happens to reach decides what they pay. */}
            <PressableScale
              style={[s.lifetimeRow, plan === 'lifetime' && s.lifetimeRowOn]}
              onPress={() => setPlan(plan === 'lifetime' ? 'annual' : 'lifetime')}
              accessibilityRole="button"
              accessibilityLabel={t('billing:paywall.lifetimeOffer', { price: LIFETIME_PRICE_LABEL })}
            >
              <Text style={[s.lifetimeRowText, plan === 'lifetime' && s.lifetimeRowTextOn]}>
                {t('billing:paywall.lifetimeOffer', { price: LIFETIME_PRICE_LABEL })}
              </Text>
            </PressableScale>
          </>
        ) : null}

        <View style={s.featureList}>
          {PAYWALL_FEATURES.map((f) => (
            <View key={f.title} style={s.featureRow}>
              <View style={s.featureIcon}>
                {f.icon === 'brain' ? <BrainIcon size={22} color={tc.gold} />
                  : f.icon === 'film' ? <FilmIcon size={22} color={tc.gold} />
                  : f.icon === 'shield' ? <ShieldIcon size={22} animate={false} />
                  : f.icon === 'block' ? <BlockIcon size={22} color={tc.gold} />
                  : <ChartIcon size={22} color={tc.gold} />}
              </View>
              <View style={s.featureText}>
                <Text style={s.featureTitle}>{f.title}</Text>
                <Text style={s.featureDesc}>{f.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        {isPremium ? (
          <PressableScale style={s.manageBtn} onPress={onBack} accessibilityRole="button" accessibilityLabel={t('action.done')}>
            <Text style={s.manageBtnText}>{t('action.done')}</Text>
          </PressableScale>
        ) : (
          <PressableScale style={s.restoreBtn} onPress={restore} accessibilityRole="button" accessibilityLabel={t('billing:paywall.restore')}>
            <Text style={s.restoreBtnText}>{t('billing:paywall.restore')}</Text>
          </PressableScale>
        )}
      </ScrollView>

      {/* The buy button, pinned ABOVE the bottom bar.

          It used to be the last thing in the scroll. The scroll did reserve the
          bar's height, which is the rule the rest of the app follows — but that
          rule only guarantees the LAST element can be scrolled clear. At rest
          the plans filled the screen and "Get Plus" sat underneath the
          translucent capsule: the most important control on a screen whose
          only job is to be pressed, drawn behind the tab bar.

          A sibling below the ScrollView rather than an absolute overlay, so
          nothing has to be measured: layout itself places it above the bar's
          reserved height, and the ScrollView shrinks to what is left. The
          price hint travels with it because the trial terms have to be read
          next to the button that starts the trial. */}
      {!isPremium ? (
        <View style={[s.footer, { paddingBottom: barInset }]}>
          <PressableScale
            style={[s.trialBtn, busy && { opacity: 0.6 }]}
            onPress={buy}
            accessibilityRole="button"
            accessibilityLabel={t(ctaKey)}
          >
            <Text style={s.trialBtnText}>{busy ? t('billing:paywall.starting') : t(ctaKey)}</Text>
          </PressableScale>
          <Text style={s.priceHint}>
            {plan === 'lifetime'
              ? t('billing:paywall.lifetimeHint')
              : plan === 'monthly'
                ? t('billing:paywall.hintTrial', { price: MONTHLY_PRICE_LABEL })
                : t('billing:paywall.hintAnnual', { price: ANNUAL_PRICE_LABEL })}
          </Text>
        </View>
      ) : null}
    </TopInsetView>
  );
}

function PlanCard({
  tc,
  selected,
  onPress,
  title,
  price,
  cadence,
  badge,
  badgeTone = 'save',
}: {
  tc: ThemeColors;
  selected: boolean;
  onPress: () => void;
  title: string;
  price: string;
  cadence: string;
  badge?: string;
  /** Paints the badge as an offer rather than a discount. Two identical gold
   *  pills side by side would compete; the trial is a gift, not a saving. */
  badgeTone?: 'save' | 'trial';
}) {
  const s = useMemo(() => makeStyles(tc), [tc]);
  return (
    <PressableScale
      style={[s.planCard, { borderColor: selected ? tc.gold : tc.border, backgroundColor: selected ? tc.goldWash : tc.paper }]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${title} ${price} ${cadence}`}
    >
      {badge ? (
        <View style={[s.planBadge, badgeTone === 'trial' && s.planBadgeTrial]}>
          <Text style={[s.planBadgeText, badgeTone === 'trial' && s.planBadgeTextTrial]}>
            {badge}
          </Text>
        </View>
      ) : null}
      <Text style={s.planTitle}>{title}</Text>
      <Text style={s.planPrice}>{price}</Text>
      <Text style={s.planCadence}>{cadence}</Text>
      <View style={[s.planRadio, { borderColor: selected ? tc.gold : tc.border, backgroundColor: selected ? tc.gold : 'transparent' }]}>
        {selected ? <Ionicons name="checkmark" size={12} color={tc.goldDeep} /> : null}
      </View>
    </PressableScale>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: tc.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      backgroundColor: tc.paper,
      borderBottomWidth: 1,
      borderBottomColor: tc.border,
    },
    headerTitle: { fontSize: 16, fontWeight: '700', color: tc.text },
    content: { paddingHorizontal: 24, paddingTop: 28, paddingBottom: 28 },
    heroTitle: { fontFamily: SERIF_FAMILY, fontSize: 28, fontWeight: '800', color: tc.text, textAlign: 'center', lineHeight: 34 },
    heroSub: { fontSize: 14, color: tc.textSecondary, textAlign: 'center', lineHeight: 20, marginTop: 12 },
    featureList: { marginTop: 28, gap: 18 },
    featureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
    featureIcon: { width: 26, alignItems: 'center', marginTop: 2 },
    featureText: { flex: 1 },
    featureTitle: { fontSize: 16, fontWeight: '700', color: tc.text, marginBottom: 2 },
    featureDesc: { fontSize: 13, color: tc.textSecondary, lineHeight: 18 },
    plans: { flexDirection: 'row', gap: 12, marginTop: 28 },
    planCard: {
      flex: 1,
      borderWidth: 2,
      borderRadius: 16,
      paddingVertical: 18,
      paddingHorizontal: 14,
      alignItems: 'center',
    },
    planBadge: {
      position: 'absolute',
      top: -10,
      backgroundColor: tc.gold,
      paddingHorizontal: 10,
      paddingVertical: 3,
      borderRadius: 999,
    },
    planBadgeTrial: { backgroundColor: tc.text },
    planBadgeTextTrial: { color: tc.paper },
    planBadgeText: { fontSize: 10, fontWeight: '900', color: tc.goldDeep, letterSpacing: 0.4 },
    planTitle: { fontSize: 13, fontWeight: '800', color: tc.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 },
    planPrice: { fontFamily: SERIF_FAMILY, fontSize: 26, fontWeight: '800', color: tc.text, marginTop: 6 },
    planCadence: { fontSize: 12, color: tc.textFaint, marginTop: 1 },
    planRadio: {
      marginTop: 12,
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    lifetimeRow: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: tc.border,
      paddingVertical: 12,
      alignItems: 'center',
      marginTop: 12,
    },
    lifetimeRowOn: { borderColor: tc.gold, backgroundColor: tc.goldWash },
    lifetimeRowText: { fontSize: 13, fontWeight: '700', color: tc.textSecondary },
    lifetimeRowTextOn: { color: tc.text },

    scroll: { flex: 1 },
    // Opaque, with a hairline above: scrolled content passes under its top
    // edge cleanly, and the strip below the button — behind the bar's glass —
    // shows the page background rather than whatever scrolled there last.
    footer: {
      backgroundColor: tc.background,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: tc.border,
      paddingHorizontal: 24,
      paddingTop: 14,
    },
    trialBtn: {
      backgroundColor: tc.gold,
      paddingVertical: 16,
      borderRadius: 14,
      alignItems: 'center',
    },
    trialBtnText: { color: tc.goldDeep, fontSize: 16, fontWeight: '900', letterSpacing: 0.4 },
    priceHint: { fontSize: 12, color: tc.textFaint, marginTop: 8, marginBottom: 10, textAlign: 'center' },
    manageBtn: { backgroundColor: tc.gold, paddingVertical: 16, borderRadius: 14, alignItems: 'center', marginTop: 28 },
    manageBtnText: { color: tc.goldDeep, fontSize: 16, fontWeight: '900' },
    restoreBtn: { marginTop: 24, alignItems: 'center' },
    restoreBtnText: { fontSize: 13, color: tc.textSecondary, textDecorationLine: 'underline' },
  });
