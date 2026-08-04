import { BASELINE_ACTIONS, STATUS_BY_ID, TUNING, getJutsu } from '@shinobi/content';
import type {
  CloneState, Energy, EnergyPool, FighterState, Jutsu, MatchEvent, MatchState, SubmittedAction, TurnResult,
} from '@shinobi/shared';
import { energyRegenFor, effStat, sealAccuracy, sealsPerTurn } from './derive.js';
import { applyEffects, breakWeave, fighterById, opponentOf, type Ctx } from './effects.js';
import type { Rng } from './rng.js';

/**
 * Advances the match by exactly one round.
 *
 * Pure per CLAUDE.md §4: no Math.random, no clock, no I/O, no mutation of `state`.
 * Every branch that consumes randomness does so through the injected `rng`.
 */
export function resolveTurn(state: MatchState, actions: SubmittedAction[], rng: Rng): TurnResult {
  const s: MatchState = structuredClone(state);
  const events: MatchEvent[] = [];

  const isComplete = (): boolean => s.phase === ('complete' as MatchState['phase']);
  if (isComplete()) return { state: s, events };

  let idCounter = 0;
  const ctx: Ctx = {
    state: s,
    events,
    rng,
    nextId: () => `${s.matchId}-r${s.round}-${idCounter++}`,
  };

  /* ── Sudden death ─────────────────────────────────────────────────── */
  if (!s.suddenDeath && s.round >= TUNING.suddenDeathRound) {
    s.suddenDeath = true;
    events.push({ t: 'suddenDeath', round: s.round });
  }
  events.push({ t: 'roundStart', round: s.round, suddenDeath: s.suddenDeath });

  /* ── Forfeits resolve before anything else ────────────────────────── */
  for (const a of actions) {
    if (a.actionId !== 'forfeit') continue;
    const f = fighterById(s, a.fighterId);
    if (!f || f.defeated || !ownedBy(a, f)) continue;
    f.defeated = true;
    events.push({ t: 'defeated', fighterId: f.id });
    // Conceding hands the match to the other fighter. Without this the match
    // ended with no winner at all, and neither side was credited.
    const survivor = s.fighters.find((o) => o.id !== f.id);
    s.winnerId = survivor && !survivor.defeated ? survivor.id : null;
    finish(s, events, 'forfeit');
    return { state: s, events };
  }

  /* ── Armed delayed effects fire at the top of the round ───────────── */
  for (const f of s.fighters) {
    const stillPending = [];
    for (const p of f.pending) {
      p.remaining -= 1;
      if (p.remaining > 0) { stillPending.push(p); continue; }
      const target = p.targetId === f.id ? f : opponentOf(s, f.id);
      events.push({ t: 'delayedFired', fighterId: f.id, id: p.id });
      applyEffects(ctx, f, target, p.effects, { nature: p.nature, discipline: p.discipline });
    }
    f.pending = stillPending;
  }
  if (checkDefeat(s, events)) return { state: s, events };

  /* ── Turn order: higher effective Speed first, ties broken by rng ──── */
  const [f0, f1] = s.fighters;
  const sp0 = effStat(f0, 'speed');
  const sp1 = effStat(f1, 'speed');
  let first = f0, second = f1, tiebreak = false;
  if (sp1 > sp0) { first = f1; second = f0; }
  else if (sp0 === sp1) {
    tiebreak = true;
    if (rng.chance(0.5)) { first = f1; second = f0; }
  }
  events.push({ t: 'order', first: first.id, second: second.id, tiebreak });

  /* Stances resolve before anyone swings. A stance is a declaration for the
     round, so it cannot depend on turn order — otherwise the slower fighter
     could never guard against the faster one. Declaring a stance still costs
     the fighter their action. */
  const spentOnStance = new Set<string>();
  for (const f of [first, second]) {
    if (f.defeated || f.weave) continue;
    const a = actions.find((x) => x.fighterId === f.id && ownedBy(x, f));
    if (!a) continue;
    const j = getJutsu(a.actionId);
    if (!j || j.effects.length === 0 || !j.effects.every((e) => e.kind === 'stance')) continue;
    for (const e of j.effects) {
      if (e.kind !== 'stance') continue;
      f.stance = e.stance;
      events.push({ t: 'stance', fighterId: f.id, stance: e.stance });
      if (e.stance === 'counter') f.reflect = { fraction: TUNING.stances.counterFraction, remaining: 1 };
    }
    spentOnStance.add(f.id);
  }

  /* ── Act ──────────────────────────────────────────────────────────── */
  for (const f of [first, second]) {
    if (isComplete()) break;
    if (f.defeated) continue;
    takeTurn(ctx, f, actions, spentOnStance.has(f.id));
    if (checkDefeat(s, events)) return { state: s, events };
  }

  /* ── Upkeep ───────────────────────────────────────────────────────── */
  for (const f of s.fighters) upkeep(ctx, f);
  if (checkDefeat(s, events)) return { state: s, events };

  /* ── Advance the round and check the hard cap ─────────────────────── */
  s.round += 1;
  if (s.round > TUNING.hardCapRound) {
    const [a, b] = s.fighters;
    const pa = a.hp / a.maxHp, pb = b.hp / b.maxHp;
    if (pa > pb) { s.winnerId = a.id; b.defeated = true; }
    else if (pb > pa) { s.winnerId = b.id; a.defeated = true; }
    else s.winnerId = null;
    finish(s, events, s.winnerId ? 'timeout' : 'draw');
  }

  return { state: s, events };
}

