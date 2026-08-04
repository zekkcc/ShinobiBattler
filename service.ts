import { BASELINE_ACTIONS, JUTSU_BY_ID, MISSIONS, TRAINING } from '@shinobi/content';
import { ZClientMessage, type ClientMessage, type MatchEvent, type Rank, type ServerMessage } from '@shinobi/shared';
import { MatchRoom, ROUND_TIMEOUT_MS, specFor } from './matchroom.js';
import { RateLimiter, type Operation } from './ratelimit.js';
import { applyTraining, claimTraining, currentWeather, startTraining, TrainingError } from './training.js';
import type { PlayerRecord, Store } from './store/index.js';
import {
  acceptMission, applyMission, availableMissions, canTakeWork, checkPromotion,
  MissionError, priceFor, promote, reputationTier, resolveMission, successChance,
  xpForLevel, syncLevel as syncLevelFor,
} from './missions.js';
import {
  acceptInvite, acceptPartyMission, applyPartyOutcome, invite, leaveSquad,
  loadMembers, newSquad, partyMissionsFor, partySuccessChance, resolvePartyMission,
  SquadError,
} from './squads.js';
import type { SquadRecord } from './store/index.js';
import {
  addNotoriety, amnestyCost, blackMarketPrice, bountyOn, claimBounty, defect,
  isWorthHunting, RogueError, seekAmnesty, takeContract, type BountyContract,
} from './rogue.js';
import { LEGACY, ROGUE } from '@shinobi/content';
import {
  awardTitles, claimable, claimLegendary, LegacyError, setDisplayedTitle,
} from './legacy.js';
import {
  acceptClanInvite, ClanError, creditContribution, deposit, foundClan, handOverLeadership,
  inviteToClan, kickFromClan, leaveClan, rankClans, roleOf, setOfficer, withdraw,
} from './clans.js';
import type { ClanRecord } from './store/index.js';

/**
 * The server-authoritative game service.
 *
 * Everything that decides an outcome happens here. The transport (WebSocket) only
 * supplies two things: an authenticated player id, and an untrusted blob. The
 * blob is Zod-parsed before any handler sees it (CLAUDE.md §5).
 */

export interface Delivery { to: string; message: ServerMessage }

const LOADOUT_LIMIT = 8;
const RANK_ORDER = ['academy', 'genin', 'chunin', 'jonin', 'anbu', 'kage'] as const;

export class GameService {
  private rooms = new Map<string, MatchRoom>();
  private roomOf = new Map<string, string>();          // playerId -> matchId
  private queue = new Map<Rank, string[]>();
  private limiter = new RateLimiter();

  constructor(private readonly store: Store, private readonly now: () => number = Date.now) {}

  /**
   * Entry point for anything arriving over the wire.
   *
   * `playerId` is supplied by the transport from the authenticated session. It is
   * never read from `raw` — a client that puts a playerId in its payload is
   * simply ignored.
   */
  async handle(playerId: string, raw: unknown): Promise<Delivery[]> {
    const parsed = ZClientMessage.safeParse(raw);
    if (!parsed.success) {
      return [{ to: playerId, message: { type: 'error', code: 'badMessage', detail: parsed.error.issues[0]?.message } }];
    }
    const msg: ClientMessage = parsed.data;

    if (!this.limiter.take(playerId, msg.type as Operation, this.now())) {
      return [{ to: playerId, message: { type: 'error', code: 'rateLimited', detail: msg.type } }];
    }

    switch (msg.type) {
      case 'ping': return [{ to: playerId, message: { type: 'pong' } }];
      case 'queue': return this.onQueue(playerId, msg.rank);
      case 'submitAction': return this.onSubmit(playerId, msg.matchId, msg.action);
      case 'forfeit': return this.onForfeit(playerId, msg.matchId);
      case 'setLoadout': return this.onSetLoadout(playerId, msg.jutsuIds);
      case 'startTraining': return this.onStartTraining(playerId, msg.locationId, msg.tier);
      case 'claimTraining': return this.onClaimTraining(playerId);
      case 'getReplay': return this.onGetReplay(msg.matchId);
      case 'listMissions': return this.onListMissions(playerId);
      case 'acceptMission': return this.onAcceptMission(playerId, msg.missionId);
      case 'completeMission': return this.onCompleteMission(playerId);
      case 'learnJutsu': return this.onLearnJutsu(playerId, msg.jutsuId);
      case 'requestPromotion': return this.onRequestPromotion(playerId);
      case 'createSquad': return this.onCreateSquad(playerId);
      case 'inviteToSquad': return this.onInvite(playerId, msg.name);
      case 'acceptSquadInvite': return this.onAcceptInvite(playerId, msg.squadId);
      case 'leaveSquad': return this.onLeaveSquad(playerId);
      case 'acceptPartyMission': return this.onAcceptParty(playerId, msg.missionId);
      case 'completePartyMission': return this.onCompleteParty(playerId);
      case 'defect': return this.onDefect(playerId);
      case 'seekAmnesty': return this.onAmnesty(playerId);
      case 'listBounties': return this.onListBounties(playerId);
      case 'takeBountyContract': return this.onTakeContract(playerId, msg.targetId);
      case 'foundClan': return this.onFoundClan(playerId, msg.name);
      case 'inviteToClan': return this.onClanInvite(playerId, msg.name);
      case 'acceptClanInvite': return this.onAcceptClan(playerId, msg.clanId);
      case 'leaveClan': return this.onLeaveClan(playerId);
      case 'kickFromClan': return this.onKick(playerId, msg.playerId);
      case 'setClanOfficer': return this.onSetOfficer(playerId, msg.playerId, msg.officer);
      case 'handOverClan': return this.onHandOver(playerId, msg.playerId);
      case 'depositToClan': return this.onDeposit(playerId, msg.amount);
      case 'withdrawFromClan': return this.onWithdraw(playerId, msg.amount);
      case 'listClans': return this.onListClans(playerId);
      case 'listLegacy': return this.onListLegacy(playerId);
      case 'setTitle': return this.onSetTitle(playerId, msg.titleId);
      case 'claimLegendary': return this.onClaimLegendary(playerId, msg.itemId);
      case 'legendaryHistory': return this.onLegendaryHistory(playerId, msg.itemId);
      default: {
        const never: never = msg;
        return [{ to: playerId, message: { type: 'error', code: 'unhandled', detail: JSON.stringify(never) } }];
      }
    }
  }

