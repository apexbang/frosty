# Tactical Wargame Engine — Build Spec

## 0. How to use this document

This is the spec for a single-player, turn-based tactical wargame where **code owns the
simulation and the AI owns judgment and prose**. It is written to be built incrementally.

- Build **Milestone 1 (§10) first** — it is the whole architecture proven on one engagement. Everything else is expansion on a spine that already holds weight.
- Treat **§11 Deferrals** as out of scope until their named milestone. Do not gold-plate them into M1.
- **§5.4 (the worked example) is the contract of record.** When prose here and the worked example disagree, the worked example wins. The human will redline it; honor the redlined version.
- Items tagged `ASSUMPTION:` are defaults the human can override. Surface them; don't bury them.

---

## 1. Core principle

**The AI proposes; the code disposes.**

- **Code owns truth:** state, dice, arithmetic, and all *categorical* invariants (capability-on-manifest, consumable counts, alive/dead, strength bounds). These are exactly the things that drift or get fudged when an LLM owns them.
- **AI owns judgment + prose:** interpreting orders, choosing the enemy's move, judging how a contested action plays out, narrating, and surfacing fog-of-war reveals.
- **Everything swappable lives behind an interface.** The two that matter — narration transport and persistence — are interfaces with a light v1 implementation and a heavier one deferred until a concrete need earns it.

The payoff that motivates the whole design: because code maintains state and hands the model only what *this* turn needs, **every turn starts clean**. Turn 50 is as sharp as turn 1. The long-campaign degradation that motivated this rebuild stops existing rather than being mitigated. And because the model's output has no authority over the ledger, its prose can be as rich as you like without risking corruption.

---

## 2. Stack

- **SvelteKit + Svelte 5 (runes).** `ASSUMPTION:` Svelte 5 with runes specifically — pin this. The one real codegen hazard is mixing Svelte 4 and 5 reactivity idioms into code that looks right and isn't. SvelteKit (not plain Svelte) so a server route is a natural home for the optional API relay later.
- **TypeScript — non-negotiable.** The move envelope and state are precisely the contracts where types catch errors before runtime, and generated code is materially better against typed interfaces.
- **Tailwind** for styling. Least consequential choice; swap for plain CSS if preferred.
- **Browser PWA.** Installable to home screen on Android. Capacitor/native wrapper deferred (§11).
- **The engine is pure, framework-free TypeScript modules** (`/lib/engine/`). It imports nothing from Svelte. Svelte only renders state and captures input. This is what makes the framework choice low-stakes and the engine unit-testable.

---

## 3. The seam (most important section)

Two kinds of rule, routed to where each belongs:

| Concern | Owner in v1 | Enforcement |
|---|---|---|
| Capability is on the actor's manifest | **Code** | Reject action if not permitted |
| Consumable counts (how many frags, rounds) | **Code** | Append-only ledger; validate vs remaining; code subtracts |
| Alive / dead, no resurrection | **Code** | Dead units can't act; 0 strength → destroyed → graveyard |
| Strength bounds (0–100), no free increases | **Code** | Clamp; increases only via logged resupply |
| Dice + outcome band | **Code** | Neutral RNG, modifiers clamped ±3, no rerolls |
| Engagement-end / hand-off | **Code** | Evaluated from strength thresholds |
| **Spatial/physical feasibility** (range, LOS, movement distance) | **Prose (AI)** | Judgment call; **deferred** to harden (§11) |
| How a firefight resolves narratively, enemy intent, tone | **Prose (AI)** | Adjudication + narration |

`ASSUMPTION:` spatial feasibility stays the AI's judgment in v1. The categorical checks above are the bulk of the pain the chat version had, for a fraction of the work. Hardening space (positions as coordinates, ranges as numbers) is a later milestone or never.

---

## 4. State model

The canonical state. Pure data; no behavior. (`/lib/engine/state.ts`)

