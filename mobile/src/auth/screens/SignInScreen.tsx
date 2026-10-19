import { router } from "expo-router";
import { useRef, useState } from "react";
import { type TextInput, View } from "react-native";
import { isRequestError } from "@/api/api-error";
import { auth } from "@/auth";
import {
  fieldErrors,
  formErrorsFrom,
  type FieldName,
  type FormErrors,
} from "@/auth/forms/error-messages";
import { clearHandoff, handOff, readHandoff, takeNotice } from "@/auth/forms/handoff";
import { emailError, normalizeEmail, signInPasswordError } from "@/auth/forms/validation";
import { Button, Input, Screen } from "@/components";
import { FormMessage, ScreenTitle } from "./parts";

const NO_ERRORS: FormErrors = { form: null, fields: {} };

// Email + password. An account whose email is not confirmed yet is sent to the code screen.
export default function SignInScreen() {
  const [email, setEmail] = useState(() => readHandoff().email ?? "");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState(takeNotice); // shown once: "Email confirmed", "Password changed"
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [submitting, setSubmitting] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  const edit = (field: FieldName, set: (value: string) => void) => (value: string) => {
    set(value);
    setErrors((current) => ({
      form: null,
      fields: { ...current.fields, [field]: undefined },
    }));
  };

  async function submit() {
    setNotice(null); // the next message is about this attempt, not the previous screen
    const fields = fieldErrors({
      email: emailError(email),
      password: signInPasswordError(password),
    });
    if (Object.keys(fields).length > 0) {
      setErrors({ form: null, fields });
      return;
    }
    setErrors(NO_ERRORS);
    setSubmitting(true);
    try {
      await auth.signIn({ email: normalizeEmail(email), password });
      clearHandoff();
      router.replace("/events");
    } catch (error) {
      if (isRequestError(error) && error.code === "EMAIL_NOT_VERIFIED") {
        // The password was right (the backend says so only then): finish the sign-up first.
        handOff({ email: normalizeEmail(email), codeSentAt: null });
        router.push("/verify-email");
        return;
      }
      setErrors(formErrorsFrom(error, "signIn"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen scroll>
      <View className="gap-6">
        <ScreenTitle
          title="Welcome back"
          subtitle="Sign in to vote and edit playlists with the room."
        />
        {notice ? <FormMessage tone="success">{notice}</FormMessage> : null}
        <View className="gap-4">
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
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
          <Input
            ref={passwordRef}
            label="Password"
            value={password}
            onChangeText={edit("password", setPassword)}
            error={errors.fields.password}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={submit}
          />
        </View>
        {errors.form ? <FormMessage tone="error">{errors.form}</FormMessage> : null}
        <Button title="Sign in" fullWidth loading={submitting} onPress={submit} />
        <View className="gap-1">
          <Button
            title="Forgot your password?"
            variant="ghost"
            onPress={() => {
              handOff({ email: email.trim() ? normalizeEmail(email) : null });
              router.push("/forgot-password");
            }}
          />
          <Button
            title="Create an account"
            variant="ghost"
            onPress={() => router.replace("/sign-up")}
          />
        </View>
      </View>
    </Screen>
  );
}