  /** Everything a player is allowed to know about themselves. */
  profileFor(player: PlayerRecord): ServerMessage {
    const promotion = checkPromotion(player);
    return {
      type: 'profile',
      rank: player.rank,
      level: player.level,
      xp: player.xp,
      xpForNext: xpForLevel(player.level + 1),
      ryo: player.ryo,
      reputation: player.reputation,
      standing: reputationTier(player.reputation).id,
      known: player.known,
      loadout: player.loadout,
      missionsAtRank: player.missionsAtRank,
      clanId: player.clanId,
      clanContribution: player.clanContribution,
      titles: player.titles,
      displayedTitle: player.displayedTitle,
      rogue: player.rogue,
      notoriety: player.notoriety,
      bounty: bountyOn(player),
      amnestyCost: player.rogue ? amnestyCost(player) : 0,
      promotion: { eligible: promotion.eligible, missing: promotion.missing, note: promotion.note },
    };
  }

  /** Called by the transport once a connection is authenticated. */
  async hello(playerId: string): Promise<Delivery[]> {
    const player = await this.store.getPlayer(playerId);
    if (!player) return [];
    return [{ to: playerId, message: this.profileFor(player) }];
  }

  /* ── Matchmaking ───────────────────────────────────────────────────── */

  private async onQueue(playerId: string, rank: Rank): Promise<Delivery[]> {
    if (this.roomOf.has(playerId)) {
      return [{ to: playerId, message: { type: 'error', code: 'alreadyInMatch' } }];
    }
    const player = await this.store.getPlayer(playerId);
    if (!player) return [{ to: playerId, message: { type: 'error', code: 'noSuchPlayer' } }];

    // A client asking to queue at a rank it has not earned is ignored; the
    // server uses the stored rank, not the requested one.
    const bucket = this.queue.get(player.rank) ?? [];
    const opponentId = bucket.find((id) => id !== playerId);

    if (!opponentId) {
      if (!bucket.includes(playerId)) bucket.push(playerId);
      this.queue.set(player.rank, bucket);
      return [{ to: playerId, message: { type: 'queued', rank: player.rank } }];
    }

    this.queue.set(player.rank, bucket.filter((id) => id !== opponentId && id !== playerId));
    const opponent = await this.store.getPlayer(opponentId);
    if (!opponent) return this.onQueue(playerId, rank);

    return this.startMatch(player, opponent);
  }

  private startMatch(a: PlayerRecord, b: PlayerRecord): Delivery[] {
    const matchId = `m-${a.id}-${b.id}-${this.now()}`;
    const seed = `${matchId}:${a.rating}:${b.rating}`;
    const room = new MatchRoom(matchId, seed, specFor(a), specFor(b));
    this.rooms.set(matchId, room);
    this.roomOf.set(a.id, matchId);
    this.roomOf.set(b.id, matchId);

    return [
      { to: a.id, message: { type: 'matchFound', matchId, opponentName: b.name, state: room.viewFor(a.id) } },
      { to: b.id, message: { type: 'matchFound', matchId, opponentName: a.name, state: room.viewFor(b.id) } },
    ];
  }

  /* ── Combat ────────────────────────────────────────────────────────── */

  private async onSubmit(playerId: string, matchId: string, action: { fighterId: string; actionId: string; targetId: string }): Promise<Delivery[]> {
    const room = this.rooms.get(matchId);
    if (!room || this.roomOf.get(playerId) !== matchId) {
      return [{ to: playerId, message: { type: 'error', code: 'notInThisMatch' } }];
    }
    if (room.isComplete) return [{ to: playerId, message: { type: 'error', code: 'matchOver' } }];

    /* The submitter is the authenticated connection, full stop. Whatever
       `submittedBy` the client put in the payload is discarded here. */
    const stamped = { ...action, submittedBy: playerId };
    const { accepted } = room.submit(playerId, [stamped]);
    if (accepted === 0) {
      return [{ to: playerId, message: { type: 'error', code: 'rejectedAction', detail: 'not a body you control' } }];
    }

    if (!room.readyToResolve) {
      return [{ to: playerId, message: { type: 'awaitingOpponent', matchId, round: room.round } }];
    }
    return this.resolveRoom(room);
  }

  private async resolveRoom(room: MatchRoom): Promise<Delivery[]> {
    const events: MatchEvent[] = room.resolve(this.now());
    const out: Delivery[] = room.fighterIds.map((id) => ({
      to: id,
      message: { type: 'roundResolved', matchId: room.matchId, events, state: room.viewFor(id) } as ServerMessage,
    }));

    if (room.isComplete) out.push(...(await this.endMatch(room)));
    return out;
  }