```typescript
type Phase = 'planning' | 'engagement' | 'consolidation' | 'disengaging' | 'transit' | 'resupply' | 'recovery';
type StrengthBand = 0 | 25 | 50 | 75 | 100;            // coarsened — see §4.3
type SupplyLevel = 'high' | 'med' | 'low' | 'none' | 'na';
type Morale = 'steady' | 'shaken' | 'broken' | 'routed';

interface Manifest {
  doctrine: string;
  echelon: string;
  organicAssets: string[];      // capabilities this side may use (the validator's allow-list)
  supportingAssets: string[];   // on-call / allocated; may be finite (track allocation as a consumable)
  prohibited: string[];         // explicit denials; anything NOT in organic/supporting is also denied
}

interface ExpendEntry { turn: number; item: string; qty: number; actor: string; reason: string; }

interface Consumables {
  loadout: Record<string, number>;   // immutable EXCEPT via a logged resupply event
  expended: ExpendEntry[];           // APPEND-ONLY; never edited or deleted
  // remaining(item) = loadout[item] - sum(expended.qty where item) — DERIVED, never stored
}

interface Unit {
  id: string;                   // IMMUTABLE: never renamed, merged, or renumbered
  type: string;
  strength: StrengthBand;
  morale: Morale;
  supply: { ammo: SupplyLevel; fuel: SupplyLevel; rations: SupplyLevel; medical: SupplyLevel };
  position: string;             // free text in v1 (spatial deferred); later: coordinates
  posture: string;
  status: string[];             // e.g. ['suppressed'] or ['destroyed']
}

interface Side {
  id: string;                   // 'BLUE' | 'RED' (schema allows more; v1 targets two)
  commander: 'player' | 'ai';
  objectives: string[];
  manifest: Manifest;           // LIVES IN STATE = it is the validator's rulebook, not just the AI's
  consumables: Consumables;
  units: Unit[];                // ACTIVE units only
}

interface Intel {
  knows: Record<string, string[]>;   // sideId -> confirmed facts it holds about others (fog of war)
  unconfirmedReports: string[];      // the surprise pool: things that may be real, wrong, stale, or absent
}

interface GameState {
  meta: { campaignName: string; turn: number; clock: string; weather: string; terrain: string; phase: Phase };
  sides: Side[];
  intel: Intel;
  graveyard: string[];          // retired units, one line each (e.g. "destroyed: TECH (AT4)")
}
```

### 4.1 Event sourcing
Each turn produces a list of `GameEvent`s (§6.3). **State is the fold of events; the canonical save is the event stream plus periodic snapshots.** This is not optional flavor — the append-only `expended` log, the change-diff you read each turn, and the event log are the same thing: a transactional ledger. Model it as one.
- `remaining(item)` is a query over events, not a stored field.
- Undo (later) = drop the last turn's events, restore the prior snapshot.
- Snapshot every N turns and on migrate/export so replay stays cheap.

### 4.2 Retire the dead
A unit at 0 strength (or `status` includes `destroyed`) is removed from `Side.units` and collapsed to a one-line entry in `graveyard`. Do not keep dead units as full objects with `na` fields. Dead units cannot act; any proposed action by one is rejected (§6.2).

### 4.3 Coarsened strength
`ASSUMPTION:` strength is a band `{0,25,50,75,100}`, not a fine percentage. Less arithmetic → less drift, and it matches how a commander actually thinks ("that squad's combat-ineffective," not "73%"). The worked example uses bands. Override to fine percentages if wanted, but the coarsening was a deliberate decision, not an oversight.

### 4.4 Fog of war is a first-class feature
`intel.unconfirmedReports` is the best mechanic in the design and should be leaned into, not minimized. A report there may turn out real (the hidden mortar), wrong, stale, or absent. Reveals (§5.3) move items from `unconfirmedReports` into a side's `knows`. M2 makes this richer; M1 should at least carry the structure.

---

## 5. The move envelope (the contract)

### 5.1 The player's order
```typescript
interface OrderAction {
  actor: string;                 // unit id on the player's side
  actionType: string;            // 'assault' | 'move' | 'fire_support' | 'recon' | 'break_contact' | ...
  target?: string;
  capabilitiesUsed: string[];    // validated vs manifest
  expend?: { item: string; qty: number }[];
}
interface PlayerOrder {
  raw: string;                   // the prose / dictated order (intent + flavor)
  actions: OrderAction[];        // structured intent (see §5.5 for who structures it)
}
```

