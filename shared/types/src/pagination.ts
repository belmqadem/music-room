// API contract: pagination for list endpoints. Changes need review from BOTH developers.
// See docs/api-contract.md ("Conventions").

export interface Page<T> {
  items: T[];
  nextCursor: string | null; // pass as ?cursor= to get the next page; null = last page
}