  private async endMatch(room: MatchRoom): Promise<Delivery[]> {
    const outcome = room.outcome;
    await room.settle(this.store, this.now());

    /* A missing-nin who wins becomes more notorious, and therefore worth more.
       Notoriety is only ever earned by what a rogue actually does. */
    const extra: Delivery[] = [];
    if (room.winnerId) {
      const winner = await this.store.getPlayer(room.winnerId);
      if (winner) {
        if (winner.rogue) addNotoriety(winner, ROGUE.notoriety.perPvpWin);
        creditContribution(winner, 'pvpWin');
        winner.pvpWins += 1;
        extra.push(...(await this.syncTitles(winner)));
        await this.store.savePlayer(winner);
      }
      const loserId = room.fighterIds.find((id) => id !== room.winnerId);
      if (loserId) extra.push(...(await this.settleBounty(room.winnerId, loserId)));
    }
    for (const id of room.fighterIds) this.roomOf.delete(id);
    this.rooms.delete(room.matchId);

    const out: Delivery[] = [];
    for (const id of room.fighterIds) {
      const player = await this.store.getPlayer(id);
      out.push({
        to: id,
        message: {
          type: 'matchEnded',
          matchId: room.matchId,
          winnerId: room.winnerId,
          outcome,
          gains: {},
          rating: player?.rating ?? 0,
        },
      });
    }
    return [...out, ...extra];
  }

  private async onForfeit(playerId: string, matchId: string): Promise<Delivery[]> {
    const room = this.rooms.get(matchId);
    if (!room || this.roomOf.get(playerId) !== matchId) {
      return [{ to: playerId, message: { type: 'error', code: 'notInThisMatch' } }];
    }
    room.forfeit(playerId);
    room.timeOutMissing();
    return this.resolveRoom(room);
  }

  /** Called on a timer by the transport: a silent client loses the round, not the match. */
  async tickTimeouts(): Promise<Delivery[]> {
    const out: Delivery[] = [];
    for (const room of [...this.rooms.values()]) {
      if (room.isComplete) continue;
      if (!room.readyToResolve) {
        room.timeOutMissing();
        out.push(...(await this.resolveRoom(room)));
      }
    }
    return out;
  }

  /* ── Loadout ───────────────────────────────────────────────────────── */

  private async onSetLoadout(playerId: string, jutsuIds: string[]): Promise<Delivery[]> {
    const player = await this.store.getPlayer(playerId);
    if (!player) return [{ to: playerId, message: { type: 'error', code: 'noSuchPlayer' } }];
    if (this.roomOf.has(playerId)) {
      return [{ to: playerId, message: { type: 'error', code: 'cannotChangeLoadoutMidMatch' } }];
    }

    const unique = [...new Set(jutsuIds)].slice(0, LOADOUT_LIMIT);
    for (const id of unique) {
      const jutsu = JUTSU_BY_ID.get(id);
      if (!jutsu) return [{ to: playerId, message: { type: 'error', code: 'unknownJutsu', detail: id } }];
      // Stat requirements are checked here as well as in the engine, so an
      // illegal loadout can never be persisted in the first place.
      if (jutsu.requires && player.stats[jutsu.requires.stat] < jutsu.requires.min) {
        return [{ to: playerId, message: { type: 'error', code: 'requirementNotMet', detail: id } }];
      }
      // You can only carry what you have learned. Baselines are always yours.
      const free = (BASELINE_ACTIONS as readonly string[]).includes(id);
      if (!free && !player.known.includes(id)) {
        return [{ to: playerId, message: { type: 'error', code: 'notLearned', detail: id } }];
      }
    }

    player.loadout = unique;
    await this.store.savePlayer(player);
    return [
      { to: playerId, message: { type: 'loadoutSet', jutsuIds: unique } },
      { to: playerId, message: this.profileFor(player) },
    ];
  }

  /* ── Training ──────────────────────────────────────────────────────── */

  private async onStartTraining(playerId: string, locationId: string, tier: number): Promise<Delivery[]> {
    const player = await this.store.getPlayer(playerId);
    if (!player) return [{ to: playerId, message: { type: 'error', code: 'noSuchPlayer' } }];
    try {
      const session = startTraining(player, locationId, tier, this.now());
      player.training = session;
      await this.store.savePlayer(player);
      const minutes = TRAINING.tiers.find((t) => t.tier === tier)!.minutes;
      return [{ to: playerId, message: { type: 'trainingStarted', locationId, tier, endsAtMs: session.startedAt + minutes * 60_000 } }];
    } catch (err) {
      const code = err instanceof TrainingError ? err.code : 'trainingFailed';
      return [{ to: playerId, message: { type: 'error', code } }];
    }
  }

  private async onClaimTraining(playerId: string): Promise<Delivery[]> {
    const player = await this.store.getPlayer(playerId);
    if (!player) return [{ to: playerId, message: { type: 'error', code: 'noSuchPlayer' } }];
    try {
      const result = claimTraining(player, this.now(), currentWeather(this.now()));
      applyTraining(player, result);
      await this.store.savePlayer(player);
      return [
        { to: playerId, message: { type: 'trainingClaimed', gains: result.gains, minutesCredited: result.minutesCredited } },
        { to: playerId, message: this.profileFor(player) },
      ];
    } catch (err) {
      const code = err instanceof TrainingError ? err.code : 'trainingFailed';
      return [{ to: playerId, message: { type: 'error', code } }];
    }
  }

  /* ── Missions ──────────────────────────────────────────────────────── */

