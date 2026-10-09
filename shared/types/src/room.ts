// API contract: room/session. Owner: belmqadem (Core & Infra). Changes need review from BOTH developers.
// See docs/api-contract.md ("Rooms").
import type { License, Role } from "./license";
import type { PermissionMode, Visibility } from "./visibility";
import type { User } from "./user";

export interface Room {
  id: string; // UUID
  name: string;
  ownerId: string; // User id
  visibility: Visibility;
  permission: PermissionMode;
  createdAt: string; // ISO 8601 UTC
  /** The caller's membership role, or null when they are not a member (public rooms only). */
  myRole: Role | null;
  /** The caller's effective license (see "Effective license" in the contract). */
  myLicense: License;
}

export interface RoomMember {
  roomId: string;
  user: User;
  role: Role;
  joinedAt: string; // ISO 8601 UTC
}

export interface CreateRoomRequest {
  name: string;
  visibility: Visibility;
  permission: PermissionMode;
}

/** All fields optional; at least one must be present. */
export interface UpdateRoomRequest {
  name?: string;
  visibility?: Visibility;
  permission?: PermissionMode;
}

export interface InviteRequest {
  userId: string;
  role: Exclude<Role, "owner">; // there is exactly one owner
}

export interface ChangeRoleRequest {
  role: Exclude<Role, "owner">;
}