/* ── One fighter's turn: their own body, then each clone body ────────── */

/**
 * An action may only drive a body its sender owns. `submittedBy` is stamped by
 * the server from the authenticated connection; unstamped actions are treated as
 * trusted (single-player, replay, and simulator paths) but the server never
 * leaves it unset. See sanitizeActions().
 */
function ownedBy(a: SubmittedAction, f: FighterState): boolean {
  return a.submittedBy === undefined || a.submittedBy === f.id;
}

function takeTurn(ctx: Ctx, f: FighterState, actions: SubmittedAction[], stanceAlreadySpent = false): void {
  const { state: s, events } = ctx;

  const controlled = controlCheck(ctx, f);

  if (!controlled && !stanceAlreadySpent) {
    if (f.weave) {
      advanceWeave(ctx, f, null);
    } else {
      const action = actions.find((a) => a.fighterId === f.id && ownedBy(a, f));
      if (action) resolveAction(ctx, f, null, action);
    }
  }

  // Clone bodies act after their originator. Control statuses sit on the
  // originator's body, so clones are not stopped by them — dispel is the answer.
  for (const clone of [...f.clones]) {
    if (s.phase === ('complete' as typeof s.phase) || f.defeated) break;
    if (!f.clones.includes(clone)) continue; // destroyed mid-turn
    if (clone.weave) { advanceWeave(ctx, f, clone); continue; }
    const action = actions.find((a) => a.fighterId === clone.id && ownedBy(a, f));
    if (action) resolveAction(ctx, f, clone, action);
  }

  void events;
}

/** Returns true if the fighter loses their action this round. */
function controlCheck(ctx: Ctx, f: FighterState): boolean {
  for (const st of f.statuses) {
    const def = STATUS_BY_ID.get(st.status);
    if (!def?.control) continue;
    if (def.control === 'skip') {
      ctx.events.push({ t: 'blocked', fighterId: f.id, reason: 'stunned' });
      return true;
    }
    if (def.control === 'skipChance' && ctx.rng.chance(def.controlChance ?? 0)) {
      ctx.events.push({ t: 'blocked', fighterId: f.id, reason: 'stunned' });
      return true;
    }
  }
  return false;
}

function advanceWeave(ctx: Ctx, f: FighterState, clone: CloneState | null): void {
  const body = clone ?? f;
  const weave = body.weave!;
  weave.remaining -= 1;
  if (weave.remaining > 0) {
    ctx.events.push({ t: 'weaveTick', fighterId: body.id, jutsuId: weave.jutsuId, remaining: weave.remaining });
    return;
  }
  const j = getJutsu(weave.jutsuId);
  body.weave = null;
  if (!j) return;
  fire(ctx, f, j, weave.targetId, clone !== null, weave.prepared);
}