  private async onListMissions(playerId: string): Promise<Delivery[]> {
    const player = await this.store.getPlayer(playerId);
    if (!player) return [{ to: playerId, message: { type: 'error', code: 'noSuchPlayer' } }];
    const tier = reputationTier(player.reputation);
    return [{
      to: playerId,
      message: {
        type: 'missionBoard',
        standing: canTakeWork(player) ? tier.note : tier.note,
        missions: availableMissions(player).map((m) => ({
          id: m.id, name: m.name, rank: m.rank, minutes: m.minutes,
          ryo: m.ryo, xp: m.xp, reputation: m.reputation, brief: m.brief,
          chance: Math.round(successChance(player, m) * 100),
        })),
      },
    }];
  }

  private async onAcceptMission(playerId: string, missionId: string): Promise<Delivery[]> {
    const player = await this.store.getPlayer(playerId);
    if (!player) return [{ to: playerId, message: { type: 'error', code: 'noSuchPlayer' } }];
    try {
      const session = acceptMission(player, missionId, this.now());
      player.mission = session;
      await this.store.savePlayer(player);
      const minutes = MISSIONS.missions.find((m) => m.id === missionId)!.minutes;
      return [{ to: playerId, message: { type: 'missionAccepted', missionId, endsAtMs: session.startedAt + minutes * 60_000 } }];
    } catch (err) {
      return [{ to: playerId, message: { type: 'error', code: err instanceof MissionError ? err.code : 'missionFailed' } }];
    }
  }

  private async onCompleteMission(playerId: string): Promise<Delivery[]> {
    const player = await this.store.getPlayer(playerId);
    if (!player) return [{ to: playerId, message: { type: 'error', code: 'noSuchPlayer' } }];
    try {
      const outcome = resolveMission(player, this.now());
      applyMission(player, outcome);
      if (outcome.success) creditContribution(player, 'mission');
      await this.store.savePlayer(player);
      const earned = await this.syncTitles(player);
      await this.store.savePlayer(player);
      return [
        {
          to: playerId,
          message: {
            type: 'missionResolved', missionId: outcome.mission.id, success: outcome.success,
            ryo: outcome.ryo, xp: outcome.xp, reputation: outcome.reputation, injured: outcome.injured,
          },
        },
        ...earned,
        { to: playerId, message: this.profileFor(player) },
      ];
    } catch (err) {
      return [{ to: playerId, message: { type: 'error', code: err instanceof MissionError ? err.code : 'missionFailed' } }];
    }
  }

  /* ── Squads ────────────────────────────────────────────────────────── */

  private squadFail(playerId: string, err: unknown): Delivery[] {
    return [{ to: playerId, message: { type: 'error', code: err instanceof SquadError ? err.code : 'squadFailed' } }];
  }

  /** The squad view every member sees, including what work it now qualifies for. */
  private async squadView(squad: SquadRecord): Promise<ServerMessage> {
    const members = await loadMembers(this.store, squad);
    const mission = squad.mission ? MISSIONS.missions.find((m) => m.id === squad.mission!.missionId) : undefined;
    return {
      type: 'squad',
      squadId: squad.id,
      leaderId: squad.leaderId,
      members: members.map((m) => ({ id: m.id, name: m.name, rank: m.rank })),
      invited: squad.invitedIds,
      mission: squad.mission && mission
        ? { missionId: squad.mission.missionId, endsAtMs: squad.mission.startedAt + mission.minutes * 60_000 }
        : null,
      partyMissions: (members[0] ? partyMissionsFor(members[0]) : []).map((m) => ({
        id: m.id, name: m.name, minutes: m.minutes, ryo: m.ryo, party: m.party, brief: m.brief,
        chance: Math.round(partySuccessChance(members, m) * 100),
      })),
    };
  }

  private async broadcastSquad(squad: SquadRecord): Promise<Delivery[]> {
    const view = await this.squadView(squad);
    return squad.memberIds.map((id) => ({ to: id, message: view }));
  }

  private async onCreateSquad(playerId: string): Promise<Delivery[]> {
    const player = await this.store.getPlayer(playerId);
    if (!player) return [{ to: playerId, message: { type: 'error', code: 'noSuchPlayer' } }];
    try {
      const squad = newSquad(player);
      await this.store.createSquad(squad);
      player.squadId = squad.id;
      await this.store.savePlayer(player);
      return this.broadcastSquad(squad);
    } catch (err) { return this.squadFail(playerId, err); }
  }

  private async onInvite(playerId: string, name: string): Promise<Delivery[]> {
    const leader = await this.store.getPlayer(playerId);
    if (!leader?.squadId) return [{ to: playerId, message: { type: 'error', code: 'notInSquad' } }];
    const squad = await this.store.getSquad(leader.squadId);
    if (!squad) return [{ to: playerId, message: { type: 'error', code: 'noSuchSquad' } }];

    const target = await this.store.getPlayerByName(name);
    if (!target || target.id === leader.id) {
      return [{ to: playerId, message: { type: 'error', code: 'noSuchPlayer' } }];
    }
    try {
      invite(squad, leader, target);
      await this.store.saveSquad(squad);
      return [
        ...(await this.broadcastSquad(squad)),
        { to: target.id, message: { type: 'squadInvite', squadId: squad.id, from: leader.name } },
      ];
    } catch (err) { return this.squadFail(playerId, err); }
  }

