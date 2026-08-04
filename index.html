import { z } from 'zod';

/* ── Primitives ───────────────────────────────────────────────────────── */

export const NATURES = ['fire', 'wind', 'lightning', 'earth', 'water', 'yin', 'yang'] as const;
export const ZNature = z.enum(NATURES);
export type Nature = z.infer<typeof ZNature>;

export const DISCIPLINES = ['taijutsu', 'genjutsu', 'ninjutsu'] as const;
export const ZDiscipline = z.enum(DISCIPLINES);
export type Discipline = z.infer<typeof ZDiscipline>;

export const STAT_KEYS = [
  'ninjutsu', 'taijutsu', 'genjutsu', 'intelligence',
  'strength', 'speed', 'stamina', 'handSeals',
] as const;
export const ZStatKey = z.enum(STAT_KEYS);
export type StatKey = (typeof STAT_KEYS)[number];

export const RANKS = ['academy', 'genin', 'chunin', 'jonin', 'anbu', 'kage'] as const;
export const ZRank = z.enum(RANKS);
export type Rank = z.infer<typeof ZRank>;

export const JUTSU_RANKS = ['E', 'D', 'C', 'B', 'A', 'S'] as const;
export const ZJutsuRank = z.enum(JUTSU_RANKS);
export type JutsuRank = z.infer<typeof ZJutsuRank>;

/**
 * Chakra is not mana (see docs/DESIGN-DIRECTION.txt). It is three separate
 * reserves:
 *   physical — body energy. Taijutsu spends it; regenerates quickly.
 *   mental   — spiritual energy. Genjutsu spends it; regenerates slowly.
 *   natural  — senjutsu. Does NOT regenerate; must be gathered, and only
 *              forbidden and sage-tier techniques require it.
 * Ninjutsu is physical and mental combined, which is what chakra is.
 */
export const ENERGY_POOLS = ['physical', 'mental', 'natural'] as const;
export const ZEnergyPool = z.enum(ENERGY_POOLS);
export type EnergyPool = (typeof ENERGY_POOLS)[number];
export type Energy = Record<EnergyPool, number>;

export const ZEnergy = z.object({
  physical: z.number().int().min(0).max(4000),
  mental: z.number().int().min(0).max(4000),
  natural: z.number().int().min(0).max(4000),
});

export const ZCost = z.object({
  physical: z.number().int().min(0).max(240),
  mental: z.number().int().min(0).max(240),
  natural: z.number().int().min(0).max(240),
});

export type Stats = Record<StatKey, number>;
export const ZStats = z.object({
  ninjutsu: z.number().int().min(1).max(500),
  taijutsu: z.number().int().min(1).max(500),
  genjutsu: z.number().int().min(1).max(500),
  intelligence: z.number().int().min(1).max(500),
  strength: z.number().int().min(1).max(500),
  speed: z.number().int().min(1).max(500),
  stamina: z.number().int().min(1).max(500),
  handSeals: z.number().int().min(1).max(500),
});

/* ── Status ids ───────────────────────────────────────────────────────── */

export const STATUS_IDS = [
  'burn', 'bleed', 'poison', 'stun', 'bind', 'blind', 'silence', 'slow', 'haste',
  'focus', 'regen', 'drench', 'conduct', 'snare', 'daze', 'exhaustion',
  'mark', 'guardbreak', 'chakraleak', 'illusionlock',
  // combo setup states
  'oiled',
  // injuries — long-lived, cleared by healing rather than by waiting out a fight
  'broken-arm', 'leg-injury', 'eye-injury',
] as const;
export const ZStatusId = z.enum(STATUS_IDS);
export type StatusId = (typeof STATUS_IDS)[number];

/* ── Effects: the small, generic set (CLAUDE.md §6) ───────────────────── */

