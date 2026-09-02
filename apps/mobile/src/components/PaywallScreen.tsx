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
import { SafeAreaView } from 'react-native-safe-area-context';
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
  type PaywallReason,
} from './paywallPricing';
import { directionalIcon } from '../i18n/rtl';
import { BlockIcon, BrainIcon, ChartIcon, FilmIcon } from './ui/icons';
import { useBottomBarInset } from '../hooks/useBottomBarInset';

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

type Plan = 'annual' | 'monthly';

export function PaywallScreen({ onBack, previewsUsed, previewsLimit, reason = null }: PaywallScreenProps) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  const isPremium = useIsPremium();
  const [plan, setPlan] = useState<Plan>('annual');
  const [busy, setBusy] = useState(false);
  const savings = annualSavingsPercent();
  const subtitle = paywallSubtitle(reason, previewsUsed, previewsLimit);
  const barInset = useBottomBarInset();

  const buy = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const product = plan === 'annual' ? PRODUCTS.ANNUAL : PRODUCTS.MONTHLY;
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
    Alert.alert(result.restored ? t('billing:paywall.restoredTitle') : t('billing:paywall.notFoundTitle'), result.message);
    if (result.restored) onBack();
  };

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <View style={s.header}>
        <PressableScale onPress={onBack} accessibilityRole="button" accessibilityLabel={t('action.back')}>
          <Ionicons name={directionalIcon('chevron-back')} size={22} color={tc.text} />
        </PressableScale>
        <Text style={s.headerTitle}>{t('billing:paywall.title')}</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: barInset + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={s.heroTitle}>{t('billing:paywall.heroTitle')}</Text>
        {isPremium ? (
          <Text style={s.heroSub}>{t('billing:paywall.alreadyPlus')}</Text>
        ) : (
          <Text style={s.heroSub}>{t(subtitle.key, subtitle.params)}</Text>
        )}

        <View style={s.featureList}>
          {PAYWALL_FEATURES.map((f) => (
            <View key={f.title} style={s.featureRow}>
              <View style={s.featureIcon}>
                {f.icon === 'brain' ? <BrainIcon size={22} color={tc.gold} />
                  : f.icon === 'film' ? <FilmIcon size={22} color={tc.gold} />
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
          <>
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
                price={MONTHLY_PRICE_LABEL}
                cadence="/month"
              />
            </View>

            <PressableScale
              style={[s.trialBtn, busy && { opacity: 0.6 }]}
              onPress={buy}
              accessibilityRole="button"
              accessibilityLabel={t('billing:paywall.startTrial')}
            >
              <Text style={s.trialBtnText}>{busy ? t('billing:paywall.starting') : t('billing:paywall.startTrial')}</Text>
            </PressableScale>
            <Text style={s.priceHint}>
              Then {plan === 'annual' ? `${ANNUAL_PRICE_LABEL}/year` : `${MONTHLY_PRICE_LABEL}/month`} · Cancel
              anytime
            </Text>

            <PressableScale style={s.restoreBtn} onPress={restore} accessibilityRole="button" accessibilityLabel={t('billing:paywall.restore')}>
              <Text style={s.restoreBtnText}>{t('billing:paywall.restore')}</Text>
            </PressableScale>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
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
}: {
  tc: ThemeColors;
  selected: boolean;
  onPress: () => void;
  title: string;
  price: string;
  cadence: string;
  badge?: string;
}) {
  const s = useMemo(() => makeStyles(tc), [tc]);
  return (
    <PressableScale
      style={[s.planCard, { borderColor: selected ? tc.gold : tc.border, backgroundColor: selected ? tc.primaryTint : tc.paper }]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${title} ${price} ${cadence}`}
    >
      {badge ? (
        <View style={s.planBadge}>
          <Text style={s.planBadgeText}>{badge}</Text>
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
    trialBtn: {
      backgroundColor: tc.gold,
      paddingVertical: 16,
      borderRadius: 14,
      alignItems: 'center',
      marginTop: 24,
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 8 },
      elevation: 5,
    },
    trialBtnText: { color: tc.goldDeep, fontSize: 16, fontWeight: '900', letterSpacing: 0.4 },
    priceHint: { fontSize: 12, color: tc.textFaint, marginTop: 10, textAlign: 'center' },
    manageBtn: { backgroundColor: tc.gold, paddingVertical: 16, borderRadius: 14, alignItems: 'center', marginTop: 28 },
    manageBtnText: { color: tc.goldDeep, fontSize: 16, fontWeight: '900' },
    restoreBtn: { marginTop: 16, alignItems: 'center' },
    restoreBtnText: { fontSize: 13, color: tc.textSecondary, textDecorationLine: 'underline' },
  });
