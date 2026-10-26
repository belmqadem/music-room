import type { OAuthProvider, Reauth, User } from "@music-room/shared";
import { useState } from "react";
import { View } from "react-native";
import { auth } from "@/auth";
import { socialErrorMessage } from "@/auth/forms/error-messages";
import { SocialSignInError } from "@/auth/social/provider-credentials";
import {
  PROVIDER_NAMES,
  ProviderLogo,
  PROVIDERS,
  providerIn,
} from "@/auth/social/providers";
import { Button, Card, Input, Text } from "@/components";
import { copy } from "@/copy";
import {
  accountsApi,
  canUnlink,
  hasAnyProof,
  proofOptions,
  signInMethodErrorMessage,
} from "./sign-in-methods";

// Sign-in methods (ADR-025, ADR-044): the password (shown, not changed here), then Google and
// Facebook, each linked or not. SECURITY: Link and Unlink first ask for a proof the account already
// has (the password, or signing in again with a linked provider); only the proofs that can work
// are offered. After either, the user is read again from the server.

const IN_THIS_BUILD = PROVIDERS.map((provider) => provider.id);
const ALL: OAuthProvider[] = ["google", "facebook"];

type Pending = { action: "link" | "unlink"; provider: OAuthProvider };
type Proof = { method: "password" } | { method: "provider"; provider: OAuthProvider };
type Notice = { tone: "success" | "error"; text: string };

export function SignInMethods({ user }: { user: User }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const text = copy.settings.signIn;

  return (
    <View className="gap-3">
      <Text variant="h3">{text.title}</Text>
      <Card className="gap-1">
        <MethodRow
          label={text.password}
          status={user.hasPassword ? (user.email ?? text.linked) : text.noPassword}
        />
        {ALL.map((provider) => {
          const name = PROVIDER_NAMES[provider];
          const linked = user.linkedProviders.includes(provider);
          const open = pending?.provider === provider;
          return (
            <View key={provider} className="gap-3">
              <View className="h-px bg-line-subtle" />
              <MethodRow
                provider={provider}
                label={name}
                status={
                  linked
                    ? canUnlink(user, provider)
                      ? text.linked
                      : text.onlyWay
                    : providerIn(provider)
                      ? text.notLinked
                      : text.notInThisApp
                }
                action={
                  open ? null : linked ? (
                    canUnlink(user, provider) ? (
                      <Button
                        title={text.unlink}
                        variant="ghost"
                        disabled={pending !== null}
                        onPress={() => {
                          setNotice(null);
                          setPending({ action: "unlink", provider });
                        }}
                        accessibilityLabel={text.unlinkName(name)}
                      />
                    ) : null
                  ) : providerIn(provider) ? (
                    <Button
                      title={text.link}
                      variant="secondary"
                      disabled={pending !== null}
                      onPress={() => {
                        setNotice(null);
                        setPending({ action: "link", provider });
                      }}
                      accessibilityLabel={text.linkName(name)}
                    />
                  ) : null
                }
              />
              {open ? (
                <Confirm
                  user={user}
                  pending={pending}
                  onDone={(done) => {
                    setPending(null);
                    setNotice(done);
                  }}
                  onCancel={() => setPending(null)}
                />
              ) : null}
            </View>
          );
        })}
      </Card>
      {notice ? (
        <Text
          tone={notice.tone}
          accessibilityRole={notice.tone === "error" ? "alert" : undefined}
          accessibilityLiveRegion="polite"
        >
          {notice.text}
        </Text>
      ) : null}
    </View>
  );
}

function MethodRow({
  provider,
  label,
  status,
  action,
}: {
  provider?: OAuthProvider;
  label: string;
  status: string;
  action?: React.ReactNode;
}) {
  return (
    <View className="min-h-12 flex-row items-center gap-3 py-2">
      {provider ? <ProviderLogo provider={provider} /> : null}
      <View className="flex-1 gap-1">
        <Text>{label}</Text>
        <Text variant="caption" tone="secondary" numberOfLines={1}>
          {status}
        </Text>
      </View>
      {action}
    </View>
  );
}

/**
 * The proof step, then the change. Linking also needs the NEW account: after the proof, its
 * provider's sign-in runs. Cancelling a provider sign-in at any point changes nothing.
 */
function Confirm({
  user,
  pending,
  onDone,
  onCancel,
}: {
  user: User;
  pending: Pending;
  onDone: (notice: Notice) => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<Reauth["method"] | OAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const text = copy.settings.signIn;
  const name = PROVIDER_NAMES[pending.provider];
  const options = proofOptions(user, IN_THIS_BUILD);

  /** Gets the proof, then (to link) the new account, then makes the change. */
  async function confirm(proof: Proof): Promise<void> {
    const key = proof.method === "password" ? "password" : proof.provider;
    setBusy(key);
    setError(null);
    // Whose sign-in is running, so a failure there names the right provider.
    let signingIn: OAuthProvider | null = null;
    try {
      let reauth: Reauth;
      if (proof.method === "password") {
        reauth = { method: "password", password };
      } else {
        signingIn = proof.provider;
        const outcome = await providerIn(proof.provider)!.getCredential();
        if (outcome.kind === "cancelled") return;
        reauth = {
          method: "provider",
          provider: proof.provider,
          credential: outcome.credential,
        };
      }
      if (pending.action === "link") {
        signingIn = pending.provider;
        const outcome = await providerIn(pending.provider)!.getCredential();
        if (outcome.kind === "cancelled") return;
        signingIn = null;
        await accountsApi.link(pending.provider, {
          credential: outcome.credential,
          reauth,
        });
      } else {
        signingIn = null;
        await accountsApi.unlink(pending.provider, { reauth });
      }
      setPassword("");
      // The server's answer is the truth: read the user again (the rows follow it).
      await auth.refreshUser().catch((failure: unknown) => {
        console.warn("Reloading the user after a sign-in change failed:", failure);
      });
      onDone({
        tone: "success",
        text: pending.action === "link" ? text.linkedDone(name) : text.unlinkedDone(name),
      });
    } catch (failure) {
      setError(
        failure instanceof SocialSignInError && signingIn
          ? socialErrorMessage(failure, PROVIDER_NAMES[signingIn])
          : signInMethodErrorMessage(failure, name, proof.method),
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <View className="gap-3 pb-2">
      <Text tone="secondary">
        {pending.action === "link" ? text.confirmLink(name) : text.confirmUnlink(name)}
      </Text>
      {!hasAnyProof(options) ? <Text tone="error">{text.cantConfirm}</Text> : null}
      {options.password ? (
        <>
          <Input
            label={text.passwordLabel}
            value={password}
            onChangeText={(value) => {
              setPassword(value);
              setError(null);
            }}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="current-password"
          />
          <Button
            title={text.confirmWithPassword}
            fullWidth
            loading={busy === "password"}
            disabled={(busy !== null && busy !== "password") || password === ""}
            onPress={() => void confirm({ method: "password" })}
          />
        </>
      ) : null}
      {options.providers.map((provider) => (
        <Button
          key={provider}
          title={text.confirmWith(PROVIDER_NAMES[provider])}
          icon={<ProviderLogo provider={provider} />}
          variant="secondary"
          fullWidth
          loading={busy === provider}
          disabled={busy !== null && busy !== provider}
          onPress={() => void confirm({ method: "provider", provider })}
        />
      ))}
      {error ? (
        <Text tone="error" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button
        title={text.cancel}
        variant="ghost"
        fullWidth
        disabled={busy !== null}
        onPress={onCancel}
      />
    </View>
  );
}