### 5.2 What the Narrator returns
```typescript
interface MoveEnvelope {
  narrative: string;                       // prose; COSMETIC; zero authority over state
  playerActions: ResolvedActionProposal[]; // the player's order, structured/echoed
  enemyActions: ResolvedActionProposal[];  // AI authors the enemy's move (same shape)
  reveals: Reveal[];                       // unconfirmed -> confirmed transitions
}

interface ResolvedActionProposal {
  actor: string;
  side: string;
  actionType: string;
  target?: string;
  opposes?: string;                        // actor id this action contests; pairs attacker<->defender into ONE roll (§6.3)
  capabilitiesUsed: string[];              // CODE validates vs that side's manifest
  expend: { item: string; qty: number }[]; // CODE validates vs remaining; CODE does the subtraction
  proposedModifiers: { label: string; value: number }[]; // CODE clamps NET to ±3, pre-roll; in a contest the net is taken in the attacker's frame (see §6.3)
  proposedOutcome?: {                      // AI judgment; CODE bounds it
    casualties?: { unit: string; deltaBand: number }[];  // deltaBand = INTEGER count of 25-pt bands (−1 = one band); negative only; result snaps within [0,100]; no resurrection
    moraleShift?: { unit: string; to: Morale }[];
    postureChange?: { unit: string; to: string }[];
    note?: string;
  };
  feasibilityNote?: string;                // spatial/physical judgment — PROSE-OWNED in v1
}

interface Reveal { report: string; resolvesTo: string; confirmedBy: string; }
```

### 5.3 Authority summary
- **AI authors:** `narrative`, the enemy's actions, `proposedModifiers`, `proposedOutcome` magnitudes, `reveals`, `feasibilityNote`.
- **Code authors (overrides anything above):** the dice, the ±3 clamp on net modifiers, consumable subtraction, strength clamping, alive/dead, clock, phase, the final folded state.
- **Contest pairing:** when an action sets `opposes`, code pairs it with that actor's action and resolves the pair on **one** dice roll. The net is computed in the **attacker's frame** from the attacking action's `proposedModifiers` (defender-favoring factors appear there as negatives, e.g. `enemy in prepared cover −1`); the defender's `proposedModifiers` describe the *same* contest from its own frame and are surfaced for transparency but **not added again**. The band is read from the **initiator's** perspective (`success_*` = initiator prevailed, opposer takes the heavier magnitude; `failure` = initiator repulsed, takes the heavier magnitude itself), and drives each side's `proposedOutcome` magnitude (each bounded independently). Unpaired actions resolve on their own roll.
- **Consumables can only ever decrease via an explicit `expend` entry.** There is no other code path that touches a count. A phantom decrement therefore requires a *visible* fabricated expend entry — which the confirm step (§5.5) surfaces — and narrative text that mentions a grenade has no effect on the ledger at all.

### 5.4 WORKED EXAMPLE — the contract of record
> The human will redline this. Treat the redlined version as authoritative.

**State before** (turn 3 complete; relevant slice). Remaining is derived: frag 4, smoke 4, mortar_60mm 12.
```json
{
  "meta": { "turn": 3, "clock": "D1 0700", "phase": "engagement" },
  "sides": [
    { "id": "BLUE", "commander": "player",
      "manifest": { "organicAssets": ["small_arms","frag","smoke","mortar_60mm","at4","m240"], "supportingAssets": [], "prohibited": ["cas","artillery_beyond_60mm"] },
      "consumables": { "loadout": { "frag": 6, "smoke": 4, "mortar_60mm": 12 },
        "expended": [ { "turn": 2, "item": "frag", "qty": 2, "actor": "1-1", "reason": "earlier assault" } ] },
      "units": [
        { "id": "1-1", "type": "rifle squad", "strength": 100, "morale": "steady", "posture": "staged", "status": [] },
        { "id": "MTR", "type": "60mm section", "strength": 100, "morale": "steady", "posture": "ready", "status": [] }
      ] },
    { "id": "RED", "commander": "ai",
      "manifest": { "organicAssets": ["small_arms","rpg","pkm"], "supportingAssets": [], "prohibited": ["heavy_weapons"] },
      "consumables": { "loadout": { "rpg": 8 }, "expended": [] },
      "units": [ { "id": "DEF", "type": "fighters in compound", "strength": 100, "morale": "steady", "posture": "prepared", "status": [] } ] }
  ]
}
```

