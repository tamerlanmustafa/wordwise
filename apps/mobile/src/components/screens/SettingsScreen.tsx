import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SUPPORTED_LANGUAGES, PROFICIENCY_LEVELS } from '../../types';
import { colors } from '../../theme/palette';
import { API_BASE_URL } from '../../services/api';
import { scheduleDailyWordReminder, scheduleReviewReminder } from '../../services/notifications';
import { settingsStyles } from './settingsStyles';

interface Props {
  onBack: () => void;
  user: any;
  onUserUpdated: (user: any) => void;
  onNavigateToFamilyPlan: () => void;
  onNavigateToPrivacy: () => void;
  onNavigateToTerms: () => void;
}

export const SettingsScreen = ({
  onBack,
  user,
  onUserUpdated,
  onNavigateToFamilyPlan,
  onNavigateToPrivacy,
  onNavigateToTerms,
}: Props) => {
  const [username, setUsername] = useState(user?.username || '');
  const [nativeLanguage, setNativeLanguage] = useState(user?.native_language || 'en');
  const [learningLanguage, setLearningLanguage] = useState(user?.learning_language || 'en');
  const [proficiencyLevel, setProficiencyLevel] = useState(user?.proficiency_level || 'A1');
  const [defaultTab, setDefaultTab] = useState<'movies' | 'books'>(user?.default_tab || 'movies');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [showNativeLangPicker, setShowNativeLangPicker] = useState(false);
  const [showLearningLangPicker, setShowLearningLangPicker] = useState(false);
  const [showProficiencyPicker, setShowProficiencyPicker] = useState(false);
  const [dailyWordNotif, setDailyWordNotif] = useState(true);
  const [reviewNotif, setReviewNotif] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem('notif_daily_word').then((v) => { if (v === 'off') setDailyWordNotif(false); });
    AsyncStorage.getItem('notif_review').then((v) => { if (v === 'off') setReviewNotif(false); });
  }, []);

  const toggleDailyWord = async () => {
    const next = !dailyWordNotif;
    setDailyWordNotif(next);
    await AsyncStorage.setItem('notif_daily_word', next ? 'on' : 'off');
    if (next) {
      scheduleDailyWordReminder();
    } else {
      try {
        const Notif = require('expo-notifications');
        await Notif.cancelScheduledNotificationAsync('daily-word');
      } catch {}
    }
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
      setError('Username is required');
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
          default_tab: defaultTab,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to update settings');
      }

      const updatedUser = await response.json();
      onUserUpdated(updatedUser);
      setSuccess('Settings updated successfully!');
    } catch (err: any) {
      setError(err.message || 'Failed to update settings');
    } finally {
      setSaving(false);
    }
  };

  const getLangName = (code: string) =>
    SUPPORTED_LANGUAGES.find((l) => l.code === code)?.name || code;

  const getProfName = (code: string) =>
    PROFICIENCY_LEVELS.find((l) => l.code === code)?.name || code;

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
                <Text style={settingsStyles.modalClose}>Done</Text>
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
          <Text style={settingsStyles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={settingsStyles.headerTitle}>Settings</Text>
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
            <Text style={settingsStyles.profileTitle}>Account Settings</Text>
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
            placeholder="Enter username"
            placeholderTextColor={colors.textSecondary}
          />
        </View>

        <View style={settingsStyles.divider} />

        <Text style={settingsStyles.sectionTitle}>Language Preferences</Text>

        <TouchableOpacity
          style={settingsStyles.selectButton}
          onPress={() => setShowNativeLangPicker(true)}
        >
          <Text style={settingsStyles.selectLabel}>Native Language</Text>
          <Text style={settingsStyles.selectValue}>{getLangName(nativeLanguage)} ▼</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={settingsStyles.selectButton}
          onPress={() => setShowLearningLangPicker(true)}
        >
          <Text style={settingsStyles.selectLabel}>Learning Language</Text>
          <Text style={settingsStyles.selectValue}>{getLangName(learningLanguage)} ▼</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={settingsStyles.selectButton}
          onPress={() => setShowProficiencyPicker(true)}
        >
          <Text style={settingsStyles.selectLabel}>Proficiency Level</Text>
          <Text style={settingsStyles.selectValue}>{getProfName(proficiencyLevel)} ▼</Text>
        </TouchableOpacity>

        <View style={settingsStyles.divider} />

        <Text style={settingsStyles.sectionTitle}>Default Home Tab</Text>
        <View style={settingsStyles.tabToggle}>
          <TouchableOpacity
            style={[settingsStyles.tabOption, defaultTab === 'movies' && settingsStyles.tabOptionActive]}
            onPress={() => setDefaultTab('movies')}
          >
            <Text style={[settingsStyles.tabOptionText, defaultTab === 'movies' && settingsStyles.tabOptionTextActive]}>
              Movies
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[settingsStyles.tabOption, defaultTab === 'books' && settingsStyles.tabOptionActive]}
            onPress={() => setDefaultTab('books')}
          >
            <Text style={[settingsStyles.tabOptionText, defaultTab === 'books' && settingsStyles.tabOptionTextActive]}>
              Books
            </Text>
          </TouchableOpacity>
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
            <Text style={settingsStyles.saveButtonText}>Save Changes</Text>
          )}
        </TouchableOpacity>

        <View style={settingsStyles.divider} />

        <Text style={settingsStyles.sectionTitle}>Notifications</Text>
        <View style={settingsStyles.notifRow}>
          <View style={settingsStyles.notifInfo}>
            <Text style={settingsStyles.notifLabel}>Today's Word (9:00 AM)</Text>
            <Text style={settingsStyles.notifDesc}>Daily word discovery from popular movies</Text>
          </View>
          <TouchableOpacity
            style={[settingsStyles.notifToggle, dailyWordNotif && settingsStyles.notifToggleOn]}
            onPress={toggleDailyWord}
          >
            <Text style={settingsStyles.notifToggleText}>{dailyWordNotif ? 'ON' : 'OFF'}</Text>
          </TouchableOpacity>
        </View>
        <View style={settingsStyles.notifRow}>
          <View style={settingsStyles.notifInfo}>
            <Text style={settingsStyles.notifLabel}>Review Reminder (6:00 PM)</Text>
            <Text style={settingsStyles.notifDesc}>Reminder to review your saved words</Text>
          </View>
          <TouchableOpacity
            style={[settingsStyles.notifToggle, reviewNotif && settingsStyles.notifToggleOn]}
            onPress={toggleReview}
          >
            <Text style={settingsStyles.notifToggleText}>{reviewNotif ? 'ON' : 'OFF'}</Text>
          </TouchableOpacity>
        </View>

        <Text style={settingsStyles.sectionTitle}>Subscription</Text>
        <TouchableOpacity style={settingsStyles.settingsLink} onPress={onNavigateToFamilyPlan}>
          <Text style={settingsStyles.settingsLinkText}>Family Plan</Text>
          <Text style={settingsStyles.settingsLinkArrow}>→</Text>
        </TouchableOpacity>
        <TouchableOpacity style={settingsStyles.settingsLink} onPress={async () => {
          const { restorePurchases } = require('../../services/billing');
          const result = await restorePurchases();
          Alert.alert(result.restored ? 'Restored!' : 'Not found', result.message);
        }}>
          <Text style={settingsStyles.settingsLinkText}>Restore Purchases</Text>
          <Text style={settingsStyles.settingsLinkArrow}>→</Text>
        </TouchableOpacity>

        <Text style={settingsStyles.sectionTitle}>Legal</Text>
        <TouchableOpacity style={settingsStyles.settingsLink} onPress={onNavigateToPrivacy}>
          <Text style={settingsStyles.settingsLinkText}>Privacy Policy</Text>
          <Text style={settingsStyles.settingsLinkArrow}>→</Text>
        </TouchableOpacity>
        <TouchableOpacity style={settingsStyles.settingsLink} onPress={onNavigateToTerms}>
          <Text style={settingsStyles.settingsLinkText}>Terms of Service</Text>
          <Text style={settingsStyles.settingsLinkArrow}>→</Text>
        </TouchableOpacity>
      </ScrollView>

      {renderPicker(showNativeLangPicker, () => setShowNativeLangPicker(false), SUPPORTED_LANGUAGES, nativeLanguage, setNativeLanguage, 'Native Language')}
      {renderPicker(showLearningLangPicker, () => setShowLearningLangPicker(false), SUPPORTED_LANGUAGES, learningLanguage, setLearningLanguage, 'Learning Language')}
      {renderPicker(showProficiencyPicker, () => setShowProficiencyPicker(false), PROFICIENCY_LEVELS, proficiencyLevel, setProficiencyLevel, 'Proficiency Level')}
    </SafeAreaView>
  );
};