function resolveAction(ctx: Ctx, f: FighterState, clone: CloneState | null, action: SubmittedAction): void {
  const { state: s, events } = ctx;
  const body = clone ?? f;
  const bodyId = clone ? clone.id : f.id;

  const j = getJutsu(action.actionId);
  if (!j) { events.push({ t: 'blocked', fighterId: bodyId, reason: 'unknownJutsu' }); return; }

  const inLoadout = f.loadout.includes(j.id)
    || f.granted.includes(j.id)
    || (BASELINE_ACTIONS as readonly string[]).includes(j.id);
  if (!inLoadout) { events.push({ t: 'blocked', fighterId: bodyId, reason: 'notInLoadout' }); return; }

  if ((body.cooldowns[j.id] ?? 0) > 0) { events.push({ t: 'blocked', fighterId: bodyId, reason: 'cooldown' }); return; }

  if (j.requires && f.stats[j.requires.stat] < j.requires.min) {
    events.push({ t: 'blocked', fighterId: bodyId, reason: 'requirement' });
    return;
  }

  const sealed = f.statuses.some((st) => STATUS_BY_ID.get(st.status)?.blocksSealedJutsu);
  if (sealed && j.seals > 0) { events.push({ t: 'blocked', fighterId: bodyId, reason: 'silenced' }); return; }

  /* ── Pay across three reserves ─────────────────────────────────────
     Physical and mental energy may be overdrawn — that is the intentional
     self-harm valve. Natural energy cannot: it is gathered from the world, not
     produced by the body, so you either have it or you do not cast. */
  const reserves: Energy = clone ? clone.chakra : f.chakra;
  const spendable: EnergyPool[] = ['physical', 'mental'];

  if (j.cost.natural > reserves.natural) {
    events.push({ t: 'blocked', fighterId: bodyId, reason: 'noEnergy' });
    return;
  }
  const maxOverdraw = Math.floor(
    (f.maxChakra.physical + f.maxChakra.mental) / 2 * TUNING.overdraw.maxOverdrawFraction,
  );
  let overdraw = 0;
  for (const pool of spendable) {
    const short = j.cost[pool] - reserves[pool];
    if (short <= 0) continue;
    if (clone) { events.push({ t: 'blocked', fighterId: bodyId, reason: 'noEnergy' }); return; }
    overdraw += short;
  }
  if (overdraw > maxOverdraw) {
    events.push({ t: 'blocked', fighterId: bodyId, reason: 'noEnergy' });
    return;
  }

  const paid: Energy = { ...j.cost };
  reserves.natural -= j.cost.natural;
  for (const pool of spendable) {
    const short = j.cost[pool] - reserves[pool];
    if (short > 0) {
      reserves[pool] = 0;
      const selfDamage = Math.round(short * TUNING.overdraw.selfDamagePerPoint);
      f.hp = Math.max(0, f.hp - selfDamage);
      events.push({ t: 'overdraw', fighterId: f.id, pool, amount: short, selfDamage });
    } else {
      reserves[pool] -= j.cost[pool];
    }
  }
  if (overdraw > 0) {
    const ex = f.statuses.find((st) => st.status === 'exhaustion');
    if (ex) ex.remaining = Math.max(ex.remaining, 3);
    else f.statuses.push({ status: 'exhaustion', remaining: 3, potency: overdraw });
    if (f.hp <= 0) return;
  }

  const paidTotal = paid.physical + paid.mental + paid.natural;
  f.skillLedger.intelligence = (f.skillLedger.intelligence ?? 0) + paidTotal / TUNING.skillGain.perChakraSpentDivisor;
  if (j.seals > 0) {
    f.skillLedger.handSeals = (f.skillLedger.handSeals ?? 0) + (j.seals * 0.05);
  }

  if (j.cooldown > 0) body.cooldowns[j.id] = j.cooldown + 1;

  /* ── Weave or fire ────────────────────────────────────────────────── */
  const prepared = f.stance === 'prepare' && j.seals > 0;
  const sealBonus = f.sealBonus + (prepared ? TUNING.stances.prepareSealBonus : 0);
  const turns = j.seals > 0 ? Math.ceil(j.seals / sealsPerTurn(effStat(f, 'handSeals'), sealBonus)) : 1;
  if (turns > 1) {
    body.weave = { jutsuId: j.id, remaining: turns - 1, total: turns, chakraPaid: paid, targetId: action.targetId, prepared };
    events.push({ t: 'weaveStart', fighterId: bodyId, jutsuId: j.id, turns });
    return;
  }

  if (prepared) f.stance = 'none';
  fire(ctx, f, j, action.targetId, clone !== null, prepared);
  void s;
}

