-- Shinobi Battler Online — Postgres schema.
--
-- Two rules drive the shape of this file:
--   * Training time is derived from started_at against the server clock. There is
--     deliberately no "elapsed" or "progress" column for a client to write to.
--   * Replays are (seed, actions) only. There is deliberately no state-snapshot
--     column — a snapshot would let a divergent replay look authoritative.

-- Credentials live apart from game state. `password` holds a self-describing
-- scrypt digest (never a plaintext or a bare hash), and `name_key` is the
-- normalised form, so two players cannot take confusable names.
CREATE TABLE accounts (
  id           TEXT PRIMARY KEY,
  name_key     TEXT NOT NULL UNIQUE,
  password     TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ
);

-- Only the SHA-256 of a session token is stored, so a database dump does not
-- hand over live sessions. There is deliberately no column for a role or a
-- player id the client could influence: the token is opaque and everything is
-- looked up from it.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_account_idx ON sessions (account_id);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

-- Player clans (guilds). Distinct from the lore clans in content, which are
-- bloodline families derived from bloodline_id rather than joined.
CREATE TABLE clans (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  name_key              TEXT NOT NULL UNIQUE,
  leader_id             TEXT NOT NULL,
  bank                  BIGINT NOT NULL DEFAULT 0 CHECK (bank >= 0),
  founded_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  withdrawn_today       BIGINT NOT NULL DEFAULT 0,
  withdraw_window_start TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE players (
  id              TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  name            TEXT NOT NULL UNIQUE,
  village_id      TEXT NOT NULL,
  clan_id         TEXT REFERENCES clans(id) ON DELETE SET NULL,
  clan_joined_at  TIMESTAMPTZ,
  clan_contribution BIGINT NOT NULL DEFAULT 0,
  bloodline_id    TEXT,                    -- rolled server-side at creation, ~20% of players
  rank            TEXT NOT NULL DEFAULT 'academy',
  level           INTEGER NOT NULL DEFAULT 1,
  xp              BIGINT  NOT NULL DEFAULT 0,
  stats           JSONB   NOT NULL,
  affinity        TEXT    NOT NULL,
  loadout         JSONB   NOT NULL DEFAULT '[]'::jsonb,
  known           JSONB   NOT NULL DEFAULT '[]'::jsonb,   -- techniques learned from teachers
  reputation      INTEGER NOT NULL DEFAULT 0,
  ryo             BIGINT  NOT NULL DEFAULT 0,
  rating          INTEGER NOT NULL DEFAULT 1000,
  missions_at_rank  INTEGER NOT NULL DEFAULT 0,           -- resets on promotion
  missions_completed INTEGER NOT NULL DEFAULT 0,
  rogue           BOOLEAN NOT NULL DEFAULT false,
  defected_at     TIMESTAMPTZ,
  notoriety       INTEGER NOT NULL DEFAULT 0,             -- earned, never granted
  titles          JSONB   NOT NULL DEFAULT '[]'::jsonb,    -- earned, never purchased
  displayed_title TEXT,
  pvp_wins        INTEGER NOT NULL DEFAULT 0,
  bounties_claimed INTEGER NOT NULL DEFAULT 0,
  s_rank_completed INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one live session per player, enforced by the primary key rather than
-- by application logic.
CREATE TABLE training_sessions (
  player_id   TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL,
  tier        SMALLINT NOT NULL CHECK (tier BETWEEN 1 AND 5),
  stat        TEXT NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One live mission per player, enforced by the primary key. As with training,
-- there is deliberately no progress or elapsed column: the outcome is derived
-- from started_at and a seed built from it.
CREATE TABLE mission_sessions (
  player_id   TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  mission_id  TEXT NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Squads are transient, but persisted: a party mission can outlive a restart and
-- a member must not be able to escape a failure by reconnecting.
-- One row per player, so the unique constraint is what guarantees nobody holds
-- membership in two clans.
CREATE TABLE clan_members (
  clan_id   TEXT NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL UNIQUE REFERENCES players(id) ON DELETE CASCADE,
  officer   BOOLEAN NOT NULL DEFAULT false,
  invited   BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (clan_id, player_id)
);

CREATE TABLE squads (
  id          TEXT PRIMARY KEY,
  leader_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  mission_id  TEXT,
  started_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per player per squad, and the unique constraint on player_id is what
-- guarantees nobody is in two squads at once.
CREATE TABLE squad_members (
  squad_id  TEXT NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL UNIQUE REFERENCES players(id) ON DELETE CASCADE,
  invited   BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (squad_id, player_id)
);

-- A bounty contract locks its value at the moment it is taken, so a rogue
-- cannot inflate the payout afterwards. Settled contracts are kept until the
-- same-pair cooldown expires, which is what stops a colluding pair looping.
CREATE TABLE bounty_contracts (
  id          TEXT PRIMARY KEY,
  hunter_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  target_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  value       INTEGER NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX bounty_hunter_idx ON bounty_contracts (hunter_id);
CREATE INDEX bounty_target_idx ON bounty_contracts (target_id);

CREATE TABLE replays (
  match_id    TEXT PRIMARY KEY,
  seed        TEXT NOT NULL,
  fighter_a   TEXT NOT NULL REFERENCES players(id),
  fighter_b   TEXT NOT NULL REFERENCES players(id),
  actions     JSONB NOT NULL,              -- SubmittedAction[], in resolution order
  winner_id   TEXT,
  outcome     TEXT NOT NULL,
  rounds      INTEGER NOT NULL,
  ended_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX replays_fighter_a_idx ON replays (fighter_a, ended_at DESC);
CREATE INDEX replays_fighter_b_idx ON replays (fighter_b, ended_at DESC);

CREATE TABLE ladder_history (
  id          BIGSERIAL PRIMARY KEY,
  player_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  match_id    TEXT NOT NULL REFERENCES replays(match_id) ON DELETE CASCADE,
  rating_before INTEGER NOT NULL,
  rating_after  INTEGER NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ladder_history_player_idx ON ladder_history (player_id, recorded_at DESC);

-- Legendary items are unique per ITEM, not one item per server: each named
-- artefact exists at most once and its history is permanent.
-- item_id is the primary key, so a legendary can exist at most once on the
-- server. Two players claiming simultaneously cannot both win: the second
-- insert is rejected by the database, not by application logic.
CREATE TABLE legendary_items (
  item_id     TEXT PRIMARY KEY,
  holder_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Append-only chain of custody. Nothing in the codebase deletes from this table;
-- "history recorded forever" is the whole point of a legendary.
CREATE TABLE legendary_history (
  id          BIGSERIAL PRIMARY KEY,
  item_id     TEXT NOT NULL,
  holder_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  held_from   TIMESTAMPTZ NOT NULL,
  held_until  TIMESTAMPTZ
);
CREATE INDEX legendary_history_item_idx ON legendary_history (item_id, held_from);
