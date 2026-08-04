# CLAUDE.md

Read this file in full before making any change. It defines the invariants of this
project. If a request in a session conflicts with something here, say so and stop
rather than silently breaking the invariant.

---

## 1. What this is

A turn-based, browser-based PvP game. Players create a shinobi, train eight stats,
build a jutsu loadout, and fight other players in server-authoritative 1v1 matches.
Rank progression (Academy → Genin → Chūnin → Jōnin → Kage) doubles as the ranked
ladder. Seasons culminate in a bracket tournament.

Genre inspiration is a ninja-fantasy setting with chakra, hand seals, elemental
natures, and clan bloodlines.

## 2. Source material — POLICY CHANGED 2026-08-02

This project uses the Naruto setting directly: canonical village, clan, technique,
and bloodline names live in `packages/content` as data.

The original rule here forbade all borrowed proper nouns. The project owner
overrode that on 2026-08-02 and asked for canonical naming throughout. The
`validate:content` IP scan that enforced the old rule has been removed and
replaced with referential-integrity checks over bloodlines, clans, and villages.

Practical note for whoever ships this: canonical naming carries trademark and
copyright exposure if the game is distributed commercially. That is a business
decision, not a code decision, and it has been made knowingly. Do not silently
re-scrub names to "fix" it.

- Proper nouns still live in `packages/content` and nowhere else. Do not hardcode
  a village, clan, or technique name in engine or server source.
- Adding a technique still means adding a JSON record, never an engine change.

## 3. Repo layout

```
packages/engine     Pure combat resolution. No I/O. The heart of the project.
packages/content    Jutsu, statuses, bloodlines, training drills — data + schemas.
packages/shared     Zod DTOs shared by server and web. No business logic.
apps/server         Fastify/Hono + WebSocket match rooms + Postgres + Redis.
apps/web            React + Vite + Zustand client.
tools/balance       Headless simulator: archetype vs archetype win-rate matrices.
tools/qa            Adversarial harness: invariant fuzzer + targeted exploit probes.
tools/lint          engine-purity lint rules (enforces §4).
```

pnpm workspaces. TypeScript strict everywhere. No `any` in `packages/*`.

## 4. Engine purity — the load-bearing invariant

`packages/engine` exposes essentially one function:

```ts
resolveTurn(state: MatchState, actions: SubmittedAction[], rng: Rng): TurnResult
// TurnResult = { state: MatchState; events: MatchEvent[] }
```

Rules, enforced by CI lint:

1. **No `Math.random`.** Randomness comes only from the injected seeded `Rng`.
2. **No `Date.now`, `new Date()`, timers, or `performance.now`.** Time is a field on
   `MatchState`, advanced by the caller.
3. **No `fetch`, no `fs`, no database, no logging side effects.**
4. **No mutation of inputs.** `resolveTurn` returns new state; it never edits `state`.
5. **No imports from `apps/*`.** Engine may import `content` and `shared` only.

Why: determinism gives us replays stored as `(seed, actions[])`, server/client
prediction from the same code, and a balance simulator that runs 50k matches in
seconds. Breaking purity breaks all three at once.

## 5. Trust model

The server is authoritative. The client submits **intent** (`{ actionId, targetId }`)
and nothing else.

- Never accept damage numbers, hit/miss results, RNG rolls, cooldown state, chakra
  totals, or elapsed training time from the client.
- Validate every WebSocket message against a Zod schema at the boundary before it
  reaches any handler.
- Training timers are computed from server-side `startedAt` timestamps in Postgres.
- Rate-limit every mutating endpoint. Assume every client is hostile.

## 6. Content is data, not code

New jutsu, statuses, bloodlines, and drills are **JSON records validated by Zod
schemas** in `packages/content`. Adding a technique must never require an engine
change.

If a technique cannot be expressed with the existing effect kinds, the correct move
is to propose a new *generic* effect kind (with tests), not to special-case a
technique inside the engine. Ask before adding an effect kind — the set is meant to
stay small.

## 7. Combat rules the engine must honor

**Nature cycle** (attacker beats defender at ×1.5; reversed ×0.66; otherwise ×1.0):

```
fire → wind → lightning → earth → water → fire
```

`yin` and `yang` sit off-cycle (always ×1.0 both ways). Yin scales illusions, yang
scales healing and body enhancement.

