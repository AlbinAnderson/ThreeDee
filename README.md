# Tabletop

A system-agnostic virtual tabletop: maps with a grid, tokens with HP and conditions, walls/doors/lights with line of sight, fog of war, area templates, drawing, shared rulers, pings, a turn tracker, chat with whispers and GM rolls, dice rolled on the server, saved rolls, handouts, rollable tables, card decks, a jukebox, per-player notepads and a party loot tracker. It's built to be extended. Game-system features (Pathfinder 1e helpers and so on) can be added as new modules without touching the core.

## Running locally

Requires Node 22+ (tested on Node 24).

```bash
npm install
npm run dev          # server on :3001 + Vite client on :5173
```

Open http://localhost:5173. Join with a name and room (default `main`), and tick **Join as GM** for yourself. Open a second browser window (or a private window, since each one keeps its own identity) to test as a player. Vite also listens on your LAN, so people on your network can join at `http://<your-ip>:5173`.

Everything is stored in `./data/` (git-ignored): the SQLite database `vtt.db` (all rooms and their snapshot history) and `assets/` (uploaded images and audio). Back up the whole folder.

`npm test` runs the server test suite (storage, snapshots, restore, permissions and privacy of every feature).

### Controls

| Action | How |
|---|---|
| Pan | Drag empty space (Select tool), right/middle drag, or Space + drag |
| Zoom | Mouse wheel, or the toolbar's − / + / fit buttons |
| Select / move token | Click / drag. Shift-click adds to the selection. Hold Alt while dropping to skip snapping |
| Delete token | Select it, press Delete |
| Tools (everyone) | `V` select, `R` ruler, `P` ping, `T` area template, `D` draw, `E` erase. The active tool's settings appear under the toolbar |
| Tools (GM) | `F` fog of war, `W` walls & doors, `L` lights |
| Ruler | Everyone sees your ruler live. Dragging a token shows the distance moved too. Snaps to cell centers (Alt = free) |
| Templates | Drag from a grid corner: burst (radius), cone (90° PF1e / 53° 5e), line, square. Affected squares are highlighted. Erase with `E` |
| Draw | Pen, line, rectangle, ellipse; color, width and fill. Everyone can draw on the live scene and erase their own; the GM can erase any and "Clear all" |
| Doors | Click a door's handle to open/close it. GM: Shift-click to lock/unlock |
| Dice | `/r 1d20+5 # Attack`, `/r 4d6kh3`, `/r 2d20kl1`, `/r d%`, or the quick-dice buttons |
| Private chat | `/gr 1d20 # Stealth` (GM-only roll), `/w Name message` (whisper; `/w Name /r 1d20` to whisper a roll), or set the chat mode picker to *GM only* / *Whisper* so every roll you make (hotbar, tables...) goes there |

