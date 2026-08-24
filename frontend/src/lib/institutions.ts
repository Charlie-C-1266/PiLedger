/**
 * The catalogue of financial institutions an account can be held with.
 *
 * The backend stores and validates only the slug (`constants.InstitutionSlug`);
 * everything a human sees — the display name, the brand colour, the monogram —
 * lives here, the same split already used for account sub-types.
 * `tests/test_institution_frontend_parity.py` guards the two sides from drifting.
 *
 * The marks are deliberately *not* the institutions' logos: those are
 * trademarked artwork, and bundling them into a self-hosted app would ship
 * someone else's assets. A brand-coloured monogram gets the same at-a-glance
 * recognition, renders crisply at any size, needs no network, and is nobody
 * else's property.
 */

export interface Institution {
  /** Stable key stored in `accounts.institution`. */
  slug: string;
  /** Display name. */
  name: string;
  /** Picker section this belongs to. */
  group: string;
  /** Brand colour — the mark's background. */
  color: string;
  /** 1–4 characters drawn on the mark. */
  mark: string;
}

/** The slug whose label the user types themselves, in `institution_name`. */
export const OTHER = "other";

export const INSTITUTIONS: Institution[] = [
  // Banks
  { slug: "barclays", name: "Barclays", group: "Banks", color: "#00AEEF", mark: "B" },
  { slug: "hsbc", name: "HSBC", group: "Banks", color: "#DB0011", mark: "HSBC" },
  { slug: "first_direct", name: "first direct", group: "Banks", color: "#1A1A1A", mark: "fd" },
  { slug: "lloyds", name: "Lloyds Bank", group: "Banks", color: "#006A4D", mark: "L" },
  { slug: "halifax", name: "Halifax", group: "Banks", color: "#0060A9", mark: "HX" },
  { slug: "bank_of_scotland", name: "Bank of Scotland", group: "Banks", color: "#002664", mark: "BoS" },
  { slug: "natwest", name: "NatWest", group: "Banks", color: "#5A287F", mark: "NW" },
  { slug: "royal_bank_of_scotland", name: "Royal Bank of Scotland", group: "Banks", color: "#3C1053", mark: "RBS" },
  { slug: "santander", name: "Santander", group: "Banks", color: "#EC0000", mark: "S" },
  { slug: "tsb", name: "TSB", group: "Banks", color: "#005EB8", mark: "TSB" },
  { slug: "co_operative_bank", name: "The Co-operative Bank", group: "Banks", color: "#00B1E7", mark: "Co" },
  { slug: "metro_bank", name: "Metro Bank", group: "Banks", color: "#DC0032", mark: "MB" },
  { slug: "virgin_money", name: "Virgin Money", group: "Banks", color: "#E10A0A", mark: "VM" },

  // Building societies
  { slug: "nationwide", name: "Nationwide", group: "Building societies", color: "#071D49", mark: "N" },
  { slug: "yorkshire_building_society", name: "Yorkshire Building Society", group: "Building societies", color: "#003865", mark: "YBS" },
  { slug: "coventry_building_society", name: "Coventry Building Society", group: "Building societies", color: "#0072CE", mark: "CBS" },
  { slug: "skipton_building_society", name: "Skipton Building Society", group: "Building societies", color: "#00A19C", mark: "SBS" },
  { slug: "leeds_building_society", name: "Leeds Building Society", group: "Building societies", color: "#E4003B", mark: "LBS" },

  // Digital banks
  { slug: "monzo", name: "Monzo", group: "Digital banks", color: "#FF4F40", mark: "M" },
  { slug: "starling", name: "Starling Bank", group: "Digital banks", color: "#6935D3", mark: "ST" },
  { slug: "chase", name: "Chase", group: "Digital banks", color: "#117ACA", mark: "C" },
  { slug: "revolut", name: "Revolut", group: "Digital banks", color: "#0666EB", mark: "R" },
  { slug: "wise", name: "Wise", group: "Digital banks", color: "#9FE870", mark: "W" },

  // Card issuers
  { slug: "amex", name: "American Express", group: "Card issuers", color: "#006FCF", mark: "AX" },
  { slug: "barclaycard", name: "Barclaycard", group: "Card issuers", color: "#0072CE", mark: "BC" },
  { slug: "capital_one", name: "Capital One", group: "Card issuers", color: "#004977", mark: "C1" },
  { slug: "mbna", name: "MBNA", group: "Card issuers", color: "#C8102E", mark: "MBNA" },

  // Supermarket banks
  { slug: "tesco_bank", name: "Tesco Bank", group: "Supermarket banks", color: "#00539F", mark: "TB" },
  { slug: "sainsburys_bank", name: "Sainsbury's Bank", group: "Supermarket banks", color: "#F06C00", mark: "SB" },

  // Investing & pensions
  { slug: "vanguard", name: "Vanguard", group: "Investing & pensions", color: "#96151D", mark: "V" },
  { slug: "hargreaves_lansdown", name: "Hargreaves Lansdown", group: "Investing & pensions", color: "#00263E", mark: "HL" },
  { slug: "aj_bell", name: "AJ Bell", group: "Investing & pensions", color: "#E01A2B", mark: "AJ" },
  { slug: "interactive_investor", name: "interactive investor", group: "Investing & pensions", color: "#0F2B5B", mark: "ii" },
  { slug: "trading_212", name: "Trading 212", group: "Investing & pensions", color: "#00AAD2", mark: "212" },
  { slug: "freetrade", name: "Freetrade", group: "Investing & pensions", color: "#FF5A1F", mark: "FT" },
  { slug: "moneybox", name: "Moneybox", group: "Investing & pensions", color: "#2B50EC", mark: "MX" },
  { slug: "nutmeg", name: "Nutmeg", group: "Investing & pensions", color: "#F5B335", mark: "NG" },

  // Other providers
  { slug: "nsandi", name: "NS&I", group: "Other providers", color: "#6E2B62", mark: "NS&I" },
  { slug: "student_loans_company", name: "Student Loans Company", group: "Other providers", color: "#0B0C0C", mark: "SLC" },
  { slug: "paypal", name: "PayPal", group: "Other providers", color: "#003087", mark: "PP" },
  { slug: "klarna", name: "Klarna", group: "Other providers", color: "#FFB3C7", mark: "K" },
  { slug: "coinbase", name: "Coinbase", group: "Other providers", color: "#0052FF", mark: "CB" },
  { slug: OTHER, name: "Other (type a name)", group: "Other providers", color: "#64748B", mark: "?" },
];