function fire(ctx: Ctx, f: FighterState, j: Jutsu, targetId: string, fromClone = false, prepared = false): void {
  const opp = opponentOf(ctx.state, f.id);
  const target = targetId === f.id ? f : opp;

  /* Seals can be fumbled, not just interrupted. A failed sequence burns part of
     what was already spent and produces nothing. */
  if (j.seals > 0 && !ctx.rng.chance(sealAccuracy(f, j.sealDifficulty))) {
    const burn = TUNING.sealAccuracy.burnFraction;
    const refund: Energy = { physical: 0, mental: 0, natural: 0 };
    const burned: Energy = { physical: 0, mental: 0, natural: 0 };
    for (const pool of ['physical', 'mental', 'natural'] as const) {
      burned[pool] = Math.round(j.cost[pool] * burn);
      refund[pool] = j.cost[pool] - burned[pool];
      f.chakra[pool] = Math.min(f.maxChakra[pool], f.chakra[pool] + refund[pool]);
    }
    ctx.events.push({ t: 'sealFailed', fighterId: f.id, jutsuId: j.id, burned });
    return;
  }

  ctx.events.push({ t: 'cast', fighterId: f.id, jutsuId: j.id, targetId: target.id });

  const effects = j.effects;
  applyEffects(ctx, f, target, effects, {
    nature: j.nature,
    discipline: j.discipline,
    sourceMult: (fromClone ? TUNING.clones.outgoingDamageMultiplier : 1)
      * (prepared ? TUNING.stances.prepareDamageMult : 1),
  });
}

/* ── End-of-round upkeep ─────────────────────────────────────────────── */