Sidebar panels (icon rail on the right):
- **Chat**: messages and rolls, with a visibility picker (Everyone / GM only / Whisper).
- **Combat**: turn tracker. Select tokens and *Add selected tokens*; roll initiative (1d20 + modifier, ties broken by modifier); the GM starts combat and advances turns, and players can end their own turn and delay (↑/↓). The current token pulses on the map.
- **Actions** (PF1e): every generic PF1e action (standard, move, full-round, combat maneuvers, free/swift/immediate/non-actions) plus your classes' level-1 actions, each showing its cost, whether it provokes an attack of opportunity, and the rules text on hover. In combat, taking an action spends that part of your turn: standard + move (or two moves, or one full-round action), one swift, a 5-foot step only if you didn't otherwise move, attacks of opportunity once per round (more with Combat Reflexes, none while flat-footed), and an immediate action off your turn uses up your next swift. Unaffordable actions are greyed out with the reason; *Reset turn* undoes mistakes. Class resources (rage rounds, channel energy, grit, panache, burn...) count down as you use them; *Rest* restores them. Outside combat the panel just announces actions in chat, so it also works as a rules reference. A turn bar appears on the map while it's your turn.
- **Status**: HP and conditions of the party (and, for the GM, everything else on the scene). Set HP/conditions in the token inspector (select a token): damage soaks temp HP first; *Everyone sees HP* shows the bar to other players.
- **Players**: the roster. Your page has your profile, **saved rolls** (also shown as a hotbar at the bottom of the map) and a private **notepad** (only you and the GM can see it).
- **Characters** (PF1e): import a PCGen character by dropping its `.pcg` file on the panel (or *Import .pcg*). You get a preview of stats, classes, skills, feats, gear and spells before saving. Players import their own characters; the GM can import NPCs or hand a character to a player. Link a character to a map token from its page or from the token inspector; when the GM links a player's character, that player gets control of the token. After levelling up in PCGen, *Re-import .pcg…* shows what changed and keeps the VTT-side state (owner, token link, sharing, current HP, spent uses). Characters are private to their player and the GM unless *Share with the party* is ticked.
  - **Sheet** tab: live PF1e numbers (ability scores, HP, AC / touch / flat-footed, saves, BAB, CMB/CMD, initiative, speed, senses), calculated from the PCGen build. Hover a number for its breakdown; click a highlighted one to roll it into chat (uses your chat mode). Rolling initiative while the character's token is in the turn order fills in the tracker. Damage/heal/temp/nonlethal right on the sheet; ability damage, drain and temporary changes under *Ability damage & temporary changes*.
  - **Skills** tab: every PF1e skill (all ten Knowledges, plus Craft/Perform/Profession sub-skills from the file or added here) with ranks, a **C** badge for class skills (+3 with a rank), key ability and total; hover for the breakdown (ranks, class skill, ability, racial bonuses, Skill Focus and the paired +2 feats, Bardic knowledge and similar class features, size for Stealth/Fly, armor check penalty, misc). Click a total to roll (uses your chat mode); 🔒 rolls for the GM only. Filters: All / Trained / Usable / ★ favorites. *⋯* opens situational bonuses (Trapfinding, Track, Investigator inspiration that spends a point unless free, Alchemy when creating items, Stonecunning) and a ± field, Take 10 / Take 20, and overrides for ranks, misc and class skill (kept on re-import).
  - **Abilities** tab: **resources** (class pools such as rage rounds, channel energy, bombs, grit, panache, inspiration, arcane pool, burn) as pips with − (use) / + (restore), custom pools for anything else (ki, homebrew), and *Rest (8 hr)* to restore all. Below, a searchable **browser** of feats, traits, class features, racial & origin traits and proficiencies, with PCGen's descriptions, *chosen / granted / virtual* badges, and *Post to chat* (uses your chat mode). PCGen only saves chosen abilities, so class and racial features the VTT's rules tables know are added (marked *rules*).
  - **Combat options** (on the Sheet above Attacks, and in the Actions panel): Power Attack, Piranha Strike, Deadly Aim, Combat Expertise, Rapid Shot (shown if you have the feat), Fight defensively and Total defense. They change the attack, damage and AC numbers and rolls directly (dodge bonuses also raise CMD; ×1.5 two-handed, ½ off hand). Weapon Focus / Specialization (and Greater) apply to their chosen weapon automatically.
  - **Inventory** tab: the character's gear, seeded from the .pcg (`EQUIPNAME`, `EQUIPSET`, `MONEY`) and then owned by the VTT, so it's kept on re-import unless you tick *Replace the inventory*. Items sit in a container tree (backpack, bandolier, bag of holding...) with +/− steppers for quantity and charges. Each **loadout** (equipment set) says where every item is: wielded (main/off/both hands), worn (armor, shield, body slots), carried or not carried; switch loadouts in one click (e.g. *Drop backpack* when a fight starts). A load meter shows carried weight (coins: 50 per lb; not-carried gear and extradimensional contents don't count) against Light/Medium/Heavy limits from Str and size. Medium/heavy load and armor set max Dex, armor check penalty, arcane spell failure and speed (the worse of the two applies). Known weapons, armor, light sources and containers fill in their stats from the name; everything is editable under *Rules data*. Lit torches and lanterns set the linked token's carried light. The purse has pp/gp/sp/cp, with *Spend* (makes change) and *Receive*. *→ Party loot* moves items to the shared Loot.
  - **Attacks** (on the Sheet): every wielded weapon with attack bonus (iteratives at BAB 6+, Weapon Finesse, masterwork/enhancement, size), damage (dice sized for the wielder, Str ×1.5 two-handed, ×½ off hand, bows/crossbows/splash weapons handled) and crit, as roll buttons; two-weapon fighting penalties when both hands hold a weapon. The Actions panel's attack rolls use the wielded weapon too.
  - **Settings** tab: what the .pcg doesn't say: the racial +2 for Humans/Half-Elves/Half-Orcs, progressions for classes the rules tables don't know (prestige/homebrew), armor and shield bonus if not detected from equipped gear, size/speed/darkvision overrides, and extra untyped bonuses (favored class HP, natural armor, deflection, ...). Kept on re-import.
  - **Linking** a token copies max HP, name, size, darkvision and the initiative modifier to it. While linked, the token holds the live HP, so the map bar, the inspector's damage buttons and the sheet all show and edit the same number. Unlinking (or deleting the token) copies the HP back onto the character.
- **Loot**: anyone can add items (image, quantity, value, holder, party notes). The GM also writes each item's **true properties**, revealed when the GM ticks *Identified*. **→ Inventory** moves some or all of a stack into a character you play (notes, value and image go along); the true properties stay GM-only until identified, and the GM can identify it from the character's inventory. **Export…** downloads CSV, Markdown or JSON.
- **Handouts**: the GM's letters, maps and pictures, shared with nobody, everyone, or chosen players. *Show to players* pops it up on their screens.
- **Tables & decks**: weighted rollable tables (one entry per line, `3: Goblins` for weight 3; GM-only unless shared) and card decks (52-card preset, or build from images / text). Draw face up (posted to chat) or face down (only you and the GM see it).
- **Tokens**: add tokens and list the ones on this scene.
- **Audio**: your own volume. The GM uploads tracks and plays them for everyone, in sync; several can play at once (music + ambience).

GM only: **History** (save a labelled snapshot, or restore the room to any earlier snapshot; restores are undoable), **Scenes** (create scenes, upload maps, grid settings, vision/fog switches, "Show players"), hiding tokens and combatants, and assigning token owners. The GM can preview a scene privately; players only see the LIVE scene.

**Vision:** in a scene with *Line of sight* on, players only see what their tokens can see; walls and closed doors block it. A *Dark* scene additionally needs light: place lights with `L`, or give tokens a carried light or darkvision in the inspector (radii in cells). The GM always sees everything. Players can never move their tokens through walls or closed doors.

The ruler's diagonal rule is set per scene. Pick **Alternating (1-2-1-2)** for PF1e's 5/10/5 counting.

## Production / the droplet

```bash
npm run build                          # builds the client into packages/client/dist
GM_PASSWORD=something PORT=3001 npm start
```

In production a single Node process serves the client, the WebSocket (`/ws`), and uploads (`/assets`). Put it behind Caddy or nginx for HTTPS, and make sure WebSocket upgrades are proxied. With Caddy that's just `vtt.example.com { reverse_proxy localhost:3001 }`. Run it under systemd or pm2.

| Env var | Default | Meaning |
|---|---|---|
| `PORT` / `HOST` | `3001` / `0.0.0.0` | Listen address |
| `DATA_DIR` | `<repo>/data` | Database (`vtt.db`), uploads (`assets/`), backups (`backups/`) |
| `SNAPSHOT_INTERVAL_MIN` | `60` | How often a room in use is snapshotted automatically |
| `GM_PASSWORD` | unset | Required to join as GM. **If unset, anyone can be GM.** Set it before exposing the server. |
| `MAX_UPLOAD_MB` | `60` | Upload size limit (images and audio) |

### Persistence, snapshots and backups

Rooms live in SQLite (`data/vtt.db`, built into Node, so there's no database server to run). The server saves a room about 1 second after each change, and flushes everything on shutdown (Ctrl+C, SIGTERM, `tsx watch` restarts).

**Snapshots:** each room is snapshotted automatically when it's in use (at most hourly). Automatic snapshots are kept for 2 days, then thinned to one per day for 30 days. Snapshots the GM saves by hand are kept forever. Restoring first snapshots the current state, so you can undo a restore.

Maintenance commands (run from the repo root):

```bash
npm run -s vtt -- rooms                  # list rooms
npm run -s vtt -- snapshots main         # list a room's snapshots
npm run -s vtt -- backup                 # data/backups/vtt-<date>.db; safe while the server runs
npm run -s vtt -- export main [file]     # room as JSON
npm run -s vtt -- import file.json main  # load JSON into a room (stop the server first)
```

On the droplet, schedule a nightly backup and copy it off the machine, e.g. with cron: `0 5 * * * cd /srv/vtt && npm run -s vtt -- backup`. Don't copy `vtt.db` by hand while the server is running, because recent writes may still be in `vtt.db-wal`; use `backup`.

Rooms saved by the old JSON store (`data/rooms/*.json`) are imported automatically on startup and the files renamed to `*.json.imported`.

Known trust limits, which are fine among friends but worth knowing: identity is a random ID stored in the browser (no accounts) and uploads aren't authenticated. Some things are only hidden by the UI, so someone digging in their browser's dev tools could find them: hidden tokens and combatants, tokens standing in darkness or fog, and which card a face-down draw was.

These, by contrast, are genuinely private, because the server never sends them to players who can't see them: other players' notes, whispers and GM-only rolls, unshared handouts, GM-only tables, unidentified loot properties and the order of a deck's draw pile (see *Private data* below).

## Architecture

```
packages/
  shared/   Game logic used by both sides: state schemas, actions, dice, geometry, protocol
  server/   Node + Express + ws. Authoritative rooms, persistence, asset uploads
  client/   React + Vite + zustand. SVG board, tools, panels
```

**The core idea:** every change to the game is an *action* defined exactly once in `shared` with `defineAction(type, zodSchema, { authorize, prepare?, apply })`.

1. The client calls `dispatch(action)`. It validates and authorizes locally for instant feedback, then applies the action optimistically.
2. The server re-validates the payload with the same zod schema and the same `authorize`. It optionally runs `prepare` (dice are rolled here, so clients can't fake them), then applies the action with the **same `apply` reducer** and broadcasts it with a sequence number.
3. Clients apply the confirmed action and drop their optimistic copy. If the server rejects it, the client rolls back and shows a toast.

Because the reducer is shared, client and server can't drift apart. Ephemeral things like pings use a separate relay channel and are never stored.

### Private data

Some data must never reach certain players (notes, whispers, unshared handouts, unidentified loot, deck order...). Two hooks handle it:

- A module may export a **redactor** `(draft, viewer) => void` that strips hidden data from a snapshot before the server sends it to that viewer (see `modules/notes.ts`, `modules/loot.ts`).
- An action may declare an **`audience(viewer, payload, { state, meta })`**. The server only delivers it to matching users (the author always gets their own). An action with a restricted audience must only touch data the redactor hides; otherwise excluded clients' state drifts.

To reveal a secret later, have a server `prepare` step copy it into the action (that's how `loot/setIdentified` and `handout/update` work). Clients re-run the redactors after every action, so data that stops being visible to someone (an un-shared handout) disappears from their screen immediately.

### Where things live

| Concern | Location |
|---|---|
| State shape (zod → TS types) | `shared/src/state.ts`, with entity schemas in `shared/src/entities/` |
| Line-of-sight / wall geometry | `shared/src/visibility.ts` |
| Feature actions | `shared/src/modules/*.ts`, registered in `modules/index.ts` |
| Permission helpers | `shared/src/actions/auth.ts` |
| Save-format migrations | `shared/src/migrations.ts` |
| Wire protocol | `shared/src/protocol.ts` |
| Room logic | `server/src/rooms/Room.ts` |
| Persistence | `server/src/persistence/`: `RoomStore` interface, `SqliteRoomStore` (DB schema migrations at the top), `snapshotPolicy` |
| Request/response ops (snapshots...) | `shared/src/rpc.ts` (types) + `server/src/rpc.ts` (handlers) + client `net/rpc.ts` |
| Maintenance CLI | `server/src/cli.ts` |
| Client stores | `client/src/state/` (`gameStore` = synced, `uiStore` = local, `board/interactionStore` = transient) |
| Board layers | `client/src/board/layers/`, registered in `layers/index.ts` |
| Tools | `client/src/tools/`, registered in `tools/index.ts` |
| Sidebar tabs | `client/src/panels/`, registered in `panels/index.ts` |
| Player page sections (notes, ...) | `client/src/player/`, registered in `player/index.ts` |
| Status tab sections | `client/src/status/index.ts` |
| Loot UI + exporters | `client/src/loot/` |
| Condition presets (icons/colors) | `client/src/config/conditions.ts` |
| PF1e characters | `shared/src/entities/pf1e.ts` (schema: `build` from PCGen, `sheet` overrides, `runtime` table state), `shared/src/modules/pf1e/characters.ts` (actions), `shared/src/pf1e/` (helpers: import, re-import merge, diff, token sync), `shared/src/pcgen/` (.pcg parser), `client/src/characters/` (UI) |
| PF1e actions & turn economy | `shared/src/pf1e/actions.ts` (generic + class actions and resources, as data), `economy.ts` (turn rules), `resources.ts`, `shared/src/modules/pf1e/turns.ts` (act / resetTurn / resetUses), `client/src/pf1e/ActionsPanel.tsx` |
| PF1e rules engine | `shared/src/pf1e/engine.ts` (`computeCharacterStats`: also load, armor penalties and weapon attacks), `modifiers.ts` (typed bonuses + stacking, with breakdowns), `rules.ts` (classes, races, sizes, armor, feats/traits with flat effects) |
| PF1e feats, toggles, resources | `shared/src/pf1e/abilities.ts` (ability catalog), `pf1e/toggles.ts` (combat options, applied in `engine.ts`), `characterPools` + `pf1e/adjustUse` in `modules/pf1e/turns.ts`, `chat/card`; `client/src/characters/AbilitiesTab.tsx`, `CombatToggles.tsx` |
| PF1e spells | `shared/src/pf1e/spellData.ts` (casting classes, spells-per-day tables, metamagic, common spells with save/SR/area), `pf1e/spells.ts` (CL, concentration, DCs, slots, prepared lists, cast/prepare rules, spell cards), `sheet.spellcasting` overrides, `runtime.prepared` + `runtime.uses["spell.<class>.<level>"]`, `shared/src/modules/pf1e/spells.ts` (castSpell / markPrepared / prepareSpells); `client/src/characters/SpellsTab.tsx`, `armTemplate` in `client/src/tools/templateTool.tsx` |
| PF1e skills | `shared/src/pf1e/skills.ts` (skill table, totals, situational bonuses), `sheet.skills` overrides, `client/src/characters/SkillsTab.tsx` |
| PF1e inventory | `shared/src/entities/pf1e.ts` (`InventorySchema`), `shared/src/pf1e/gear.ts` (weapon/light/container tables, name detection, carrying capacity, coins), `pf1e/inventory.ts` (seeding from .pcg, slots, carried weight, lit light), `shared/src/modules/pf1e/inventory.ts` (actions incl. loot transfer), `client/src/characters/InventoryTab.tsx` |
| Handouts, audio, tables & decks UI | `client/src/handouts/`, `client/src/audio/`, `client/src/random/` |

## Extending it: recipes

**Add a synced feature** (for example spell-slot tracking; `modules/combat.ts` is a good model):
1. Add the data to `GameStateSchema` in `shared/src/state.ts` (entity schema in `shared/src/entities/`). Bump `CURRENT_SCHEMA_VERSION` and add a migration step that fills in defaults for existing rooms.
2. Create `shared/src/modules/spellSlots.ts` exporting `{ spend: defineAction(...), ... }` and add it to `gameModules`. `GameAction` and server handling pick it up automatically.
3. Add a panel in `client/src/panels/` and register it in `panels/index.ts` with an `icon`. Use `useGame(s => s.spellSlots)` to read and `dispatch(spellSlotActions.spend.create({...}))` to write.

**Add a board tool:** write `defineTool({ id, label, icon, hotkey, createState, onPointerDown/Move/Up })` and list it in `tools/index.ts`. It gets a toolbar button and its hotkey automatically. Give it an `Options` component to show settings under the toolbar while it's active (see `drawTool.tsx`).

**Add something to each player's page** (character info, inventory...): write a component taking `{ player, viewer, isSelf }` and add `{ id, title, visible?, Component }` to `player/index.ts`. For per-player synced data, key a state slice by user id, as `notes` does. If it's private, add a redactor and an audience.

**Add something to the Status tab:** add `{ id, title, gmOnly?, Component }` to `status/index.ts`.

**Add a server request** (something that isn't a game-state change, e.g. a search or an admin operation): add the args schema and result type in `shared/src/rpc.ts`, a handler in `server/src/rpc.ts`, and call `await request('your.op', args)` on the client.

**Change the database schema:** append a SQL step to `MIGRATIONS` in `SqliteRoomStore.ts`; never edit an existing one. (Game-state shape changes go through `shared/src/migrations.ts` instead.)

**Add a loot export format:** add an entry to `lootExporters` in `loot/exportLoot.ts`.

**Add a visual layer** (auras, weather...): write a component taking `{ scene }` and add it to `boardLayers` in draw order.

**Add an ephemeral event** (shared cursors...): add a variant to `EphemeralEventSchema`, then send it with `sendEphemeral(...)` and subscribe with `onEphemeral(kind, handler)`.

**System-specific features** (PF1e) live in their own `shared/src/modules/pf1e/*`, `shared/src/pf1e/*` and `client/src/characters/*` files, so the core stays generic. New per-character data that the VTT tracks (spent spell slots, resource uses...) goes in `Character.runtime`, which re-import never touches; anything that comes from PCGen stays in `build`; manual settings go in `sheet`. Derived numbers are built as lists of typed `Modifier`s summed by `sumModifiers`, which applies PF1e stacking rules and keeps a breakdown; add new bonus sources (buffs, gear, conditions) as more modifiers rather than editing totals. Missing rules data (a race, class or feat) goes in `rules.ts`; a missing action or class ability goes in `actions.ts` (a class's resources are formulas of class level and ability modifiers).

### Conventions

- `useGame(selector)` selectors must return existing objects. To get a derived array, select the source record and derive it with `useMemo`, otherwise React re-renders forever.
- Form fields in `components/fields.tsx` commit on blur or Enter, so typing doesn't flood the server.
- `npm run typecheck` checks all three packages.