export type Effect =
  | { kind: 'damage'; power: number; scaling: StatKey; leech?: number; pierce?: number; hits?: number; bonusVs?: { status: StatusId; mult: number } }
  | { kind: 'heal'; power: number; scaling: StatKey }
  | { kind: 'chakraDelta'; amount: number; pool: EnergyPool | 'all'; target: 'self' | 'opponent' }
  | { kind: 'applyStatus'; status: StatusId; duration: number; potency?: number; chance?: number; target: 'self' | 'opponent' }
  | { kind: 'cleanseStatus'; statuses?: StatusId[]; count?: number; target: 'self' | 'opponent' }
  | { kind: 'statModifier'; stat: StatKey; mult: number; duration: number; target: 'self' | 'opponent' }
  | { kind: 'shield'; power: number; scaling: StatKey; duration: number }
  | { kind: 'cloneSplit'; count: number; duration: number }
  | { kind: 'substitutionCharge'; amount: number }
  | { kind: 'gateOpen'; tiers: number }
  | { kind: 'dispel'; clones?: boolean; buffs?: boolean; shields?: boolean; target: 'self' | 'opponent' }
  | { kind: 'reflectStance'; fraction: number; duration: number }
  | { kind: 'interrupt' }
  | { kind: 'stance'; stance: 'substitute' | 'counter' | 'prepare' }
  | { kind: 'delayed'; delay: number; effects: Effect[] };

export const EFFECT_KINDS = [
  'damage', 'heal', 'chakraDelta', 'applyStatus', 'cleanseStatus', 'statModifier',
  'shield', 'cloneSplit', 'substitutionCharge', 'gateOpen', 'dispel',
  'reflectStance', 'interrupt', 'stance', 'delayed',
] as const;

const ZLeafEffect = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('damage'),
    power: z.number().min(0).max(400),
    scaling: ZStatKey,
    leech: z.number().min(0).max(1).optional(),
    pierce: z.number().min(0).max(1).optional(),
    hits: z.number().int().min(1).max(8).optional(),
    bonusVs: z.object({ status: ZStatusId, mult: z.number().min(1).max(3) }).optional(),
  }),
  z.object({ kind: z.literal('heal'), power: z.number().min(0).max(400), scaling: ZStatKey }),
  z.object({
    kind: z.literal('chakraDelta'),
    amount: z.number().int().min(-200).max(200),
    pool: z.union([ZEnergyPool, z.literal('all')]),
    target: z.enum(['self', 'opponent']),
  }),
  z.object({
    kind: z.literal('applyStatus'),
    status: ZStatusId,
    duration: z.number().int().min(1).max(20),
    potency: z.number().min(0).max(200).optional(),
    chance: z.number().min(0).max(1).optional(),
    target: z.enum(['self', 'opponent']),
  }),
  z.object({ kind: z.literal('cleanseStatus'), statuses: z.array(ZStatusId).optional(), count: z.number().int().min(1).max(20).optional(), target: z.enum(['self', 'opponent']) }),
  z.object({ kind: z.literal('statModifier'), stat: ZStatKey, mult: z.number().min(0.1).max(5), duration: z.number().int().min(1).max(20), target: z.enum(['self', 'opponent']) }),
  z.object({ kind: z.literal('shield'), power: z.number().min(0).max(500), scaling: ZStatKey, duration: z.number().int().min(1).max(20) }),
  z.object({ kind: z.literal('cloneSplit'), count: z.number().int().min(1).max(8), duration: z.number().int().min(1).max(20) }),
  z.object({ kind: z.literal('substitutionCharge'), amount: z.number().int().min(-3).max(3) }),
  z.object({ kind: z.literal('gateOpen'), tiers: z.number().int().min(1).max(8) }),
  z.object({ kind: z.literal('dispel'), clones: z.boolean().optional(), buffs: z.boolean().optional(), shields: z.boolean().optional(), target: z.enum(['self', 'opponent']) }),
  z.object({ kind: z.literal('reflectStance'), fraction: z.number().min(0).max(1), duration: z.number().int().min(1).max(6) }),
  z.object({ kind: z.literal('interrupt') }),
  z.object({ kind: z.literal('stance'), stance: z.enum(['substitute', 'counter', 'prepare']) }),
]);

