// The search text rules, kept apart from the API call so they are tested without the app.

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 100;

/**
 * The query to send, or null when there is nothing to search yet. Spaces are collapsed and the
 * ends trimmed; the backend refuses fewer than 2 or more than 100 characters (400).
 */
export function searchQueryFrom(input: string): string | null {
  const query = input.trim().replace(/\s+/g, " ");
  if (query.length < SEARCH_MIN_LENGTH) return null;
  return query.slice(0, SEARCH_MAX_LENGTH);
}
