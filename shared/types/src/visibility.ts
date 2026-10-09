// API contract: visibility. Owner: belmqadem (Core & Infra).
// Changes need review from BOTH developers. See docs/api-contract.md ("Access rules") and ADR-005.
// String unions (not enums): enums emit runtime code and this package is types-only.

/**
 * public (default): any user can see the resource.
 * private: only the owner and invited users can; everyone else gets 404.
 */
export type Visibility = "public" | "private";
