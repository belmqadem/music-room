# Music Room — Design System ("Sonic Parlor")

Source of truth: `design-tokens.json` (exported from Stitch). **Read it before building or changing any screen.** Never hardcode a color, font, size or radius that exists as a token; define the tokens once in the app's theme module and import them everywhere.

## Rules for building screens

1. **Dark only.** `colorMode` is dark. Screen background is `surfaces.canvas` (#12131C).
2. **Depth comes from surface tiers, not shadows.** Lowest (#0D0E16) for recessed areas and input fills, Low (#1A1B24) for cards and list rows, Elevated (#222638) for modals and track-list surfaces, High (#2A2E42) for selected/hover, Bright (#383843) for dividers and inactive borders.
3. **Electric Ember (#FF5A36)** is the one primary accent: main CTA, active voting state, playback hero, input focus ring. One primary CTA per screen. Pressed state is `electricEmberHover` (#E04826).
4. **Chartreuse (#C8FF00)** is reserved for _live/realtime_ only: presence indicators, sync status, other users' active selection ring. Do not use it as a decorative color.
5. **Text on bright fills** (Ember, Chartreuse) uses `text.inverse` (#12131C), never white.
6. **Text hierarchy:** primary (#F3F4F8) for titles, secondary (#8E94A8) for metadata/timestamps/labels, tertiary (#5F6578) for placeholders and inactive icons.
7. **Feedback colors have fixed meanings:** success #00E599 (track queued, connected), warning #FFB800 (expiring room link), error #FF3366 (invalid room code, disconnected playback).
8. **Borders:** 1px hairline `rgba(255,255,255,0.08)` by default; focus ring Ember; live-selection ring Chartreuse.

## Typography

| Role    | Font                      | Use                                                    |
| ------- | ------------------------- | ------------------------------------------------------ |
| display | Syne 700/800              | hero + h1 titles only                                  |
| sans    | Plus Jakarta Sans 400–700 | everything UI: buttons, inputs, track titles, metadata |
| mono    | JetBrains Mono 500/700    | room invite codes (ROOM-742), BPM counters, timers     |

Scale (size/line-height, weight, letter-spacing): hero 32/38 800 -0.03em · h1 26/32 700 -0.02em · h2 20/26 700 -0.01em · h3 16/22 600 · bodyLarge 15/22 400 · body 14/20 400 · caption 12/16 500 +0.01em · badge 11/14 700 +0.04em uppercase · code 18/24 700 +0.08em (mono).

The fonts must be loaded in the app (e.g. `expo-font` / `@expo-google-fonts/*` on React Native, or `next/font` on web), and each weight used must be loaded explicitly.

## Radius

sm 6 · md 8 · lg 12 · xl 16 · 2xl 20 · full 9999. Suggested defaults: inputs/buttons md or lg, cards xl, modals/sheets 2xl, avatars/pills full.

## Workflow for Claude Code

- Before starting a screen: read this file and `design-tokens.json`, then create/extend a single theme file (colors, typography, radius) generated from the tokens.
- Build shared components first (Button, Input, Card, TrackRow, Badge, RoomCodeChip), then compose screens from them.
- If a screen needs a value that isn't a token, say so and propose one instead of inventing a one-off.
- Check contrast on dark surfaces for `text.tertiary`; use it only for placeholders and inactive elements.
