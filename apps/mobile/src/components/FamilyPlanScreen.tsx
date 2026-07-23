import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { familyApi, type FamilyPlan } from '../services/api';
import { useIsPremium } from '../stores/entitlementsStore';

const COLORS = {
  primary: '#7C5CBF',
  background: '#FAFAF8',
  paper: '#FFFFFF',
  text: '#2D3142',
  textSecondary: '#5C6378',
  textTertiary: '#9AA0AE',
  border: '#E8E8EC',
  error: '#D66A6A',
  success: '#4CAF9A',
};

export interface FamilyPlanScreenProps {
  onBack: () => void;
  userId: number;
}

export function FamilyPlanScreen({ onBack, userId }: FamilyPlanScreenProps) {
  const { t } = useTranslation();
  const isPremium = useIsPremium();
  const [plan, setPlan] = useState<FamilyPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = await familyApi.getPlan();
      setPlan(p);
    } catch (e) {
      console.warn('[FamilyPlan] load failed:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    try {
      const p = await familyApi.createPlan();
      setPlan(p);
    } catch (e: any) {
      Alert.alert(t('billing:family.errorTitle'), e.message || t('billing:family.createFailed'));
    }
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      await familyApi.inviteMember(inviteEmail.trim());
      setInviteEmail('');
      load();
    } catch (e: any) {
      Alert.alert(t('billing:family.errorTitle'), e.message || t('billing:family.inviteFailed'));
    } finally {
      setInviting(false);
    }
  };

  const handleRemove = (memberId: number, email: string) => {
    Alert.alert(t('billing:family.removeMember'), t('billing:family.removeMemberBody', { email }), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        try { await familyApi.removeMember(memberId); load(); } catch {}
      }},
    ]);
  };

  const handleLeave = () => {
    Alert.alert(t('billing:family.leaveTitle'), t('billing:family.leaveBody'), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: async () => {
        try { await familyApi.leave(); load(); } catch {}
      }},
    ]);
  };

  const isOwner = plan?.owner_id === userId;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={8}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('billing:family.title')}</Text>
        <View style={{ width: 60 }} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : !plan ? (
        <View style={styles.centered}>
          <Text style={styles.emptyIcon}>👨‍👩‍👧‍👦</Text>
          <Text style={styles.emptyTitle}>{t('billing:family.title')}</Text>
          <Text style={styles.emptyBody}>
            Share your WordWise Plus subscription with up to 4 family members.
            Each member gets full premium access.
          </Text>
          {isPremium ? (
            <TouchableOpacity style={styles.primaryBtn} onPress={handleCreate}>
              <Text style={styles.primaryBtnText}>{t('billing:family.create')}</Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.needsPremium}>{t('billing:family.requiresPlus')}</Text>
          )}
        </View>
      ) : (
        <View style={styles.content}>
          <View style={styles.planCard}>
            <Text style={styles.planTitle}>
              {isOwner ? t('billing:family.yourPlan') : t('billing:family.ownersPlan', { email: plan.owner_email })}
            </Text>
            <Text style={styles.memberCount}>
              {plan.members.length + 1} / {plan.max_members} members
            </Text>
          </View>

          <Text style={styles.sectionTitle}>{t('billing:family.members')}</Text>
          <View style={styles.memberRow}>
            <Text style={styles.memberEmail}>{plan.owner_email}</Text>
            <Text style={styles.ownerBadge}>{t('billing:family.owner')}</Text>
          </View>
          {plan.members.map((m) => (
            <View key={m.user_id} style={styles.memberRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.memberEmail}>{m.email}</Text>
                <Text style={styles.memberUsername}>@{m.username}</Text>
              </View>
              {isOwner && (
                <TouchableOpacity onPress={() => handleRemove(m.user_id, m.email)}>
                  <Text style={styles.removeBtn}>{t('billing:family.remove')}</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}

          {isOwner && plan.members.length < plan.max_members - 1 && (
            <View style={styles.inviteSection}>
              <Text style={styles.sectionTitle}>{t('billing:family.invite')}</Text>
              <View style={styles.inviteRow}>
                <TextInput
                  style={styles.inviteInput}
                  placeholder={t('billing:family.emailPlaceholder')}
                  placeholderTextColor={COLORS.textTertiary}
                  value={inviteEmail}
                  onChangeText={setInviteEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
                <TouchableOpacity
                  style={[styles.inviteBtn, inviting && { opacity: 0.5 }]}
                  onPress={handleInvite}
                  disabled={inviting}
                >
                  <Text style={styles.inviteBtnText}>{inviting ? '...' : 'Invite'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {!isOwner && (
            <TouchableOpacity style={styles.leaveBtn} onPress={handleLeave}>
              <Text style={styles.leaveBtnText}>{t('billing:family.leave')}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: COLORS.paper,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  backText: { fontSize: 16, color: COLORS.primary, fontWeight: '500', width: 60 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { fontSize: 22, fontWeight: '800', color: COLORS.text, marginBottom: 8 },
  emptyBody: { fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  needsPremium: { fontSize: 13, color: COLORS.textTertiary, fontStyle: 'italic' },
  primaryBtn: { backgroundColor: COLORS.primary, paddingVertical: 16, paddingHorizontal: 32, borderRadius: 12 },
  primaryBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  content: { padding: 16 },
  planCard: { backgroundColor: COLORS.paper, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: COLORS.border, marginBottom: 20 },
  planTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text },
  memberCount: { fontSize: 14, color: COLORS.textSecondary, marginTop: 4 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginTop: 8 },
  memberRow: { flexDirection: 'row', alignItems: 'center', padding: 14, backgroundColor: COLORS.paper, borderRadius: 10, marginBottom: 6, borderWidth: 1, borderColor: COLORS.border },
  memberEmail: { fontSize: 15, color: COLORS.text, flex: 1 },
  memberUsername: { fontSize: 12, color: COLORS.textTertiary },
  ownerBadge: { fontSize: 12, fontWeight: '700', color: COLORS.primary, backgroundColor: '#F0EBFF', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  removeBtn: { fontSize: 13, color: COLORS.error, fontWeight: '600' },
  inviteSection: { marginTop: 16 },
  inviteRow: { flexDirection: 'row', gap: 10 },
  inviteInput: { flex: 1, backgroundColor: COLORS.paper, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: COLORS.border, fontSize: 15, color: COLORS.text },
  inviteBtn: { backgroundColor: COLORS.primary, paddingHorizontal: 20, borderRadius: 10, justifyContent: 'center' },
  inviteBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  leaveBtn: { marginTop: 24, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: COLORS.error, alignItems: 'center' },
  leaveBtnText: { fontSize: 15, fontWeight: '600', color: COLORS.error },
});