**Player order (turn 4):** *"1st squad assaults the compound, two frags. Mortars fire two HE in support."*

**App assembles payload:** state slice + the rule modules this turn can trigger (assault, fire support, contact) + the order. (Sizing in §8; in M1 a single inline ruleset is fine.)

**AI returns `MoveEnvelope`:**
```json
{
  "narrative": "1st squad pushes off the line of departure as two 60mm rounds crump into the compound's near wall; the fighters inside go to ground under the dust...",
  "playerActions": [
    { "actor": "1-1", "side": "BLUE", "actionType": "assault", "target": "compound", "opposes": "DEF",
      "capabilitiesUsed": ["small_arms","frag"],
      "expend": [ { "item": "frag", "qty": 2 } ],
      "proposedModifiers": [ { "label": "60mm support", "value": 2 }, { "label": "enemy in prepared cover", "value": -1 } ],
      "proposedOutcome": { "casualties": [ { "unit": "1-1", "deltaBand": -1 } ], "note": "takes the compound, light losses" },
      "feasibilityNote": "compound within assault distance via covered approach" },
    { "actor": "MTR", "side": "BLUE", "actionType": "fire_support", "target": "compound",
      "capabilitiesUsed": ["mortar_60mm"],
      "expend": [ { "item": "mortar_60mm", "qty": 2 } ],
      "proposedModifiers": [],
      "proposedOutcome": { "note": "suppresses defenders during the assault" } }
  ],
  "enemyActions": [
    { "actor": "DEF", "side": "RED", "actionType": "defend_fire", "target": "1-1", "opposes": "1-1",
      "capabilitiesUsed": ["small_arms","rpg"],
      "expend": [ { "item": "rpg", "qty": 1 } ],
      "proposedModifiers": [ { "label": "prepared position", "value": 1 } ],
      "proposedOutcome": { "casualties": [ { "unit": "DEF", "deltaBand": -3 } ], "note": "fires then is overrun" } }
  ],
  "reveals": []
}
```

**Validator pass (code):**
- `1-1` assault — `small_arms`,`frag` ∈ BLUE.organicAssets ✓; `1-1` alive ✓; expend frag 2 ≤ remaining 4 ✓.
- `MTR` fire_support — `mortar_60mm` ∈ organicAssets ✓; expend 2 ≤ remaining 12 ✓.
- `DEF` defend_fire — `small_arms`,`rpg` ∈ RED.organicAssets ✓; expend rpg 1 ≤ remaining 8 ✓.
- Modifiers: contest net (attacker frame) = +2 −1 = +1 (≤ ±3) ✓; `DEF`'s `+1 prepared position` mirrors the player's `−1 cover` — surfaced, not re-added.
- **Smoke appears in no expend entry → smoke remaining stays 4. There is no code path for it to change.**

> **Rejected-hypothetical (the orbital-laser case):** had any action listed `capabilitiesUsed: ["cas"]` or `["orbital_laser"]`, the validator emits a `rejected` event (not in organic/supporting, or explicitly prohibited), drops the action, and surfaces `"1-1: cas not available"`. State does not change. The class of bug is structurally impossible, not merely discouraged.

**Resolver (code):**
- `1-1` assault vs `DEF` (paired via `opposes`) — ONE roll: RNG `2d6 = [3,4] = 7`, net +1 → **8 → success_costly**. Net is the attacker-frame sum `[60mm +2, enemy cover −1] = +1`; `DEF`'s `+1 prepared position` mirrors the same cover and is NOT added again.
- Apply on the shared band: `1-1` 100 → 75 (deltaBand −1, bounded). `DEF` overrun 100 → 25 (deltaBand −3; result snaps within [0,100], would clamp at 0 if lower), morale → broken, posture → broken.
- Append expend: frag×2 (`1-1`), mortar_60mm×2 (`MTR`), rpg×1 (`DEF`).
- Clock 0700 → 0720. `1-1` posture → consolidating.
- End check: RED's only committed unit `DEF` at 25% and broken → below ~50% → phase → consolidation, hand-off flagged.

