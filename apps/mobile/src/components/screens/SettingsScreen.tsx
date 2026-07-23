import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SUPPORTED_LANGUAGES, CEFR_LEVELS, AVAILABLE_LANGUAGES } from '../../types';
import { useOnboardingStore } from '../../stores/onboardingStore';
import { DAILY_GOAL_OPTIONS } from '../onboarding/placement';
import { colors } from '../../theme/palette';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { useThemeStore, type ThemePreference } from '../../stores/themeStore';
import { API_BASE_URL } from '../../services/api';
import {
  scheduleWordReminder,
  scheduleReviewReminder,
  getWordReminderMode,
  setWordReminderMode,
  type WordReminderMode,
} from '../../services/notifications';
import { makeSettingsStyles } from './settingsStyles';
import {
  UI_LANGUAGES,
  clearExplicitAppLanguage,
  getAppLanguage,
  getUiLanguage,
  hasExplicitAppLanguage,
  setAppLanguage,
} from '../../i18n';

interface Props {
  onBack: () => void;
  user: any;
  onUserUpdated: (user: any) => void;
  onNavigateToFamilyPlan: () => void;
  onNavigateToPrivacy: () => void;
  onNavigateToTerms: () => void;
  targetLanguage: string;
  setTargetLanguage: (lang: string) => void;
}

