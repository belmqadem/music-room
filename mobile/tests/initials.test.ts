import { describe, expect, it } from "vitest";
import { initialsOf } from "@/components/initials";

// The letters in the profile's avatar.
describe("the avatar's initials", () => {
  it.each([
    ["Ada Lovelace", "AL"],
    ["ada lovelace", "AL"],
    ["Ada", "A"],
    ["Ada Byron Lovelace", "AB"],
    ["Bob (test)", "BT"],
    ["  Ada   Lovelace  ", "AL"],
    ["Élodie Ölçer", "ÉÖ"],
    ["محمد علي", "مع"],
    ["DJ 2000 Kid", "DK"],
  ])("%j -> %j", (name, expected) => {
    expect(initialsOf(name)).toBe(expected);
  });

  it.each(["", "   ", "123 456", "🎧"])(
    "no letter at all (%j): a question mark",
    (name) => {
      expect(initialsOf(name)).toBe("?");
    },
  );
});