**Events produced:**
```
dice   { actor:"1-1", roll:[3,4], modifiers:[{"60mm support":2},{"enemy cover":-1}], net:1, band:"success_costly" }
strength { unit:"1-1", from:100, to:75,  reason:"assault casualties" }
strength { unit:"DEF", from:100, to:25,  reason:"overrun" }
morale   { unit:"DEF", from:"steady", to:"broken" }
posture  { unit:"1-1", from:"staged", to:"consolidating" }
posture  { unit:"DEF", from:"prepared", to:"broken" }
expend   { side:"BLUE", actor:"1-1", item:"frag", qty:2 }
expend   { side:"BLUE", actor:"MTR", item:"mortar_60mm", qty:2 }
expend   { side:"RED",  actor:"DEF", item:"rpg", qty:1 }
clock    { from:"D1 0700", to:"D1 0720" }
phase    { from:"engagement", to:"consolidation" }
```

**State after** (slice). Remaining now: **frag 2, smoke 4 (UNCHANGED), mortar_60mm 10**; RED rpg 7.
```json
{
  "meta": { "turn": 4, "clock": "D1 0720", "phase": "consolidation" },
  "sides": [
    { "id":"BLUE", "units":[
        { "id":"1-1", "strength":75, "morale":"steady", "posture":"consolidating", "status":[] },
        { "id":"MTR", "strength":100, "morale":"steady", "posture":"ready", "status":[] } ] },
    { "id":"RED", "units":[
        { "id":"DEF", "strength":25, "morale":"broken", "posture":"broken", "status":[] } ] }
  ]
}
```

**The point:** the two bugs from the chat build — smoke swept along with the frags, and a phantom mortar round — have no representation in this pipeline. The mortar fired exactly 2 because the order said 2 and code subtracted 2. Smoke is untouched because nothing expended it. The prose may say anything; it has no authority over these numbers.

### 5.5 Order structuring + the confirm safeguard
The order is prose (typed or dictated), which matches the desired ergonomics. Something must turn that prose into the structured `actions`/`expend`. Three options, with a recommendation:

