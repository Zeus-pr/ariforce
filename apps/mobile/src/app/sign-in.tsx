import * as Haptics from 'expo-haptics';
import { useRef, useState } from 'react';
import { StyleSheet, View, type TextInputInstance } from 'react-native';
import { KeyboardAwareScrollView } from '@/components/scroll';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { LogoLockup } from '@/components/logo-lockup';
import { TextField } from '@/components/text-field';
import { AuthError } from '@/lib/auth-api';
import { useAuth } from '@/lib/auth-context';
import { colors, radius, spacing } from '@/theme';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const TITLES: Partial<Record<AuthError['kind'], string>> = {
  network: 'No connection',
  'rate-limited': 'Too many attempts',
  account: 'Can’t sign in with this account',
  'no-role': 'No access',
  origin: 'Sign-in blocked',
};

export default function SignInScreen() {
  const { signIn, notice, clearNotice } = useAuth();
  const insets = useSafeAreaInsets();
  const passwordRef = useRef<TextInputInstance>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<{ title: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // A session the app ended on its own (role without access, account state) explains itself here.
  const banner = formError ?? (notice ? { title: 'Signed out', body: notice } : null);

  async function submit() {
    if (busy) return;
    const e = email.trim().toLowerCase();
    const errs: typeof fieldErrors = {};
    if (!e) errs.email = 'Enter your work email.';
    else if (!EMAIL_RE.test(e)) errs.email = 'That doesn’t look like an email address.';
    if (!password) errs.password = 'Enter your password.';
    setFieldErrors(errs);
    setFormError(null);
    clearNotice();
    if (errs.email || errs.password) return;

    setBusy(true);
    try {
      await signIn(e, password);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // The auth guard in app/_layout.tsx moves us to home.
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const kind = err instanceof AuthError ? err.kind : 'server';
      const message =
        err instanceof AuthError ? err.message : 'Something went wrong. Try again in a moment.';
      if (kind === 'credentials') {
        setFieldErrors({ password: message });
        setPassword('');
        passwordRef.current?.focus();
      } else {
        setFormError({ title: TITLES[kind] ?? 'Sign-in failed', body: message });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAwareScrollView
      style={styles.flex}
      bottomOffset={spacing.xl}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.scroll,
        { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl },
      ]}
    >
      <LogoLockup />

      <View style={styles.heading}>
        <AppText variant="title" accessibilityRole="header">
          Sign in
        </AppText>
        <AppText variant="subhead">
          Use the email and password you use on the AriForce website.
        </AppText>
      </View>

      <View style={styles.form}>
        <TextField
          label="Work email"
          value={email}
          onChangeText={(t) => {
            setEmail(t);
            if (fieldErrors.email) setFieldErrors((f) => ({ ...f, email: undefined }));
          }}
          placeholder="name@company.com"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          textContentType="username"
          enterKeyHint="next"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => passwordRef.current?.focus()}
          editable={!busy}
          error={fieldErrors.email}
        />
        <TextField
          ref={passwordRef}
          label="Password"
          secret
          value={password}
          onChangeText={(t) => {
            setPassword(t);
            if (fieldErrors.password) setFieldErrors((f) => ({ ...f, password: undefined }));
          }}
          placeholder="Your password"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="current-password"
          textContentType="password"
          enterKeyHint="go"
          returnKeyType="go"
          onSubmitEditing={submit}
          editable={!busy}
          error={fieldErrors.password}
        />

        {banner && (
          <View style={styles.alert} accessibilityRole="alert" accessibilityLiveRegion="polite">
            <AppText variant="headline" style={styles.alertText}>
              {banner.title}
            </AppText>
            <AppText variant="caption" style={styles.alertText}>
              {banner.body}
            </AppText>
          </View>
        )}

        <Button label="Sign in" loadingLabel="Signing in…" loading={busy} onPress={submit} />
      </View>

      <AppText variant="caption" style={styles.help}>
        Forgot your password? Reset it on the AriForce website, or ask your administrator.
      </AppText>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.ground },
  scroll: { flexGrow: 1, paddingHorizontal: spacing.xl },
  heading: { marginTop: spacing.xxxl, marginBottom: spacing.xl, gap: spacing.sm },
  form: { gap: spacing.lg + spacing.xs },
  alert: {
    backgroundColor: colors.dangerWash,
    borderColor: colors.dangerBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    padding: spacing.md,
    gap: spacing.xs,
  },
  alertText: { color: colors.danger },
  help: { marginTop: spacing.xl, textAlign: 'center' },
});