  private async onAcceptInvite(playerId: string, squadId: string): Promise<Delivery[]> {
    const player = await this.store.getPlayer(playerId);
    if (!player) return [{ to: playerId, message: { type: 'error', code: 'noSuchPlayer' } }];
    const squad = await this.store.getSquad(squadId);
    if (!squad) return [{ to: playerId, message: { type: 'error', code: 'noSuchSquad' } }];
    try {
      acceptInvite(squad, player);
      await this.store.saveSquad(squad);
      player.squadId = squad.id;
      await this.store.savePlayer(player);
      return this.broadcastSquad(squad);
    } catch (err) { return this.squadFail(playerId, err); }
  }

  private async onLeaveSquad(playerId: string): Promise<Delivery[]> {
    const player = await this.store.getPlayer(playerId);
    if (!player?.squadId) return [{ to: playerId, message: { type: 'error', code: 'notInSquad' } }];
    const squad = await this.store.getSquad(player.squadId);
    if (!squad) return [{ to: playerId, message: { type: 'error', code: 'noSuchSquad' } }];
    try {
      const before = [...squad.memberIds];
      const { disbanded } = leaveSquad(squad, player);
      player.squadId = null;
      await this.store.savePlayer(player);
      if (disbanded) {
        await this.store.deleteSquad(squad.id);
        return before.map((id) => ({ to: id, message: { type: 'squadDisbanded' } as ServerMessage }));
      }
      await this.store.saveSquad(squad);
      return [
        ...(await this.broadcastSquad(squad)),
        { to: playerId, message: { type: 'squadDisbanded' } },
      ];
    } catch (err) { return this.squadFail(playerId, err); }
  }

  private async onAcceptParty(playerId: string, missionId: string): Promise<Delivery[]> {
    const leader = await this.store.getPlayer(playerId);
    if (!leader?.squadId) return [{ to: playerId, message: { type: 'error', code: 'notInSquad' } }];
    const squad = await this.store.getSquad(leader.squadId);
    if (!squad) return [{ to: playerId, message: { type: 'error', code: 'noSuchSquad' } }];
    try {
      const members = await loadMembers(this.store, squad);
      acceptPartyMission(squad, leader, members, missionId, this.now());
      await this.store.saveSquad(squad);
      return this.broadcastSquad(squad);
    } catch (err) { return this.squadFail(playerId, err); }
  }

  private async onCompleteParty(playerId: string): Promise<Delivery[]> {
    const caller = await this.store.getPlayer(playerId);
    if (!caller?.squadId) return [{ to: playerId, message: { type: 'error', code: 'notInSquad' } }];
    const squad = await this.store.getSquad(caller.squadId);
    if (!squad?.mission) return [{ to: playerId, message: { type: 'error', code: 'notInSquad' } }];
    try {
      const members = await loadMembers(this.store, squad);
      const outcome = resolvePartyMission(squad, members, this.now());

      const out: Delivery[] = [];
      for (const member of members) {
        applyPartyOutcome(member, outcome);
        if (outcome.success && outcome.mission.rank === 'S') member.sRankCompleted += 1;
        syncLevelFor(member);
        out.push(...(await this.syncTitles(member)));
        member.squadId = null;
        await this.store.savePlayer(member);
        out.push({
          to: member.id,
          message: {
            type: 'partyMissionResolved', missionId: outcome.mission.id, success: outcome.success,
            ryo: outcome.ryo, xp: outcome.xp, reputation: outcome.reputation,
          },
        });
        out.push({ to: member.id, message: this.profileFor(member) });
      }
      // The squad exists for the mission; it is done, so the squad is done.
      await this.store.deleteSquad(squad.id);
      return out;
    } catch (err) { return this.squadFail(playerId, err); }
  }

  /* ── Missing-nin and hunter-nin ────────────────────────────────────── */

  private rogueFail(playerId: string, err: unknown): Delivery[] {
    return [{ to: playerId, message: { type: 'error', code: err instanceof RogueError ? err.code : 'rogueFailed' } }];
  }

  private async onDefect(playerId: string): Promise<Delivery[]> {
    const player = await this.store.getPlayer(playerId);
    if (!player) return [{ to: playerId, message: { type: 'error', code: 'noSuchPlayer' } }];
    if (this.roomOf.has(playerId)) return [{ to: playerId, message: { type: 'error', code: 'inMatch' } }];
    try {
      defect(player, this.now());
      await this.store.savePlayer(player);
      return [
        { to: playerId, message: { type: 'defected', note: ROGUE.defection.note } },
        { to: playerId, message: this.profileFor(player) },
      ];
    } catch (err) { return this.rogueFail(playerId, err); }
  }

  private async onAmnesty(playerId: string): Promise<Delivery[]> {
    const player = await this.store.getPlayer(playerId);
    if (!player) return [{ to: playerId, message: { type: 'error', code: 'noSuchPlayer' } }];
    try {
      const paid = seekAmnesty(player, this.now());
      await this.store.savePlayer(player);
      return [
        { to: playerId, message: { type: 'returned', paid, note: ROGUE.amnesty.note } },
        { to: playerId, message: this.profileFor(player) },
      ];
    } catch (err) { return this.rogueFail(playerId, err); }
  }

  private async onListBounties(playerId: string): Promise<Delivery[]> {
    const contracts = await this.store.listContracts(this.now());
    const mine = contracts.find((c) => c.hunterId === playerId && c.expiresAt > this.now());
    const rogues = await this.store.listRogues();
    return [{
      to: playerId,
      message: {
        type: 'bountyBoard',
        bounties: rogues
          .filter((r) => r.id !== playerId && isWorthHunting(r))
          .map((r) => ({ targetId: r.id, name: r.name, level: r.level, notoriety: r.notoriety, value: bountyOn(r) })),
        yourContract: mine ? { targetId: mine.targetId, expiresAtMs: mine.expiresAt, value: mine.value } : null,
      },
    }];
  }

