import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../app-text';
import { Card } from '../card';
import { Icon } from '../icon';
import { colors, fonts, radius, spacing } from '@/theme';

/** Presentational offline-cache / sync stub (no network). */
export function SyncStrip({ label }: { label: string }) {
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState(label);

  function sync() {
    if (busy) return;
    setBusy(true);
    setText('Syncing offline records...');
    setTimeout(() => {
      setText('Synced just now • profiles fresh');
      setBusy(false);
      setTimeout(() => setText(label), 2200);
    }, 900);
  }

  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <Icon name="cloud-check-outline" size={18} color={colors.success} />
        <AppText variant="small" style={styles.label} numberOfLines={1}>
          {text}
        </AppText>
        <Pressable
          onPress={sync}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Sync offline cache"
          style={({ pressed }) => [styles.btn, (pressed || busy) && styles.btnPressed]}
        >
          <AppText variant="chip" style={styles.btnText}>
            {busy ? '…' : 'Sync'}
          </AppText>
        </Pressable>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  label: { flex: 1, color: colors.muted, fontFamily: fonts.medium },
  btn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.tealWash,
  },
  btnPressed: { opacity: 0.7 },
  btnText: { color: colors.canopy, fontFamily: fonts.bold },
});
