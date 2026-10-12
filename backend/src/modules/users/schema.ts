import { z } from "zod";

// GET /users?query=ada&limit=20&cursor=...
// `query` is trimmed and must be at least 3 characters, so nobody can list the
// whole directory with a one-letter search.
export const MIN_QUERY_LENGTH = 3;

export const searchQuerySchema = z.object({
  query: z.string().trim().min(MIN_QUERY_LENGTH).max(50),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(512).optional(),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;