const BY_SLUG: Record<string, Institution> = Object.fromEntries(
  INSTITUTIONS.map((i) => [i.slug, i]),
);

/** The picker's sections, in catalogue order. */
export const INSTITUTION_GROUPS: { label: string; institutions: Institution[] }[] =
  INSTITUTIONS.reduce<{ label: string; institutions: Institution[] }[]>((groups, inst) => {
    const last = groups[groups.length - 1];
    if (last?.label === inst.group) last.institutions.push(inst);
    else groups.push({ label: inst.group, institutions: [inst] });
    return groups;
  }, []);

/** Colours a custom institution's mark is drawn from, picked by name hash so a
 * given provider keeps the same colour everywhere it appears. */
const CUSTOM_COLORS = ["#64748B", "#0F766E", "#7C3AED", "#B45309", "#BE123C", "#1D4ED8"];

/** Up to two initials from a free-text institution name ("Chase Business" → "CB"). */
export function initialsFrom(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return words
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

function hashIndex(value: string, buckets: number): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(hash) % buckets;
}

/** Relative luminance per WCAG 2.1, used to pick legible mark text. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Ink that stays readable on `color`. Brand palettes run from Barclays cyan to
 * Nationwide navy, so the choice is made per colour rather than assuming white. */
export function markForeground(color: string): string {
  return luminance(color) > 0.4 ? "#10131A" : "#FFFFFF";
}

// Longer monograms need proportionally smaller text to stay inside their badge.
// Indexed by mark length; anything longer than four characters uses the last.
const TEXT_SCALE = [0.5, 0.42, 0.33, 0.26];

/** Type size for `mark` drawn inside a badge `size` px across. Shared so the
 * small picker badge and the large card emblem stay visually consistent. */
export function markFontSize(mark: string, size: number): number {
  const scale = TEXT_SCALE[Math.min(mark.length, TEXT_SCALE.length) - 1];
  return Math.round(size * scale * 10) / 10;
}

/** What to draw for one account's institution: the catalogue entry for a known
 * slug, a derived one for a custom name, or null when none is recorded.
 *
 * `key` is what to group by — the slug for catalogue entries, and the
 * case-folded custom name for `other`, so "Chase Business" and
 * "chase business" land in one group rather than two.
 */
export function resolveInstitution(account: {
  institution?: string | null;
  institution_name?: string | null;
}): (Institution & { key: string }) | null {
  const slug = account.institution;
  if (!slug) return null;
  if (slug === OTHER) {
    const name = (account.institution_name ?? "").trim();
    if (!name) return null;
    return {
      slug: OTHER,
      key: `other:${name.toLowerCase()}`,
      name,
      group: "Other providers",
      color: CUSTOM_COLORS[hashIndex(name.toLowerCase(), CUSTOM_COLORS.length)],
      mark: initialsFrom(name),
    };
  }
  const known = BY_SLUG[slug];
  return known ? { ...known, key: known.slug } : null;
}