  private async onTakeContract(playerId: string, targetId: string): Promise<Delivery[]> {
    const hunter = await this.store.getPlayer(playerId);
    const target = await this.store.getPlayer(targetId);
    if (!hunter || !target) return [{ to: playerId, message: { type: 'error', code: 'noSuchTarget' } }];
    try {
      const existing = await this.store.listContracts(this.now());
      const contract = takeContract(hunter, target, existing, this.now());
      await this.store.saveContract(contract);
      return [{
        to: playerId,
        message: { type: 'contractTaken', targetId, value: contract.value, expiresAtMs: contract.expiresAt },
      }];
    } catch (err) { return this.rogueFail(playerId, err); }
  }

  /** Settles any live contract the winner held on the loser. */
  private async settleBounty(winnerId: string, loserId: string): Promise<Delivery[]> {
    const contracts = await this.store.listContracts(this.now());
    const contract = contracts.find(
      (c: BountyContract) => c.hunterId === winnerId && c.targetId === loserId && c.expiresAt > this.now(),
    );
    if (!contract) return [];

    const hunter = await this.store.getPlayer(winnerId);
    const rogue = await this.store.getPlayer(loserId);
    if (!hunter || !rogue || !rogue.rogue) return [];

    const claim = claimBounty(contract, hunter, rogue, this.now());
    hunter.bountiesClaimed += 1;
    const earnedByHunter = await this.syncTitles(hunter);
    await this.store.savePlayer(hunter);
    await this.store.savePlayer(rogue);
    // The contract row stays until the same-pair cooldown lapses; only its
    // expiry is brought forward so it can no longer be claimed again.
    await this.store.saveContract({ ...contract, expiresAt: this.now() - 1 });

    return [
      { to: hunter.id, message: { type: 'bountyClaimed', targetName: rogue.name, paid: claim.paidToHunter } },
      ...earnedByHunter,
      { to: rogue.id, message: { type: 'bountyLost', hunterName: hunter.name, taken: claim.takenFromRogue } },
    ];
  }

  /* ── Legacy: titles and legendary items ────────────────────────────── */

  /**
   * Re-checks every title after anything that could have earned one. Titles are
   * only ever produced here, from thresholds — there is no grant path.
   */
  private async syncTitles(player: PlayerRecord): Promise<Delivery[]> {
    const fresh = awardTitles(player);
    if (fresh.length === 0) return [];
    return [{
      to: player.id,
      message: {
        type: 'titlesEarned',
        titles: fresh.map((id) => {
          const t = LEGACY.titles.find((x) => x.id === id)!;
          return { id: t.id, name: t.name, blurb: t.blurb };
        }),
      },
    }];
  }

  private async onListLegacy(playerId: string): Promise<Delivery[]> {
    const player = await this.store.getPlayer(playerId);
    if (!player) return [{ to: playerId, message: { type: 'error', code: 'noSuchPlayer' } }];
    const held = await this.store.listLegendaries();

    const holders = new Map<string, string>();
    for (const h of held) holders.set(h.holderId, (await this.store.getPlayer(h.holderId))?.name ?? 'unknown');

    return [{
      to: playerId,
      message: {
        type: 'legacy',
        titles: LEGACY.titles.map((t) => ({
          id: t.id, name: t.name, blurb: t.blurb, earned: player.titles.includes(t.id),
        })),
        displayed: player.displayedTitle,
        claimable: claimable(player, held),
        held: held.map((h) => ({
          itemId: h.itemId,
          name: LEGACY.legendaries.find((l) => l.id === h.itemId)?.name ?? h.itemId,
          holderName: holders.get(h.holderId) ?? 'unknown',
          yours: h.holderId === playerId,
        })),
      },
    }];
  }

  private async onSetTitle(playerId: string, titleId: string | null): Promise<Delivery[]> {
    const player = await this.store.getPlayer(playerId);
    if (!player) return [{ to: playerId, message: { type: 'error', code: 'noSuchPlayer' } }];
    try {
      setDisplayedTitle(player, titleId);
      await this.store.savePlayer(player);
      return [{ to: playerId, message: { type: 'titleSet', titleId } }];
    } catch (err) {
      return [{ to: playerId, message: { type: 'error', code: err instanceof LegacyError ? err.code : 'legacyFailed' } }];
    }
  }

  private async onClaimLegendary(playerId: string, itemId: string): Promise<Delivery[]> {
    const player = await this.store.getPlayer(playerId);
    if (!player) return [{ to: playerId, message: { type: 'error', code: 'noSuchPlayer' } }];
    try {
      const claim = await claimLegendary(this.store, player, itemId, this.now());
      return [{ to: playerId, message: { type: 'legendaryClaimed', ...claim } }];
    } catch (err) {
      // A losing racer hits the store's unique constraint rather than the check.
      const code = err instanceof LegacyError ? err.code : 'alreadyHeld';
      return [{ to: playerId, message: { type: 'error', code } }];
    }
  }

  private async onLegendaryHistory(playerId: string, itemId: string): Promise<Delivery[]> {
    const chain = await this.store.legendaryHistory(itemId);
    const out = [];
    for (const entry of chain) {
      out.push({
        holderName: (await this.store.getPlayer(entry.holderId))?.name ?? 'unknown',
        heldFrom: entry.heldFrom,
        heldUntil: entry.heldUntil,
      });
    }
    return [{ to: playerId, message: { type: 'legendaryChain', itemId, chain: out } }];
  }

