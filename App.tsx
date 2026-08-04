import { useEffect, useMemo, useState } from 'react';
import type { Jutsu } from '@shinobi/shared';
import { useGame } from './store.js';
import { Commands, ExchangeLog, FighterCard } from './components.js';

interface TrainingLocation { id: string; name: string; activity: string; primary: string; secondary: string; unlockRank: string }
interface TrainingTier { tier: number; name: string; minutes: number }
interface TrainingContent { locations: TrainingLocation[]; tiers: TrainingTier[] }

/* ── Gate ────────────────────────────────────────────────────────────── */

interface Village { id: string; name: string; country: string; affinityBias: string }

function Gate() {
  const { authenticate, status, error } = useGame();
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [villageId, setVillageId] = useState('konohagakure');
  const [villages, setVillages] = useState<Village[]>([]);

  useEffect(() => {
    void fetch('/api/content/villages')
      .then((r) => r.json())
      .then((d: { villages: Village[] }) => setVillages(d.villages))
      .catch(() => setVillages([]));
  }, []);

  const registering = mode === 'register';
  const ready = name.trim().length >= 3 && password.length >= 10;

  return (
    <div className="gate panel">
      <p className="eyebrow">{registering ? 'Enrol at the academy' : 'Welcome back'}</p>
      <h2>{registering ? 'Create your shinobi' : 'Sign in'}</h2>
      <p>
        {registering
          ? 'One account, one shinobi. Your name is how the village will know you, and it cannot be changed.'
          : 'Sign in to pick up where you left off.'}
      </p>

      <label className="field">
        <span>Shinobi name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete={registering ? 'username' : 'username'}
          spellCheck={false}
        />
      </label>

      <label className="field">
        <span>Password{registering ? ' — at least 10 characters' : ''}</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={registering ? 'new-password' : 'current-password'}
        />
      </label>

      {registering && (
        <label className="field">
          <span>Village</span>
          <select
            value={villageId}
            onChange={(e) => setVillageId(e.target.value)}
            style={{
              width: '100%', background: 'var(--ink)', border: '1px solid var(--indigo-edge)',
              borderRadius: 2, color: 'var(--washi)', fontFamily: 'var(--data)', padding: '10px 12px',
            }}
          >
            {villages.map((v) => (
              <option key={v.id} value={v.id}>{v.name} — {v.country}</option>
            ))}
          </select>
        </label>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
        <button
          className="btn btn-seal"
          disabled={!ready || status === 'connecting'}
          onClick={() => void authenticate(mode, name, password, villageId)}
        >
          {status === 'connecting' ? 'One moment' : registering ? 'Enrol' : 'Sign in'}
        </button>
        <button className="tab" onClick={() => setMode(registering ? 'login' : 'register')}>
          {registering ? 'I already have a shinobi' : 'I need to enrol'}
        </button>
      </div>

      {registering && (
        <p className="empty" style={{ marginTop: 14 }}>
          Roughly one shinobi in five is born with a bloodline. It is rolled when you enrol
          and cannot be chosen or bought.
        </p>
      )}

      {error && <p className="notice error">{error}</p>}
    </div>
  );
}

/* ── Hub ─────────────────────────────────────────────────────────────── */

function Hub({ catalogue }: { catalogue: Jutsu[] }) {
  const { send, playerId, training, notice, board, mission, profile, squad, squadInvite, bounties, contract } = useGame();
  const [tab, setTab] = useState<'missions' | 'squad' | 'train' | 'teachers' | 'loadout' | 'bounties'>('missions');
  const [inviteName, setInviteName] = useState('');

  // The board is the first thing a player should see, so ask for it on arrival.
  useEffect(() => { send({ type: 'listMissions' }); }, [send]);
  const [content, setContent] = useState<TrainingContent | null>(null);
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    void fetch('/api/content/training').then((r) => r.json()).then(setContent).catch(() => setContent(null));
  }, []);

  const toggle = (id: string) =>
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= 8 ? cur : [...cur, id]));

  return (
    <>
      <div className="tabs">
        <button className={`tab ${tab === 'missions' ? 'tab-on' : ''}`} onClick={() => { setTab('missions'); send({ type: 'listMissions' }); }}>Mission board</button>
        <button className={`tab ${tab === 'squad' ? 'tab-on' : ''}`} onClick={() => setTab('squad')}>
          Squad{squad ? ` (${squad.members.length})` : ''}{squadInvite ? ' ·' : ''}
        </button>
        <button className={`tab ${tab === 'bounties' ? 'tab-on' : ''}`} onClick={() => { setTab('bounties'); send({ type: 'listBounties' }); }}>
          {profile?.rogue ? 'Hunted' : 'Bounties'}
        </button>
        <button className={`tab ${tab === 'train' ? 'tab-on' : ''}`} onClick={() => setTab('train')}>Training</button>
        <button className={`tab ${tab === 'teachers' ? 'tab-on' : ''}`} onClick={() => setTab('teachers')}>Teachers</button>
        <button className={`tab ${tab === 'loadout' ? 'tab-on' : ''}`} onClick={() => setTab('loadout')}>Loadout</button>
      </div>

      {notice && <p className="notice">{notice}</p>}

      {tab === 'missions' && (
        <section className="panel">
          <p className="eyebrow">The desk knows who you are</p>
          <h2>Mission board</h2>
          {mission ? (
            <>
              <p>On assignment. Report back after {new Date(mission.endsAtMs).toLocaleTimeString()}.</p>
              <p className="empty">
                The outcome was decided the moment you accepted. Reporting early will not change it,
                and neither will reporting twice.
              </p>
              <button className="btn btn-seal" onClick={() => send({ type: 'completeMission' })}>Report back</button>
            </>
          ) : board.length === 0 ? (
            <p className="empty">Nothing on the board for you. Raise your rank or your standing.</p>
          ) : (
            <div className="list">
              {board.map((m) => (
                <div key={m.id} className="row">
                  <div>
                    <div className="row-name">{m.name}</div>
                    <div className="row-meta">
                      {m.rank}-rank · {m.minutes}m · {m.ryo} ryo · {m.xp} xp · {m.reputation >= 0 ? '+' : ''}{m.reputation} rep
                    </div>
                    <div className="row-meta" style={{ marginTop: 4, opacity: 0.75 }}>{m.brief}</div>
                  </div>
                  <button className="btn" onClick={() => send({ type: 'acceptMission', missionId: m.id })}>
                    {m.chance}% · take
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === 'squad' && (
        <section className="panel">
          <p className="eyebrow">S-rank work needs three</p>
          <h2>Squad</h2>

          {squadInvite && !squad && (
            <div className="row" style={{ marginBottom: 14 }}>
              <div className="row-name">{squadInvite.from} wants you on their squad</div>
              <button className="btn btn-seal" onClick={() => send({ type: 'acceptSquadInvite', squadId: squadInvite.squadId })}>
                Accept
              </button>
            </div>
          )}

          {!squad ? (
            <>
              <p className="empty">
                A squad is formed for one mission and dissolves after it. Once the mission starts,
                nobody can leave — the whole squad shares the outcome either way.
              </p>
              <button className="btn btn-seal" onClick={() => send({ type: 'createSquad' })}>Form a squad</button>
            </>
          ) : (
            <>
              <div className="list" style={{ marginBottom: 14 }}>
                {squad.members.map((m) => (
                  <div key={m.id} className="row">
                    <div>
                      <div className="row-name">{m.name}</div>
                      <div className="row-meta">{m.rank}{m.id === squad.leaderId ? ' · leader' : ''}</div>
                    </div>
                    {m.id === playerId && <span className="row-meta">you</span>}
                  </div>
                ))}
                {squad.invited.map((id) => (
                  <div key={id} className="row" style={{ opacity: 0.55 }}>
                    <div className="row-name">Invitation sent</div>
                    <span className="row-meta">waiting</span>
                  </div>
                ))}
              </div>

              {squad.mission ? (
                <>
                  <p>On assignment together. Report back after {new Date(squad.mission.endsAtMs).toLocaleTimeString()}.</p>
                  <button className="btn btn-seal" onClick={() => send({ type: 'completePartyMission' })}>
                    Report back
                  </button>
                </>
              ) : (
                <>
                  {squad.leaderId === playerId && (
                    <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                      <input
                        value={inviteName}
                        onChange={(e) => setInviteName(e.target.value)}
                        placeholder="Shinobi name"
                        style={{
                          flex: 1, background: 'var(--ink)', border: '1px solid var(--indigo-edge)',
                          borderRadius: 2, color: 'var(--washi)', fontFamily: 'var(--data)', padding: '9px 11px',
                        }}
                      />
                      <button
                        className="btn"
                        onClick={() => { send({ type: 'inviteToSquad', name: inviteName }); setInviteName(''); }}
                      >
                        Invite
                      </button>
                    </div>
                  )}

                  {squad.partyMissions.length > 0 && squad.leaderId === playerId && (
                    <div className="list" style={{ marginBottom: 14 }}>
                      {squad.partyMissions.map((m) => (
                        <div key={m.id} className="row">
                          <div>
                            <div className="row-name">{m.name}</div>
                            <div className="row-meta">needs {m.party} · {m.minutes}m · {m.ryo} ryo split</div>
                            <div className="row-meta" style={{ marginTop: 4, opacity: 0.75 }}>{m.brief}</div>
                          </div>
                          <button className="btn" onClick={() => send({ type: 'acceptPartyMission', missionId: m.id })}>
                            {m.chance}% · take
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <button className="btn" onClick={() => send({ type: 'leaveSquad' })}>Leave squad</button>
                </>
              )}
            </>
          )}
        </section>
      )}

      {tab === 'bounties' && (
        <section className="panel">
          {profile?.rogue ? (
            <>
              <p className="eyebrow">Notoriety {profile.notoriety} · your head is worth {profile.bounty} ryo</p>
              <h2>You are being hunted</h2>
              <p className="empty">
                Every match you win makes you worth more. Lose to a hunter holding a contract and
                they take it — all of it — and your notoriety goes back to nothing.
              </p>
              <button className="btn btn-seal" onClick={() => send({ type: 'seekAmnesty' })}>
                Buy amnesty — {profile.amnestyCost} ryo
              </button>
            </>
          ) : (
            <>
              <p className="eyebrow">Village work, of a kind</p>
              <h2>Contracts</h2>
              {contract && (
                <p className="notice">
                  Working a contract worth {contract.value} ryo. Beat them in the arena to collect.
                </p>
              )}
              {bounties.length === 0 ? (
                <p className="empty">No missing-nin worth hunting right now.</p>
              ) : (
                <div className="list">
                  {bounties.map((b) => (
                    <div key={b.targetId} className="row">
                      <div>
                        <div className="row-name">{b.name}</div>
                        <div className="row-meta">level {b.level} · notoriety {b.notoriety}</div>
                      </div>
                      <button
                        className="btn"
                        disabled={Boolean(contract)}
                        onClick={() => send({ type: 'takeBountyContract', targetId: b.targetId })}
                      >
                        {b.value} ryo
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ marginTop: 18, borderTop: 'var(--rule)', paddingTop: 14 }}>
                <p className="empty">
                  Leaving your village opens the black market and forbidden work, and closes the
                  mission desk and your rank for as long as you stay out. Other players can then
                  come for you.
                </p>
                <button className="btn" onClick={() => send({ type: 'defect' })}>Leave your village</button>
              </div>
            </>
          )}
        </section>
      )}

      {tab === 'teachers' && (
        <section className="panel">
          <p className="eyebrow">{profile ? `${profile.ryo} ryo · standing ${profile.standing}` : 'Bring money'}</p>
          <h2>Learn from a teacher</h2>
          <p className="empty">
            Standing changes the price. Rank decides what anyone will teach you at all.
          </p>
          <div className="list">
            {catalogue.filter((j) => !(profile?.known ?? []).includes(j.id)).slice(0, 60).map((j) => (
              <div key={j.id} className="row">
                <div>
                  <div className="row-name">{j.name}</div>
                  <div className="row-meta">
                    {j.rank} · {j.discipline}{j.nature ? ` · ${j.nature}` : ''}
                    {j.requires ? ` · needs ${j.requires.stat} ${j.requires.min}` : ''}
                  </div>
                </div>
                <button className="btn" onClick={() => send({ type: 'learnJutsu', jutsuId: j.id })}>Learn</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === 'train' && (
        <section className="panel">
          <p className="eyebrow">Every action improves something</p>
          <h2>Where are you training?</h2>
          {training ? (
            <>
              <p>Training at {training.locationId}. Finishes {new Date(training.endsAtMs).toLocaleTimeString()}.</p>
              <p className="empty">
                Time is counted by the server, so closing this page changes nothing. Claim whenever you like —
                a partial session pays for the time actually spent.
              </p>
              <button className="btn btn-seal" onClick={() => send({ type: 'claimTraining' })}>Claim training</button>
            </>
          ) : !content ? (
            <p className="empty">Loading locations…</p>
          ) : (
            <div className="list">
              {content.locations.map((loc) => (
                <div key={loc.id} className="row">
                  <div>
                    <div className="row-name">{loc.name}</div>
                    <div className="row-meta">
                      {loc.activity} → {loc.primary} / {loc.secondary} · {loc.unlockRank}+
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {content.tiers.slice(0, 3).map((t) => (
                      <button
                        key={t.tier}
                        className="btn"
                        onClick={() => send({ type: 'startTraining', locationId: loc.id, tier: t.tier })}
                      >
                        {t.minutes}m
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === 'loadout' && (
        <section className="panel">
          <p className="eyebrow">{picked.length} of 8 chosen</p>
          <h2>Pick what you carry</h2>
          {(profile?.known.length ?? 0) === 0 && (
            <p className="empty">
              You have not learned anything yet. Take a mission, then buy a technique from a teacher.
              The eight baseline moves are always yours in a fight.
            </p>
          )}
          <div className="list">
            {catalogue.filter((j) => (profile?.known ?? []).includes(j.id)).map((j) => (
              <button
                key={j.id}
                className={`row ${picked.includes(j.id) ? 'row-on' : ''}`}
                style={{ textAlign: 'left', width: '100%' }}
                onClick={() => toggle(j.id)}
              >
                <div>
                  <div className="row-name">{j.name}</div>
                  <div className="row-meta">
                    {j.rank} · {j.discipline}{j.nature ? ` · ${j.nature}` : ''}
                    {j.requires ? ` · needs ${j.requires.stat} ${j.requires.min}` : ''}
                  </div>
                </div>
                <span className="row-meta">{picked.includes(j.id) ? 'carried' : ''}</span>
              </button>
            ))}
          </div>
          <div style={{ marginTop: 14 }}>
            <button className="btn btn-seal" onClick={() => send({ type: 'setLoadout', jutsuIds: picked })}>
              Save loadout
            </button>
          </div>
        </section>
      )}

      {profile && (
        <section className="panel">
          <p className="eyebrow">
            {profile.rank} · level {profile.level} · {profile.reputation} reputation · {profile.missionsAtRank} missions at rank
          </p>
          <h2>{profile.promotion.eligible ? 'You are ready to advance' : 'What stands between you and the next rank'}</h2>
          {profile.promotion.eligible ? (
            <>
              <p>{profile.promotion.note}</p>
              <button className="btn btn-seal" onClick={() => send({ type: 'requestPromotion' })}>Sit the exam</button>
            </>
          ) : profile.promotion.missing.length === 0 ? (
            <p className="empty">{profile.promotion.note}</p>
          ) : (
            <ul className="empty" style={{ margin: 0, paddingLeft: 18 }}>
              {profile.promotion.missing.map((m) => <li key={m}>{m}</li>)}
            </ul>
          )}
        </section>
      )}

      <section className="panel">
        <p className="eyebrow">Ranked</p>
        <h2>Find an opponent</h2>
        <p className="empty">
          Matches are resolved entirely on the server. You submit a move; everything else is decided there.
        </p>
        <button className="btn btn-seal" onClick={() => send({ type: 'queue', rank: 'genin' })} disabled={!playerId}>
          Join the queue
        </button>
      </section>
    </>
  );
}

/* ── Arena ───────────────────────────────────────────────────────────── */

function Arena({ catalogue }: { catalogue: Jutsu[] }) {
  const { state, playerId, matchId, send, waiting, notice, log } = useGame();
  const jutsuById = useMemo(() => new Map(catalogue.map((j) => [j.id, j])), [catalogue]);

  if (!state || !playerId) return null;
  const me = state.fighters.find((f) => f.id === playerId)!;
  const them = state.fighters.find((f) => f.id !== playerId)!;
  const names = new Map(state.fighters.map((f) => [f.id, f.name]));

  const BASELINE = ['basic-strike', 'throw-weapon', 'chakra-focus', 'guard-stance',
    'substitute', 'counter-stance-basic', 'prepare-seals', 'gather-natural-energy'];
  const options = [...new Set([...BASELINE, ...me.loadout])]
    .map((id) => jutsuById.get(id))
    .filter((j): j is Jutsu => Boolean(j));

  const locked = waiting || Boolean(me.weave) || state.phase === 'complete';

  return (
    <>
      <div className="arena">
        <FighterCard fighter={me} subtitle="You" jutsuById={jutsuById} />
        <section className="panel">
          <p className="eyebrow">Round {state.round}{state.suddenDeath ? ' · sudden death' : ''}</p>
          <h2>The exchange</h2>
          <ExchangeLog log={log} names={names} jutsuById={jutsuById} />
        </section>
        <FighterCard fighter={them} subtitle="Opponent" jutsuById={jutsuById} />
      </div>

      <section className="panel">
        <p className="eyebrow">
          {me.weave ? 'Your hands are busy — the weave continues'
            : waiting ? 'Move locked in'
            : 'Choose one'}
        </p>
        <h2>Your move</h2>
        {notice && <p className="notice">{notice}</p>}
        <Commands
          options={options}
          disabled={locked}
          onPick={(actionId) =>
            send({ type: 'submitAction', matchId: matchId!, action: { fighterId: playerId, actionId, targetId: them.id } })
          }
        />
        <div style={{ marginTop: 14 }}>
          <button className="btn" onClick={() => send({ type: 'forfeit', matchId: matchId! })}>Forfeit</button>
        </div>
      </section>
    </>
  );
}

/* ── Shell ───────────────────────────────────────────────────────────── */

export default function App() {
  const { status, playerId, matchId, weather, error, clearError, profile } = useGame();
  const [catalogue, setCatalogue] = useState<Jutsu[]>([]);

  useEffect(() => {
    void fetch('/api/content/jutsu').then((r) => r.json()).then(setCatalogue).catch(() => setCatalogue([]));
  }, []);

  return (
    <div className="shell">
      <header className="masthead">
        <h1 className="wordmark">Shinobi Battler <span>Online</span></h1>
        <div className="masthead-meta">
          <span>{weather}</span>
          {profile && <span>{profile.rank} · {profile.ryo} ryo</span>}
          <span>{catalogue.length} techniques</span>
          <span>{status === 'connected' ? (playerId ?? 'connected') : status}</span>
        </div>
      </header>

      {error && (
        <p className="notice error" onClick={clearError} role="status">
          {error} — tap to dismiss
        </p>
      )}

      {status !== 'connected' || !playerId ? <Gate />
        : matchId ? <Arena catalogue={catalogue} />
        : <Hub catalogue={catalogue} />}
    </div>
  );
}
