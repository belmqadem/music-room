// The search text rules, kept apart from the API calls so they are tested without the app.

/** Spaces collapsed and ends trimmed; null below `min` characters, cut at `max` (the backend's). */
function queryFrom(input: string, min: number, max: number): string | null {
  const query = input.trim().replace(/\s+/g, " ");
  if (query.length < min) return null;
  return query.slice(0, max);
}

/** The music catalog: 2 to 100 characters (GET /tracks/search). */
export const searchQueryFrom = (input: string) => queryFrom(input, 2, 100);

/** People, by the start of their display name: 3 to 50 characters (GET /users). */
export const peopleQueryFrom = (input: string) => queryFrom(input, 3, 50);
