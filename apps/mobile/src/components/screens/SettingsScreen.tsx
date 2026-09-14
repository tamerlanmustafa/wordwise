import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { CEFR_LEVELS, AVAILABLE_LANGUAGES } from '../../types';
import { useThemeColors } from '../../theme/tokens';
import { useThemeStore, type ThemePreference } from '../../stores/themeStore';
import { authApi } from '../../services/api';
import { showConfirm } from '../../stores/confirmStore';
import {
  canSaveUsername,
  hasUnsavedUsername,
  normalizeUsername,
  usernameState,
} from './profileForm';
import { USERNAME_MAX, usernameProblem } from '../../utils/username';
import { clearExplicitAppLanguage } from '../../i18n';
import { makeSettingsStyles } from './settingsStyles';
import { useBottomBarInset } from '../../hooks/useBottomBarInset';
import { ScreenHeader } from '../common/ScreenHeader';
import {
  Rows,
  Section,
  Segmented,
  SelectRow,
} from './settings/SettingsUI';
import { withTap } from '../../utils/feedback';

interface Props {
  onBack: () => void;
  /** Accepted so App.tsx can keep passing it uniformly, but deliberately not
   *  rendered: the header shows the same plain "← Back" as every other pushed
   *  screen rather than naming where you came from. */
  backLabel?: string;
  user: any;
  onUserUpdated: (user: any) => void;
  targetLanguage: string;
  setTargetLanguage: (lang: string) => void;
}

export const SettingsScreen = ({
  onBack,
  user,
  onUserUpdated,
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

  const { t } = useTranslation();
  const tc = useThemeColors();
  const themePreference = useThemeStore((s) => s.preference);
  const setThemePreference = useThemeStore((s) => s.setPreference);
  const settingsStyles = useMemo(() => makeSettingsStyles(tc), [tc]);
  // The tab bar is an absolute overlay, so this screen has to reserve its
  // height itself. Without it the last section — Legal — scrolled under the
  // floating capsule and its links could not be tapped.
  const barInset = useBottomBarInset();

  useEffect(() => {
  }, []);

  /**
   * The one language control. It sets what English is translated INTO, and
   * also writes `native_language` so the account field agrees with what the
   * user picked — `setTargetLanguage` already keeps `learning_language` in
   * step, and leaving the third column disagreeing with the other two is how
   * this got confusing in the first place.
   *
   * ## It now moves the interface too, which it never actually did
   *
   * The App language section was removed from this screen deliberately, on the
   * understanding that the UI would simply follow the translation language.
   * It did not. `resolveAppLanguage` ranks the account's `language_preference`
   * ABOVE the translation language, and signup pins that column to whatever
   * the device locale was at the time — so the interface was frozen at signup
   * and this picker could never move it. `setAppLanguage(persist)` and
   * `clearExplicitAppLanguage` existed for a Settings control that no longer
   * shipped, and had zero production call sites.
   *
   * Measured: an account with `native_language: es` and
   * `language_preference: en` — Spanish translations, English interface, and
   * no control anywhere to change it. Six locales that most accounts could
   * never reach.
   *
   * Clearing the pin (rather than setting it to the new language) is what
   * keeps the documented behaviour honest: the interface *follows* the
   * translation language from here on, instead of being re-pinned to a value
   * the user never chose.
   */
  const handleSelectNativeLanguage = (code: string) => {
    setTargetLanguage(code);
    if (!user) return;
    authApi
      // `language_preference: ''` is the schema's documented "clear it", and
      // it has to go in the same PATCH — two requests would let one land and
      // the other fail, leaving the columns disagreeing again.
      .updateProfile({ native_language: code.toLowerCase(), language_preference: '' })
      .then((fresh) => {
        onUserUpdated(fresh);
        // Drop the device-side pin as well, then re-derive. The account copy
        // and the local copy are one preference stored twice; clearing only
        // one restores the other on the next launch.
        void clearExplicitAppLanguage(code);
      })
      .catch(() => {
        // Best-effort, like the rest of this screen's language writes: the
        // translation language already applies locally and the next change
        // retries. Never block the picker on the network.
      });
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
      const state = usernameState(username, user?.username);
      if (state === 'empty') setError(t('settings:usernameRequired'));
      // Say which rule, rather than letting the server answer with a 422 the
      // user then has to interpret. Same rules as onboarding — this screen had
      // none, which is how a 300-character name reached the database.
      if (state === 'invalid') setError(usernameProblem(username, t) ?? '');
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
                  onPress={withTap(() => {
                    onSelect(item.code);
                    onClose();
                  })}
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
          <View style={settingsStyles.fieldBlockOnly}>
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
              // The same ceiling onboarding's field has had all along. Without
              // it this box accepted 300 characters and the server stored them.
              maxLength={USERNAME_MAX}
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