  /* ── Clans ─────────────────────────────────────────────────────────── */

  private clanFail(playerId: string, err: unknown): Delivery[] {
    return [{ to: playerId, message: { type: 'error', code: err instanceof ClanError ? err.code : 'clanFailed' } }];
  }

  private async clanView(clan: ClanRecord, viewerId: string): Promise<ServerMessage> {
    const members = [];
    for (const id of clan.memberIds) {
      const m = await this.store.getPlayer(id);
      if (m) members.push({ id: m.id, name: m.name, role: roleOf(clan, id) ?? 'member', contribution: m.clanContribution });
    }
    return {
      type: 'clan', clanId: clan.id, name: clan.name, leaderId: clan.leaderId,
      bank: clan.bank, members, invited: clan.invitedIds,
      yourRole: roleOf(clan, viewerId) ?? 'none',
    };
  }

  private async broadcastClan(clan: ClanRecord): Promise<Delivery[]> {
    const out: Delivery[] = [];
    for (const id of clan.memberIds) out.push({ to: id, message: await this.clanView(clan, id) });
    return out;
  }

  private async clanOf(playerId: string): Promise<{ player: PlayerRecord; clan: ClanRecord } | null> {
    const player = await this.store.getPlayer(playerId);
    if (!player?.clanId) return null;
    const clan = await this.store.getClan(player.clanId);
    return clan ? { player, clan } : null;
  }

  private async onFoundClan(playerId: string, name: string): Promise<Delivery[]> {
    const player = await this.store.getPlayer(playerId);
    if (!player) return [{ to: playerId, message: { type: 'error', code: 'noSuchPlayer' } }];
    try {
      const existing = await this.store.getClanByNameKey(name.trim().toLowerCase().replace(/[\s_-]+/g, ''));
      if (existing) throw new ClanError('nameTaken');
      const clan = foundClan(player, name, this.now());
      await this.store.createClan(clan);
      player.clanId = clan.id;
      player.clanJoinedAt = this.now();
      player.clanContribution = 0;
      await this.store.savePlayer(player);
      return [...(await this.broadcastClan(clan)), { to: playerId, message: this.profileFor(player) }];
    } catch (err) { return this.clanFail(playerId, err); }
  }

  private async onClanInvite(playerId: string, name: string): Promise<Delivery[]> {
    const ctx = await this.clanOf(playerId);
    if (!ctx) return [{ to: playerId, message: { type: 'error', code: 'notInClan' } }];
    const target = await this.store.getPlayerByName(name);
    if (!target || target.id === playerId) return [{ to: playerId, message: { type: 'error', code: 'noSuchPlayer' } }];
    try {
      inviteToClan(ctx.clan, ctx.player, target);
      await this.store.saveClan(ctx.clan);
      return [
        ...(await this.broadcastClan(ctx.clan)),
        { to: target.id, message: { type: 'clanInvite', clanId: ctx.clan.id, name: ctx.clan.name, from: ctx.player.name } },
      ];
    } catch (err) { return this.clanFail(playerId, err); }
  }

  private async onAcceptClan(playerId: string, clanId: string): Promise<Delivery[]> {
    const player = await this.store.getPlayer(playerId);
    const clan = await this.store.getClan(clanId);
    if (!player || !clan) return [{ to: playerId, message: { type: 'error', code: 'noSuchClan' } }];
    try {
      acceptClanInvite(clan, player, this.now());
      await this.store.saveClan(clan);
      await this.store.savePlayer(player);
      return [...(await this.broadcastClan(clan)), { to: playerId, message: this.profileFor(player) }];
    } catch (err) { return this.clanFail(playerId, err); }
  }

  private async onLeaveClan(playerId: string): Promise<Delivery[]> {
    const ctx = await this.clanOf(playerId);
    if (!ctx) return [{ to: playerId, message: { type: 'error', code: 'notInClan' } }];
    try {
      const soleMember = ctx.clan.memberIds.length === 1;
      leaveClan(ctx.clan, ctx.player);
      await this.store.savePlayer(ctx.player);
      if (soleMember) {
        await this.store.deleteClan(ctx.clan.id);
        return [{ to: playerId, message: { type: 'clanLeft' } }, { to: playerId, message: this.profileFor(ctx.player) }];
      }
      await this.store.saveClan(ctx.clan);
      return [...(await this.broadcastClan(ctx.clan)), { to: playerId, message: { type: 'clanLeft' } }];
    } catch (err) { return this.clanFail(playerId, err); }
  }

  private async onKick(playerId: string, targetId: string): Promise<Delivery[]> {
    const ctx = await this.clanOf(playerId);
    const target = await this.store.getPlayer(targetId);
    if (!ctx || !target) return [{ to: playerId, message: { type: 'error', code: 'noSuchMember' } }];
    try {
      kickFromClan(ctx.clan, ctx.player, target);
      await this.store.saveClan(ctx.clan);
      await this.store.savePlayer(target);
      return [...(await this.broadcastClan(ctx.clan)), { to: target.id, message: { type: 'clanLeft' } }];
    } catch (err) { return this.clanFail(playerId, err); }
  }

  private async onSetOfficer(playerId: string, targetId: string, officer: boolean): Promise<Delivery[]> {
    const ctx = await this.clanOf(playerId);
    if (!ctx) return [{ to: playerId, message: { type: 'error', code: 'notInClan' } }];
    try {
      setOfficer(ctx.clan, ctx.player, targetId, officer);
      await this.store.saveClan(ctx.clan);
      return this.broadcastClan(ctx.clan);
    } catch (err) { return this.clanFail(playerId, err); }
  }

