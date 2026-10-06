# Fathom UI notes (current) → Air Health v2 open skin

Studied `~/Projects/fathom` (Mac) `src/styles.css` + `src/ui/App.tsx` on 2026-10-06. Live on `:5179`. User steer: **take good ideas**, do not remap Air Health to Today/History/Body.

## What replaced cards in Fathom
Fathom has **no metric card grid**. The page is a continuous column on olive-black ground:

| Pattern | Role |
|---|---|
| **Top pill nav** | Text-only tabs, paper fill when on; hairline under header |
| **Huge Literata h1** | Day / metric title (`clamp` ~2.4–4.6rem), tight tracking |
| **Open sections** | `h2` + content; spacing via margin, not boxed panels |
| **One raised figure** | `.trace` (HR line) — only major `--raise` + soft shadow |
| **Fortnight strip** | 14 day buttons with persimmon bars, not cards |
| **Markbar / mix / deltas** | Thin progress strips on the ground |
| **Chips + missing line** | Present signals as chips; empties as a dim sentence |
| **Ledger / slots** (CSS still present) | 2-col hairline rows (name / value / detail) — used as language, not card stacks |
| **Plots** | SVG charts sit on the page; figcaption = big serif number + dim label |
| **Lists** | `.history` / `.log` = hairline rows |

Tokens unchanged: ink `#12140f`, raise `#1b1e16`, paper `#f3efe4`, paper-dim, line, persimmon, chartreuse, deep, wake. Literata + Schibsted Grotesk.

## Ideas stolen for Air Health (not a clone)
1. Kill raised/shadowed card stacks → **open blocks** with hairline dividers.
2. Keep **one** raised surface where a “trace” belongs (intraday HR), like Fathom’s `.trace`.
3. Morning report = **lede + readout ledger**, not a floating sheet.
4. 2-col chart layouts = **split ledger** (center rule), not two cards.
5. Same palette, type, top pills, quiet chrome.
6. **Keep** Air Health IA: Overview / Sleep / Activity / Heart / Coach / Data + all Chart.js charts, coach, takeout, phone sync.

## Intentionally different
Air Health multi-page health coach dashboard vs Fathom’s day-reading of a takeout. Different features stay; only the visual language converges.
