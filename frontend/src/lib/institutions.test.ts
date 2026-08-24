import { describe, it, expect } from "vitest";
import {
  INSTITUTIONS,
  INSTITUTION_GROUPS,
  OTHER,
  initialsFrom,
  markForeground,
  resolveInstitution,
} from "./institutions";

describe("resolveInstitution", () => {
  it("returns null when no institution is recorded", () => {
    expect(resolveInstitution({ institution: null, institution_name: null })).toBeNull();
  });

  it("resolves a catalogue slug to its name, colour and mark", () => {
    const chase = resolveInstitution({ institution: "chase", institution_name: null });
    expect(chase).toMatchObject({ key: "chase", name: "Chase", mark: "C" });
    expect(chase?.color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("returns null for a slug that isn't in the catalogue", () => {
    expect(
      resolveInstitution({ institution: "gringotts", institution_name: null }),
    ).toBeNull();
  });

  it("uses the typed name and its initials for a custom institution", () => {
    const custom = resolveInstitution({
      institution: OTHER,
      institution_name: "Glasgow Credit Union",
    });
    expect(custom).toMatchObject({ name: "Glasgow Credit Union", mark: "GC" });
  });

  it("returns null for 'other' with no name, rather than a blank mark", () => {
    expect(resolveInstitution({ institution: OTHER, institution_name: "  " })).toBeNull();
  });

  it("folds case in the custom group key so one provider makes one group", () => {
    const a = resolveInstitution({ institution: OTHER, institution_name: "Kroo" });
    const b = resolveInstitution({ institution: OTHER, institution_name: "kroo" });
    expect(a?.key).toBe(b?.key);
  });

  it("keeps custom keys apart from catalogue slugs", () => {
    const custom = resolveInstitution({ institution: OTHER, institution_name: "chase" });
    expect(custom?.key).not.toBe("chase");
  });

  it("gives a given custom name a stable colour", () => {
    const first = resolveInstitution({ institution: OTHER, institution_name: "Kroo" });
    const second = resolveInstitution({ institution: OTHER, institution_name: "Kroo" });
    expect(first?.color).toBe(second?.color);
  });
});

describe("initialsFrom", () => {
  it("takes the first letter of up to two words", () => {
    expect(initialsFrom("Chase Business Account")).toBe("CB");
  });

  it("handles a single word", () => {
    expect(initialsFrom("Kroo")).toBe("K");
  });

  it("falls back to a placeholder for an empty name", () => {
    expect(initialsFrom("   ")).toBe("?");
  });
});

describe("markForeground", () => {
  it("puts white ink on a dark brand colour", () => {
    expect(markForeground("#071D49")).toBe("#FFFFFF");
  });

  it("puts dark ink on a light brand colour", () => {
    // Wise's green and Klarna's pink are too light to carry white text.
    expect(markForeground("#9FE870")).toBe("#10131A");
    expect(markForeground("#FFB3C7")).toBe("#10131A");
  });
});

describe("catalogue", () => {
  it("has no duplicate slugs", () => {
    const slugs = INSTITUTIONS.map((i) => i.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("offers every institution through exactly one picker group", () => {
    const grouped = INSTITUTION_GROUPS.flatMap((g) => g.institutions);
    expect(grouped).toHaveLength(INSTITUTIONS.length);
    expect(new Set(INSTITUTION_GROUPS.map((g) => g.label)).size).toBe(
      INSTITUTION_GROUPS.length,
    );
  });
});