  private async onHandOver(playerId: string, targetId: string): Promise<Delivery[]> {
    const ctx = await this.clanOf(playerId);
    if (!ctx) return [{ to: playerId, message: { type: 'error', code: 'notInClan' } }];
    try {
      handOverLeadership(ctx.clan, ctx.player, targetId);
      await this.store.saveClan(ctx.clan);
      return this.broadcastClan(ctx.clan);
    } catch (err) { return this.clanFail(playerId, err); }
  }

  private async onDeposit(playerId: string, amount: number): Promise<Delivery[]> {
    const ctx = await this.clanOf(playerId);
    if (!ctx) return [{ to: playerId, message: { type: 'error', code: 'notInClan' } }];
    try {
      deposit(ctx.clan, ctx.player, amount);
      await this.store.saveClan(ctx.clan);
      await this.store.savePlayer(ctx.player);
      return [...(await this.broadcastClan(ctx.clan)), { to: playerId, message: this.profileFor(ctx.player) }];
    } catch (err) { return this.clanFail(playerId, err); }
  }

  private async onWithdraw(playerId: string, amount: number): Promise<Delivery[]> {
    const ctx = await this.clanOf(playerId);
    if (!ctx) return [{ to: playerId, message: { type: 'error', code: 'notInClan' } }];
    try {
      withdraw(ctx.clan, ctx.player, amount, this.now());
      await this.store.saveClan(ctx.clan);
      await this.store.savePlayer(ctx.player);
      return [...(await this.broadcastClan(ctx.clan)), { to: playerId, message: this.profileFor(ctx.player) }];
    } catch (err) { return this.clanFail(playerId, err); }
  }

  private async onListClans(playerId: string): Promise<Delivery[]> {
    const clans = await this.store.listClans();
    const totals = new Map<string, number>();
    for (const clan of clans) {
      let sum = 0;
      for (const id of clan.memberIds) sum += (await this.store.getPlayer(id))?.clanContribution ?? 0;
      totals.set(clan.id, sum);
    }
    return [{ to: playerId, message: { type: 'clanRankings', clans: rankClans(clans, totals) } }];
  }

  /* ── Learning techniques ───────────────────────────────────────────── */

  private async onLearnJutsu(playerId: string, jutsuId: string): Promise<Delivery[]> {
    const player = await this.store.getPlayer(playerId);
    if (!player) return [{ to: playerId, message: { type: 'error', code: 'noSuchPlayer' } }];

    const jutsu = JUTSU_BY_ID.get(jutsuId);
    if (!jutsu) return [{ to: playerId, message: { type: 'error', code: 'unknownJutsu', detail: jutsuId } }];
    if (player.known.includes(jutsuId)) return [{ to: playerId, message: { type: 'error', code: 'alreadyKnown' } }];

    /* The black market asks no questions about rank, only for more money. That
       is the trade a missing-nin makes. */
    const needed = MISSIONS.teacherRankRequired[jutsu.rank]!;
    if (!(player.rogue && ROGUE.blackMarket.ignoresRankGate)
      && RANK_ORDER.indexOf(player.rank) < RANK_ORDER.indexOf(needed)) {
      return [{ to: playerId, message: { type: 'error', code: 'rankLocked', detail: jutsuId } }];
    }

    const listed = MISSIONS.jutsuPrices[jutsu.rank]!;
    const price = player.rogue ? blackMarketPrice(listed) : priceFor(listed, player);
    if (player.ryo < price) {
      return [{ to: playerId, message: { type: 'error', code: 'cannotAfford', detail: String(price) } }];
    }

    player.ryo -= price;
    player.known.push(jutsuId);
    await this.store.savePlayer(player);
    return [
      { to: playerId, message: { type: 'jutsuLearned', jutsuId, paid: price, ryo: player.ryo } },
      { to: playerId, message: this.profileFor(player) },
    ];
  }

  /* ── Rank ──────────────────────────────────────────────────────────── */

  private async onRequestPromotion(playerId: string): Promise<Delivery[]> {
    const player = await this.store.getPlayer(playerId);
    if (!player) return [{ to: playerId, message: { type: 'error', code: 'noSuchPlayer' } }];
    const check = checkPromotion(player);
    if (!check.eligible) {
      return [{ to: playerId, message: { type: 'promotionDenied', missing: check.missing, note: check.note } }];
    }
    const rank = promote(player);
    await this.store.savePlayer(player);
    return [
      { to: playerId, message: { type: 'promotion', rank, note: check.note } },
      { to: playerId, message: this.profileFor(player) },
    ];
  }

  /* ── Replays ───────────────────────────────────────────────────────── */

  private async onGetReplay(matchId: string): Promise<Delivery[]> {
    const replay = await this.store.getReplay(matchId);
    if (!replay) return [{ to: '', message: { type: 'error', code: 'noSuchReplay' } }];
    return [{ to: '', message: { type: 'replay', matchId, seed: replay.seed, actions: replay.actions } }];
  }

  /* ── Introspection for tests and ops ───────────────────────────────── */

  roomFor(playerId: string): MatchRoom | undefined {
    const id = this.roomOf.get(playerId);
    return id ? this.rooms.get(id) : undefined;
  }
  get activeRooms(): number { return this.rooms.size; }
  get roundTimeoutMs(): number { return ROUND_TIMEOUT_MS; }
}
