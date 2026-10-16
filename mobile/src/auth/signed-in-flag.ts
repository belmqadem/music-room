// TODO(auth): PLACEHOLDER. Replace with the real signed-in state (access token in secure storage,
// refreshed against the backend). Until then this hardcoded flag picks which route group is shown.
export const IS_SIGNED_IN: boolean = false;

// TEMP: remove before release. While true, BOTH route groups can be opened whatever IS_SIGNED_IN
// says, so every screen can be reached from the dev links on the welcome screen.
export const TEMP_ALLOW_ALL_ROUTES: boolean = true;
