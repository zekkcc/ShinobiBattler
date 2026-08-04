# Direction changes from docs/DESIGN-DIRECTION.txt (2026-08-02)

That document is now the governing design direction. Where it disagrees with an
earlier decision, it wins. This file records what changed and what it invalidated,
so nobody re-litigates a settled question or quietly drifts back.

| # | Design direction says | Previously built | Resolution |
|---|---|---|---|
| 1 | Chakra is "not mana" — Physical, Mental, and Natural energy pools | Single chakra pool | **REPLACED.** Three pools. Taijutsu spends Physical, genjutsu spends Mental, ninjutsu spends both, forbidden/sage techniques additionally require Natural — which does not regenerate and must be gathered. |
| 2 | Substitute is a move the player chooses | Passive: auto-consumed on any hit above a damage threshold | **REPLACED.** Substitution is a declared stance costing your action. Passive triggering removed. |
| 3 | Seals have Difficulty, Speed, and Accuracy; interrupted seals fail | Seals had difficulty and speed only; interrupts cancelled with a refund | **EXTENDED.** Added an accuracy roll on completion. A failed weave fizzles and burns half the cost. |
| 4 | Injuries: broken arm blocks hand seals, leg injury slows, eye injury reduces accuracy | No injury layer | **ADDED** as long-duration statuses, cleared by healing or time. |
| 5 | Combos: Oil→Fire→Explosion, Mist→Lightning→Electrocution, Water→Wind→Tsunami | Only `drench`/`conduct` nature modifiers | **ADDED** a data-driven combo table. Setup status + payoff nature fires a combo and consumes the status. |
| 6 | Bloodlines are random, ~20% of players, weighted by lore rarity | Bloodline freely assignable, all equal | **REPLACED.** Added rarity weights and a seeded roll. |
| 7 | Ranks include ANBU; Chunin/Jonin exams gate progression | academy→genin→chunin→jonin→kage | **EXTENDED** with `anbu`. |
| 8 | Eight core stats, and every action improves something | Eight stats already matched | **CONFIRMED** — no change. |
| 9 | Legendary weapons: one of each unique item per server, never duplicated | Not built | **PENDING.** Uniqueness is a server-side constraint; noted so it is not implemented as "one weapon per server". |
| 10 | Pets and cosmetics must never affect combat power | Not built | **PENDING**, recorded as a hard constraint. |
| 11 | No pay-to-win, ever | n/a | **PROJECT-WIDE CONSTRAINT.** Nothing purchasable may affect combat outcomes. Titles are earned, never bought. |

## Squads (built 2026-08-03)

S-rank missions carry `party: 3` and used to be refused outright with
`needsParty` — content that existed and could not be reached. Squads close that.

The rules exist to stop a squad becoming a way to dodge consequences:

- Nobody joins without accepting an invite; an invite alone puts you nowhere.
- A player is in at most one squad, enforced by a unique constraint on
  `squad_members.player_id` rather than by application logic.
- Every member must independently meet the rank and reputation bar, so a squad
  cannot smuggle a genin into an S-rank, and one outcast closes the desk for all.
- Once the mission starts the squad is **locked**: leaving, disbanding, inviting,
  and taking a second mission are all refused. A member who senses failure coming
  cannot walk away from the reputation hit.
- The outcome is seeded from `(squadId, missionId, startedAt)`, so any member can
  report back and they all get the same answer, and reporting twice cannot
  re-roll it or pay twice.
- Odds use the squad **average**, not the sum, so three passengers cannot ride one
  specialist through an S-rank. The purse is split, so a bigger squad trades pay
  for odds — a real decision rather than a strictly better one. Reputation is not
  split: everyone was there.

## Missing-nin and hunter-nin (built 2026-08-03)

Reputation previously only moved downward, through mission failure, and the
`wanted` tier closed the mission desk with nothing able to put you there and
nobody able to act on it. Both ends of that loop are now joined.

Defecting opens the black market — forbidden techniques above your rank, at
roughly double the price — and closes the village: no desk work, no promotion,
standing on the floor. Other players can then take a contract and come for you.

**The whole design rests on one inequality.** A bounty is worth exactly what the
rogue has accumulated in notoriety, which is only ever earned by what they
actually do; it is never minted. The hunter collects `hunterShare` (0.6) of what
the rogue loses, so two players colluding — defect, get caught deliberately, split
the payout — destroy 40% of the pot every cycle. A same-pair cooldown makes it
slow as well as lossy, and being caught resets notoriety to zero so the next loop
is worth less again.