**Discipline triangle** (×1.2 / ×0.85, applied after the nature multiplier):

```
taijutsu → genjutsu → ninjutsu → taijutsu
```

**Turn order**: higher effective Speed acts first; ties broken by the seeded Rng.

**Weaving**: a jutsu with `seals > 0` occupies the caster for
`ceil(seals / sealsPerTurn(handSeals))` turns. The opponent can see a weave in
progress and its remaining turns. Damage above `interruptThreshold` or any `stun`
status cancels the weave and refunds half the chakra.

**Chakra**: spending more than the current pool is allowed and applies `exhaustion`
(self-damage scaling with the overdraw). This is intentional, not a bug.

**Substitution**: a limited-charge reactive dodge. Charges are a match resource, not
a cooldown. Success chance scales with Speed vs. the attacker's Speed.

**Clones**: splitting creates N bodies sharing the caster's *current* chakra evenly.
Each clone absorbs one qualifying hit. Clones may weave in parallel — each clone is
a body with its own weave slot and cooldown map, driven by an action whose
`fighterId` is the clone id. A clone with no submitted action holds; the engine
never invents intent. Chakra held by a clone that has NOT been killed returns to
the caster on recall or dispel. Chakra on a clone that was destroyed is lost.
Clone damage output is scaled by `tuning.clones.outgoingDamageMultiplier`.

**Gates**: an eight-tier self-buff ladder. Each tier multiplies Strength and Speed and
applies escalating HP drain per turn. Tier 8 is lethal to the user on match end.
Note when tuning: damage scales as `(1 + stat/100)`, so a x1.5 Strength gate is
about +25% damage at Strength 100, not +50%. Price the drain against the real
number, not the multiplier.

**Sudden death**: from round 60 all damage is multiplied by 1.25. A hard cap at
round 140 awards the win on HP percentage (draw if exact) — without it, two
sustain builds can stall indefinitely and deny each other a loss.

**Control**: after a status tagged `hard` expires, the victim is immune to hard
control for `tuning.control.hardImmunityTurns` rounds. Without diminishing
returns an illusion build can chain-lock an opponent out of the entire match.

**Bloodlines**: kekkei genkai and clan traits are records in
`packages/content/data/bloodlines.json`. They bake stat multipliers into the
fighter at construction (so dispel cannot strip them), may add substitution
charges and seal throughput, and grant techniques that sit outside the loadout
budget.

## 8. Trust model, part two: body ownership

An action carries the body it drives (`fighterId` — a fighter id OR one of that
fighter's clone ids) and `submittedBy`, the authenticated sender.

**The server MUST stamp `submittedBy` from the connection, never from the
payload.** Call `sanitizeActions(state, senderFighterId, actions)` at the
WebSocket boundary; `resolveTurn` enforces ownership a second time. Without this
one player can address an action to the other player's clone body and drive it.
Regression tests: "QA regressions > X9" in packages/engine/test.

## 9. Testing policy

- `packages/engine`: **tests first**, always. Write failing Vitest cases describing
  the rule, then implement. Coverage on the engine is expected to stay above 90%.
- Every bug fix in the engine starts with a regression test that reproduces it.
- `packages/content`: schema validation runs in CI. Invalid records fail the build.
- Balance changes are numeric diffs to content JSON, justified by simulator output —
  never ad-hoc "feels better" edits to engine code.

## 10. Commands

```
pnpm test            # all workspaces
pnpm test:engine     # fast inner loop
pnpm lint            # includes the engine-purity lint rules
pnpm validate:content
pnpm sim -- --matches 50000 --report matrix
pnpm qa                # adversarial fuzzer + exploit probes
pnpm dev
```

## 11. Definition of done for any change

1. Tests written and passing.
2. `pnpm lint` and `pnpm validate:content` clean.
3. No new engine dependency on I/O, time, or global randomness.
4. If combat numbers changed: simulator run attached, no archetype outside 43–57%
   win rate against the field.
5. `pnpm qa` reports zero HIGH-severity findings.
6. Any bug fix ships with the regression test that reproduces it first.

## 12. Things not to do

- Do not build UI while engine tests are red.
- Do not add a package, ORM, or state library without asking first.
- Do not "optimize" the engine with mutation or caching before the simulator shows a
  real bottleneck.
- Do not store replays as full state snapshots. `(seed, actions[])` only.
- Do not put balance constants in engine source. They belong in content data.
