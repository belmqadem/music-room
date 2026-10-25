import { useEffect, useState } from "react";
import { View } from "react-native";
import { auth } from "@/auth";
import { Button, Input, Text } from "@/components";
import {
  defaultBackendUrl,
  getBackendUrl,
  resetBackendUrl,
  setBackendUrl,
} from "./backend-url";
import {
  changeServerAddress,
  checkServer,
  normalizeBackendUrl,
  SERVER_MESSAGES,
} from "./server-address";

type Notice = { tone: "error" | "success" | "secondary"; text: string };

/**
 * The backend address (the subject requires it to be changeable in the app). Editable only while
 * signed out: the session's refresh token belongs to one server, and changing the address while
 * signed in would send it to another one at the next refresh.
 */
export function ServerAddressForm({ editable }: { editable: boolean }) {
  const [address, setAddress] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    void getBackendUrl().then(setAddress);
  }, []);

  /** The address as typed, normalized; or null (and a message) when it is not an http(s) URL. */
  function validAddress(): string | null {
    try {
      return normalizeBackendUrl(address);
    } catch {
      setNotice({ tone: "error", text: SERVER_MESSAGES.invalid });
      return null;
    }
  }

  async function check(): Promise<void> {
    const target = validAddress();
    if (!target) return;
    setChecking(true);
    setNotice(null);
    const result = await checkServer(target, fetch);
    setChecking(false);
    setNotice({
      tone: result === "reachable" ? "success" : "error",
      text: SERVER_MESSAGES[result],
    });
  }

  /** Forgets the old server's session, then stores the new address: or changes nothing. */
  async function switchTo(next: string, store: () => Promise<void>, done: Notice) {
    try {
      await changeServerAddress(next, {
        current: getBackendUrl,
        forgetStoredSession: auth.forgetStoredSession,
        store,
      });
      setAddress(next);
      setNotice(done);
    } catch (error) {
      console.warn("Could not change the server address:", error);
      setNotice({ tone: "error", text: SERVER_MESSAGES.notSaved });
    }
  }

  async function save(): Promise<void> {
    const target = validAddress();
    if (!target) return;
    await switchTo(target, () => setBackendUrl(target), {
      tone: "success",
      text: SERVER_MESSAGES.saved,
    });
  }

  async function restoreDefault(): Promise<void> {
    await switchTo(defaultBackendUrl(), resetBackendUrl, {
      tone: "secondary",
      text: "Back to this build's default server.",
    });
  }

  return (
    <View className="gap-4">
      <Input
        label="Server address"
        placeholder="http://192.168.1.20:3000"
        value={address}
        onChangeText={(value) => {
          setAddress(value);
          setNotice(null);
        }}
        editable={editable}
        helper={
          editable
            ? "The computer running the Music Room backend, as http://address:port."
            : "Sign out to change it: your session belongs to this server."
        }
        keyboardType="url"
        autoCapitalize="none"
        autoCorrect={false}
      />
      {notice ? (
        <Text
          tone={notice.tone}
          accessibilityRole={notice.tone === "error" ? "alert" : undefined}
          accessibilityLiveRegion="polite"
        >
          {notice.text}
        </Text>
      ) : null}
      <Button
        title="Check connection"
        variant="secondary"
        fullWidth
        loading={checking}
        onPress={() => void check()}
      />
      {editable ? (
        <>
          <Button title="Save" fullWidth onPress={() => void save()} />
          <Button
            title="Use the default"
            variant="ghost"
            fullWidth
            onPress={() => void restoreDefault()}
          />
        </>
      ) : null}
    </View>
  );
}
