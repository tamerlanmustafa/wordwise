/**
 * LevelResultStep — onboarding step 4 (prototype §4). Shows the CEFR band the
 * placement quiz derived: a big coloured disc, the level label, a short
 * explanation, and the A1→C2 ramp with the user's level lit. Colours come
 * from the centralized cefrColors map (theme/palette); level names come
 * from `common:cefr.*`.
 */

import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { cefrColors } from '../../theme/palette';
import { SERIF_FAMILY, MONO_FAMILY } from '../../theme/fonts';
import { CEFR_LEVELS, type CefrLevel } from '../../types';
import { FadeInUp } from '../ui/FadeInUp';
import { OnboardingCTA } from './OnboardingCTA';

export interface LevelResultStepProps {
  level: CefrLevel;
  onContinue: () => void;
  onBack: () => void;
}

export function LevelResultStep({ level, onContinue, onBack: _onBack }: LevelResultStepProps) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  const color = cefrColors[level] ?? tc.gold;

  return (
    <SafeAreaView style={s.root} edges={['top', 'bottom']}>
      <View style={s.body}>
        <FadeInUp>
          <Text style={s.eyebrow}>{t('onboarding:levelResult.eyebrow')}</Text>
        </FadeInUp>
        <FadeInUp delay={80}>
          <View style={[s.disc, { backgroundColor: color, shadowColor: color }]}>
            <Text style={s.discText}>{level}</Text>
          </View>
        </FadeInUp>
        <FadeInUp delay={140}>
          <Text style={s.label}>{t(`cefr.${level}`, { defaultValue: level })}</Text>
        </FadeInUp>
        <FadeInUp delay={200}>
          <Text style={s.copy}>{t(`onboarding:levelResult.explanation.${level}`)}</Text>
        </FadeInUp>
        <FadeInUp delay={260} style={s.rampWrap}>
          <View style={s.ramp}>
            {CEFR_LEVELS.map((lv) => {
              const on = lv === level;
              return (
                <View key={lv} style={s.rampCol}>
                  <View style={[s.rampBar, { backgroundColor: on ? (cefrColors[lv] ?? tc.gold) : tc.divider }]} />
                  <Text style={[s.rampLabel, { color: on ? tc.text : tc.textFaint, fontWeight: on ? '900' : '700' }]}>
                    {lv}
                  </Text>
                </View>
              );
            })}
          </View>
        </FadeInUp>
      </View>
      <OnboardingCTA label={t('onboarding:levelResult.cta')} onPress={onContinue} />
    </SafeAreaView>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: tc.background },
    body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
    eyebrow: {
      fontFamily: MONO_FAMILY,
      fontSize: 10.5,
      fontWeight: '800',
      letterSpacing: 2,
      color: tc.goldOnSurface,
      textTransform: 'uppercase',
      textAlign: 'center',
    },
    disc: {
      width: 110,
      height: 110,
      borderRadius: 55,
      marginVertical: 18,
      alignItems: 'center',
      justifyContent: 'center',
      shadowOpacity: 0.4,
      shadowRadius: 30,
      shadowOffset: { width: 0, height: 12 },
      elevation: 10,
    },
    discText: { fontFamily: SERIF_FAMILY, fontSize: 44, fontWeight: '700', color: '#fff' },
    label: { fontFamily: SERIF_FAMILY, fontSize: 26, fontWeight: '700', letterSpacing: -0.5, color: tc.text, textAlign: 'center' },
    copy: { fontSize: 14, lineHeight: 21, color: tc.textSecondary, marginTop: 8, textAlign: 'center', maxWidth: 300 },
    rampWrap: { width: '100%', marginTop: 30 },
    ramp: { flexDirection: 'row', gap: 5 },
    rampCol: { flex: 1, alignItems: 'center' },
    rampBar: { height: 8, borderRadius: 999, alignSelf: 'stretch' },
    rampLabel: { marginTop: 6, fontFamily: MONO_FAMILY, fontSize: 10 },
  });
