// The avatar's letters: the first letter of the first two words that have one, uppercased.
// "Ada Lovelace" -> "AL", "Bob (test)" -> "BT", "ada" -> "A", "  " or "123" -> "?".
export function initialsOf(displayName: string): string {
  const letters = displayName
    .split(/\s+/)
    .map((word) => /\p{L}/u.exec(word)?.[0])
    .filter((letter): letter is string => letter !== undefined)
    .slice(0, 2);
  return letters.length > 0 ? letters.join("").toLocaleUpperCase() : "?";
}
