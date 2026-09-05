import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { colors } from '../../theme/palette';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { useThemeStore, type ThemePreference } from '../../stores/themeStore';
import { useFeedbackPrefsStore } from '../../stores/feedbackPrefsStore';
import { authApi } from '../../services/api';
import { showConfirm } from '../../stores/confirmStore';
import {
  canSaveUsername,
  hasUnsavedUsername,
  normalizeUsername,
  usernameState,
} from './profileForm';
import { scheduleReviewReminder } from '../../services/notifications';
import { makeSettingsStyles } from './settingsStyles';
import { FORWARD_ARROW, reloadForRtl, syncRtlLayout } from '../../i18n/rtl';
import { useBottomBarInset } from '../../hooks/useBottomBarInset';
import { ScreenHeader } from '../common/ScreenHeader';
import {
  SELECTABLE_UI_LANGUAGES,
  clearExplicitAppLanguage,
  getAppLanguage,
  getUiLanguage,
  hasExplicitAppLanguage,
  setAppLanguage,
} from '../../i18n';

interface Props {
  onBack: () => void;
  /** Names where Back lands (e.g. "Profile"). Defaults to a plain "Back". */
  backLabel?: string;
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
  backLabel,
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
  const [proficiencyLevel, setProficiencyLevel] = useState(user?.proficiency_level || 'A1');
  const [saving, setSaving] = useState(false);
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
  const [reviewNotif, setReviewNotif] = useState(true);

  const { t } = useTranslation();
  const tc = useThemeColors();
  const themePreference = useThemeStore((s) => s.preference);
  const setThemePreference = useThemeStore((s) => s.setPreference);
  // Sound/haptics live in a store rather than this screen's local state: the
  // fire path reads them synchronously from anywhere in the app, and Settings
  // is only one of the places that can change them.
  const soundEnabled = useFeedbackPrefsStore((s) => s.soundEnabled);
  const hapticsEnabled = useFeedbackPrefsStore((s) => s.hapticsEnabled);
  const setSoundEnabled = useFeedbackPrefsStore((s) => s.setSoundEnabled);
  const setHapticsEnabled = useFeedbackPrefsStore((s) => s.setHapticsEnabled);
  const appearanceStyles = useMemo(() => makeAppearanceStyles(tc), [tc]);
  const settingsStyles = useMemo(() => makeSettingsStyles(tc), [tc]);
  // The tab bar is an absolute overlay, so this screen has to reserve its
  // height itself. Without it the last section — Legal — scrolled under the
  // floating capsule and its links could not be tapped.
  const barInset = useBottomBarInset();

  useEffect(() => {
    AsyncStorage.getItem('notif_review').then((v) => { if (v === 'off') setReviewNotif(false); });
    hasExplicitAppLanguage().then(setAppLanguagePinned);
  }, []);

  /**
   * Finish a language change that also flips the layout direction.
   *
   * Text switches instantly, but mirroring is native state that only applies on
   * the next bundle load — so unlike every other setting on this screen, this
   * one has to interrupt. We ask rather than reload outright because the user is
   * mid-session here, and offer a manual-restart fallback for the builds where
   * expo-updates can't reload us (Expo Go).
   */
  const confirmRtlRestart = (code: string) => {
    if (!syncRtlLayout(code)) return;
    Alert.alert(
      t('settings:appLanguage.restartTitle'),
      t('settings:appLanguage.restartBody', {
        language: getUiLanguage(code)?.nativeName ?? code,
      }),
      [
        { text: t('common:action.later'), style: 'cancel' },
        {
          text: t('settings:appLanguage.restartNow'),
          onPress: () => {
            void reloadForRtl().then((ok) => {
              if (!ok) Alert.alert(t('settings:appLanguage.restartManual'));
            });
          },
        },
      ],
    );
  };

  /**
   * Mirror the pin onto the account, so a new install comes up in the same
   * language and transactional email is written in it (#98). `''` clears it.
   *
   * Fire-and-forget on purpose: the language has already changed on screen and
   * must not un-change because the network is down. A signed-out user has no
   * account to mirror to, and the next explicit change syncs whatever the
   * server missed.
   */
  const syncAppLanguageToAccount = (value: string) => {
    if (!user) return;
    authApi
      .updateProfile({ language_preference: value })
      .then(onUserUpdated)
      .catch(() => {});
  };

