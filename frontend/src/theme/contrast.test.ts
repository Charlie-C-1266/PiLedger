import { describe, it, expect } from "vitest";
import { lightTokens, darkTokens } from "./tokens";

// WCAG 2.x contrast guard. The dashboard renders most of its secondary text and
// its up/down/warn figures at 11–14px, which is "normal" text and needs a 4.5:1
// contrast ratio. These tokens previously sat at 2.3–3.7:1 (see the
// 2026-06-11 dashboard styling review); this test computes the real ratios from
// the token hex values and locks the regression out — change a token below the
// threshold and CI fails here.

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return (
    0.2126 * srgbToLinear(r) +
    0.7152 * srgbToLinear(g) +
    0.0722 * srgbToLinear(b)
  );
}

function ratio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// Approximate the opaque colour produced by compositing `fg` at `alpha` over
// `bg` — mirrors the `color-mix(in oklab, COLOR, transparent N%)` tints the
// delta pills and rate banner use, in sRGB (close enough that the verdicts hold;
// the failing margins are wide). `alpha` = 1 − (transparency fraction).
function over(fg: string, bg: string, alpha: number): string {
  const [fr, fg_, fb] = parseHex(fg);
  const [br, bg_, bb] = parseHex(bg);
  const blend = (f: number, b: number) => Math.round(alpha * f + (1 - alpha) * b);
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(blend(fr, br))}${hex(blend(fg_, bg_))}${hex(blend(fb, bb))}`;
}

const AA_NORMAL = 4.5;

describe("light-mode token contrast (small text)", () => {
  const { bg, surface, textSoft, textMute, up, down, warn } = lightTokens;

  it.each([
    ["textMute on surface", textMute, surface],
    ["textMute on bg", textMute, bg],
    ["textSoft on surface", textSoft, surface],
    ["up on surface", up, surface],
    ["up on bg", up, bg],
    ["down on surface", down, surface],
    ["down on bg", down, bg],
    ["warn on surface", warn, surface],
    ["warn on bg", warn, bg],
  ])("%s clears AA (4.5:1)", (_label, fg, bgColor) => {
    expect(ratio(fg, bgColor)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  // Delta pills: coloured text on a 10%-opacity tint of the same colour over the
  // card surface (Overview "net position" / % pills, `transparent 90%`).
  it.each([
    ["up", up],
    ["down", down],
  ])("%s delta-pill text clears AA on its tint", (_label, color) => {
    expect(ratio(color, over(color, surface, 0.1))).toBeGreaterThanOrEqual(
      AA_NORMAL,
    );
  });

  // Rate banner CTA: warn text on an 8%-opacity warn tint over the page bg
  // (`.rateBanner` `transparent 92%`).
  it("warn CTA clears AA on the rate-banner tint", () => {
    expect(ratio(warn, over(warn, bg, 0.08))).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});

describe("dark-mode token contrast (small text)", () => {
  const { bg, surface, surfaceAlt, textSoft, textMute, up, down, warn } =
    darkTokens;

  it.each([
    ["textMute on surface", textMute, surface],
    ["textMute on surfaceAlt", textMute, surfaceAlt],
    ["textMute on bg", textMute, bg],
    ["textSoft on surface", textSoft, surface],
    ["up on surface", up, surface],
    ["down on surface", down, surface],
    ["warn on surface", warn, surface],
  ])("%s clears AA (4.5:1)", (_label, fg, bgColor) => {
    expect(ratio(fg, bgColor)).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});
