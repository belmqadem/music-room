// TEMP: remove before release (together with src/dev/DevScreenLinks.tsx). While true, BOTH route
// groups can be opened whatever the sign-in state is, so every screen can be reached from the dev
// links on the welcome screen while the real screens are still being built.
export const TEMP_ALLOW_ALL_ROUTES: boolean = true;
