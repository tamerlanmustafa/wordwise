import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { reportsApi, type ReportReason } from '../services/api';
import { FlagIcon } from './ui/icons';
import { withTap } from '../utils/feedback';

// Mirrors the web ReportDialog (frontend/src/components/ReportDialog.tsx),
// adapted to React Native primitives. Same shape, same backend call.

const REASON_OPTIONS: ReportReason[] = [
  'WRONG_TRANSLATION',
  'WRONG_CONTEXT',
  'WRONG_SPELLING',
  'INAPPROPRIATE_CONTENT',
  'OTHER',
];

const COLORS = {
  primary: '#7C5CBF',
  warning: '#F4A261',
  warningDark: '#D4823F',
  error: '#D66A6A',
  text: '#2D3142',
  textSecondary: '#5C6378',
  border: '#E8E8EC',
  surface: '#FAFAF8',
  paper: '#FFFFFF',
  overlay: 'rgba(0, 0, 0, 0.45)',
};

export interface ReportDialogProps {
  visible: boolean;
  onClose: () => void;
  word: string;
  movieId?: number | null;
  movieTitle?: string;
  translationSource?: string;
  onSubmitted?: () => void;
}

export function ReportDialog({
  visible,
  onClose,
  word,
  movieId,
  movieTitle,
  translationSource,
  onSubmitted,
}: ReportDialogProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState<ReportReason | ''>('');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setReason('');
    setDetails('');
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    if (submitting) return;
    reset();
    onClose();
  }, [submitting, onClose, reset]);

  const handleSubmit = useCallback(async () => {
    if (!reason) {
      setError(t('report.error.selectReason'));
      return;
    }
    if (reason === 'OTHER' && !details.trim()) {
      setError(t('report.error.detailsRequired'));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await reportsApi.create({
        word,
        movie_id: movieId ?? undefined,
        movie_title: movieTitle,
        reason,
        details: details.trim() || undefined,
        translation_source: translationSource,
      });
      reset();
      onSubmitted?.();
      onClose();
    } catch (e: any) {
      setError(e?.message || t('report.error.submitFailed'));
    } finally {
      setSubmitting(false);
    }
  }, [t, reason, details, word, movieId, movieTitle, translationSource, onClose, onSubmitted, reset]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          {/* Header */}
          <View style={styles.header}>
            <FlagIcon size={18} solid color={COLORS.warning} style={styles.headerIcon} />
            <Text style={styles.headerTitle}>{t('report.title')}</Text>
            <TouchableOpacity onPress={withTap(handleClose)} disabled={submitting} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.headerClose}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 8 }}>
            <Text style={styles.metaLabel}>{t('report.reportingWord')}</Text>
            <Text style={styles.wordText}>{word}</Text>
            {movieTitle ? (
              <Text style={styles.movieText}>{t('report.fromMovie', { title: movieTitle })}</Text>
            ) : null}

            <Text style={styles.sectionLabel}>{t('report.issueQuestion')}</Text>
            {REASON_OPTIONS.map((opt) => {
              const selected = reason === opt;
              return (
                <TouchableOpacity
                  key={opt}
                  style={[styles.reasonRow, selected && styles.reasonRowSelected]}
                  onPress={withTap(() => {
                    setReason(opt);
                    setError(null);
                  })}
                  activeOpacity={0.7}
                >
                  <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>
                    {selected && <View style={styles.radioInner} />}
                  </View>
                  <Text style={[styles.reasonText, selected && styles.reasonTextSelected]}>
                    {t(`report.reason.${opt}`)}
                  </Text>
                </TouchableOpacity>
              );
            })}

            <Text style={styles.sectionLabel}>{t('report.additionalDetails')}</Text>
            <TextInput
              style={styles.textInput}
              multiline
              numberOfLines={3}
              placeholder={
                reason === 'OTHER' ? t('report.detailsRequired') : t('report.detailsOptional')
              }
              placeholderTextColor="#A0A4B0"
              value={details}
              onChangeText={(t) => {
                setDetails(t);
                setError(null);
              }}
              editable={!submitting}
            />

            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}
          </ScrollView>

          {/* Footer */}
          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.btn, styles.btnGhost]}
              onPress={withTap(handleClose)}
              disabled={submitting}
            >
              <Text style={styles.btnGhostText}>{t('action.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary, (!reason || submitting) && styles.btnDisabled]}
              onPress={withTap(handleSubmit)}
              disabled={!reason || submitting}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.btnPrimaryText}>{t('report.submit')}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '85%',
    backgroundColor: COLORS.paper,
    borderRadius: 16,
    overflow: 'hidden',
    borderTopWidth: 4,
    borderTopColor: COLORS.warning,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerIcon: {
    marginEnd: 8,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  headerClose: {
    fontSize: 20,
    color: COLORS.textSecondary,
    paddingHorizontal: 4,
  },
  body: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  metaLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  wordText: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 2,
  },
  movieText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
    fontStyle: 'italic',
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 18,
    marginBottom: 8,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 8,
  },
  reasonRowSelected: {
    borderColor: COLORS.warning,
    backgroundColor: '#FFF8F1',
  },
  radioOuter: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: COLORS.border,
    marginEnd: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterSelected: {
    borderColor: COLORS.warning,
  },
  radioInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.warning,
  },
  reasonText: {
    fontSize: 14,
    color: COLORS.text,
  },
  reasonTextSelected: {
    fontWeight: '600',
  },
  textInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: COLORS.text,
    minHeight: 80,
    textAlignVertical: 'top',
    backgroundColor: COLORS.surface,
  },
  errorBox: {
    marginTop: 12,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#FCE8E8',
  },
  errorText: {
    color: COLORS.error,
    fontSize: 13,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    padding: 16,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  btn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
    minWidth: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGhost: {
    backgroundColor: 'transparent',
  },
  btnGhostText: {
    color: COLORS.textSecondary,
    fontSize: 15,
    fontWeight: '500',
  },
  btnPrimary: {
    backgroundColor: COLORS.warning,
  },
  btnPrimaryText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  btnDisabled: {
    opacity: 0.4,
  },
});
