import { router } from "expo-router";
import { useRef, useState } from "react";
import { type TextInput, View } from "react-native";
import { auth } from "@/auth";
import {
  fieldErrors,
  formErrorsFrom,
  type FieldName,
  type FormErrors,
} from "@/auth/forms/error-messages";
import { handOff, readHandoff } from "@/auth/forms/handoff";
import { useSecondsUntilResend } from "@/auth/forms/use-seconds-left";
import {
  codeError,
  emailError,
  newPasswordError,
  normalizeEmail,
  PASSWORD_POLICY_HINT,
} from "@/auth/forms/validation";
import { Button, Input, Screen } from "@/components";
import { FormMessage, ScreenTitle } from "./parts";

const NO_ERRORS: FormErrors = { form: null, fields: {} };

// Two steps (ADR-022): ask for a code by email, then the code and a new password. The first answer
// never says whether the address has an account (the backend answers the same either way).
export default function ForgotPasswordScreen() {
  const [step, setStep] = useState<"request" | "reset">("request");
  const [email, setEmail] = useState(() => readHandoff().email ?? "");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [busy, setBusy] = useState<"send" | "reset" | null>(null);
  const passwordRef = useRef<TextInput>(null);
  const secondsLeft = useSecondsUntilResend(sentAt);

  const edit = (field: FieldName, set: (value: string) => void) => (value: string) => {
    set(value);
    setErrors((current) => ({
      form: null,
      fields: { ...current.fields, [field]: undefined },
    }));
  };

  async function sendCode() {
    const problem = emailError(email);
    if (problem) {
      setStep("request");
      setErrors({ form: null, fields: { email: problem } });
      return;
    }
    setErrors(NO_ERRORS);
    setBusy("send");
    try {
      await auth.forgotPassword({ email: normalizeEmail(email) });
      setSentAt(Date.now());
      setStep("reset");
    } catch (error) {
      setErrors(formErrorsFrom(error, "forgot"));
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    const fields = fieldErrors({
      code: codeError(code),
      newPassword: newPasswordError(newPassword),
    });
    if (Object.keys(fields).length > 0) {
      setErrors({ form: null, fields });
      return;
    }
    setErrors(NO_ERRORS);
    setBusy("reset");
    try {
      await auth.resetPassword({
        email: normalizeEmail(email),
        code: code.trim(),
        newPassword,
      });
      // Every session of the account was ended by the reset (ADR-022): sign in again.
      handOff({
        email: normalizeEmail(email),
        codeSentAt: null,
        notice: "Password changed. Sign in with your new password.",
      });
      router.replace("/sign-in");
    } catch (error) {
      setErrors(formErrorsFrom(error, "reset"));
    } finally {
      setBusy(null);
    }
  }

  if (step === "request") {
    return (
      <Screen scroll>
        <View className="gap-6">
          <ScreenTitle
            title="Reset your password"
            subtitle="Enter the email you signed up with. If there is an account for it, we'll send a 6-digit code."
          />
          <Input
            label="Email"
            value={email}
            onChangeText={edit("email", setEmail)}
            error={errors.fields.email}
            placeholder="name@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="send"
            onSubmitEditing={sendCode}
          />
          {errors.form ? <FormMessage tone="error">{errors.form}</FormMessage> : null}
          <Button
            title="Send code"
            fullWidth
            loading={busy === "send"}
            onPress={sendCode}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <View className="gap-6">
        <ScreenTitle
          title="Choose a new password"
          subtitle={`If ${normalizeEmail(email)} has an account, we sent it a 6-digit code. Enter the code with your new password.`}
        />
        <View className="gap-4">
          <Input
            label="Code"
            value={code}
            onChangeText={edit("code", (value) => setCode(value.replace(/\D/g, "")))}
            error={errors.fields.code}
            placeholder="123456"
            keyboardType="number-pad"
            maxLength={6}
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
          <Input
            ref={passwordRef}
            label="New password"
            value={newPassword}
            onChangeText={edit("newPassword", setNewPassword)}
            error={errors.fields.newPassword}
            helper={PASSWORD_POLICY_HINT}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="go"
            onSubmitEditing={reset}
          />
        </View>
        {errors.form ? <FormMessage tone="error">{errors.form}</FormMessage> : null}
        <Button
          title="Change password"
          fullWidth
          loading={busy === "reset"}
          onPress={reset}
        />
        <View className="gap-1">
          <Button
            title={
              secondsLeft > 0 ? `Send a new code in ${secondsLeft} s` : "Send a new code"
            }
            variant="ghost"
            disabled={secondsLeft > 0}
            loading={busy === "send"}
            onPress={sendCode}
          />
          <Button
            title="Use a different email"
            variant="ghost"
            onPress={() => {
              setErrors(NO_ERRORS);
              setStep("request");
            }}
          />
        </View>
      </View>
    </Screen>
  );
}
