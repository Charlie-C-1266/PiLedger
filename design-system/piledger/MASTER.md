# PiLedger — Design System (Master)

> **Retrieval:** when building a specific page, first check `design-system/piledger/pages/[page-name].md`.
> If that file exists its rules **override** this Master file; otherwise follow the rules below.

> **Captured from the live codebase** (`frontend/src/theme/tokens.ts`, `frontend/src/index.css`,
> the component CSS modules) — not auto-generated guesswork. PiLedger is a **React 19 + TypeScript
> (Vite)** single-page app, **not** React Native; ignore any RN-specific advice the generator emits.

**Project:** PiLedger — self-hosted personal finance: net-worth tracking, accounts, transactions, envelope budgeting, savings goals.
**Updated:** 2026-06-15

---

## Foundations

### Theming
Light and dark are both first-class, toggled at runtime and remembered in `localStorage`
(`pl-theme-mode`, `pl-theme-accent`). `ThemeProvider` writes the palette to `--pl-*` CSS custom
properties on `:root`. **Components reference tokens (`var(--pl-surface)`), never raw hex.**

### Colour tokens

| Role | Token | Light | Dark |
|------|-------|-------|------|
| App background | `--pl-bg` | `#F6F6F8` | `#0E0F12` |
| Surface (cards, modals) | `--pl-surface` | `#FFFFFF` | `#16181D` |
| Surface alt (inputs, chips) | `--pl-surface-alt` | `#F0F0F4` | `#1E2128` |
| Text | `--pl-text` | `#0F1218` | `#ECEEF2` |
| Text soft | `--pl-text-soft` | `#5B6172` | `#9BA1AE` |
| Text muted | `--pl-text-mute` | `#677080` | `#888F9E` |
| Rule / border | `--pl-rule` | `rgba(15,18,24,.07)` | `rgba(255,255,255,.07)` |
| Up / positive | `--pl-up` | `#0B7D4A` | `#3FD79A` |
| Down / negative | `--pl-down` | `#C73030` | `#FF7A8A` |
| Warn | `--pl-warn` | `#915F09` | `#F5B544` |

The light-mode up/down/warn values are deliberately darkened to clear **WCAG AA 4.5:1** — keep them that way.

### Accent
User-selectable accent (`--pl-accent`), default teal `#0F766E`. Options:
`#0F766E` · `#5546F6` · `#0EA5A4` · `#E5685A` · `#1F4FB6`.
`--pl-accent-soft` is an accent↔background `color-mix` for subtle fills. Functional colour
(up/down) is **never the only signal** — always pair with text, icon, or sign.

### Typography
- **UI:** "Plus Jakarta Sans" (variable 400–800, self-hosted woff2).
- **Numeric / mono:** "JetBrains Mono" (hex inputs, code-ish values).
- Base line-height **1.5**. Use `font-variant-numeric: tabular-nums` (`.tabular-nums`) on money
  columns, balances, and timers to prevent width jitter.
- Mobile control font-size is forced to 16px (`@media (max-width: 719px)`) to stop iOS focus-zoom.

### Spacing & radius
- Spacing rhythm: **4 / 6 / 8 / 12 / 16 / 20 / 28** px.
- Radius: **8px** small controls/swatches · **10px** inputs/selects/buttons · **20px** cards & modals · **999px** chips/pills.

### Shadow
- `--pl-shadow` — subtle 1px lift for resting cards.
- `--pl-shadow-lg` — `0 14px 28px …` for raised cards, dropdowns, and modals.

### Focus
Every interactive control gets a **2px `--pl-accent` outline** on `:focus-visible` (keyboard only),
offset 2px (defined globally in `index.css`). Never remove it.

---

## Components

- **Inputs / selects** — `--pl-surface-alt` fill, 1px `--pl-rule` border, 10px radius, border
  transitions to `--pl-accent` on focus.
- **Chips** — pill shaped, `--pl-surface-alt` → `--pl-accent`/white when active (category pickers,
  Expense/Income toggle, series toggles).
- **Cards** — `--pl-surface`, 20px radius, `--pl-shadow`; avoid layout-shifting hover transforms on dense dashboards.

### Modals — shared `Modal` component
All modals render through `frontend/src/components/Modal.tsx`: a blurred scrim
(`rgba(0,0,0,.5)` + 6px blur) and a centred `--pl-surface` card (440px default; `size="wide"` → 760px
for chart/detail modals such as projections).

- **Motion:** the card **appears centred** with a fade-and-scale (`scale 0.96 → 1`); it fades back
  out on close (faster than the entrance). Wrap call-sites in `<AnimatePresence>` so the exit plays.
- **Reduced motion:** collapses to a plain crossfade (no slide).
- **Dismissal & a11y:** closes on backdrop click and **Escape**; `role="dialog"` + `aria-modal`.

### Motion (general)
Built on `motion` (`motion/react`). Durations 150–300ms, **transform/opacity only**, ease-out in /
faster ease-in out. Page transitions use `PageStagger` — top-level cards **slide in from the right**
in a staggered cascade. Always honour `prefers-reduced-motion`.

---

## Anti-patterns (do NOT do)
- ❌ Raw hex in components — use `--pl-*` tokens and verify **both** themes.
- ❌ Colour as the only meaning (up/down) — add text/icon/sign.
- ❌ Emoji as structural icons.
- ❌ Removing focus rings.
- ❌ Animating width/height/top/left — use transform/opacity.
- ❌ Text below 4.5:1 contrast (light mode is the tight one).
- ❌ Instant state changes — transition 150–300ms.

## Pre-delivery checklist
- [ ] Tokens used (no raw hex); light **and** dark verified.
- [ ] Contrast ≥ 4.5:1 (check light mode specifically).
- [ ] `:focus-visible` rings intact; fully keyboard reachable.
- [ ] Touch targets ≥ 44px on mobile.
- [ ] `prefers-reduced-motion` respected.
- [ ] No horizontal scroll / layout shift; `tabular-nums` on money columns.
- [ ] New UI ships with Vitest coverage (per CLAUDE.md testing rule).
