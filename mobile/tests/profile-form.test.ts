import type { Profile } from "@music-room/shared";
import { describe, expect, it } from "vitest";
import {
  draftFromProfile,
  genresFrom,
  PROFILE_SECTIONS,
  type ProfileDraft,
  profileUpdateFrom,
  sectionFrom,
  todayUtc,
} from "@/features/profile/profile-form";
import { updateProfileSchema } from "../../backend/src/modules/profiles/schema";

// The edit-profile form (ADR-024): what it sends, what it refuses, and that the backend's own
// schema agrees with both.

const TODAY = todayUtc();

const EMPTY: ProfileDraft = {
  bio: "",
  fullName: "",
  city: "",
  phone: "",
  birthDate: "",
  genres: "",
};

const FILLED: ProfileDraft = {
  bio: "Night owl.",
  fullName: "Ada Lovelace",
  city: "Paris",
  phone: "+33 6 12 34 56 78",
  birthDate: "2001-09-14",
  genres: "techno, jazz",
};

function request(draft: Partial<ProfileDraft>, original: ProfileDraft = EMPTY) {
  const result = profileUpdateFrom({ ...original, ...draft }, original, TODAY);
  if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.errors)}`);
  return result.request;
}

function errors(draft: Partial<ProfileDraft>) {
  const result = profileUpdateFrom({ ...EMPTY, ...draft }, EMPTY, TODAY);
  if (result.ok) throw new Error("expected the form to refuse it");
  return result.errors;
}

describe("filling the form from the server's profile", () => {
  it("takes every block, genres as one comma-separated field", () => {
    const profile: Profile = {
      userId: "u1",
      displayName: "Ada",
      publicInfo: { bio: "Night owl." },
      friendsInfo: { fullName: "Ada Lovelace", city: "Paris" },
      musicPreferences: { genres: ["techno", "jazz"] },
      privateInfo: { phone: "+33 6 12 34 56 78", birthDate: "2001-09-14" },
    };

    expect(draftFromProfile(profile)).toEqual(FILLED);
  });

  it("a field never filled in (null) or a missing block is an empty field", () => {
    const profile: Profile = {
      userId: "u1",
      displayName: "Ada",
      publicInfo: { bio: null },
    };

    expect(draftFromProfile(profile)).toEqual(EMPTY);
  });
});

describe("the sections each edit button opens", () => {
  it("together hold every field of the form, each in exactly one section", () => {
    const fields = Object.values(PROFILE_SECTIONS).flat();
    expect([...fields].sort()).toEqual(Object.keys(EMPTY).sort());
  });

  it("About is full name, city, phone and birth date", () => {
    expect(PROFILE_SECTIONS.about).toEqual(["fullName", "city", "phone", "birthDate"]);
  });

  it.each(["bio", "about", "music"] as const)("the route can name %j", (section) => {
    expect(sectionFrom(section)).toBe(section);
  });

  it.each([
    ["no section", undefined],
    ["an unknown one", "private"],
    ["a different case", "Bio"],
    ["a name from the object's prototype", "toString"],
    ["the parameter given twice", ["bio", "about"]],
    ["an empty one", ""],
  ])("%s is none: the whole form", (_case, param) => {
    expect(sectionFrom(param)).toBeNull();
  });
});

describe("genres from the text field", () => {
  it("are trimmed, lowercased, without blanks or duplicates, in their order", () => {
    expect(genresFrom(" Techno, jazz,, TECHNO ,r&b ")).toEqual(["techno", "jazz", "r&b"]);
  });

  it("an empty field is no genres", () => {
    expect(genresFrom("  ")).toEqual([]);
  });
});

describe("what is sent", () => {
  it("nothing changed: an empty request (nothing to send)", () => {
    expect(request({}, FILLED)).toEqual({});
  });

  it("only the fields that changed, in their own block", () => {
    expect(request({ city: "Lyon" }, FILLED)).toEqual({ friendsInfo: { city: "Lyon" } });
    expect(request({ phone: "0612345678", bio: "Hi" }, FILLED)).toEqual({
      publicInfo: { bio: "Hi" },
      privateInfo: { phone: "0612345678" },
    });
  });

  it("a field emptied is sent as null, which clears it", () => {
    expect(request({ fullName: "  ", birthDate: "" }, FILLED)).toEqual({
      friendsInfo: { fullName: null },
      privateInfo: { birthDate: null },
    });
  });

  it("text is trimmed, and spaces alone around the same text are no change", () => {
    expect(request({ bio: "  Night owl.  " }, FILLED)).toEqual({});
    expect(request({ city: "  Lyon " }, FILLED)).toEqual({
      friendsInfo: { city: "Lyon" },
    });
  });

  it("genres are sent as the whole new list when the list changes", () => {
    expect(request({ genres: "jazz, techno" }, FILLED)).toEqual({
      musicPreferences: { genres: ["jazz", "techno"] },
    });
    expect(request({ genres: "" }, FILLED)).toEqual({ musicPreferences: { genres: [] } });
  });

  it("the same genres written differently are no change", () => {
    expect(request({ genres: "Techno ,JAZZ, techno" }, FILLED)).toEqual({});
  });

  it("duplicates are removed before counting: 11 tags with a repeat are 10 genres", () => {
    const ten = Array.from({ length: 10 }, (_, i) => `g${i}`);
    expect(request({ genres: [...ten, "G0"].join(",") })).toEqual({
      musicPreferences: { genres: ten },
    });
  });
});

describe("what the form refuses, as the backend does", () => {
  it.each([
    ["bio", { bio: "x".repeat(281) }, "Keep it to 280 characters max."],
    ["fullName", { fullName: "x".repeat(81) }, "Keep it to 80 characters max."],
    ["city", { city: "x".repeat(81) }, "Keep it to 80 characters max."],
  ] as const)("%s too long", (field, draft, message) => {
    expect(errors(draft)[field]).toBe(message);
  });

  it.each(["abc", "12", "+", "06-12-34#56", "1".repeat(31)])("phone %j", (phone) => {
    expect(errors({ phone }).phone).toMatch(/phone number/);
  });

  it.each([
    ["2001/09/14", /YYYY-MM-DD/],
    ["2023-02-30", /YYYY-MM-DD/],
    ["14-09-2001", /YYYY-MM-DD/],
    ["1899-12-31", /1900/],
    ["2999-01-01", /future/],
  ])("birth date %j", (birthDate, message) => {
    expect(errors({ birthDate }).birthDate).toMatch(message);
  });

  it("more than 10 genres", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `g${i}`).join(",");
    expect(errors({ genres: eleven }).genres).toBe("Keep it to 10 genres max.");
  });

  it("a genre longer than 30 characters", () => {
    expect(errors({ genres: "x".repeat(31) }).genres).toBe(
      "Keep each genre to 30 characters max.",
    );
  });

  it.each(["#rock", "-punk", "rock!"])("a genre with odd characters: %j", (genres) => {
    expect(errors({ genres }).genres).toMatch(/letter or digit/);
  });

  it("several problems are reported together, and nothing is sent", () => {
    const result = profileUpdateFrom(
      { ...EMPTY, phone: "abc", birthDate: "nope" },
      EMPTY,
      TODAY,
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(Object.keys(result.errors).sort()).toEqual(["birthDate", "phone"]);
  });
});

describe("the limits themselves are allowed", () => {
  it("280, 80, 10 genres of 30, the oldest and newest birth dates, the shortest phone", () => {
    const tenLong = Array.from({ length: 10 }, (_, i) => `${i}${"x".repeat(29)}`);
    expect(
      request({
        bio: "x".repeat(280),
        fullName: "x".repeat(80),
        city: "y".repeat(80),
        phone: "123",
        birthDate: "1900-01-01",
        genres: tenLong.join(","),
      }),
    ).toMatchObject({ privateInfo: { phone: "123", birthDate: "1900-01-01" } });
    expect(request({ birthDate: TODAY })).toEqual({ privateInfo: { birthDate: TODAY } });
  });

  it.each(["r&b", "drum'n'bass", "hip-hop", "lo-fi / chill", "80s", "électro"])(
    "the genre %j",
    (genre) => {
      expect(request({ genres: genre })).toEqual({
        musicPreferences: { genres: [genre] },
      });
    },
  );
});

describe("the backend's own schema agrees", () => {
  it.each([
    [{ bio: "Night owl." }],
    [{ fullName: "Ada", city: "Paris" }],
    [{ phone: "+33 (0)6 12.34-56", birthDate: "1900-01-01" }],
    [{ birthDate: TODAY }],
    [{ genres: "r&b, drum'n'bass, hip-hop, lo-fi / chill, 80s, électro" }],
    [{ bio: "x".repeat(280), fullName: "x".repeat(80), city: "y".repeat(80) }],
    [{ phone: "", birthDate: "", fullName: " " }],
  ])("accepts every request the form builds: %j", (draft) => {
    // Clearing a field only means something against a profile that has it filled in.
    const original = "phone" in draft && draft.phone === "" ? FILLED : EMPTY;
    const body = request(draft, original);
    expect(updateProfileSchema.safeParse(body).success).toBe(true);
  });

  it.each([
    [{ publicInfo: { bio: "x".repeat(281) } }],
    [{ friendsInfo: { fullName: "x".repeat(81) } }],
    [{ friendsInfo: { city: "x".repeat(81) } }],
    [{ privateInfo: { phone: "abc" } }],
    [{ privateInfo: { phone: "12" } }],
    [{ privateInfo: { phone: "1".repeat(31) } }],
    [{ privateInfo: { birthDate: "2023-02-30" } }],
    [{ privateInfo: { birthDate: "1899-12-31" } }],
    [{ privateInfo: { birthDate: "2999-01-01" } }],
    [{ musicPreferences: { genres: Array.from({ length: 11 }, (_, i) => `g${i}`) } }],
    [{ musicPreferences: { genres: ["x".repeat(31)] } }],
    [{ musicPreferences: { genres: ["#rock"] } }],
  ])("refuses what the form refuses: %j", (body) => {
    expect(updateProfileSchema.safeParse(body).success).toBe(false);
  });

  it("an empty phone or birth date would be refused, which is why the form sends null", () => {
    expect(updateProfileSchema.safeParse({ privateInfo: { phone: "" } }).success).toBe(
      false,
    );
    expect(
      updateProfileSchema.safeParse({ privateInfo: { birthDate: "" } }).success,
    ).toBe(false);
    expect(
      updateProfileSchema.safeParse({ privateInfo: { phone: null, birthDate: null } })
        .success,
    ).toBe(true);
  });
});
