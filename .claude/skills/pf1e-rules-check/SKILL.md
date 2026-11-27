---
name: pf1e-rules-check
description: PF1e rules accuracy and PCGen .pcg compatibility checklist. Use whenever adding or editing PF1e rules tables, stat calculations, spells, feats, skills, buffs, conditions, or .pcg parsing.
paths:
  - packages/shared/src/pf1e/**
  - packages/shared/src/pcgen/**
---

# PF1e Rules & PCGen Compatibility Checklist

Apply this checklist whenever modifying files under `packages/shared/src/pf1e/` or `packages/shared/src/pcgen/`:

## 1. Name & Entity Matching
- **Never use raw `.includes()` or unanchored `/word/i`** on PCGen or PF1e names. Known failure modes:
  - `"leather"` matching `"Leather Boots"`, `"acid"` matching `"Wand of Acid Arrow"`, `/feat/i` matching `"Class Feature"`, `"dagger"` matching `"Punching Dagger"`, `"hunter"` matching `"Witch Hunter"`.
- Always use `normalizeName()`, word boundaries (`\b`), and longest-match-first canonical lookup tables.
- Support both PCGen variant formats: `"Base (Variant)"` and `"Base, Variant"` (e.g., `Sword (Short)`, `Longbow (Composite)`, `Invisibility (Greater)`, `Cure Light Wounds, Mass`).
- Split comma-separated targets on `legacyFeats` / `virtualFeats`, floor fractional legacy ranks (`Math.floor`), and match sheet overrides case-insensitively.

## 2. Engine-Enforced Rules (Never UI-Only)
- Enforce mutual exclusions (e.g., `Total Defense` vs `Combat Expertise` / `Fighting Defensively`; `Power Attack` vs `Piranha Strike`), feat deduplication, slot caps, and non-stacking rules (`sizeSteps`, fear/fatigue condition groups) inside `@vtt/shared` pure functions and `authorize` — never only in React button handlers.

## 3. Downstream Stat Flow (Avoid Omissions & Double-Counting)
Trace every modifier through the full stat pipeline before adding it:
- **Abilities:** Ability damage applies `-Math.floor(damage / 2)` without changing the score; zeroed abilities (`Helpless`/`Paralyzed`) set `loseDexToAc: true` and fix modifier at `-5` (ignoring ability damage).
- **AC & CMD:** `armor`, `shield`, `natural`, and `enhancement` (e.g., *Barkskin*) stay off Touch AC and CMD; `dodge` and `deflection` flow to Touch AC and CMD (with `dodge` dropped on flat-footed / `loseDexToAc`); all AC penalties apply to CMD.
- **Attacks & CMB:** `fx.mods.attack`, `fx.mods.attackMelee`, and melee combat toggles (`Power Attack`, `Piranha Strike`, `Combat Expertise`, `Fighting Defensively`) flow into `cmb` — do **not** add a second `cmb` penalty on conditions like `Grappled` that already penalize `attack`.
- **Size:** Multiple magical size increases (or decreases) do not stack (`maxGrow + maxShrink`), clamped to `Fine..Colossal`.

## 4. Offline Verification Against Local PCGen Data
- **Verify tables offline, never guess from memory:** Query the local PCGen PF1e `.lst` database (git-ignored at `./data/pcgen/data/pathfinder/`) using the bundled lookup script:
  ```bash
  node .claude/skills/pf1e-rules-check/scripts/pcgen-lookup.mjs <class|race|spell|feat|ability|equip|equipmod|skill|any> "<query>"
  ```
  *(Prioritizes Paizo books; pass `--all` for 3rd-party publishers.)*
- **Do not scrape or fetch `aonprd.com`:** Keep your workflow 100% offline using local PCGen `.lst` data. Any prose/exception rulings not clear from `.lst` files should be listed under **"Verify in audit"** for Antigravity to double-check against AoN during review.
- **4-way interaction tests for every new mechanic:** Whenever adding a feat, spell, buff, or condition rule, write tests covering:
  1. **Stacking:** same bonus type (highest wins), different bonus types (stack), and penalties (always stack).
  2. **Downstream propagation:** assert exact deltas on every affected stat (`AC`, `Touch`, `FF`, `CMB`, `CMD`, `Saves`, `Skills`, `Speed`, `Spells`).
  3. **Idempotency / dedup:** duplicate `.pcg` entries (`ABILITY` + `FEAT`/`VFEAT`) and condition marker + active buff together.
  4. **PCGen naming variants:** `"Base (Variant)"`, `"Base, Variant"`, mixed casing, and fractional ranks.
