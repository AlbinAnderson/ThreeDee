# Pathfinder 1st Edition (PF1e): Level 1 Actions Reference for VTT Implementation

To model Pathfinder 1st Edition combat in a Virtual Tabletop (VTT), your engine needs to track **six action types** per turn: **Standard**, **Move**, **Full-Round**, **Swift**, **Immediate** (consumes your next turn's Swift action), and **Free**, plus **Non-Actions** and **Attacks of Opportunity (AoO)**.

On a normal turn, a character receives:
* **1 Standard Action + 1 Move Action** (or **2 Move Actions**), **OR** **1 Full-Round Action**
* **1 Swift Action** (unless an Immediate Action was used since the end of their last turn)
* **Unlimited Free Actions** (subject to GM discretion)
* **1 Attack of Opportunity** per round (unless modified by feats like Combat Reflexes)

---

## Part 1: Generic Actions (All Level 1 Characters)

### Standard Actions

| Action | Provokes AoO? | Mechanical Notes |
| :--- | :--- | :--- |
| **Attack (Melee / Ranged / Unarmed)** | No (Melee) / Yes (Ranged, Unarmed without Improved Unarmed Strike) | Single attack roll at highest BAB. Can optionally apply **Fight Defensively** (-4 to attacks, +2 dodge bonus to AC until next turn). |
| **Aid Another** | No (varies by task) | Attack roll vs. AC 10 (or DC 10 skill check) to grant an ally +2 on their next attack roll, AC against one opponent, or skill check. |
| **Cast a Spell** | Yes | Default for spells with a 1-standard-action casting time. Can be cast defensively (Concentration check, DC `15 + 2 × spell level`) to avoid provoking. |
| **Concentrate to Maintain a Spell** | No | Required each round for spells with duration "Concentration." |
| **Dismiss a Spell** | No | Ends a dismissible spell (`(D)`) that you cast. |
| **Activate Magic Item** | Varies | **Spell Completion** (Scrolls) provokes AoO. **Spell Trigger** (Wands, Staves), **Command Word**, and **Use-Activated** items do **not** provoke AoO. |
| **Drink a Potion / Apply Oil** | Yes | Consumes a potion or applies oil to an object/creature. |
| **Feint** | No | Bluff check vs. DC `10 + BAB + Wis mod` (or `10 + Sense Motive`, whichever is higher) to deny target's Dex bonus to AC on your next melee attack before the end of your next turn. |
| **Total Defense** | No | +4 dodge bonus to AC until the start of your next turn; you cannot make Attacks of Opportunity while using Total Defense. |
| **Ready an Action** | No | Set a trigger to execute a Standard, Move, Swift, or Free action out of turn; permanently moves your Initiative count directly ahead of the triggering creature. |
| **Start/Complete Full-Round Action** | Varies | Spend a Standard action on turn 1 and a Standard action on turn 2 to complete a Full-Round action (cannot be used for Full Attack, Charge, Run, or Withdraw). |
| **Use a Skill** | Varies | Default for most active skills (e.g., Heal: First Aid [Yes], Intimidate: Demoralize [No]). |
| **Use a Special Ability** | Varies | Spell-Like Abilities (`Sp`) provoke AoO; Supernatural (`Su`) and Extraordinary (`Ex`) abilities do **not** provoke AoO unless specifically stated. |

---

### Move Actions

| Action | Provokes AoO? | Mechanical Notes |
| :--- | :--- | :--- |
| **Move** | Yes (leaving a threatened square) | Move up to your base speed. |
| **Crawl** | Yes | Move 5 feet while Prone. |
| **Stand Up from Prone** | Yes | Removes the Prone condition. |
| **Draw a Weapon** | No | Can be combined with a regular Move action if your BAB is +1 or higher. |
| **Sheathe a Weapon** | Yes | Stores a held weapon. |
| **Ready / Loose a Shield** | No | Can be combined with a regular Move action if your BAB is +1 or higher. |
| **Open or Close a Door** | No | Opens or closes an unlocked door. |
| **Manipulate an Item** | Yes | Pick up an item, retrieve a stored item, or move a heavy object. |
| **Mount / Dismount a Steed** | No | Requires being adjacent to the mount. |
| **Load a Light / Hand Crossbow** | Yes | Heavy and repeating crossbows require a Full-Round action. |
| **Direct / Redirect an Active Spell** | No | Moves or retargets active spells such as *Flaming Sphere* or *Spiritual Weapon*. |

---

### Full-Round Actions

| Action | Provokes AoO? | Mechanical Notes |
| :--- | :--- | :--- |
| **Full Attack** | No (Melee) / Yes (Ranged) | Required for multiple attacks (e.g., Two-Weapon Fighting, Flurry of Blows, multiple natural attacks). Can optionally apply **Fight Defensively** (-4 to attacks, +2 dodge bonus to AC). |
| **Charge** | No (movement still provokes) | Move up to 2× speed in a straight line (min. 10 ft) + 1 melee attack (+2 attack, -2 AC until the start of your next turn). |
| **Run** | Yes (leaving threatened squares) | Move 4× speed in a straight line (3× in heavy armor); lose Dex bonus to AC until next turn. |
| **Withdraw** | No (starting square only) | Move up to 2× speed; the square you start in is not considered threatened by any enemy you can see. |
| **Coup de Grace** | Yes | Auto-hit and auto-crit against a Helpless target; target must make a Fortitude save (DC `10 + damage dealt`) or die. |
| **Cast a 1-Round Spell** | Yes | Spell takes effect just before the beginning of your next turn. |
| **Load a Heavy / Repeating Crossbow** | Yes | Reloads a heavy crossbow or changes a repeating crossbow case. |
| **Extinguish Flames** | No | Drop prone and roll (+4 bonus on Reflex save to extinguish fire). |
| **Escape a Net / Full-Round Skill** | Yes | Includes Escape Artist vs. a net or any 1-round skill task. |

---

### Combat Maneuvers

*All Combat Maneuvers provoke an Attack of Opportunity from the target unless the attacker possesses the corresponding "Improved" feat (e.g., Improved Trip).*

* **Replaces a Melee Attack (usable during an Attack, Full Attack, Charge, or AoO):**
  * **Disarm**
  * **Sunder**
  * **Trip**
* **Standard Action:**
  * **Bull Rush** *(also usable at the end of a Charge)*
  * **Dirty Trick**
  * **Drag**
  * **Grapple**
  * **Overrun** *(also usable as part of a Move or Charge)*
  * **Reposition**
  * **Steal**

---

### Free, Swift, Immediate, and Non-Actions

* **5-Foot Step (No Action / Non-Action):** Move 5 feet without provoking AoOs. Usable only once per turn and only if you take no other movement that turn.
* **Delay (No Action / Non-Action):** Voluntarily lower your Initiative count to act later in the round.
* **Attack of Opportunity (No Action / Non-Action):** 1/round melee attack triggered when an opponent in your threatened area performs a provoking action.
* **Drop an Item / Drop Prone / Speak (Free Action):** Does not provoke AoOs.
* **Cease Concentration on a Spell (Free Action):** Ends a concentration-duration spell.
* **Prepare Spell Components (Free Action):** Included as part of casting a spell.
* **Swift / Immediate Actions:** No generic level 1 actions exist; these are granted exclusively by feats, spells, magic items, or class features.

---

## Part 2: Level 1 Class-Specific Actions

*Note: Passive bonuses (e.g., Rogue's Sneak Attack, Fighter's Bonus Combat Feat, Ranger's Favored Enemy) are omitted unless they grant a distinct active trigger or resource button in a VTT.*

### Core Classes

* **Barbarian**
  * **Rage (Free):** Enter or end rage (+4 Str, +4 Con, +2 Will, -2 AC). Resource: `4 + Con mod` rounds/day.
* **Bard**
  * **Bardic Performance (Standard to start, Free to maintain):** *Countersong*, *Distraction*, *Fascinate*, or *Inspire Courage (+1)*. Resource: `4 + Cha mod` rounds/day.
  * **Cast a Spell (Varies):** Spontaneous Arcane (Cantrips, 1st-level).
* **Cleric**
  * **Channel Energy (Standard, does not provoke):** 30-ft burst (`1d6` heal or harm). Resource: `3 + Cha mod` uses/day.
  * **Domain Powers (Varies, usually Standard or Swift):** Two 1st-level powers based on chosen Domains. Resource: typically `3 + Wis mod` uses/day.
  * **Cast a Spell / Spontaneous Cure or Inflict (Varies):** Prepared Divine (Orisons, 1st-level).
* **Druid**
  * **Nature Bond (Varies):** Either a **Domain Power** (as Cleric) OR an **Animal Companion** (Handle Animal: **Free** for known tricks, **Move** to push).
  * **Wild Empathy (1 Minute):** Diplomacy-like check (`1d20 + level + Cha mod`) to improve an animal's attitude.
  * **Cast a Spell / Spontaneous Summon Nature's Ally (Varies):** Prepared Divine (Orisons, 1st-level).
* **Fighter**
  * *No unique active class actions at level 1 (only Bonus Combat Feat).*
* **Monk**
  * **Flurry of Blows (Full-Round):** Make an extra unarmed/monk-weapon attack. Treats BAB as Monk level (`+1` at level 1) with a `-2` penalty to all attacks (`-1/-1` before Str/Dex modifiers).
  * **Stunning Fist (Free, declared before attack roll):** Target makes a Fortitude save (DC `10 + 1/2 level + Wis mod`) or is Stunned for 1 round. Resource: `1/day`.
* **Paladin**
  * **Detect Evil (Move for single target / Standard as spell):** At-will.
  * **Smite Evil (Swift):** Add Cha mod to attack rolls and deflection bonus to AC, and +1 to damage against 1 evil target. Resource: `1/day`.
* **Ranger**
  * **Wild Empathy (1 Minute):** As Druid.
* **Rogue**
  * *No unique active class actions at level 1.*
* **Sorcerer**
  * **Bloodline Power (Varies, usually Standard):** 1st-level power based on chosen Bloodline. Resource: typically `3 + Cha mod` uses/day.
  * **Cast a Spell (Varies):** Spontaneous Arcane (Cantrips, 1st-level).
* **Wizard**
  * **Arcane Bond (Standard, if Bonded Object):** Cast any 1 spell in your spellbook without preparing it (`1/day`). *(Familiar grants no unique combat action at level 1.)*
  * **Arcane School Power (Varies, usually Standard):** 1st-level power based on chosen School. Resource: typically `3 + Int mod` uses/day.
  * **Cast a Spell (Varies):** Prepared Arcane (Cantrips, 1st-level).

---

### Base Classes

* **Alchemist**
  * **Throw Bomb (Standard, provokes AoO):** Ranged touch attack (`1d6 + Int mod` fire damage + splash). Resource: `1 + Int mod` uses/day.
  * **Drink Mutagen (Standard, provokes AoO):** +4 alchemical bonus to one physical stat, -2 penalty to corresponding mental stat, +2 natural armor for 10 minutes. Takes 1 hour to brew.
  * **Drink Extract (Standard, provokes AoO):** Functions as 1st-level personal-range spells.
* **Cavalier**
  * **Challenge (Swift):** +1 damage to challenged target, -2 AC against attacks from all other creatures. Resource: `1/day`.
  * **Tactician (Standard):** Grant a bonus Teamwork feat to allies within 30 ft for 3 rounds. Resource: `1/day`.
* **Gunslinger** *(Resource: Grit = `Wis mod`, minimum 1)*
  * **Deadeye (Free, part of attack):** Spend 1 grit per range increment beyond the first to resolve a firearm attack against Touch AC.
  * **Gunslinger's Dodge (Immediate):** Spend 1 grit when targeted by a ranged attack to move 5 ft (+2 AC) or drop prone (+4 AC) against that attack.
  * **Quick Clear (Standard with ≥1 grit, or Move by spending 1 grit):** Remove the Broken condition from a misfired firearm.
* **Inquisitor**
  * **Judgment (Swift):** Activate 1 ongoing combat buff (*Destruction, Healing, Justice, Piercing, Protection, Purity, Resiliency, Resistance,* or *Smiting*). Resource: `1/day`.
  * **Domain / Inquisition Power (Varies):** As Cleric.
  * **Cast a Spell (Varies):** Spontaneous Divine (Orisons, 1st-level).
* **Magus**
  * **Arcane Pool (Swift):** Spend 1 point to grant a held weapon a +1 enhancement bonus for 1 minute. Resource: `1 + Int mod` points/day (`1/2 level [min 1] + Int mod`).
  * **Spell Combat (Full-Round):** Cast a Magus spell (1-standard-action casting time) AND make melee attacks with a -2 penalty to all attacks.
  * **Cast a Spell (Varies):** Prepared Arcane (Cantrips, 1st-level).
* **Oracle**
  * **Revelation (Varies):** One 1st-level active or passive ability based on chosen Mystery.
  * **Cast a Spell (Varies):** Spontaneous Divine (Orisons, 1st-level).
* **Summoner**
  * **Summon Eidolon (1-Minute Ritual):** Calls the Eidolon to the Summoner's side.
  * **Summon Monster I (Standard):** Lasts 1 minute/level. Cannot be used while the Eidolon is summoned. Resource: `3 + Cha mod` uses/day.
  * **Cast a Spell (Varies):** Spontaneous Arcane (Cantrips, 1st-level).
* **Witch**
  * **Hex (Varies, usually Standard):** One 1st-level Hex (e.g., *Slumber*, *Evil Eye*, *Cackle* [Move]). Most hostile hexes can affect a given target only 1/day.
  * **Cast a Spell (Varies):** Prepared Arcane (Cantrips, 1st-level).

---

### Alternate Classes

* **Antipaladin**
  * **Detect Good (Move for single target / Standard as spell):** At-will.
  * **Smite Good (Swift):** Add Cha mod to attack rolls and deflection bonus to AC, and +1 to damage against 1 good target. Resource: `1/day`.
* **Ninja**
  * *No unique active class actions at level 1 (Ki Pool is gained at level 2).*
* **Samurai**
  * **Challenge (Swift):** As Cavalier. Resource: `1/day`.
  * **Resolve (Varies):** *Determined* (**Standard**, remove fatigued/shaken/sickened), *Resolute* (**Immediate**, reroll a Fortitude or Will save), or *Unstoppable* (**No Action**, automatically stabilize and remain conscious at negative HP). Resource: `1/day`.

---

### Hybrid Classes

* **Arcanist**
  * **Arcane Reservoir (Free, part of casting):** Spend 1 point to increase a spell's Caster Level or Save DC by +1. Resource: starts with `3` points/day (max `4`).
  * **Arcanist Exploit (Varies, usually Standard or Swift):** One 1st-level exploit.
  * **Consume Spells (Move):** Sacrifice a 1st-level spell slot to gain 1 point in your Arcane Reservoir. Resource: `Cha mod` (minimum 1) uses/day.
  * **Cast a Spell (Varies):** Prepared-Spontaneous Hybrid Arcane (Cantrips, 1st-level).
* **Bloodrager**
  * **Bloodrage (Free):** Enter or end bloodrage (+4 Str, +4 Con, +2 Will, -2 AC). Resource: `4 + Con mod` rounds/day.
  * **Bloodline Power (Varies):** 1st-level power (typically active while bloodraging).
* **Brawler**
  * **Martial Flexibility (Move):** Gain any 1 Combat Feat you meet the prerequisites for, lasting 1 minute. Resource: `3/day`.
* **Hunter**
  * **Animal Focus (Swift):** Apply an animal aspect buff to yourself (`1 minute/day`) and/or your Animal Companion (unlimited duration; can be changed as a Swift action).
  * **Wild Empathy (1 Minute):** As Druid.
  * **Cast a Spell (Varies):** Spontaneous Divine (Orisons, 1st-level).
* **Investigator**
  * **Inspiration (Free):** Add `1d6` to a skill or ability check (costs 1 point; free for Knowledge, Linguistics, and Spellcraft). Resource: `Int mod` (minimum 1) points/day (`1/2 level + Int mod`, rounded down).
  * **Drink Extract (Standard, provokes AoO):** As Alchemist.
* **Shaman**
  * **Spirit Ability (Varies, usually Standard):** 1st-level power from chosen Spirit. Resource: typically `3 + Cha mod` uses/day.
  * **Cast a Spell (Varies):** Prepared Divine (Orisons, 1st-level).
* **Skald**
  * **Raging Song (Standard to start, Free to maintain):** *Inspired Rage* (grants willing allies +2 Str, +2 Con, +1 Will, -1 AC). Resource: `3 + Cha mod` rounds/day.
  * **Cast a Spell (Varies):** Spontaneous Arcane (Cantrips, 1st-level).
* **Slayer**
  * **Studied Target (Move):** Designate 1 target for +1 on attack rolls, damage rolls, and Bluff, Knowledge, Perception, Sense Motive, and Survival checks against that target.
* **Swashbuckler** *(Resource: Panache = `Cha mod`, minimum 1)*
  * **Derring-Do (Free, part of check):** Spend 1 panache to add `1d6` (exploding on a 6, up to Dex mod times) to an Acrobatics, Climb, Escape Artist, Fly, Ride, or Swim check.
  * **Dodging Panache (Immediate):** Spend 1 panache when targeted by a melee attack to move 5 ft and add Cha mod as a dodge bonus to AC against that attack.
  * **Opportune Parry and Riposte (No Action + Immediate):** Expend 1 AoO and 1 panache to roll an attack to parry a melee attack; if successful and you have at least 1 panache remaining, spend an **Immediate** action to counter-attack.
* **Warpriest**
  * **Blessings (Standard or Swift, varies by Blessing):** Two 1st-level powers from chosen Blessings. Resource: `3/day` (shared pool).
  * **Cast a Spell (Varies):** Prepared Divine (Orisons, 1st-level).

---

### Occult & Other Classes

* **Kineticist**
  * **Kinetic Blast (Standard, provokes AoO):** Ranged attack (`1d6 + 1 + Con mod` physical) or ranged touch attack (`1d6 + 1/2 Con mod` energy) up to 30 ft; can be modified by your 1st-level **Infusion**.
  * **Gather Power (Move, or Full-Round + Move next turn):** Reduce the Burn cost of a blast wild talent used on the same turn by 1 (or 2 for Full-Round, or 3 for Full-Round + Move next turn).
  * **Basic Utility Wild Talent (Varies, usually Standard):** Elemental utility power (e.g., *Basic Aerokinesis*, *Basic Pyrokinesis*).
* **Medium**
  * **Channel a Spirit (1-Hour Séance):** Bind 1 of 6 legendary spirits for the day.
  * **Spirit Surge (Free, after failing a d20 roll):** Add `1d6` to a failed check/attack/save by accepting 1 point of Spirit Influence.
  * **Spirit Power (Varies):** Lesser spirit power based on the channeled spirit.
  * **Cast a Spell (Varies):** Psychic Knacks (0-level spells only at level 1).
* **Mesmerist**
  * **Hypnotic Stare (Swift):** Target within 30 ft takes a -2 penalty on Will saves.
  * **Painful Stare (Free, 1/round, usable off-turn):** Trigger when a stared target takes damage to deal `+1` additional precision damage (the extra `1d6` on the Mesmerist's own attacks begins at level 3).
  * **Mesmerist Trick (Standard to implant, Free to trigger):** Implant a hypnotic suggestion in an ally. Resource: `1 + Cha mod` uses/day (`1/2 level [min 1] + Cha mod`).
  * **Cast a Spell (Varies):** Spontaneous Psychic (Knacks, 1st-level).
* **Occultist**
  * **Base Focus Power (Varies, usually Standard or Swift):** Activated from 2 chosen Implement Schools. Resource: Mental Focus (`1 + Int mod` points/day).
  * **Cast a Spell (Varies):** Spontaneous Psychic (Knacks, 1st-level).
* **Psychic**
  * **Phrenic Amplification (Free, part of casting):** Spend Phrenic Pool points to modify a linked spell. Resource: `Wis or Cha mod` points/day (`1/2 level + Wis/Cha mod`, rounded down).
  * **Discipline Power (Varies):** 1st-level power based on chosen Psychic Discipline.
  * **Cast a Spell (Varies):** Spontaneous Psychic (Knacks, 1st-level).
* **Spiritualist**
  * **Manifest Phantom (1-Minute Ritual):** Summons the Phantom in Ectoplasmic or Incorporeal form.
  * **Harbor / Dismiss Phantom (Standard):** Returns the Phantom to the Spiritualist's consciousness.
  * **Shared Consciousness — Shunt Mind-Affecting Effect (Immediate):** While the Phantom is harbored, shunt a failed save against a mind-affecting effect into the Phantom (`1/day`).
  * **Etheric Tether (Full-Round, provokes AoO):** Concentrate to keep an Ectoplasmic Phantom manifested if it starts your turn between 50 ft and 100 ft away.
  * **Cast a Spell (Varies):** Spontaneous Psychic (Knacks, 1st-level).
* **Shifter**
  * **Shifter's Claws (Swift to extend, Free to retract):** Gain 2 primary claw attacks (`1d4`, or `1d3` if Small). Resource: **At-will**.
  * **Shifter Aspect (Swift):** Gain a minor aspect buff. Resource: `4 minutes/day` (`3 + Shifter level`).
  * **Wild Empathy (1 Minute):** As Druid.
* **Vigilante**
  * **Switch Identity (1 Minute):** Change between Social and Vigilante identities.
  * **Social Talent (Varies):** One 1st-level talent (mostly passive or out-of-combat).

---

### Unchained Classes (Mechanical Differences at Level 1)

* **Unchained Barbarian:** **Rage (Free)** grants a flat +2 melee attack/damage, +2 Will, -2 AC, and 2 temporary HP/level instead of Str/Con attribute bonuses.
* **Unchained Monk:** **Flurry of Blows (Full-Round)** grants 1 extra attack at full BAB with **no -2 penalty** (`+1/+1` at level 1).
* **Unchained Rogue & Unchained Summoner:** Identical active actions at level 1 to their Core/Base versions.