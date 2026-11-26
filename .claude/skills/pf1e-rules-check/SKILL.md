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

## 4. Verification
- Verify class progression tables, caster levels, and spell/condition effects against PF1e Core/APG/ACG/AoN rather than guessing.
- List every newly added table or uncertain ruling under **"Verify in audit"** in your summary.