- **(Recommended for v1)** AI parses the prose order into the structured `playerActions` (it's good at fuzzy intent), code validates categorically, **and the app shows the parsed expenditures + proposed casualties for a one-tap confirm/adjust before the resolver commits.** This keeps the workflow, keeps the player as final authority over counts, and closes the only residual gap (a *plausible* quantity mis-parse, e.g. "a couple grenades" → 2 vs 3). `ASSUMPTION:` confirm step defaults ON; the player can disable it once they trust the parse.
- **(Strongest)** Structured order entry — actor select, action select, expend steppers. Zero quantity-misparse risk; the AI never authors player counts. More UI; this is the shallow, common-case action list (§9), not menu hell.
- **(Lightest)** Prose order, AI proposes counts, code only bounds them. Catches illegal, misses plausible mis-parse. Acceptable only if the confirm step is omitted and you accept the residual.

---

## 6. The turn cycle

### 6.1 Sequence
1. **Assemble payload** — current state slice + rule modules sized to stakes (§8) + the player's order.
2. **Narrate** — `Narrator.run(payload) → MoveEnvelope` (§7). v1 ClipboardNarrator: app renders a prompt to copy; player pastes into any AI; player pastes the JSON back; app parses and shape-validates it.
3. **Validate** (§6.2) — manifest + consumables + alive. Rejections surfaced to the player.
4. **Confirm** (optional, §5.5) — show parsed expenditures + outcomes for one-tap confirm/adjust.
5. **Resolve** (§6.3) — dice per contested action, bounded deltas, append expend, advance clock, apply reveals, evaluate phase/end conditions.
6. **Fold** events → new `GameState`; snapshot per §4.1.
7. **Render** reactively — state panel updates; narrative panel shows prose; dice + modifiers shown briefly (§9).
8. **Autosave** via `SaveStore`.

### 6.2 Validator responsibilities (`/lib/engine/validate.ts`)
- **Capability:** every entry in `capabilitiesUsed` must be in the actor's side `manifest.organicAssets` or `supportingAssets` (and a finite supporting allocation must have remaining). Otherwise → `rejected` event, drop the action, surface a clear message. **Reject, don't silently drop** — the player should see the orbital laser was refused.
- **Consumables:** each `expend` item must exist in `loadout` with `remaining ≥ qty`. If short → reject and surface ("out of AT4"). Do not clamp silently.
- **Alive:** a dead/destroyed actor's actions are rejected.
- **Bounds (applied at resolve):** strength result clamped to `[0,100]`; strength may **never** increase except via a `resupply`/`reinforcement` event carrying a manifest source; 0 strength → `destroyed` → graveyard.
- **Modifiers:** net per contested action clamped to `[-3, +3]`.

### 6.3 Resolver + hardened dice (`/lib/engine/resolve.ts`, `/lib/engine/dice.ts`)
- **Neutral RNG:** real entropy (Web Crypto `getRandomValues`), not author-chosen. This replaces the model rolling its own dice.
- **2d6 + clamped net modifier**, itemized into the `dice` event **before** the band is read (pre-commit, so modifiers can't be shaded to justify a result). **No rerolls.**
- **Outcome bands:** `total = 2d6 + net` (net ∈ [−3,+3], so total ∈ [−1,15]) → `≥10 success_clean` · `7–9 success_costly` · `5–6 stalled` · `≤4 failure`. `stalled` = no objective/positional change this turn; casualties at most −1 band per side. `failure` = attacker gains nothing and is the side taking the heavier (bounded) loss.
- **Contests:** actions linked by `opposes` resolve on a **single** roll. The net is the attacker-frame clamped modifier sum (defender-favoring factors are negatives already present there; the defender's mirrored modifiers are not re-added). **The band is read from the initiator's perspective:** `success_*` = the initiator prevailed and the **opposer** takes the heavier magnitude; `failure` = the initiator was repulsed and **the initiator** takes the heavier magnitude; `stalled` = neither side gains, casualties light. The band drives both actors' `proposedOutcome` magnitudes, each bounded independently. Unpaired actions roll on their own.
- **Casualty magnitude:** v1 uses the AI's `proposedOutcome.casualties` (`deltaBand` = integer count of 25-pt bands), with code enforcing bounds and direction sanity against the band (a `success_clean` should not yield heavy own-casualties). Deterministic casualty tables are a later hardening (§11).
- **Engagement-end / hand-off:** evaluate from state thresholds — a side's committed units below ~50% / objective lost / no force ratio → that side breaks contact; set `phase` and flag hand-off. Code decides; the AI may narrate the break.

```typescript
type OutcomeBand = 'success_clean' | 'success_costly' | 'stalled' | 'failure';

type GameEvent =
  | { kind:'dice'; actor:string; roll:[number,number]; modifiers:{label:string;value:number}[]; net:number; band:OutcomeBand }
  | { kind:'expend'; side:string; actor:string; item:string; qty:number; reason?:string }
  | { kind:'strength'; unit:string; from:StrengthBand; to:StrengthBand; reason:string }
  | { kind:'morale'; unit:string; from:Morale; to:Morale }
  | { kind:'posture'; unit:string; from:string; to:string }
  | { kind:'reveal'; report:string; resolvesTo:string; confirmedBy:string }
  | { kind:'resupply'; side:string; item:string; from:number; to:number; source:string }
  | { kind:'destroyed'; unit:string }
  | { kind:'rejected'; actor:string; action:string; reason:string }
  | { kind:'clock'; from:string; to:string }
  | { kind:'phase'; from:Phase; to:Phase };
```

---

## 7. Interfaces (swappable)

### 7.1 Narrator (`/lib/engine/narrator.ts`)
```typescript
interface TurnPayload { state: GameState; rules: string; order: PlayerOrder; detail: 'light'|'standard'|'deep'; }
interface Narrator { run(payload: TurnPayload): Promise<MoveEnvelope>; }
```
- **v1: `ClipboardNarrator`** — renders the prompt for the player to copy, accepts a pasted JSON string, parses and shape-validates it into a `MoveEnvelope`. Model-agnostic, no key, no hosting.
- **Later (M4): `ApiNarrator`** — calls the model directly. The API key must NOT live in client code; route through a single **stateless relay** (a SvelteKit server route) that adds the key, calls the model, returns prose. It holds no game state. This relay is the *only* component that ever wants hosting, and it is optional.

### 7.2 SaveStore (`/lib/engine/store.ts`)
```typescript
interface SaveStore {
  save(snapshot: GameState, events: GameEvent[]): Promise<void>;
  load(id: string): Promise<{ snapshot: GameState; events: GameEvent[] }>;
  list(): Promise<{ id: string; name: string; turn: number; savedAt: string }[]>;
  export(id: string): Promise<string>;   // serialized save (download)
  import(blob: string): Promise<string>; // returns new id (upload)
}
```
- **v1: IndexedDB implementation.** Covers a single-device campaign fully.
- **Export/Import button ships in v1** — device-only with no backup is the one real data risk; the button retires it.
- **Later: SQLite** swap behind this same interface, only if querying or scale ever earns it. **Design the data model normalized so the swap is clean — but do not pull WASM SQLite into M1.**

---

## 8. Stakes-to-payload sizing (M2)

`sizeTurn(state, order) → { ruleModules: string[]; detail: 'light'|'standard'|'deep'; stateSlice: Partial<GameState> }`

The app sizes each turn from state, because the code already knows the stakes (units in contact, enemy strength, live unconfirmed reports).
- **light** — no contact, simple action (patrol/move): minimal rule modules, terse prose, cheap call.
- **standard** — limited contact.
- **deep** — multiple units in contact, or live `unconfirmedReports`, or high enemy strength: load the full relevant rule modules, ask for richer reasoning and prose.

**Modular rulebook, conditionally loaded.** Write all the rules — ambush, minefield, indirect fire, breaching, fog-of-war reveals, break-contact — as **separate modules**, and include only the sections this turn can trigger. The library grows without limit; no single turn carries all of it. Richness lives in the library, minimalism in each call.

Two stops on the dial:
- **Floor:** don't over-feed a quiet turn. Heavy apparatus on a simple patrol invites manufactured drama and costs tokens for nothing. The mine should sometimes just be a mine.
- **Ceiling:** more context helps only while it's *relevant* context. Feed the units, rules, and reports actually in play — not the whole campaign log. Past relevance, padding dilutes focus.

This is not the chat's unbounded accumulation; it is bounded, per-turn, situation-sized spend in a medium that forgets by design. That is precisely what lets the heavy turns be heavy.

---

## 9. UI

**Organizing principle: the screen is the state, live, and you act on it by touching it.**

- **Two registers, clearly separated.** An authoritative **State Panel** (units with strength bars/bands, posture, flags for suppressed/low-on-key-consumable, consumables remaining as derived values, clock, phase) and a **Narrative Panel** (the prose). Numbers you trust; story you enjoy. The state panel is rendered from folded state, so it cannot drift from truth — it *is* truth rendered.
- **Reactive, no reload** (Svelte 5 runes: `$state`, `$derived`). `remaining` is `$derived` from `loadout − Σexpended`.
- **Order entry** — v1 per §5.5 (prose + AI parse + confirm recommended). M3 adds tap-to-order: tap a unit → see only actions its manifest permits (an off-manifest action is literally unofferable) → expend steppers that won't let you exceed remaining. *Offering* actions (enumerate) is the hard part and is deferred; *checking* a proposed action (compare to manifest) is easy and ships in v1.
- **Resolution shows its work, briefly.** On resolve, surface the dice, the itemized modifiers, and the band for a beat before/with the prose ("assault — rolled 7, +2 support −1 cover = success at a cost"). Protect this; it's why the sim reads as a real fight.
- **Fog-of-war reveal beat.** A small "contact!" moment when an `unconfirmedReports` item resolves. These surprises are the best thing in the design and deserve staging, not burial in a paragraph.
- **Autosave invisible.** Every resolved turn writes via `SaveStore`. No "generate JSON," no chat migration, no bloat — the thing that started this whole project simply stops being something the player thinks about.
- **Undo last turn** (M3) — event-sourced, so undo drops the last turn's events and restores the prior snapshot. Removes all fear of fat-fingering on a phone.
- **Campaign log** (M2) — the event history as readable scrollback; an after-action report, nearly free since events are already stored.
- **Manual override / free action** — a typed one-off that still routes through the dice and the rules, so the tap UI never feels like a cage.

**The one real tension:** tap-to-order keeps the phone clean, but deep action trees get fiddly on a small screen. Favor a **shallow, common-case action list with the override valve** for the rest, rather than exposing every possibility through taps. Spend interaction-design effort here, not on infrastructure you don't need.

---

## 10. Milestones

### Milestone 1 — Vertical slice (the spine). **Build this first.**
One engagement, end to end: **seed state → issue order → ClipboardNarrator round-trip → validate → resolve → fold → reactive render → autosave.**
- Engine as pure TS (`state`, `validate`, `resolve`, `dice`, `narrator`, `store`), fully unit-testable with the narrator mocked.
- `ClipboardNarrator` + `IndexedDB` `SaveStore` + export/import.
- Strength banded; consumables append-only with derived remaining; dead → graveyard.
- Single inline ruleset (no module loading yet); no sizing yet; prose order + confirm step.
- Two sides, BLUE (player) vs a simple RED (AI-authored move in the same envelope).

**M1 acceptance criteria:**
1. Seed a campaign from a starter state and see it render in the State Panel.
2. Issue a prose order; complete a full ClipboardNarrator round-trip into a parsed `MoveEnvelope`.
3. An off-manifest capability (e.g. `cas`) is **rejected and surfaced**; state unchanged. *(demonstrate with a test)*
4. Real dice roll; outcome band applied; modifiers pre-committed and clamped to ±3. *(test)*
5. Consumables subtract exactly per the order; **a consumable not in any expend entry cannot change**; remaining is derived. *(test the frag/smoke/mortar case from §5.4)*
6. A unit reduced to 0 is destroyed and moved to graveyard; it cannot act next turn. *(test)*
7. State updates reactively with no reload; narrative + dice shown.
8. Autosave persists across reload; export then import reproduces the campaign.

### Milestone 2 — Depth
Modular rulebook + conditional loading + `sizeTurn` (§8). Fog-of-war reveals as a first-class beat. Campaign log view.

### Milestone 3 — Interaction
Tap-to-order with manifest-filtered action lists; expend steppers. Undo. Resolution "show your work" polish. PWA installable to home screen.

### Milestone 4 — Later / optional (each independent, each earns its way in)
`ApiNarrator` + stateless relay (zero-paste prose — the one hosting piece). SQLite behind `SaveStore` if querying/scale needs it. Capacitor/Android wrapper if the browser can't deliver something needed. Spatial-feasibility hardening (positions as coordinates, ranges as numbers) and/or deterministic casualty tables.

---

## 11. Deferrals — explicit, do not build in earlier milestones

- **Spatial/physical feasibility** (range, LOS, movement distance) — PROSE-OWNED in v1; harden in M4 via positional state. No spatial modeling in M1.
- **SQLite / any WASM database** — IndexedDB behind `SaveStore` for v1; SQLite is an M4 swap.
- **Direct API calls / any server / the relay** — ClipboardNarrator only until M4. No key handling in v1.
- **Android/Capacitor wrapper** — PWA only; defer.
- **Deterministic casualty tables** — AI proposes magnitude, code bounds, in v1.
- **Multi-device sync** — export/import covers it; no sync server.
- **More than two sides** — schema supports `sides[]`, but v1 targets BLUE/RED.
- **Tap-to-order UI** — M3; v1 uses prose + parse + confirm.

---

## 12. Open decisions — RESOLVED 2026-06-19

1. **The §5.4 worked example** — ✅ **REDLINED.** Fixed: DEF casualty now `deltaBand -3` (was −50, which contradicted the 100→25 result); `deltaBand` is now an integer count of 25-pt bands; contest pairing via `opposes` with one roll per contest (attacker-frame net, mirrored defender modifiers not re-added); `reveal` event aligned to `{report, resolvesTo, confirmedBy}`; band table covers `≤4`/`≥10` and defines `stalled`/`failure` semantics. This redlined version is now the contract of record.
2. **Strength** — ✅ **Banded `{0,25,50,75,100}`** confirmed.
3. **Order structuring** (§5.5) — ✅ **Prose + AI-parse + confirm** confirmed.
4. **Confirm-before-commit** — ✅ **Default ON**, player-disableable.
5. **Svelte 5 / runes pin, TypeScript, Tailwind, PWA** — ✅ **Accepted as the stack** (assumed defaults stand; Tailwind swappable for plain CSS).
6. Any field tagged `ASSUMPTION:` above — accepted as defaults unless overridden in a later phase.

**Scope decision:** the GSD roadmap covers **all four milestones** (M1 → M4), with M1 (the vertical slice / spine) built first per §10.
