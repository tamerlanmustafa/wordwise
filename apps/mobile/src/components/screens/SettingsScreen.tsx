import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CEFR_LEVELS, AVAILABLE_LANGUAGES } from '../../types';
import { useThemeColors } from '../../theme/tokens';
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
import { useBottomBarInset } from '../../hooks/useBottomBarInset';
import { ScreenHeader } from '../common/ScreenHeader';
import { useAuthStore } from '../../stores/authStore';
import {
  Avatar,
  LinkRow,
  Rows,
  Section,
  Segmented,
  SelectRow,
  SwitchRow,
} from './settings/SettingsUI';

interface Props {
  onBack: () => void;
  /** Accepted so App.tsx can keep passing it uniformly, but deliberately not
   *  rendered: the header shows the same plain "← Back" as every other pushed
   *  screen rather than naming where you came from. */
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
  user,
  onUserUpdated,
  onNavigateToFamilyPlan,
  onNavigateToPrivacy,
  onNavigateToTerms,
  targetLanguage,
  setTargetLanguage,
}: Props) => {
  const [username, setUsername] = useState(user?.username || '');
  const [proficiencyLevel, setProficiencyLevel] = useState(user?.proficiency_level || 'A1');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [showNativeLangPicker, setShowNativeLangPicker] = useState(false);
  const [showProficiencyPicker, setShowProficiencyPicker] = useState(false);
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
  const settingsStyles = useMemo(() => makeSettingsStyles(tc), [tc]);
  // The tab bar is an absolute overlay, so this screen has to reserve its
  // height itself. Without it the last section — Legal — scrolled under the
  // floating capsule and its links could not be tapped.
  const barInset = useBottomBarInset();

  useEffect(() => {
    AsyncStorage.getItem('notif_review').then((v) => { if (v === 'off') setReviewNotif(false); });
  }, []);

  /**
   * The one language control. It sets what English is translated INTO, and
   * also writes `native_language` so the account field agrees with what the
   * user picked — `setTargetLanguage` already keeps `learning_language` in
   * step, and leaving the third column disagreeing with the other two is how
   * this got confusing in the first place.
   */
  const handleSelectNativeLanguage = (code: string) => {
    setTargetLanguage(code);
    if (!user) return;
    authApi
      .updateProfile({ native_language: code.toLowerCase() })
      .then(onUserUpdated)
      .catch(() => {});
  };

  const handleRestorePurchases = async () => {
    const { restorePurchases } = require('../../services/billing');
    const result = await restorePurchases();
    Alert.alert(
      result.restored
        ? t('billing:paywall.restoredTitle')
        : t('billing:paywall.notFoundTitle'),
      result.message,
    );
  };

  /**
   * Account deletion, moved here from the profile sheet so it sits at the end
   * of Settings rather than one tap from every other menu item. Still
   * double-confirmed, and the confirmation is still `destructive` — the row is
   * quiet, the commitment is not.
   */
  const handleDeleteAccount = () => {
    showConfirm({
      title: t('settings:menu.deleteAccountTitle'),
      message: t('settings:menu.deleteAccountBody'),
      confirmLabel: t('settings:menu.delete'),
      tone: 'destructive',
      onConfirm: () => {
        useAuthStore.getState().deleteAccount().catch(() => {
          Alert.alert(
            t('settings:menu.deleteFailedTitle'),
            t('settings:menu.deleteFailedBody'),
          );
        });
      },
    });
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
      {/* No `backLabel`: every other pushed screen in the app renders a plain
          "← Back", and Settings was the only one naming where you came from. */}
      <ScreenHeader onBack={handleBack} title={t('settings:title')} />

      <ScrollView
        style={settingsStyles.scrollContent}
        contentContainerStyle={[settingsStyles.scrollContainer, { paddingBottom: barInset + 24 }]}
      >
        {/* ── Profile ───────────────────────────────────────────────────── */}
        <Section title={t('settings:profile')}>
          <View style={settingsStyles.identityRow}>
            <Avatar uri={user?.profile_picture_url} name={user?.username || user?.email} />
            <View style={settingsStyles.identityText}>
              <Text style={settingsStyles.identityName} numberOfLines={1}>
                {user?.username || t('settings:usernamePlaceholder')}
              </Text>
              {user?.email ? (
                <Text style={settingsStyles.identityEmail} numberOfLines={1}>
                  {user.email}
                </Text>
              ) : null}
            </View>
          </View>
          <View style={settingsStyles.fieldBlock}>
            <Text style={settingsStyles.inputLabel}>{t('settings:username')}</Text>
            <TextInput
              style={settingsStyles.textInput}
              value={username}
              onChangeText={setUsername}
              placeholder={t('settings:usernamePlaceholder')}
              placeholderTextColor={tc.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={handleSaveUsername}
            />
            {/* Save sits with the field it saves, and only appears once there
                is something to save. */}
            {canSaveUsername(username, user?.username) ? (
              <TouchableOpacity
                style={[settingsStyles.saveButton, saving && settingsStyles.saveButtonDisabled]}
                onPress={handleSaveUsername}
                disabled={saving}
                activeOpacity={0.7}
              >
                {saving ? (
                  <ActivityIndicator size="small" color={tc.goldDeep} />
                ) : (
                  <Text style={settingsStyles.saveButtonText}>{t('settings:saveChanges')}</Text>
                )}
              </TouchableOpacity>
            ) : null}
          </View>
        </Section>

        {error ? (
          <View style={settingsStyles.alertError}>
            <Text style={settingsStyles.alertErrorText}>{error}</Text>
          </View>
        ) : null}
        {success ? (
          <View style={settingsStyles.alertSuccess}>
            <Text style={settingsStyles.alertSuccessText}>{success}</Text>
          </View>
        ) : null}

        {/* ── Language & level ──────────────────────────────────────────────
            ONE language control. We only ever translate out of English, so the
            target is always the user's own language — "native language" and
            "translation language" were two names, two pickers and two lists
            for a single value. */}
        <Section
          title={t('settings:languagePreferences')}
          footer={t('settings:nativeLanguageFooter')}
        >
          <Rows>
            <SelectRow
              label={t('settings:nativeLanguage')}
              value={getTargetLangName(targetLanguage)}
              onPress={() => setShowNativeLangPicker(true)}
            />
            <SelectRow
              label={t('settings:proficiencyLevel')}
              value={getProfName(proficiencyLevel)}
              onPress={() => setShowProficiencyPicker(true)}
            />
          </Rows>
        </Section>

        {/* ── Appearance ────────────────────────────────────────────────── */}
        <Section title={t('settings:appearance')}>
          <Segmented
            value={themePreference}
            onChange={setThemePreference}
            options={(['light', 'system', 'dark'] as ThemePreference[]).map((opt) => ({
              value: opt,
              label: t(`settings:theme.${opt}`),
            }))}
          />
        </Section>

        {/* ── Sound & haptics ───────────────────────────────────────────── */}
        <Section title={t('settings:soundAndHaptics')}>
          <Rows>
            <SwitchRow
              label={t('settings:soundEffects')}
              description={t('settings:soundEffectsDesc')}
              value={soundEnabled}
              onValueChange={setSoundEnabled}
            />
            <SwitchRow
              label={t('settings:haptics')}
              description={t('settings:hapticsDesc')}
              value={hapticsEnabled}
              onValueChange={setHapticsEnabled}
            />
          </Rows>
        </Section>

        {/* ── Notifications ─────────────────────────────────────────────── */}
        <Section title={t('settings:notifications')}>
          <SwitchRow
            label={t('settings:reviewReminder')}
            description={t('settings:reviewReminderDesc')}
            value={reviewNotif}
            onValueChange={toggleReview}
          />
        </Section>

        {/* ── Subscription ──────────────────────────────────────────────── */}
        <Section title={t('settings:subscription')}>
          <Rows>
            <LinkRow label={t('settings:familyPlan')} onPress={onNavigateToFamilyPlan} />
            <LinkRow label={t('settings:restorePurchases')} onPress={handleRestorePurchases} />
          </Rows>
        </Section>

        {/* ── Legal ─────────────────────────────────────────────────────── */}
        <Section title={t('settings:legal')}>
          <Rows>
            <LinkRow label={t('settings:privacyPolicy')} onPress={onNavigateToPrivacy} />
            <LinkRow label={t('settings:termsOfService')} onPress={onNavigateToTerms} />
          </Rows>
        </Section>

        {/* ── Account ───────────────────────────────────────────────────────
            Deletion has to be reachable in-app (App Store 5.1.1(v)), and it is
            the one row nobody should reach by accident. Last section, muted
            rather than red: red is an alarm colour and an alarm draws the eye,
            which is the opposite of what this row wants. The confirmation still
            carries the destructive tone. */}
        <Section title={t('settings:account')} footer={t('settings:deleteAccountFooter')}>
          <LinkRow label={t('settings:menu.deleteAccount')} muted onPress={handleDeleteAccount} />
        </Section>
      </ScrollView>

      {/* Over AVAILABLE_LANGUAGES, not SUPPORTED_LANGUAGES: this sets what
          words translate INTO, so it may only offer languages we have
          translations for. */}
      {renderPicker(
        showNativeLangPicker,
        () => setShowNativeLangPicker(false),
        AVAILABLE_LANGUAGES,
        targetLanguage,
        handleSelectNativeLanguage,
        t('settings:nativeLanguage'),
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