/** `delayed` may nest leaf effects one level deep — no deeper, to keep resolution bounded. */
export const ZEffect = z.union([
  ZLeafEffect,
  z.object({ kind: z.literal('delayed'), delay: z.number().int().min(1).max(10), effects: z.array(ZLeafEffect).min(1).max(4) }),
]);

/* ── Jutsu ────────────────────────────────────────────────────────────── */

export const ZJutsu = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(2).max(48),
  discipline: ZDiscipline,
  nature: ZNature.nullable(),
  rank: ZJutsuRank,
  cost: ZCost,
  /** seal difficulty — drives weave length AND the accuracy roll on completion */
  seals: z.number().int().min(0).max(12),
  /** higher = harder to perform cleanly; 0 means the seals cannot fail */
  sealDifficulty: z.number().int().min(0).max(200),
  cooldown: z.number().int().min(0).max(20),
  interruptThreshold: z.number().int().min(1).max(400),
  requires: z.object({ stat: ZStatKey, min: z.number().int().min(0).max(200) }).optional(),
  effects: z.array(ZEffect).min(1).max(4),
  flavor: z.string().max(220).optional(),
});
export type Jutsu = z.infer<typeof ZJutsu>;

/* ── Match state ──────────────────────────────────────────────────────── */

export interface ActiveStatus { status: StatusId; remaining: number; potency: number }
export interface ActiveModifier { stat: StatKey; mult: number; remaining: number; source: string }
export interface ActiveShield { amount: number; remaining: number }
export interface WeaveState { jutsuId: string; remaining: number; total: number; chakraPaid: Energy; targetId: string; prepared: boolean }
export interface CloneState {
  id: string;
  chakra: Energy;
  remaining: number;
  /** clones weave in parallel with their originator (CLAUDE.md §7) */
  weave: WeaveState | null;
  cooldowns: Record<string, number>;
}
export interface PendingEffect {
  id: string;
  effects: Effect[];
  remaining: number;
  ownerId: string;
  targetId: string;
  /** carried from the jutsu that armed it, so multipliers stay correct when it fires */
  nature: Nature | null;
  discipline: Discipline;
}

export interface FighterState {
  id: string;
  name: string;
  level: number;
  stats: Stats;
  affinity: Nature;
  primaryDiscipline: Discipline;
  hp: number;
  maxHp: number;
  chakra: Energy;
  maxChakra: Energy;
  loadout: string[];
  /** bloodline in play, if any — drives passives and granted techniques */
  bloodlineId: string | null;
  /** techniques usable because of a bloodline, outside the loadout budget */
  granted: string[];
  /** extra seals resolved per turn, from a bloodline */
  sealBonus: number;
  cooldowns: Record<string, number>;
  statuses: ActiveStatus[];
  modifiers: ActiveModifier[];
  shields: ActiveShield[];
  clones: CloneState[];
  weave: WeaveState | null;
  pending: PendingEffect[];
  substitutions: number;
  gateTier: number;
  /** declared stance for the current round, set by a stance action */
  stance: 'none' | 'substitute' | 'counter' | 'prepare';
  /** rounds of immunity to hard control, granted after a hard control ends */
  controlImmunity: number;
  reflect: { fraction: number; remaining: number } | null;
  /** per-match skill-gain ledger; the server persists this when the match ends */
  skillLedger: Partial<Record<StatKey, number>>;
  defeated: boolean;
}

export interface MatchState {
  matchId: string;
  seed: string;
  round: number;
  timeMs: number;
  phase: 'awaitingActions' | 'complete';
  suddenDeath: boolean;
  fighters: [FighterState, FighterState];
  winnerId: string | null;
  outcome: 'pending' | 'ko' | 'timeout' | 'draw' | 'forfeit';
}