export const SettingsScreen = ({
  onBack,
  user,
  onUserUpdated,
  onNavigateToFamilyPlan,
  onNavigateToPrivacy,
  onNavigateToTerms,
  targetLanguage,
  setTargetLanguage,
}: Props) => {
  const [username, setUsername] = useState(user?.username || '');
  const [nativeLanguage, setNativeLanguage] = useState(user?.native_language || 'en');
  const [learningLanguage, setLearningLanguage] = useState(user?.learning_language || 'en');
  const [proficiencyLevel, setProficiencyLevel] = useState(user?.proficiency_level || 'A1');
  const [saving, setSaving] = useState(false);
  const dailyGoalMinutes = useOnboardingStore((st) => st.dailyGoalMinutes);
  const setDailyGoalMinutes = useOnboardingStore((st) => st.setDailyGoalMinutes);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [showNativeLangPicker, setShowNativeLangPicker] = useState(false);
  const [showLearningLangPicker, setShowLearningLangPicker] = useState(false);
  const [showProficiencyPicker, setShowProficiencyPicker] = useState(false);
  const [showAppLangPicker, setShowAppLangPicker] = useState(false);
  // Active UI language, plus whether it's pinned here or merely inherited from
  // the translation language (which decides if we offer the "reset" affordance).
  const [appLanguage, setAppLanguageState] = useState(getAppLanguage());
  const [appLanguagePinned, setAppLanguagePinned] = useState(false);
  const [dailyWordNotif, setDailyWordNotif] = useState(true);
  const [wordReminderMode, setWordReminderModeState] = useState<WordReminderMode>('daily');
  const [reviewNotif, setReviewNotif] = useState(true);
  const [accordionMode, setAccordionMode] = useState(true);

  const { t } = useTranslation();
  const tc = useThemeColors();
  const themePreference = useThemeStore((s) => s.preference);
  const setThemePreference = useThemeStore((s) => s.setPreference);
  const appearanceStyles = useMemo(() => makeAppearanceStyles(tc), [tc]);
  const settingsStyles = useMemo(() => makeSettingsStyles(tc), [tc]);

  useEffect(() => {
    AsyncStorage.getItem('notif_daily_word').then((v) => { if (v === 'off') setDailyWordNotif(false); });
    getWordReminderMode().then(setWordReminderModeState);
    AsyncStorage.getItem('notif_review').then((v) => { if (v === 'off') setReviewNotif(false); });
    AsyncStorage.getItem('accordion_mode').then((v) => { if (v === 'off') setAccordionMode(false); });
    hasExplicitAppLanguage().then(setAppLanguagePinned);
  }, []);

  const handleSelectAppLanguage = async (code: string) => {
    await setAppLanguage(code);
    setAppLanguageState(code);
    setAppLanguagePinned(true);
  };

  // Drop the pin so the UI follows the translation language again.
  const handleResetAppLanguage = async () => {
    await clearExplicitAppLanguage(targetLanguage);
    setAppLanguageState(getAppLanguage());
    setAppLanguagePinned(false);
  };

  const toggleAccordionMode = async () => {
    const next = !accordionMode;
    setAccordionMode(next);
    await AsyncStorage.setItem('accordion_mode', next ? 'on' : 'off');
  };

  const toggleDailyWord = async () => {
    const next = !dailyWordNotif;
    setDailyWordNotif(next);
    await AsyncStorage.setItem('notif_daily_word', next ? 'on' : 'off');
    if (next) {
      scheduleWordReminder(wordReminderMode);
    } else {
      try {
        const Notif = require('expo-notifications');
        await Notif.cancelScheduledNotificationAsync('daily-word');
      } catch {}
    }
  };

  const toggleWordReminderMode = async () => {
    const next: WordReminderMode = wordReminderMode === 'hourly' ? 'daily' : 'hourly';
    setWordReminderModeState(next);
    await setWordReminderMode(next);
    // Re-schedule with the new cadence only if the reminder is currently on.
    if (dailyWordNotif) scheduleWordReminder(next);
  };

  const toggleReview = async () => {
    const next = !reviewNotif;
    setReviewNotif(next);
    await AsyncStorage.setItem('notif_review', next ? 'on' : 'off');
    if (next) {
      scheduleReviewReminder();
    } else {
      try {
        const Notif = require('expo-notifications');
        await Notif.cancelScheduledNotificationAsync('review-reminder');
      } catch {}
    }
  };

  const handleSave = async () => {
    if (!username.trim()) {
      setError(t('settings:usernameRequired'));
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const token = await (await import('../../services/auth/tokenStorage')).tokenStorage.getAccessToken();
      const response = await fetch(`${API_BASE_URL}/auth/me`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          username: username.trim(),
          native_language: nativeLanguage,
          learning_language: learningLanguage,
          proficiency_level: proficiencyLevel,
          // `default_tab` intentionally omitted — mobile has no Books tab and
          // never reads it, so it must not clobber the web user's choice
          // (UX audit F-005/F-025).
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || t('settings:saveFailed'));
      }

      const updatedUser = await response.json();
      onUserUpdated(updatedUser);
      setSuccess(t('settings:saveSuccess'));
    } catch (err: any) {
      setError(err.message || t('settings:saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const getLangName = (code: string) =>
    SUPPORTED_LANGUAGES.find((l) => l.code === code)?.name || code;

  // Endonym first (that's what a speaker scans for), English name after —
  // except for English itself, where the two are the same word.
  const proficiencyItems = useMemo(
    () => CEFR_LEVELS.map((code) => ({ code, name: t(`cefrPicker.${code}`) })),
    [t],
  );

  const appLanguageItems = useMemo(
    () =>
      UI_LANGUAGES.map((l) => ({
        code: l.code,
        name: l.nativeName === l.name ? l.name : `${l.nativeName} · ${l.name}`,
      })),
    [],
  );

  const getProfName = (code: string) => t(`cefrPicker.${code}`, { defaultValue: code });

  const renderPicker = (
    visible: boolean,
    onClose: () => void,
    items: ReadonlyArray<{ code: string; name: string }>,
    selected: string,
    onSelect: (code: string) => void,
    title: string,
  ) => {
    if (!visible) return null;
    return (
      <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
        <View style={settingsStyles.modalOverlay}>
          <View style={settingsStyles.modalContent}>
            <View style={settingsStyles.modalHeader}>
              <Text style={settingsStyles.modalTitle}>{title}</Text>
              <TouchableOpacity onPress={onClose}>
                <Text style={settingsStyles.modalClose}>{t('action.done')}</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={settingsStyles.modalScroll}>
              {items.map((item) => (
                <TouchableOpacity
                  key={item.code}
                  style={[
                    settingsStyles.modalItem,
                    item.code === selected && settingsStyles.modalItemSelected,
                  ]}
                  onPress={() => {
                    onSelect(item.code);
                    onClose();
                  }}
                >
                  <Text
                    style={[
                      settingsStyles.modalItemText,
                      item.code === selected && settingsStyles.modalItemTextSelected,
                    ]}
                  >
                    {item.name}
                  </Text>
                  {item.code === selected && <Text style={settingsStyles.checkmark}>✓</Text>}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  };

  return (
    <SafeAreaView style={settingsStyles.container} edges={['top']}>
      <View style={settingsStyles.header}>
        <TouchableOpacity onPress={onBack} style={settingsStyles.backButton}>
          <Text style={settingsStyles.backButtonText}>← {t('action.back')}</Text>
        </TouchableOpacity>
        <Text style={settingsStyles.headerTitle}>{t('settings:title')}</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={settingsStyles.scrollContent} contentContainerStyle={settingsStyles.scrollContainer}>
        <View style={settingsStyles.profileHeader}>
          {user?.profile_picture_url ? (
            <Image source={{ uri: user.profile_picture_url }} style={settingsStyles.avatar} />
          ) : (
            <View style={settingsStyles.avatarPlaceholder}>
              <Text style={settingsStyles.avatarInitial}>
                {user?.username?.[0]?.toUpperCase() || 'U'}
              </Text>
            </View>
          )}
          <View style={settingsStyles.profileInfo}>
            <Text style={settingsStyles.profileTitle}>{t('settings:accountSettings')}</Text>
            <Text style={settingsStyles.profileEmail}>{user?.email}</Text>
          </View>
        </View>

        <View style={settingsStyles.divider} />

        {error && (
          <View style={settingsStyles.alertError}>
            <Text style={settingsStyles.alertErrorText}>{error}</Text>
          </View>
        )}
        {success && (
          <View style={settingsStyles.alertSuccess}>
            <Text style={settingsStyles.alertSuccessText}>{success}</Text>
          </View>
        )}

        <Text style={settingsStyles.sectionTitle}>Profile</Text>
        <View style={settingsStyles.inputContainer}>
          <Text style={settingsStyles.inputLabel}>Username</Text>
          <TextInput
            style={settingsStyles.textInput}
            value={username}
            onChangeText={setUsername}
            placeholder={t('settings:usernamePlaceholder')}
            placeholderTextColor={colors.textSecondary}
          />
        </View>

        <View style={settingsStyles.divider} />

        <Text style={settingsStyles.sectionTitle}>{t('settings:languagePreferences')}</Text>

        <TouchableOpacity
          style={settingsStyles.selectButton}
          onPress={() => setShowNativeLangPicker(true)}
        >
          <Text style={settingsStyles.selectLabel}>{t('settings:nativeLanguage')}</Text>
          <Text style={settingsStyles.selectValue}>{getLangName(nativeLanguage)} ▼</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={settingsStyles.selectButton}
          onPress={() => setShowLearningLangPicker(true)}
        >
          <Text style={settingsStyles.selectLabel}>{t('settings:learningLanguage')}</Text>
          <Text style={settingsStyles.selectValue}>{getLangName(learningLanguage)} ▼</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={settingsStyles.selectButton}
          onPress={() => setShowProficiencyPicker(true)}
        >
          <Text style={settingsStyles.selectLabel}>{t('settings:proficiencyLevel')}</Text>
          <Text style={settingsStyles.selectValue}>{getProfName(proficiencyLevel)} ▼</Text>
        </TouchableOpacity>

        <View style={settingsStyles.divider} />

        {/* Daily goal — set once in onboarding, now editable here (F-026). */}
        <Text style={settingsStyles.sectionTitle}>{t('settings:dailyGoal')}</Text>
        <View style={appearanceStyles.segmented}>
          {DAILY_GOAL_OPTIONS.map((g) => {
            const isActive = dailyGoalMinutes === g.mins;
            return (
              <TouchableOpacity
                key={g.mins}
                onPress={() => { void setDailyGoalMinutes(g.mins); }}
                style={[appearanceStyles.segment, isActive && appearanceStyles.segmentActive]}
                activeOpacity={0.7}
              >
                <Text style={[appearanceStyles.segmentText, isActive && appearanceStyles.segmentTextActive]}>
                  {g.mins}m
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={settingsStyles.divider} />

        <Text style={settingsStyles.sectionTitle}>{t('settings:appearance')}</Text>
        <View style={appearanceStyles.segmented}>
          {(['light', 'system', 'dark'] as ThemePreference[]).map((opt) => {
            const isActive = themePreference === opt;
            return (
              <TouchableOpacity
                key={opt}
                onPress={() => setThemePreference(opt)}
                style={[
                  appearanceStyles.segment,
                  isActive && appearanceStyles.segmentActive,
                ]}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    appearanceStyles.segmentText,
                    isActive && appearanceStyles.segmentTextActive,
                  ]}
                >
                  {t(`settings:theme.${opt}`)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={settingsStyles.divider} />

        <Text style={settingsStyles.sectionTitle}>{t('settings:appLanguage.sectionTitle')}</Text>

        <TouchableOpacity
          style={settingsStyles.selectButton}
          onPress={() => setShowAppLangPicker(true)}
          accessibilityRole="button"
        >
          <Text style={settingsStyles.selectLabel}>{t('settings:appLanguage.label')}</Text>
          <Text style={settingsStyles.selectValue}>
            {getUiLanguage(appLanguage)?.nativeName ?? appLanguage} ▼
          </Text>
        </TouchableOpacity>

        <Text style={settingsStyles.notifDesc}>{t('settings:appLanguage.description')}</Text>

        {appLanguagePinned ? (
          <TouchableOpacity onPress={handleResetAppLanguage} accessibilityRole="button">
            <Text style={[settingsStyles.notifDesc, { color: colors.primary, marginTop: 6 }]}>
              {t('settings:appLanguage.followTranslationHint', { language: targetLanguage })}
            </Text>
          </TouchableOpacity>
        ) : null}

        <View style={settingsStyles.divider} />

        <Text style={settingsStyles.sectionTitle}>{t('settings:translationLanguage')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          {AVAILABLE_LANGUAGES.slice(0, 8).map((lang) => (
            <TouchableOpacity
              key={lang.code}
              style={[
                settingsStyles.selectButton,
                { paddingVertical: 8, paddingHorizontal: 14, marginBottom: 0 },
                lang.code === targetLanguage && { backgroundColor: colors.primary, borderColor: colors.primary },
              ]}
              onPress={() => setTargetLanguage(lang.code)}
              activeOpacity={0.7}
            >
              <Text style={[settingsStyles.selectLabel, lang.code === targetLanguage && { color: '#fff' }]}>
                {lang.code}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          style={[settingsStyles.saveButton, saving && settingsStyles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.7}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={settingsStyles.saveButtonText}>{t('settings:saveChanges')}</Text>
          )}
        </TouchableOpacity>

        <View style={settingsStyles.divider} />

        <Text style={settingsStyles.sectionTitle}>{t('settings:vocabulary')}</Text>
        <View style={settingsStyles.notifRow}>
          <View style={settingsStyles.notifInfo}>
            <Text style={settingsStyles.notifLabel}>{t('settings:autoCollapse')}</Text>
            <Text style={settingsStyles.notifDesc}>{t('settings:autoCollapseDesc')}</Text>
          </View>
          <TouchableOpacity
            style={[settingsStyles.notifToggle, accordionMode && settingsStyles.notifToggleOn]}
            onPress={toggleAccordionMode}
          >
            <Text style={settingsStyles.notifToggleText}>{accordionMode ? 'ON' : 'OFF'}</Text>
          </TouchableOpacity>
        </View>

        <Text style={settingsStyles.sectionTitle}>{t('settings:notifications')}</Text>
        <View style={settingsStyles.notifRow}>
          <View style={settingsStyles.notifInfo}>
            <Text style={settingsStyles.notifLabel}>{t('settings:wordOfTheHour')}</Text>
            <Text style={settingsStyles.notifDesc}>{t('settings:wordOfTheHourDesc')}</Text>
          </View>
          <TouchableOpacity
            style={[settingsStyles.notifToggle, dailyWordNotif && settingsStyles.notifToggleOn]}
            onPress={toggleDailyWord}
          >
            <Text style={settingsStyles.notifToggleText}>{dailyWordNotif ? 'ON' : 'OFF'}</Text>
          </TouchableOpacity>
        </View>
        {dailyWordNotif && (
          <View style={settingsStyles.notifRow}>
            <View style={settingsStyles.notifInfo}>
              <Text style={settingsStyles.notifLabel}>{t('settings:reminderFrequency')}</Text>
              <Text style={settingsStyles.notifDesc}>
                {wordReminderMode === 'hourly'
                  ? 'Remind me every hour'
                  : 'Remind me once a day at 9:00 AM'}
              </Text>
            </View>
            <TouchableOpacity
              style={[settingsStyles.notifToggle, wordReminderMode === 'hourly' && settingsStyles.notifToggleOn]}
              onPress={toggleWordReminderMode}
            >
              <Text style={settingsStyles.notifToggleText}>
                {wordReminderMode === 'hourly' ? 'HOURLY' : 'DAILY'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
        <View style={settingsStyles.notifRow}>
          <View style={settingsStyles.notifInfo}>
            <Text style={settingsStyles.notifLabel}>{t('settings:reviewReminder')}</Text>
            <Text style={settingsStyles.notifDesc}>{t('settings:reviewReminderDesc')}</Text>
          </View>
          <TouchableOpacity
            style={[settingsStyles.notifToggle, reviewNotif && settingsStyles.notifToggleOn]}
            onPress={toggleReview}
          >
            <Text style={settingsStyles.notifToggleText}>{reviewNotif ? 'ON' : 'OFF'}</Text>
          </TouchableOpacity>
        </View>

        <Text style={settingsStyles.sectionTitle}>{t('settings:subscription')}</Text>
        <TouchableOpacity style={settingsStyles.settingsLink} onPress={onNavigateToFamilyPlan}>
          <Text style={settingsStyles.settingsLinkText}>{t('settings:familyPlan')}</Text>
          <Text style={settingsStyles.settingsLinkArrow}>→</Text>
        </TouchableOpacity>
        <TouchableOpacity style={settingsStyles.settingsLink} onPress={async () => {
          const { restorePurchases } = require('../../services/billing');
          const result = await restorePurchases();
          Alert.alert(result.restored ? t('billing:paywall.restoredTitle') : t('billing:paywall.notFoundTitle'), result.message);
        }}>
          <Text style={settingsStyles.settingsLinkText}>{t('settings:restorePurchases')}</Text>
          <Text style={settingsStyles.settingsLinkArrow}>→</Text>
        </TouchableOpacity>

        <Text style={settingsStyles.sectionTitle}>Legal</Text>
        <TouchableOpacity style={settingsStyles.settingsLink} onPress={onNavigateToPrivacy}>
          <Text style={settingsStyles.settingsLinkText}>{t('settings:privacyPolicy')}</Text>
          <Text style={settingsStyles.settingsLinkArrow}>→</Text>
        </TouchableOpacity>
        <TouchableOpacity style={settingsStyles.settingsLink} onPress={onNavigateToTerms}>
          <Text style={settingsStyles.settingsLinkText}>{t('settings:termsOfService')}</Text>
          <Text style={settingsStyles.settingsLinkArrow}>→</Text>
        </TouchableOpacity>
      </ScrollView>

      {renderPicker(
        showAppLangPicker,
        () => setShowAppLangPicker(false),
        appLanguageItems,
        appLanguage,
        handleSelectAppLanguage,
        t('settings:appLanguage.pickerTitle'),
      )}
      {renderPicker(showNativeLangPicker, () => setShowNativeLangPicker(false), SUPPORTED_LANGUAGES, nativeLanguage, setNativeLanguage, t('settings:nativeLanguage'))}
      {renderPicker(showLearningLangPicker, () => setShowLearningLangPicker(false), SUPPORTED_LANGUAGES, learningLanguage, setLearningLanguage, t('settings:learningLanguage'))}
      {renderPicker(showProficiencyPicker, () => setShowProficiencyPicker(false), proficiencyItems, proficiencyLevel, setProficiencyLevel, t('settings:proficiencyLevel'))}
    </SafeAreaView>
  );
};

const makeAppearanceStyles = (tc: ThemeColors) => StyleSheet.create({
  segmented: {
    flexDirection: 'row',
    backgroundColor: tc.paper,
    borderWidth: 1,
    borderColor: tc.border,
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentActive: {
    backgroundColor: tc.primary,
  },
  segmentText: {
    fontSize: 14,
    fontWeight: '600',
    color: tc.textSecondary,
  },
  segmentTextActive: {
    color: tc.textInverse,
  },
});
