import { router, Stack } from "expo-router";
import { useAuth } from "@/auth";
import { Screen } from "@/components";
import { copy } from "@/copy";
import { UsernameForm } from "./UsernameForm";

// Changing the username from Settings (ADR-046). Friends, invitations and rooms refer to the
// account's id, so nothing breaks: people just see the new name, and the old one is free again.
export default function ChangeUsernameScreen() {
  const state = useAuth();
  const current = state.status === "signedIn" ? (state.user?.displayName ?? "") : "";
  return (
    <Screen scroll>
      <Stack.Screen options={{ title: copy.username.changeTitle }} />
      <UsernameForm initial={current} onSaved={() => router.back()} />
    </Screen>
  );
}