export const ZSubmittedAction = z.object({
  /** the body this action drives — a fighter id, or one of that fighter's clone ids */
  fighterId: z.string().min(1).max(64),
  actionId: z.string().regex(/^[a-z0-9-]+$/).max(64),
  targetId: z.string().min(1).max(64),
  /**
   * The authenticated fighter who sent this action. The server MUST stamp this
   * from the connection, never from the payload. When present the engine drops
   * any action addressed to a body the sender does not own, so a compromised or
   * buggy server layer cannot let one player drive the other's clone bodies.
   */
  submittedBy: z.string().min(1).max(64).optional(),
});
export type SubmittedAction = z.infer<typeof ZSubmittedAction>;

/* ── Events ───────────────────────────────────────────────────────────── */

export type MatchEvent =
  | { t: 'roundStart'; round: number; suddenDeath: boolean }
  | { t: 'order'; first: string; second: string; tiebreak: boolean }
  | { t: 'weaveStart'; fighterId: string; jutsuId: string; turns: number }
  | { t: 'weaveTick'; fighterId: string; jutsuId: string; remaining: number }
  | { t: 'weaveBroken'; fighterId: string; jutsuId: string; refund: number; cause: 'damage' | 'stun' | 'dispel' }
  | { t: 'cast'; fighterId: string; jutsuId: string; targetId: string }
  | { t: 'overdraw'; fighterId: string; pool: EnergyPool; amount: number; selfDamage: number }
  | { t: 'damage'; sourceId: string; targetId: string; amount: number; natureMult: number; disciplineMult: number; shielded: number; cloneId: string | null }
  | { t: 'heal'; fighterId: string; amount: number }
  | { t: 'chakra'; fighterId: string; pool: EnergyPool; delta: number }
  | { t: 'status'; fighterId: string; status: StatusId; applied: boolean; duration: number }
  | { t: 'statusExpired'; fighterId: string; status: StatusId }
  | { t: 'statusTick'; fighterId: string; status: StatusId; amount: number }
  | { t: 'cleanse'; fighterId: string; removed: StatusId[] }
  | { t: 'modifier'; fighterId: string; stat: StatKey; mult: number; duration: number }
  | { t: 'shield'; fighterId: string; amount: number }
  | { t: 'clonesSplit'; fighterId: string; count: number; chakraEach: Energy }
  | { t: 'cloneDestroyed'; fighterId: string; cloneId: string }
  | { t: 'cloneRecalled'; fighterId: string; cloneId: string; chakraReturned: Energy }
  | { t: 'substitution'; fighterId: string; success: boolean; remaining: number }
  | { t: 'gate'; fighterId: string; tier: number }
  | { t: 'gateDrain'; fighterId: string; amount: number }
  | { t: 'gateCollapse'; fighterId: string }
  | { t: 'dispel'; fighterId: string; clones: number; buffs: number; shields: number }
  | { t: 'reflect'; fighterId: string; amount: number }
  | { t: 'counter'; fighterId: string; blocked: number }
  | { t: 'delayedArmed'; fighterId: string; id: string; delay: number }
  | { t: 'delayedFired'; fighterId: string; id: string }
  | { t: 'skillGain'; fighterId: string; stat: StatKey; amount: number }
  | { t: 'blocked'; fighterId: string; reason: 'cooldown' | 'unknownJutsu' | 'notInLoadout' | 'silenced' | 'requirement' | 'defeated' | 'stunned' | 'noEnergy' }
  | { t: 'sealFailed'; fighterId: string; jutsuId: string; burned: Energy }
  | { t: 'combo'; fighterId: string; targetId: string; comboId: string; amount: number }
  | { t: 'stance'; fighterId: string; stance: FighterState['stance'] }
  | { t: 'injury'; fighterId: string; status: StatusId }
  | { t: 'suddenDeath'; round: number }
  | { t: 'defeated'; fighterId: string }
  | { t: 'matchEnd'; winnerId: string | null; outcome: MatchState['outcome'] };