function upkeep(ctx: Ctx, f: FighterState): void {
  const { events } = ctx;
  if (f.defeated) return;

  /* Status ticks. Damage-over-time bypasses shields on purpose: otherwise a
     shield-stacking build is immune to every attrition line in the game. */
  for (const st of f.statuses) {
    const def = STATUS_BY_ID.get(st.status);
    if (!def) continue;
    if (def.dotPctMaxHp !== undefined) {
      const ramp = (def.rampPerTurn ?? 0) * Math.max(0, st.potency > 0 ? 1 : 0);
      const pct = def.dotPctMaxHp + ramp;
      const amount = Math.max(1, Math.round(f.maxHp * pct + st.potency * 0.25));
      const dealt = Math.min(f.hp, amount);
      f.hp -= dealt;
      events.push({ t: 'statusTick', fighterId: f.id, status: st.status, amount: dealt });
    }
    if (def.hotPctMaxHp !== undefined) {
      const amount = Math.min(f.maxHp - f.hp, Math.round(f.maxHp * def.hotPctMaxHp + st.potency * 0.25));
      if (amount > 0) {
        f.hp += amount;
        events.push({ t: 'statusTick', fighterId: f.id, status: st.status, amount });
      }
    }
    if (def.chakraPerTurn !== undefined) {
      for (const pool of ['physical', 'mental'] as const) {
        const before = f.chakra[pool];
        f.chakra[pool] = Math.max(0, Math.min(f.maxChakra[pool], before + def.chakraPerTurn));
        if (f.chakra[pool] !== before) events.push({ t: 'chakra', fighterId: f.id, pool, delta: f.chakra[pool] - before });
      }
    }
  }

  if (f.controlImmunity > 0) f.controlImmunity -= 1;
  for (const st of f.statuses) st.remaining -= 1;
  for (const st of f.statuses) {
    if (st.remaining > 0) continue;
    events.push({ t: 'statusExpired', fighterId: f.id, status: st.status });
    if (STATUS_BY_ID.get(st.status)?.tags.includes('hard')) {
      f.controlImmunity = Math.max(f.controlImmunity, TUNING.control.hardImmunityTurns);
    }
  }
  f.statuses = f.statuses.filter((st) => st.remaining > 0);

  for (const m of f.modifiers) m.remaining -= 1;
  f.modifiers = f.modifiers.filter((m) => m.remaining > 0);

  for (const sh of f.shields) sh.remaining -= 1;
  f.shields = f.shields.filter((sh) => sh.remaining > 0 && sh.amount > 0);

  if (f.reflect) {
    f.reflect.remaining -= 1;
    if (f.reflect.remaining <= 0) f.reflect = null;
  }

  /* Clones that expire un-killed hand their remaining chakra back. */
  const surviving: CloneState[] = [];
  for (const c of f.clones) {
    c.remaining -= 1;
    if (c.remaining > 0) { surviving.push(c); continue; }
    if (TUNING.clones.returnChakraOnRecall) {
      const back: Energy = { physical: 0, mental: 0, natural: 0 };
      for (const pool of ['physical', 'mental', 'natural'] as const) {
        back[pool] = Math.min(f.maxChakra[pool] - f.chakra[pool], c.chakra[pool]);
        f.chakra[pool] += back[pool];
      }
      events.push({ t: 'cloneRecalled', fighterId: f.id, cloneId: c.id, chakraReturned: back });
    }
  }
  f.clones = surviving;

  for (const key of Object.keys(f.cooldowns)) {
    const v = (f.cooldowns[key] ?? 0) - 1;
    if (v <= 0) delete f.cooldowns[key];
    else f.cooldowns[key] = v;
  }
  for (const c of f.clones) {
    for (const key of Object.keys(c.cooldowns)) {
      const v = (c.cooldowns[key] ?? 0) - 1;
      if (v <= 0) delete c.cooldowns[key];
      else c.cooldowns[key] = v;
    }
  }

  /* Gates burn the user every round they stay open. */
  if (f.gateTier > 0) {
    const gate = TUNING.gates[f.gateTier - 1];
    if (gate) {
      const drain = Math.max(1, Math.round(f.maxHp * gate.hpDrainPct * TUNING.gateDrainScale));
      const dealt = Math.min(f.hp, drain);
      f.hp -= dealt;
      events.push({ t: 'gateDrain', fighterId: f.id, amount: dealt });
    }
  }

  /* Physical energy comes back quickly, mental slowly, natural not at all. */
  const regen = energyRegenFor(f.stats);
  for (const pool of ['physical', 'mental', 'natural'] as const) {
    const before = f.chakra[pool];
    f.chakra[pool] = Math.min(f.maxChakra[pool], before + regen[pool]);
    if (f.chakra[pool] !== before) events.push({ t: 'chakra', fighterId: f.id, pool, delta: f.chakra[pool] - before });
  }

  /* Substitute and Counter are single-round declarations. Prepare persists until
     it is spent on a technique. */
  if (f.stance === 'substitute' || f.stance === 'counter') f.stance = 'none';
}

/* ── Match end ───────────────────────────────────────────────────────── */

function checkDefeat(s: MatchState, events: MatchEvent[]): boolean {
  const [a, b] = s.fighters;
  let ended = false;
  for (const f of s.fighters) {
    if (f.hp <= 0 && !f.defeated) {
      f.hp = 0;
      f.defeated = true;
      events.push({ t: 'defeated', fighterId: f.id });
      ended = true;
    }
  }
  if (!ended) return false;

  if (a.defeated && b.defeated) { s.winnerId = null; finish(s, events, 'draw'); }
  else if (a.defeated) { s.winnerId = b.id; finish(s, events, 'ko'); }
  else { s.winnerId = a.id; finish(s, events, 'ko'); }
  return true;
}

function finish(s: MatchState, events: MatchEvent[], outcome: MatchState['outcome']): void {
  if (s.phase === 'complete') return;

  /* The eighth gate kills its user when the match ends (CLAUDE.md §7). */
  for (const f of s.fighters) {
    if (f.gateTier >= 8 && !f.defeated) {
      f.hp = 0;
      f.defeated = true;
      events.push({ t: 'gateCollapse', fighterId: f.id });
      events.push({ t: 'defeated', fighterId: f.id });
      if (s.winnerId === f.id) {
        const other = s.fighters.find((o) => o.id !== f.id)!;
        s.winnerId = other.defeated ? null : other.id;
        if (s.winnerId === null) outcome = 'draw';
      }
    }
  }

  s.phase = 'complete';
  s.outcome = outcome;
  events.push({ t: 'matchEnd', winnerId: s.winnerId, outcome: s.outcome });
}