That is deliberately not a detection problem. Nobody has to notice the collusion,
because it simply loses money. `pnpm drift` now asserts `hunterShare < 1`, since
that single number is what the property rests on.

Contract values are locked when taken, so a rogue cannot inflate a payout after
the fact, and a capture can never take more ryo than the rogue actually holds.

## Clans (built 2026-08-03)

Step 8 of the core loop — "join or create a clan (guild)". Distinct from the lore
clans in `clans.json`, which are bloodline families derived from `bloodlineId`
rather than joined. The `clanId` field previously carried the lore meaning but was
never assigned by any code path, so it now carries the player clan.

Founding costs money **and** standing (chunin, 60 reputation) — the money is the
smaller half of the bar, so a clan is not something a rich academy student buys.

The interesting problem is the treasury, because a shared pot is the most obviously
lootable thing in a game like this. It is guarded three ways rather than one:
officer rank, a one-day tenure gate so a stranger cannot join and empty it, and a
rolling daily cap.

**A bug worth recording.** The first cap implementation took a fraction of the
*current* balance, which meant every withdrawal raised the remaining allowance —
an officer could still drain the whole treasury in a day, just in slices. The cap
is now a fraction of the treasury as it stood at the start of the window,
reconstructed as `bank + withdrawnToday`. A test asserts the second withdrawal
fails.

Clans are ranked on what members have contributed, not on treasury size, so one
rich founder cannot outrank an active clan.

Leadership cannot be abandoned: a leader with members must hand over first, and a
sole leader leaving dissolves the clan rather than stranding it.

## Legacy: titles and legendaries (built 2026-08-03)

The `legendary_items` and `legendary_history` tables had been sitting in the
schema, unimplemented, since the persistence work. They now back the design
direction's central pillar — *players chase legacy, not gear*.

**Titles** are derived from thresholds and nothing else. There is no grant path,
no price field anywhere in the data, and `awardTitles` is idempotent. A player can
only display one they have earned.

**Legendaries** exist at most once on the server. Uniqueness is a PRIMARY KEY on
`item_id`, not the application check above it — there is a test that deliberately
bypasses the check and asserts the storage layer rejects the second claim, because
under concurrency the check is the part that fails. The chain of custody is
append-only; nothing in the codebase deletes from `legendary_history`.

**A design decision worth not reversing.** Legendaries grant no combat power.
That is deliberate, not an omission. A permanent stat bonus handed to whoever
reached a milestone first would make the ladder unwinnable for everyone who
arrived later, and would quietly invalidate every balance number. `pnpm drift`
asserts `grantsCombatPower === false` and that no legacy record carries a stat or
price field.

### A refactor forced along the way

`createPlayer` and `savePlayer` in the Postgres store were hand-written positional
parameter lists that had drifted, through several rounds of added fields, into
`$21` appearing before `$20`. Every new column was another chance to scramble them
silently. Both are now generated from one column map, which is what let the five
new columns land without incident.

## Deferred (meta-game, mostly server-side — not yet built)

Village politics and elections, clan/guild system, territory control, player-driven
economy and crafting, black market, rogue-nin and hunter-nin loops, Chunin/Jonin/ANBU
exams, rare wandering teachers, legendary scroll hunts, mentor system, seasons and
weather, hidden dungeons, housing, pets, cosmetics, titles, seasonal story arcs,
dynamic server history.

These are recorded here rather than in code so the scope is visible. None of them
may compromise §4 engine purity or §5 server authority.

## Balance: 8 of 10 in band (2026-08-03)

Up from 5. The middle eight now sit between 46.0% and 52.7% at 20k matches. Three
structural faults were found and fixed, each now asserted so it cannot return:

1. **The field was elementally asymmetric.** Affinity is defensive; jutsu nature
   is offensive. Balancing affinity *counts* is not enough — no archetype in the
   field cast earth jutsu, so water affinity was never countered and whoever held
   it won the "vs field" metric on structure rather than strength. `pnpm parity`
   now asserts every archetype counters as many opponents as counter it, and
   checks the cycle is still live rather than balanced by being switched off.
