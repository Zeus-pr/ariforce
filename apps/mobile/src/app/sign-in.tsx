import { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextInputInstance,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/button';
import { LogoLockup } from '@/components/logo-lockup';
import { TextField } from '@/components/text-field';
import { AuthError } from '@/lib/auth-api';
import { useAuth } from '@/lib/auth-context';
import { colors, fonts, radius, space } from '@/theme';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignInScreen() {
  const { signIn } = useAuth();
  const insets = useSafeAreaInsets();
  const passwordRef = useRef<TextInputInstance>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<{ title: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    const e = email.trim().toLowerCase();
    const errs: typeof fieldErrors = {};
    if (!e) errs.email = 'Enter your work email.';
    else if (!EMAIL_RE.test(e)) errs.email = 'That doesn’t look like an email address.';
    if (!password) errs.password = 'Enter your password.';
    setFieldErrors(errs);
    setFormError(null);
    if (errs.email || errs.password) return;

    setBusy(true);
    try {
      await signIn(e, password);
      // The auth guard in app/_layout.tsx moves us to home.
    } catch (err) {
      const kind = err instanceof AuthError ? err.kind : 'server';
      const message =
        err instanceof AuthError ? err.message : 'Something went wrong. Try again in a moment.';
      if (kind === 'credentials') {
        setFieldErrors({ password: message });
        setPassword('');
        passwordRef.current?.focus();
      } else {
        setFormError({
          title:
            kind === 'network'
              ? 'No connection'
              : kind === 'rate-limited'
                ? 'Too many attempts'
                : kind === 'account'
                  ? 'Can’t sign in with this account'
                  : 'Sign-in failed',
          body: message,
        });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.xl },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <LogoLockup size={32} />

        <View style={styles.heading}>
          <Text style={styles.title} accessibilityRole="header">
            Sign in
          </Text>
          <Text style={styles.subtitle}>
            Use the email and password you use on the AriForce website.
          </Text>
        </View>

        <View style={styles.card}>
          <TextField
            label="Work email"
            value={email}
            onChangeText={(t) => {
              setEmail(t);
              if (fieldErrors.email) setFieldErrors((f) => ({ ...f, email: undefined }));
            }}
            placeholder="name@arighnapharma.com"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            textContentType="username"
            returnKeyType="next"
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
            returnKeyType="go"
            onSubmitEditing={submit}
            editable={!busy}
            error={fieldErrors.password}
          />

          {formError && (
            <View style={styles.alert} accessibilityRole="alert" accessibilityLiveRegion="polite">
              <Text style={styles.alertTitle}>{formError.title}</Text>
              <Text style={styles.alertBody}>{formError.body}</Text>
            </View>
          )}

          <Button label="Sign in" loadingLabel="Signing in…" loading={busy} onPress={submit} />
        </View>

        <Text style={styles.help}>
          Forgot your password? Reset it on the AriForce website, or ask your administrator.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.ground },
  scroll: { flexGrow: 1, paddingHorizontal: space.xl },
  heading: { marginTop: 40, marginBottom: space.xl, gap: 8 },
  title: {
    fontFamily: fonts.bold,
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -0.6,
    color: colors.ink,
  },
  subtitle: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: colors.muted },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.xl - 4,
    gap: space.lg + 2,
    shadowColor: colors.navy,
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  alert: {
    backgroundColor: colors.dangerSoft,
    borderColor: colors.dangerBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    gap: 2,
  },
  alertTitle: { fontFamily: fonts.semibold, fontSize: 14, color: colors.danger },
  alertBody: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.danger },
  help: {
    marginTop: space.xl,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.muted,
    textAlign: 'center',
  },
});