export interface TurnResult { state: MatchState; events: MatchEvent[] }

/* ── Wire DTOs (server boundary, CLAUDE.md §5) ────────────────────────── */

export const ZClientMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('queue'), rank: ZRank }),
  z.object({ type: z.literal('submitAction'), matchId: z.string().max(64), action: ZSubmittedAction }),
  z.object({ type: z.literal('forfeit'), matchId: z.string().max(64) }),
  z.object({ type: z.literal('startTraining'), locationId: z.string().regex(/^[a-z0-9-]+$/).max(32), tier: z.number().int().min(1).max(5) }),
  z.object({ type: z.literal('claimTraining') }),
  z.object({ type: z.literal('setLoadout'), jutsuIds: z.array(z.string().regex(/^[a-z0-9-]+$/)).max(8) }),
  z.object({ type: z.literal('ping') }),
  z.object({ type: z.literal('getReplay'), matchId: z.string().max(64) }),
  z.object({ type: z.literal('listMissions') }),
  z.object({ type: z.literal('acceptMission'), missionId: z.string().regex(/^[a-z0-9-]+$/).max(48) }),
  z.object({ type: z.literal('completeMission') }),
  z.object({ type: z.literal('learnJutsu'), jutsuId: z.string().regex(/^[a-z0-9-]+$/).max(48) }),
  z.object({ type: z.literal('requestPromotion') }),
  z.object({ type: z.literal('createSquad') }),
  z.object({ type: z.literal('inviteToSquad'), name: z.string().min(1).max(64) }),
  z.object({ type: z.literal('acceptSquadInvite'), squadId: z.string().max(64) }),
  z.object({ type: z.literal('leaveSquad') }),
  z.object({ type: z.literal('acceptPartyMission'), missionId: z.string().regex(/^[a-z0-9-]+$/).max(48) }),
  z.object({ type: z.literal('completePartyMission') }),
  z.object({ type: z.literal('defect') }),
  z.object({ type: z.literal('seekAmnesty') }),
  z.object({ type: z.literal('listBounties') }),
  z.object({ type: z.literal('takeBountyContract'), targetId: z.string().max(64) }),
  z.object({ type: z.literal('foundClan'), name: z.string().min(1).max(64) }),
  z.object({ type: z.literal('inviteToClan'), name: z.string().min(1).max(64) }),
  z.object({ type: z.literal('acceptClanInvite'), clanId: z.string().max(64) }),
  z.object({ type: z.literal('leaveClan') }),
  z.object({ type: z.literal('kickFromClan'), playerId: z.string().max(64) }),
  z.object({ type: z.literal('setClanOfficer'), playerId: z.string().max(64), officer: z.boolean() }),
  z.object({ type: z.literal('handOverClan'), playerId: z.string().max(64) }),
  z.object({ type: z.literal('depositToClan'), amount: z.number().int().min(1).max(100_000_000) }),
  z.object({ type: z.literal('withdrawFromClan'), amount: z.number().int().min(1).max(100_000_000) }),
  z.object({ type: z.literal('listClans') }),
  z.object({ type: z.literal('listLegacy') }),
  z.object({ type: z.literal('setTitle'), titleId: z.string().regex(/^[a-z0-9-]+$/).max(48).nullable() }),
  z.object({ type: z.literal('claimLegendary'), itemId: z.string().regex(/^[a-z0-9-]+$/).max(48) }),
  z.object({ type: z.literal('legendaryHistory'), itemId: z.string().regex(/^[a-z0-9-]+$/).max(48) }),
]);

