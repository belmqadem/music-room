// Public entry point of @music-room/shared. Import with `import type { ... }`.
export type { User, UserSummary, OAuthProvider } from "./user";
export type {
  RegisterRequest,
  LoginRequest,
  RefreshRequest,
  OAuthCredentialRequest,
  AuthSession,
} from "./auth";
export type { ApiError, ApiErrorCode } from "./api-error";
export type { Page } from "./pagination";
export type { Visibility } from "./visibility";
export type {
  LocationTimeRule,
  VoteLicense,
  EditLicense,
  MyPermissions,
  GeoPoint,
} from "./license";
export type { Invitation, InviteRequest } from "./invitation";
export type { Track } from "./track";
export type { MusicEvent, CreateEventRequest, UpdateEventRequest } from "./event";
export type {
  EventTrack,
  SuggestTrackRequest,
  VoteRequest,
  EventQueueUpdate,
  AdvanceQueueRequest,
  QueueEntry,
  QueueSnapshot,
} from "./vote";
export type {
  SubscribeRequest,
  SubscribeAck,
  UnsubscribeAck,
  AccessLost,
} from "./realtime";
export type {
  Playlist,
  PlaylistEntry,
  PlaylistSnapshot,
  CreatePlaylistRequest,
  UpdatePlaylistRequest,
  AddPlaylistTrackRequest,
  MovePlaylistTrackRequest,
} from "./playlist";
