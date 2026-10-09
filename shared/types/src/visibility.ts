// API contract: room visibility and permission mode. Owner: belmqadem (Core & Infra).
// Changes need review from BOTH developers. See docs/api-contract.md ("Access rules") and ADR-004.
// String unions (not enums): enums emit runtime code and this package is types-only.

/** public: any user can see the room. private: only members can (others get 404). */
export type Visibility = "public" | "private";

/** open: anyone who can see the room gets editor rights. restricted: only member roles count. */
export type PermissionMode = "open" | "restricted";
