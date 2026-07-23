import { StyleSheet } from 'react-native';
import type { ThemeColors } from '../../theme/tokens';

// Shared styles for Settings, Vocabulary, LearnedWords and other
// header-with-back-button "sub-page" screens navigated to from the
// user icon / profile area.
//
// Theme-aware: build per-render with `useMemo(() => makeSettingsStyles(tc), [tc])`
// so these sub-pages follow the light/dark theme instead of the old light-only
// `colors` snapshot.
export const makeSettingsStyles = (tc: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: tc.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: tc.paper,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tc.border,
  },
  backButton: {
    width: 60,
  },
  backButtonText: {
    fontSize: 16,
    color: tc.primaryOnSurface,
    fontWeight: '500',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: tc.text,
  },
  scrollContent: {
    flex: 1,
  },
  scrollContainer: {
    padding: 20,
    paddingBottom: 40,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  avatarPlaceholder: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: tc.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitial: {
    fontSize: 24,
    fontWeight: '700',
    color: tc.textInverse,
  },
  profileInfo: {
    marginStart: 16,
  },
  profileTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: tc.text,
  },
  profileEmail: {
    fontSize: 14,
    color: tc.textSecondary,
    marginTop: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: tc.border,
    marginVertical: 20,
  },
  alertError: {
    backgroundColor: tc.errorTint,
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  alertErrorText: {
    color: tc.error,
    fontSize: 14,
  },
  alertSuccess: {
    backgroundColor: tc.successTint,
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  alertSuccessText: {
    color: tc.success,
    fontSize: 14,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: tc.text,
    marginBottom: 12,
  },
  inputContainer: {
    marginBottom: 4,
  },
  inputLabel: {
    fontSize: 13,
    color: tc.textSecondary,
    marginBottom: 6,
  },
  textInput: {
    backgroundColor: tc.paper,
    borderWidth: 1,
    borderColor: tc.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: tc.text,
  },
  selectButton: {
    backgroundColor: tc.paper,
    borderWidth: 1,
    borderColor: tc.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  selectLabel: {
    fontSize: 14,
    color: tc.textSecondary,
  },
  selectValue: {
    fontSize: 14,
    color: tc.text,
    fontWeight: '500',
  },
  tabToggle: {
    flexDirection: 'row',
    backgroundColor: tc.paper,
    borderWidth: 1,
    borderColor: tc.border,
    borderRadius: 8,
    overflow: 'hidden',
  },
  tabOption: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  tabOptionActive: {
    backgroundColor: tc.primary,
  },
  tabOptionText: {
    fontSize: 15,
    fontWeight: '500',
    color: tc.textSecondary,
  },
  tabOptionTextActive: {
    color: tc.textInverse,
  },
  saveButton: {
    backgroundColor: tc.primary,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 28,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: tc.textInverse,
    fontSize: 16,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: tc.scrim,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: tc.paper,
    borderTopStartRadius: 16,
    borderTopEndRadius: 16,
    maxHeight: '60%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tc.border,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: tc.text,
  },
  modalClose: {
    fontSize: 16,
    fontWeight: '600',
    color: tc.primaryOnSurface,
  },
  modalScroll: {
    paddingBottom: 30,
  },
  modalItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tc.border,
  },
  modalItemSelected: {
    backgroundColor: tc.primaryTint,
  },
  modalItemText: {
    fontSize: 16,
    color: tc.text,
  },
  modalItemTextSelected: {
    color: tc.primaryOnSurface,
    fontWeight: '600',
  },
  checkmark: {
    fontSize: 16,
    color: tc.primaryOnSurface,
    fontWeight: '700',
  },
  notifRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: tc.border,
  },
  notifInfo: { flex: 1 },
  notifLabel: { fontSize: 14, fontWeight: '600', color: tc.text },
  notifDesc: { fontSize: 12, color: tc.textSecondary, marginTop: 2 },
  notifToggle: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: tc.chipBg,
    marginStart: 12,
  },
  notifToggleOn: { backgroundColor: tc.primary },
  notifToggleText: { fontSize: 12, fontWeight: '700', color: tc.textInverse },
  settingsLink: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, paddingHorizontal: 16, backgroundColor: tc.paper,
    borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: tc.border,
  },
  settingsLinkText: { fontSize: 15, color: tc.text },
  settingsLinkArrow: { fontSize: 16, color: tc.textSecondary },
});
