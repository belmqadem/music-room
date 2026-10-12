import { z } from "zod";
import { HttpError } from "../../http-error.js";

// Cursor of the user search: the last row seen was (lower(display_name), id).
// Like every cursor it may be forged; that only moves the page position.
export interface UserSearchCursor {
  name: string;
  id: string;
}

const cursorSchema = z.strictObject({ n: z.string().max(200), i: z.uuid() });

export function encodeUserCursor(cursor: UserSearchCursor): string {
  return Buffer.from(JSON.stringify({ n: cursor.name, i: cursor.id })).toString(
    "base64url",
  );
}

export function decodeUserCursor(raw: string): UserSearchCursor {
  const invalid = () => new HttpError(400, "VALIDATION_ERROR", "Invalid cursor.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw invalid();
  }
  const result = cursorSchema.safeParse(parsed);
  if (!result.success) throw invalid();
  return { name: result.data.n, id: result.data.i };
}
