// API contract: user. Owner: belmqadem (Core & Infra). Changes need review from BOTH developers.
// See docs/api-contract.md ("Authentication").

/** A user as seen by other users and by the user themself. Never contains secrets. */
export interface User {
  id: string; // UUID
  displayName: string;
  email: string; // TODO(contract): decide whether other users may see this (privacy) or only "me".
  createdAt: string; // ISO 8601 UTC
}