  const handleSelectAppLanguage = async (code: string) => {
    await setAppLanguage(code);
    setAppLanguageState(code);
    setAppLanguagePinned(true);
    syncAppLanguageToAccount(code);
    confirmRtlRestart(code);
  };

  // Drop the pin so the UI follows the translation language again.
  const handleResetAppLanguage = async () => {
    await clearExplicitAppLanguage(targetLanguage);
    const resolved = getAppLanguage();
    setAppLanguageState(resolved);
    setAppLanguagePinned(false);
    // Clear the account copy too, or the next hydrate reads it back as a pin.
    syncAppLanguageToAccount('');
    confirmRtlRestart(resolved);
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

  /**
   * PATCH one or more account fields and reconcile local state.
   *
   * This replaced a hand-rolled `fetch` that re-read the token, rebuilt the
   * auth header and re-implemented error extraction — all of which
   * `authApi.updateProfile` already does, including surfacing the backend's
   * own reason ("Username already taken") verbatim.
   *
   * `default_tab` is deliberately never sent: mobile has no Books tab and
   * never reads the field, so including it would clobber the web user's
   * choice (UX audit F-005/F-025).
   */
  const savePatch = async (patch: Record<string, unknown>, successMsg?: string) => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const updatedUser = await authApi.updateProfile(patch);
      onUserUpdated(updatedUser);
      if (successMsg) setSuccess(successMsg);
      return true;
    } catch (err: any) {
      setError(err.message || t('settings:saveFailed'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  /**
   * The three account pickers now commit on selection, like every other
   * control on this screen. They used to wait for a "Save changes" button
   * parked below the translation chips — so picking a proficiency level and
   * tapping Back silently discarded it, and proficiency is what composes the
   * Practice deck and the Explore mix.
   *
   * Optimistic: the row shows the new value immediately and rolls back if the
   * PATCH fails, so a dead network can't leave the UI claiming a level the
   * server never took.
   */
  const commitField = (
    field: 'native_language' | 'learning_language' | 'proficiency_level',
    value: string,
    apply: (v: string) => void,
    previous: string,
  ) => {
    apply(value);
    void savePatch({ [field]: value }).then((ok) => {
      if (!ok) apply(previous);
    });
  };

  const handleSaveUsername = async () => {
    const next = normalizeUsername(username);
    if (!canSaveUsername(username, user?.username)) {
      if (usernameState(username, user?.username) === 'empty') {
        setError(t('settings:usernameRequired'));
      }
      return;
    }
    await savePatch({ username: next }, t('settings:saveSuccess'));
  };

  /**
   * Back, with a guard for an unsaved username.
   *
   * Everything else on the screen is already committed by the time you reach
   * here, so this is the only edit Back can destroy.
   */
  const handleBack = () => {
    if (!hasUnsavedUsername(username, user?.username)) {
      onBack();
      return;
    }
    showConfirm({
      title: t('settings:unsavedTitle'),
      message: t('settings:unsavedBody'),
      confirmLabel: t('settings:discardChanges'),
      tone: 'destructive',
      onConfirm: onBack,
    });
  };

  const getLangName = (code: string) =>
    SUPPORTED_LANGUAGES.find((l) => l.code === code)?.name || code;

  /** The learning/translation language's own name — "Español", not "Spanish".
   *  A speaker scans for their language in their language, which is why the
   *  grid this replaced showed nativeName too. */
  const getTargetLangName = (code: string) =>
    AVAILABLE_LANGUAGES.find((l) => l.code === code)?.nativeName || code;

  // Endonym first (that's what a speaker scans for), English name after —
  // except for English itself, where the two are the same word.
  const proficiencyItems = useMemo(
    () => CEFR_LEVELS.map((code) => ({ code, name: t(`cefrPicker.${code}`) })),
    [t],
  );

  const appLanguageItems = useMemo(
    () =>
      SELECTABLE_UI_LANGUAGES.map((l) => ({
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
      <ScreenHeader
        onBack={handleBack}
        backLabel={backLabel}
        title={t('settings:title')}
      />

      {/* The avatar + email block that used to open this screen is gone. You
          can only arrive here from the profile sheet, which has just shown you
          the same avatar, the same name and the same email — so it restated
          your identity to you and spent ~90pt of the first screenful doing it,
          pushing the settings themselves below the fold. */}
      <ScrollView
        style={settingsStyles.scrollContent}
        contentContainerStyle={[settingsStyles.scrollContainer, { paddingBottom: barInset + 24 }]}
      >
        <Text style={settingsStyles.sectionTitle}>{t('settings:profile')}</Text>
        <View style={settingsStyles.inputContainer}>
          <Text style={settingsStyles.inputLabel}>{t('settings:username')}</Text>
          <TextInput
            style={settingsStyles.textInput}
            value={username}
            onChangeText={setUsername}
            placeholder={t('settings:usernamePlaceholder')}
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={handleSaveUsername}
          />
        </View>

        {/* Save sits with the field it saves. It used to live below the
            translation-language chips, far enough down that the button and the
            input were never on screen together — and the success/error banner
            was further up still, above the fold, so the confirmation for a tap
            down here appeared somewhere you weren't looking. */}
        {canSaveUsername(username, user?.username) ? (
          <TouchableOpacity
            style={[settingsStyles.saveButton, saving && settingsStyles.saveButtonDisabled]}
            onPress={handleSaveUsername}
            disabled={saving}
            activeOpacity={0.7}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={settingsStyles.saveButtonText}>{t('settings:saveChanges')}</Text>
            )}
          </TouchableOpacity>
        ) : null}

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

        <View style={settingsStyles.divider} />

        <Text style={settingsStyles.sectionTitle}>{t('settings:languagePreferences')}</Text>

        <TouchableOpacity
          style={settingsStyles.selectButton}
          onPress={() => setShowNativeLangPicker(true)}
        >
          <Text style={settingsStyles.selectLabel}>{t('settings:nativeLanguage')}</Text>
          <Text style={settingsStyles.selectValue}>{getLangName(nativeLanguage)} ▼</Text>
        </TouchableOpacity>

        {/* Learning language IS the translation language.
            They were two controls over one column. `setTargetLanguage` already
            writes `users.learning_language` (see App.tsx), and `targetLanguage`
            initialises from it — so the separate "Learning language" picker and
            the "Translation language" grid could disagree about the same value,
            and the picker offered every SUPPORTED_LANGUAGES entry including the
            ones we cannot translate into. Picking one of those set a target
            language the app had no translations for. One control now, over the
            list we can actually serve. */}
        <TouchableOpacity
          style={settingsStyles.selectButton}
          onPress={() => setShowLearningLangPicker(true)}
        >
          <Text style={settingsStyles.selectLabel}>{t('settings:learningLanguage')}</Text>
          <Text style={settingsStyles.selectValue}>{getTargetLangName(targetLanguage)} ▼</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={settingsStyles.selectButton}
          onPress={() => setShowProficiencyPicker(true)}
        >
          <Text style={settingsStyles.selectLabel}>{t('settings:proficiencyLevel')}</Text>
          <Text style={settingsStyles.selectValue}>{getProfName(proficiencyLevel)} ▼</Text>
        </TouchableOpacity>

        <View style={settingsStyles.divider} />

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

        <Text style={settingsStyles.sectionTitle}>{t('settings:soundAndHaptics')}</Text>
        <View style={settingsStyles.notifRow}>
          <View style={settingsStyles.notifInfo}>
            <Text style={settingsStyles.notifLabel}>{t('settings:soundEffects')}</Text>
            <Text style={settingsStyles.notifDesc}>{t('settings:soundEffectsDesc')}</Text>
          </View>
          <TouchableOpacity
            style={[settingsStyles.notifToggle, soundEnabled && settingsStyles.notifToggleOn]}
            onPress={() => setSoundEnabled(!soundEnabled)}
          >
            <Text style={settingsStyles.notifToggleText}>{soundEnabled ? 'ON' : 'OFF'}</Text>
          </TouchableOpacity>
        </View>
        <View style={settingsStyles.notifRow}>
          <View style={settingsStyles.notifInfo}>
            <Text style={settingsStyles.notifLabel}>{t('settings:haptics')}</Text>
            <Text style={settingsStyles.notifDesc}>{t('settings:hapticsDesc')}</Text>
          </View>
          <TouchableOpacity
            style={[settingsStyles.notifToggle, hapticsEnabled && settingsStyles.notifToggleOn]}
            onPress={() => setHapticsEnabled(!hapticsEnabled)}
          >
            <Text style={settingsStyles.notifToggleText}>{hapticsEnabled ? 'ON' : 'OFF'}</Text>
          </TouchableOpacity>
        </View>

        <Text style={settingsStyles.sectionTitle}>{t('settings:notifications')}</Text>
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
          <Text style={settingsStyles.settingsLinkArrow}>{FORWARD_ARROW}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={settingsStyles.settingsLink} onPress={async () => {
          const { restorePurchases } = require('../../services/billing');
          const result = await restorePurchases();
          Alert.alert(result.restored ? t('billing:paywall.restoredTitle') : t('billing:paywall.notFoundTitle'), result.message);
        }}>
          <Text style={settingsStyles.settingsLinkText}>{t('settings:restorePurchases')}</Text>
          <Text style={settingsStyles.settingsLinkArrow}>{FORWARD_ARROW}</Text>
        </TouchableOpacity>

        <Text style={settingsStyles.sectionTitle}>{t('settings:legal')}</Text>
        <TouchableOpacity style={settingsStyles.settingsLink} onPress={onNavigateToPrivacy}>
          <Text style={settingsStyles.settingsLinkText}>{t('settings:privacyPolicy')}</Text>
          <Text style={settingsStyles.settingsLinkArrow}>{FORWARD_ARROW}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={settingsStyles.settingsLink} onPress={onNavigateToTerms}>
          <Text style={settingsStyles.settingsLinkText}>{t('settings:termsOfService')}</Text>
          <Text style={settingsStyles.settingsLinkArrow}>{FORWARD_ARROW}</Text>
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
      {/* The three account pickers commit on selection now — see `commitField`.
          They used to hold their value in local state until a Save button far
          down the page, which meant picking a proficiency level and tapping
          Back threw it away without a word. */}
      {renderPicker(
        showNativeLangPicker,
        () => setShowNativeLangPicker(false),
        SUPPORTED_LANGUAGES,
        nativeLanguage,
        (code) => commitField('native_language', code, setNativeLanguage, nativeLanguage),
        t('settings:nativeLanguage'),
      )}
      {/* Over AVAILABLE_LANGUAGES, not SUPPORTED_LANGUAGES: this picker now
          sets what words translate INTO, so it may only offer languages we
          have translations for. `setTargetLanguage` persists it locally and
          onto the account's `learning_language`, so no commitField here. */}
      {renderPicker(
        showLearningLangPicker,
        () => setShowLearningLangPicker(false),
        AVAILABLE_LANGUAGES,
        targetLanguage,
        setTargetLanguage,
        t('settings:learningLanguage'),
      )}
      {renderPicker(
        showProficiencyPicker,
        () => setShowProficiencyPicker(false),
        proficiencyItems,
        proficiencyLevel,
        (code) => commitField('proficiency_level', code, setProficiencyLevel, proficiencyLevel),
        t('settings:proficiencyLevel'),
      )}
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
  // Translation languages. A wrapping grid rather than the `segmented` row —
  // twelve endonyms of very different widths ("中文" against "Azərbaycan")
  // don't divide a row evenly, and forcing them to would clip the long ones.
  langGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  langChip: {
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: tc.border,
    backgroundColor: tc.paper,
  },
  langChipActive: {
    backgroundColor: tc.primary,
    borderColor: tc.primary,
  },
  langChipText: {
    fontSize: 13.5,
    fontWeight: '600',
    color: tc.textSecondary,
  },
  langChipTextActive: {
    color: tc.textInverse,
    fontWeight: '800',
  },
});