/** Everything the server may send back. */
export type ServerMessage =
  | { type: 'welcome'; playerId: string; weather: string }
  | { type: 'queued'; rank: Rank }
  | { type: 'matchFound'; matchId: string; opponentName: string; state: MatchState }
  | { type: 'roundResolved'; matchId: string; events: MatchEvent[]; state: MatchState }
  | { type: 'awaitingOpponent'; matchId: string; round: number }
  | { type: 'matchEnded'; matchId: string; winnerId: string | null; outcome: MatchState['outcome']; gains: Partial<Record<StatKey, number>>; rating: number }
  | { type: 'trainingStarted'; locationId: string; tier: number; endsAtMs: number }
  | { type: 'trainingClaimed'; gains: Partial<Record<StatKey, number>>; minutesCredited: number }
  | { type: 'loadoutSet'; jutsuIds: string[] }
  | { type: 'replay'; matchId: string; seed: string; actions: SubmittedAction[] }
  | { type: 'profile'; rank: Rank; level: number; xp: number; xpForNext: number; ryo: number; reputation: number; standing: string; known: string[]; loadout: string[]; missionsAtRank: number; clanId: string | null; clanContribution: number; titles: string[]; displayedTitle: string | null; rogue: boolean; notoriety: number; bounty: number; amnestyCost: number; promotion: { eligible: boolean; missing: string[]; note: string } }
  | { type: 'missionBoard'; missions: { id: string; name: string; rank: string; minutes: number; ryo: number; xp: number; reputation: number; brief: string; chance: number }[]; standing: string }
  | { type: 'missionAccepted'; missionId: string; endsAtMs: number }
  | { type: 'missionResolved'; missionId: string; success: boolean; ryo: number; xp: number; reputation: number; injured: boolean }
  | { type: 'jutsuLearned'; jutsuId: string; paid: number; ryo: number }
  | { type: 'promotion'; rank: Rank; note: string }
  | { type: 'promotionDenied'; missing: string[]; note: string }
  | { type: 'squad'; squadId: string; leaderId: string; members: { id: string; name: string; rank: Rank }[]; invited: string[]; mission: { missionId: string; endsAtMs: number } | null; partyMissions: { id: string; name: string; minutes: number; ryo: number; party: number; brief: string; chance: number }[] }
  | { type: 'squadInvite'; squadId: string; from: string }
  | { type: 'squadDisbanded' }
  | { type: 'partyMissionResolved'; missionId: string; success: boolean; ryo: number; xp: number; reputation: number }
  | { type: 'defected'; note: string }
  | { type: 'returned'; paid: number; note: string }
  | { type: 'bountyBoard'; bounties: { targetId: string; name: string; level: number; notoriety: number; value: number }[]; yourContract: { targetId: string; expiresAtMs: number; value: number } | null }
  | { type: 'contractTaken'; targetId: string; value: number; expiresAtMs: number }
  | { type: 'bountyClaimed'; targetName: string; paid: number }
  | { type: 'bountyLost'; hunterName: string; taken: number }
  | { type: 'clan'; clanId: string; name: string; leaderId: string; bank: number; members: { id: string; name: string; role: string; contribution: number }[]; invited: string[]; yourRole: string }
  | { type: 'clanInvite'; clanId: string; name: string; from: string }
  | { type: 'clanLeft' }
  | { type: 'clanRankings'; clans: { clanId: string; name: string; members: number; contribution: number; bank: number }[] }
  | { type: 'legacy'; titles: { id: string; name: string; blurb: string; earned: boolean }[]; displayed: string | null; claimable: { itemId: string; name: string; lore: string }[]; held: { itemId: string; name: string; holderName: string; yours: boolean }[] }
  | { type: 'titleSet'; titleId: string | null }
  | { type: 'titlesEarned'; titles: { id: string; name: string; blurb: string }[] }
  | { type: 'legendaryClaimed'; itemId: string; name: string; lore: string }
  | { type: 'legendaryChain'; itemId: string; chain: { holderName: string; heldFrom: number; heldUntil: number | null }[] }
  | { type: 'pong' }
  | { type: 'error'; code: string; detail?: string };
export type ClientMessage = z.infer<typeof ZClientMessage>;