2. **The two defences had drifted apart.** The tuner had set Stamina to buy 0.95
   ward but only 0.65 guard. Because most of any realistic field attacks the ward,
   that made Stamina the single best stat in the game. They are now linked in the
   tuner and asserted equal in `pnpm drift`.
3. **Non-damage roles were not worth their slot.** A heal restored ~133 where a
   damage slot dealt ~185, so healing, gates and setup builds all lost by
   construction. Role ceilings were raised and the tuner found workable values;
   Medic went 39% to 50%.

### Still open

- **Bulwark, 76%.** Isolated to its build: swapping in another archetype's stats
  AND loadout together drops it to 51%, but swapping either one alone changes
  almost nothing. So it is the combination, not a single overtuned number, and
  that is where the next investigation should start.
- **Sage, 24%.** Its whole plan is gather natural energy, then land one forbidden
  technique. That plan still does not pay for the turns it costs.

Neither is a global dial. Do not reach for one — the last three global passes all
traded one archetype for another until the structural faults above were fixed.

## Superseded balance finding (2026-08-02)

Archetype fixtures were rebuilt around the new systems and are now parity-checked
(`pnpm parity`): equal stat totals, equal rank-point budgets, and a declared stat
discount for bloodline builds. That made the matrix readable for the first time.

It immediately showed a real problem the old fixtures were hiding: at an identical
budget, Artillery outputs ~98 damage per round against a field average near 30.
Rank-points are the wrong budget unit — a `damage` role and a `shield` role cost
the same but are not worth the same, so an all-offense loadout is worth roughly
three times a mixed one.

This is a content-pricing problem, not a dial problem. Nine global tuning passes
moved other archetypes around Artillery without closing the gap. The fix is
per-role budget weighting, not another multiplier. See
`.claude/agents/content-balance-smith.md`.

Structural fixes that DID land, and should not be reverted:

- Defensive stat investment now has real leverage (it previously moved mitigation
  by ~6 points between a 110-stamina tank and a 60-stamina glass cannon).
- `sealsPerTurn` is no longer floored, removing a step function where one point of
  Hand Seals could double throughput.
- Ninjutsu costs are weighted up to pay for drawing on two reserves.
- S-rank economics: a technique costing 8 of a 14-point budget now hits hard
  enough to be worth the gather turn and the weave.

## Persistence (built 2026-08-03)

`PostgresStore` alongside `MemoryStore`, both behind the same interface, with one
contract suite run against both. Writing the tests executed `schema.sql` for the
first time and caught that it had drifted from the record shape — it was missing
`known`, `missions_at_rank`, `missions_completed`, and the `mission_sessions`
table entirely, all added after the schema was written and never reconciled.

The schema now also carries assertions as tests: training has no elapsed/progress
column, replays have no state-snapshot column, one live training session and one
live mission per player are enforced by primary key rather than by application
logic, and a legendary item cannot be inserted twice.

## Accounts (built 2026-08-03)

The `dev-alice` / `dev-bob` token map is gone. Registration creates the account and
the shinobi together, which closes "Create a shinobi" — the first step of the core
loop, which until now had no endpoint at all.

Choices worth not undoing:

- scrypt with a per-user salt and cost parameters stored in the digest, so they
  can be raised later without invalidating existing passwords.
- Timing-safe comparison, and a decoy hash when the account does not exist —
  skipping the hash on an unknown name makes "no such player" measurably faster
  than "wrong password", which is a free user-enumeration oracle.
- Session tokens are opaque: 256 bits of randomness, SHA-256 at rest, carrying no
  player id, role, or expiry the client could edit.
- Registration and login are the only unauthenticated mutating endpoints, so they
  are rate limited per IP. Malformed requests deliberately still consume budget.

## Anti-drift checklist

Re-read `docs/DESIGN-DIRECTION.txt` at the end of any task that touches combat,
progression, or economy, and confirm:

1. Combat still reads as chess, not as a damage race — Move / Counter / Prepare /
   Substitute / Charge / Throw / Summon / Transform / Seal all remain live choices.
2. Chakra management is still a skill: three pools, asymmetric regeneration.
3. Progression is still identity and legacy, not gear. Reputation and rank gate
   content; purchases never do.
4. Nothing purchasable affects combat power.
5. Every action a player takes still improves some stat.
6. Bloodlines remain rare. If more than ~20% of rolled characters have one, that is
   a bug.
