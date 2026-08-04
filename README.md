# Shinobi Battler Online

Turn-based, server-authoritative PvP battler. The governing design direction is
`docs/DESIGN-DIRECTION.txt`; `docs/OVERRIDES.md` records what it changed and why.
`CLAUDE.md` holds the engineering invariants.

## Run it locally

```
pnpm install
pnpm dev              # game server on :3000 + web client on :5173
```

Then open **http://localhost:5173** and enrol — pick a name, a password, and a
village. Open a second window (or an incognito one), enrol a second shinobi, put
both in the queue, and you have a match against yourself.

Vite proxies `/api` and `/ws` to the game server, so the browser stays on one
origin and there is no CORS setup to do.

To run them separately: `pnpm dev:server` and `pnpm dev:web`.

## Checks

```
pnpm test            # 109 engine tests
pnpm test:server     # 243 tests: auth, trust model, progression, squads, clans,
                     #            rogue-nin, titles and legendaries, store contract
pnpm lint            # engine-purity rules (CLAUDE.md §4)
pnpm validate:content
pnpm parity          # archetype fixture fairness
pnpm sim -- --matches 20000
pnpm tune            # automated balance search
pnpm qa              # adversarial fuzzer + 20 exploit probes
pnpm drift           # design-direction conformance
```

## Layout

```
packages/shared     Zod DTOs and the shared type model. No business logic.
packages/engine     Pure combat resolution. resolveTurn(state, actions, rng).
packages/content    267 jutsu, 24 statuses, 21 bloodlines, 6 combos, 17 missions,
                    training locations, clans, villages, reputation tiers,
                    promotion gates, and every balance constant.
apps/server         Fastify + WebSocket. Accounts, matchmaking, match rooms,
                    training, missions, squads, reputation, teachers, rank exams,
                    clans, defection and bounties, titles and legendaries,
                    rating, replays.
apps/web            React + Vite + Zustand client. Renders server state and
                    submits intent; it calculates nothing itself.
tools/balance       Simulator, fixture parity check, automated tuner.
tools/qa            Invariant fuzzer, exploit probes, drift check.
tools/lint          Engine-purity rules enforced in CI.
.claude/agents      Sub-agents for review, tuning, and QA passes.
```

## Server

The transport is deliberately thin: it resolves a connection to an authenticated
player id and hands the raw payload to `GameService`, which makes every game
decision. There is exactly one place the trust model can be got wrong.

### Accounts

One account is one shinobi, which is what makes reputation and rank mean anything.
Passwords are scrypt-hashed with a per-user salt and a self-describing digest, so
the cost parameters can be raised later without invalidating anyone. Session tokens
are 256 bits of randomness and only their SHA-256 is stored, so a database dump does
not hand over live sessions. Login answers identically for a wrong name and a wrong
password, and does the hashing work either way, so it cannot be used to find out who
plays here.

`SEED_DEV_ACCOUNTS=1` creates two local accounts and prints their tokens. It is off
by default so it cannot fire in production.

### Storage

Two implementations behind one `Store` interface, and the same contract suite runs
against both — that is what makes them interchangeable rather than merely similar.

```
DATABASE_URL=postgres://…  MIGRATE_ON_BOOT=1  pnpm dev:server
```

Without `DATABASE_URL` the server runs in memory and everything resets on restart.
`PostgresStore` is written against a two-line driver interface, so production runs
it on `pg.Pool` and the tests run it on an in-process Postgres.

Note what `schema.sql` does NOT have: no elapsed or progress column on training
(time is always derived from `started_at` against the server clock) and no
state-snapshot column on replays (they are `(seed, actions[])` only). Those
absences are the guarantee, and there are tests asserting the columns stay absent.

## Not yet built

`apps/web`, and the meta-game listed at the bottom of `docs/OVERRIDES.md`.
