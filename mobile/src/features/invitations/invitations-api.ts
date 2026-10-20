import type { Invitation, Page } from "@music-room/shared";
import { auth } from "@/auth";

// Invitations, the same for events and playlists (docs/api-contract.md, "Access rules"). Owner only:
// the server answers 403 to anyone else who can see the resource, 404 to those who cannot.

export type InvitableResource = "event" | "playlist";

const base = (resource: InvitableResource, id: string) =>
  `/${resource === "event" ? "events" : "playlists"}/${encodeURIComponent(id)}/invitations`;

export function invitationsApi(resource: InvitableResource, id: string) {
  return {
    /** Newest invitation first, paged like every list. */
    list: (cursor?: string) =>
      auth.request<Page<Invitation>>("GET", base(resource, id), {
        query: { limit: 50, cursor },
      }),
    /** Takes effect at once. 409 ALREADY_INVITED if that person is already on the list. */
    invite: (userId: string) =>
      auth.request<Invitation>("POST", base(resource, id), { body: { userId } }),
    /** Idempotent; takes effect at once (their live updates stop if they lose access). */
    remove: (userId: string) =>
      auth.request("DELETE", `${base(resource, id)}/${encodeURIComponent(userId)}`),
  };
}
