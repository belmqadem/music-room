// Helpers to tell Postgres constraint errors apart. Services use them to turn a
// race ("two requests did the same thing") into the right HTTP error instead of a 500.
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

function constraintOf(error: unknown, code: string): string | null {
  const pgError = error as { code?: unknown; constraint?: unknown } | null;
  if (pgError?.code !== code) return null;
  return typeof pgError.constraint === "string" ? pgError.constraint : "";
}

/** The name of the violated UNIQUE/PRIMARY KEY constraint, or null if this is not that error. */
export function uniqueViolationOf(error: unknown): string | null {
  return constraintOf(error, UNIQUE_VIOLATION);
}

/** The name of the violated FOREIGN KEY constraint, or null if this is not that error. */
export function foreignKeyViolationOf(error: unknown): string | null {
  return constraintOf(error, FOREIGN_KEY_VIOLATION);
}
