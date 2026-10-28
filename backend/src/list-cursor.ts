import { z } from "zod";
import { HttpError } from "./http-error.js";

// List cursors (keyset pagination): "the last row I saw was (created_at, id)". Shared by every
// list that is ordered by a timestamp and an id (events, playlists, invitations).
// created_at is kept as the TEXT Postgres printed, not as a JavaScript Date:
// Postgres stores microseconds and a Date only has milliseconds, so a Date
// would round, and rows could be skipped or repeated at a page boundary.
// A cursor is not a secret and may be forged; that only moves the page position,
// because the visibility filter is applied to every page.
export interface ListCursor {
  createdAt: string;
  id: string;
}

// What Postgres prints for timestamptz with the default DateStyle, e.g.
// "2026-10-12 14:58:15.473123+00" (fraction and minutes of the offset optional).
const POSTGRES_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/;

const cursorSchema = z.strictObject({
  c: z.string().regex(POSTGRES_TIMESTAMP),
  i: z.uuid(),
});

export function encodeCursor(cursor: ListCursor): string {
  return Buffer.from(JSON.stringify({ c: cursor.createdAt, i: cursor.id })).toString(
    "base64url",
  );
}

export function decodeCursor(raw: string): ListCursor {
  const invalid = () => new HttpError(400, "VALIDATION_ERROR", "Invalid cursor.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw invalid();
  }
  const result = cursorSchema.safeParse(parsed);
  if (!result.success) throw invalid();
  return { createdAt: result.data.c, id: result.data.i };
}
