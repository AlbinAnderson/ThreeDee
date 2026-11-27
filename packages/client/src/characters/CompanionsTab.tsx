/**
 * Companions (Epic 9): link familiars, animal companions, mounts, eidolons,
 * phantoms and cohorts to their master; quick-switch between them; harbor /
 * manifest; known tricks and Handle Animal; Life Link / Etheric Tether.
 * Every rule is checked again on the server; the UI only hides what can't work.
 */
import { useMemo, useState } from 'react';
import { ArrowUpLeft, Eye, EyeOff, HeartHandshake, PawPrint, Plus, Unlink, X } from 'lucide-react';
import {
  canBeHandled,
  canManageCharacter,
  companionActions,
  companionLinkProblem,
  companionsOf,
  companionTypeFromPcgen,
  COMPANION_TYPE_LABEL,
  COMPANION_TYPES,
  handleAnimalCheck,
  HARBOR_LABEL,
  hpLinkName,
  hpView,
  MAX_KNOWN_TRICKS,
  newId,
  normalizeName,
  signed,
  STANDARD_TRICKS,
  tricksFromBuild,
  type Character,
  type CompanionType,
  type GameState,
  type HandleMode,
} from '@vtt/shared';
import { InfoTip } from '../components/InfoTip';
import { hpColor } from '../config/conditions';
import { confirmDialog } from '../state/dialogs';
import { dispatch } from '../state/dispatch';
import { useGame, useSelf } from '../state/hooks';
import { currentWhisper } from '../state/uiStore';
import { useCharactersUi } from './store';

const openCharacter = (id: string) => useCharactersUi.setState({ selectedId: id });

function useCharacterState() {
  const characters = useGame((s) => s.characters);
  const tokens = useGame((s) => s.tokens);
  return useMemo(() => ({ characters, tokens }) as Pick<GameState, 'characters' | 'tokens'>, [characters, tokens]);
}

function HpBar({ state, c }: { state: Pick<GameState, 'tokens'>; c: Character }) {
  const hp = hpView(state, c);
  return (
    <span className="companion-hp" title={`${hp.current} / ${hp.max} HP${hp.temp ? ` (+${hp.temp} temp)` : ''}`}>
      <span className="hp-bar-html companion-hp-bar">
        <span
          style={{
            display: 'block',
            width: `${Math.max(0, Math.min(100, (hp.current / Math.max(1, hp.max)) * 100))}%`,
            background: hpColor(hp.current, hp.max),
          }}
        />
      </span>
      <span className="small-text">
        {hp.current}/{hp.max}
      </span>
    </span>
  );
}

/** Above the sheet tabs: "Master: X" back-link and/or chips for this character's companions. */
export function CompanionStrip({ character: c }: { character: Character }) {
  const state = useCharacterState();
  const master = c.companion ? state.characters[c.companion.masterId] : undefined;
  const companions = companionsOf(state, c.id);
  if (!c.companion && companions.length === 0) return null;
  return (
    <div className="companion-strip">
      {c.companion && (
        <span className="companion-strip-master small-text">
          {COMPANION_TYPE_LABEL[c.companion.type]} of{' '}
          {master ? (
            <button type="button" className="link-button" onClick={() => openCharacter(master.id)} title={`Open ${master.name}`}>
              <ArrowUpLeft size={11} /> {master.name}
            </button>
          ) : (
            <span className="muted">a character you can’t see</span>
          )}
        </span>
      )}
      {companions.map((x) => (
        <button
          key={x.id}
          type="button"
          className="companion-chip"
          onClick={() => openCharacter(x.id)}
          title={`Open ${x.name} (${COMPANION_TYPE_LABEL[x.companion!.type]})`}
        >
          <PawPrint size={11} />
          <span className="companion-chip-name">{x.name}</span>
          {x.companion!.harbored ? <span className="badge subtle">{HARBOR_LABEL[x.companion!.type]}</span> : <HpBar state={state} c={x} />}
        </button>
      ))}
    </div>
  );
}

export function CompanionsTab({ character: c }: { character: Character }) {
  const self = useSelf();
  const manage = canManageCharacter(self, c);
  const state = useCharacterState();
  const companions = companionsOf(state, c.id);
  const [showAdd, setShowAdd] = useState(false);
  const compact = !!c.companion && companions.length === 0 && !showAdd;
  return (
    <div className="companions">
      {c.companion ? <CompanionControls character={c} manage={manage} /> : manage && <BecomeCompanion character={c} />}
      {compact ? (
        manage && (
          <button type="button" className="link-button small-text" onClick={() => setShowAdd(true)}>
            <Plus size={11} /> Give {c.name} a companion of its own
          </button>
        )
      ) : (
        <section>
          <div className="section-header">
            <h3>Companions</h3>
          </div>
          {companions.length === 0 && <p className="muted small-text">No linked companions.</p>}
          <ul className="companion-list">
            {companions.map((x) => (
              <CompanionRow key={x.id} companion={x} />
            ))}
          </ul>
          {manage && <AddCompanion master={c} />}
        </section>
      )}
      <p className="muted small-text">
        A companion is its own character with its own token. It must be played by the same player as its master; giving either to someone else unlinks them.
      </p>
    </div>
  );
}

function CompanionRow({ companion: x }: { companion: Character }) {
  const self = useSelf();
  const state = useCharacterState();
  const link = x.companion!;
  const manage = canManageCharacter(self, x);
  const token = x.tokenId ? state.tokens[x.tokenId] : undefined;
  return (
    <li className="companion-row">
      <button type="button" className="link-button companion-row-name" onClick={() => openCharacter(x.id)} title={`Open ${x.name}`}>
        {x.name}
      </button>
      <span className="badge subtle">{COMPANION_TYPE_LABEL[link.type]}</span>
      {link.harbored ? <span className="badge warn">{HARBOR_LABEL[link.type]}</span> : <HpBar state={state} c={x} />}
      {!link.harbored && (token?.conditions.length ?? x.runtime.conditions.length) > 0 && (
        <span className="muted small-text" title="Conditions">
          {(token?.conditions ?? x.runtime.conditions).join(', ')}
        </span>
      )}
      {manage && <HarborButton companion={x} />}
    </li>
  );
}

function HarborButton({ companion: x }: { companion: Character }) {
  const link = x.companion!;
  const label = link.harbored
    ? 'Manifest'
    : HARBOR_LABEL[link.type] === 'Harbored'
      ? 'Harbor'
      : HARBOR_LABEL[link.type] === 'Dismissed'
        ? 'Dismiss'
        : 'Put away';
  return (
    <button
      type="button"
      className="small"
      title={link.harbored ? 'Bring it back onto the map, next to its master' : 'Take its token off the map (HP and conditions are kept)'}
      onClick={() =>
        dispatch(
          companionActions.setHarbored.create({
            companionId: x.id,
            harbored: !link.harbored,
          }),
        )
      }
    >
      {link.harbored ? <Eye size={12} /> : <EyeOff size={12} />} {label}
    </button>
  );
}

/** Characters `master`'s controller could link as its companions. */
function useLinkCandidates(master: Character) {
  const self = useSelf();
  const state = useCharacterState();
  return useMemo(
    () =>
      Object.values(state.characters)
        .filter(
          (x) =>
            x.id !== master.id &&
            x.companion?.masterId !== master.id &&
            x.ownerId === master.ownerId &&
            canManageCharacter(self, x) &&
            !x.companion?.harbored &&
            companionLinkProblem(state, x.id, master.id) === true,
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [state, master.id, master.ownerId, self],
  );
}

function AddCompanion({ master }: { master: Character }) {
  const state = useCharacterState();
  const candidates = useLinkCandidates(master);
  const [pick, setPick] = useState('');
  const [type, setType] = useState<CompanionType>('animalCompanion');
  const chosen = candidates.find((x) => x.id === pick);
  // FOLLOWER lines in the master's .pcg that match a character you could link.
  const selfNames = new Set([normalizeName(master.name), normalizeName(master.build.bio.name ?? '')]);
  const followers = master.build.companions.followers.filter((f) => !selfNames.has(normalizeName(f.name)));
  const suggestions = followers.flatMap((f) => {
    const match = candidates.find((x) => normalizeName(x.name) === normalizeName(f.name) || normalizeName(x.build.bio.name ?? '') === normalizeName(f.name));
    return match ? [{ follower: f, match }] : [];
  });
  const linkedNames = new Set(companionsOf(state, master.id).flatMap((x) => [normalizeName(x.name), normalizeName(x.build.bio.name ?? '')]));
  const unmatched = followers.filter((f) => !suggestions.some((s) => s.follower === f) && !linkedNames.has(normalizeName(f.name)));
  const link = (x: Character, t: CompanionType) =>
    dispatch(
      companionActions.link.create({
        companionId: x.id,
        masterId: master.id,
        type: t,
        knownTricks: tricksFromBuild(x.build),
      }),
    );

  return (
    <div className="companion-add">
      {suggestions.map(({ follower, match }, i) => (
        <div key={`${follower.name}-${i}`} className="companion-suggestion small-text">
          <span>
            PCGen follower <strong>{follower.name}</strong> ({follower.type ?? 'companion'})
          </span>
          <button type="button" className="small gold" onClick={() => link(match, companionTypeFromPcgen(follower.type))}>
            <Plus size={12} /> Link {match.name}
          </button>
        </div>
      ))}
      {unmatched.length > 0 && (
        <p className="muted small-text">
          The .pcg lists {unmatched.map((f) => f.name).join(', ')}: import {unmatched.length === 1 ? 'its' : 'their'} .pcg to link{' '}
          {unmatched.length === 1 ? 'it' : 'them'}.
        </p>
      )}
      {candidates.length > 0 ? (
        <div className="companion-add-row">
          <select value={chosen ? pick : ''} onChange={(e) => setPick(e.target.value)} aria-label="Character to link">
            <option value="">Link a character…</option>
            {candidates.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <select value={type} onChange={(e) => setType(e.target.value as CompanionType)} aria-label="Companion type">
            {COMPANION_TYPES.map((t) => (
              <option key={t} value={t}>
                {COMPANION_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="small"
            disabled={!chosen}
            onClick={() => {
              if (chosen && link(chosen, type)) setPick('');
            }}
          >
            <Plus size={12} /> Link
          </button>
        </div>
      ) : (
        linkedNames.size === 0 && unmatched.length === 0 && <p className="muted small-text">Import the companion’s own .pcg (same player) to link it here.</p>
      )}
    </div>
  );
}

/** On a character that isn't a companion: link it to a master (suggested from MASTER lines in its .pcg). */
function BecomeCompanion({ character: c }: { character: Character }) {
  const self = useSelf();
  const state = useCharacterState();
  const masters = useMemo(
    () =>
      Object.values(state.characters)
        .filter((m) => m.id !== c.id && m.ownerId === c.ownerId && canManageCharacter(self, m) && companionLinkProblem(state, c.id, m.id) === true)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [state, c.id, c.ownerId, self],
  );
  const fromFile = c.build.companions.masters[0];
  const suggested = fromFile
    ? masters.find((m) => normalizeName(m.name) === normalizeName(fromFile.name) || normalizeName(m.build.bio.name ?? '') === normalizeName(fromFile.name))
    : undefined;
  const [pick, setPick] = useState('');
  const [type, setType] = useState<CompanionType>(companionTypeFromPcgen(fromFile?.type));
  if (masters.length === 0) return null;
  const chosen = masters.find((m) => m.id === pick);
  const link = (m: Character, t: CompanionType) =>
    dispatch(
      companionActions.link.create({
        companionId: c.id,
        masterId: m.id,
        type: t,
        knownTricks: tricksFromBuild(c.build),
      }),
    );
  return (
    <section>
      <div className="section-header">
        <h3>Master</h3>
      </div>
      {suggested && (
        <div className="companion-suggestion small-text">
          <span>
            PCGen says {c.name} is {suggested.name}’s {(fromFile?.type ?? 'companion').toLowerCase()}.
          </span>
          <button type="button" className="small gold" onClick={() => link(suggested, companionTypeFromPcgen(fromFile?.type))}>
            <Plus size={12} /> Link
          </button>
        </div>
      )}
      <div className="companion-add-row">
        <select value={chosen ? pick : ''} onChange={(e) => setPick(e.target.value)} aria-label="Master">
          <option value="">Companion of…</option>
          {masters.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value as CompanionType)} aria-label="Companion type">
          {COMPANION_TYPES.map((t) => (
            <option key={t} value={t}>
              {COMPANION_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <button type="button" className="small" disabled={!chosen} onClick={() => chosen && link(chosen, type)}>
          <Plus size={12} /> Link
        </button>
      </div>
    </section>
  );
}

function CompanionControls({ character: c, manage }: { character: Character; manage: boolean }) {
  const self = useSelf();
  const state = useCharacterState();
  const link = c.companion!;
  const master = state.characters[link.masterId];
  const both = manage && !!master && canManageCharacter(self, master);
  const hpName = hpLinkName(link.type);
  return (
    <section>
      <div className="section-header">
        <h3>{COMPANION_TYPE_LABEL[link.type]}</h3>
        {manage && <HarborButton companion={c} />}
      </div>
      <p className="small-text">
        {master ? (
          <>
            Master:{' '}
            <button type="button" className="link-button" onClick={() => openCharacter(master.id)}>
              <ArrowUpLeft size={11} /> {master.name}
            </button>
          </>
        ) : (
          <span className="muted">Its master isn’t shared with you.</span>
        )}
        {link.harbored && (
          <span className="badge warn" style={{ marginLeft: 6 }}>
            {HARBOR_LABEL[link.type]}
          </span>
        )}
      </p>
      {manage && (
        <div className="companion-add-row">
          <select
            value={link.type}
            aria-label="Companion type"
            onChange={(e) =>
              dispatch(
                companionActions.update.create({
                  companionId: c.id,
                  changes: { type: e.target.value as CompanionType },
                }),
              )
            }
          >
            {COMPANION_TYPES.map((t) => (
              <option key={t} value={t}>
                {COMPANION_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          {canBeHandled(link.type) && (
            <label className="checkbox-inline small-text">
              <input
                type="checkbox"
                checked={link.link}
                onChange={(e) =>
                  dispatch(
                    companionActions.update.create({
                      companionId: c.id,
                      changes: { link: e.target.checked },
                    }),
                  )
                }
              />
              <InfoTip
                title="Link"
                body="Animal companion / special mount class feature: handle as a free action, push as a move action, even without ranks; +4 circumstance bonus on Handle Animal checks for this animal."
              >
                <span>Master has Link</span>
              </InfoTip>
            </label>
          )}
          <button
            type="button"
            className="small danger"
            disabled={link.harbored}
            title={link.harbored ? 'Manifest it before unlinking' : undefined}
            onClick={async () => {
              if (
                await confirmDialog({
                  title: `Unlink ${c.name}?`,
                  message: `${c.name} stays as its own character; it just stops being ${master?.name ?? 'its master'}’s companion.`,
                  confirmLabel: 'Unlink',
                  danger: true,
                })
              ) {
                dispatch(companionActions.unlink.create({ companionId: c.id }));
              }
            }}
          >
            <Unlink size={12} /> Unlink
          </button>
        </div>
      )}
      {canBeHandled(link.type) && <Tricks character={c} manage={manage} canHandle={both && !link.harbored} master={master} />}
      {hpName && both && master && !link.harbored && <HpLink companion={c} master={master} name={hpName} />}
    </section>
  );
}

function Tricks({ character: c, manage, canHandle, master }: { character: Character; manage: boolean; canHandle: boolean; master: Character | undefined }) {
  const state = useCharacterState();
  const link = c.companion!;
  const [draft, setDraft] = useState('');
  const [pushTrick, setPushTrick] = useState('');
  const known = link.knownTricks;
  const setTricks = (next: string[]) =>
    dispatch(
      companionActions.update.create({
        companionId: c.id,
        changes: { knownTricks: next.slice(0, MAX_KNOWN_TRICKS) },
      }),
    );
  const addTrick = () => {
    const t = draft.trim().slice(0, 40);
    if (t && !known.some((k) => k.toLowerCase() === t.toLowerCase()) && setTricks([...known, t])) setDraft('');
  };
  const check = (mode: HandleMode) => (master ? handleAnimalCheck(state, master, c, mode) : null);
  const handle = check('handle');
  const push = check('push');
  const roll = (mode: HandleMode, trick?: string) =>
    dispatch(
      companionActions.handleAnimal.create({
        companionId: c.id,
        mode,
        ...(trick ? { trick } : {}),
        chatId: newId(),
        whisper: currentWhisper(),
      }),
    );
  const costText = (cost: string) => (cost === 'free' ? 'free' : cost === 'move' ? 'move' : 'full-round');
  const unknownStandard = STANDARD_TRICKS.filter((t) => !known.some((k) => k.toLowerCase() === t.toLowerCase()));

  return (
    <div className="companion-tricks">
      <h4>
        <InfoTip
          title="Handle Animal"
          body="Handle (a known trick): DC 10. Push (a trick it doesn’t know): DC 25. +2 if the animal is wounded or has nonlethal or ability damage. Normally handle is a move action and push a full-round action; Link makes them free and move."
        >
          <span>Known tricks</span>
        </InfoTip>
        {handle && (
          <span className="muted small-text">
            {' '}
            · Handle DC {handle.dc} ({costText(handle.cost)}) · Push DC {push!.dc} ({costText(push!.cost)}) · roll {signed(handle.bonus)}
          </span>
        )}
      </h4>
      {known.length === 0 && <p className="muted small-text">No tricks yet.</p>}
      <div className="companion-trick-list">
        {known.map((t, i) => (
          <span key={`${t}-${i}`} className="companion-trick">
            {canHandle ? (
              <button type="button" className="small" title={`Handle: ${t} (DC ${handle?.dc ?? 10})`} onClick={() => roll('handle', t)}>
                <PawPrint size={11} /> {t}
              </button>
            ) : (
              <span className="badge subtle">{t}</span>
            )}
            {manage && (
              <button
                type="button"
                className="icon-button"
                aria-label={`Forget ${t}`}
                title="Remove trick"
                onClick={() => setTricks(known.filter((_, j) => j !== i))}
              >
                <X size={11} />
              </button>
            )}
          </span>
        ))}
      </div>
      {manage && (
        <div className="companion-add-row">
          <input
            list={`tricks-${c.id}`}
            value={draft}
            maxLength={40}
            placeholder="Add a trick…"
            aria-label="New trick"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addTrick();
            }}
          />
          <datalist id={`tricks-${c.id}`}>
            {unknownStandard.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          <button type="button" className="small" disabled={!draft.trim()} onClick={addTrick}>
            <Plus size={12} /> Add
          </button>
        </div>
      )}
      {canHandle && (
        <div className="companion-add-row">
          <input
            value={pushTrick}
            maxLength={40}
            placeholder="Trick to push (optional)"
            aria-label="Trick to push"
            onChange={(e) => setPushTrick(e.target.value)}
          />
          <button type="button" className="small" title={`Push: DC ${push?.dc ?? 25}`} onClick={() => roll('push', pushTrick.trim() || undefined)}>
            Push
          </button>
        </div>
      )}
    </div>
  );
}

function HpLink({ companion: c, master, name }: { companion: Character; master: Character; name: string }) {
  const state = useCharacterState();
  const [draft, setDraft] = useState('');
  const m = hpView(state, master);
  const cp = hpView(state, c);
  const missing = Math.max(0, cp.max - cp.current);
  const limit = Math.max(0, Math.min(missing, m.current));
  const amount = Math.floor(Number(draft));
  const valid = draft.trim() !== '' && Number.isFinite(amount) && amount >= 1 && amount <= limit;
  const send = () => {
    if (!valid) return;
    if (
      dispatch(
        companionActions.hpLink.create({
          companionId: c.id,
          amount,
          chatId: newId(),
          whisper: currentWhisper(),
        }),
      )
    )
      setDraft('');
  };
  return (
    <div className="companion-hplink">
      <h4>
        <InfoTip
          title={name}
          body={
            name === 'Life Link'
              ? 'Summoner: as a free action, sacrifice any number of hit points; each prevents 1 point of damage to the eidolon.'
              : 'Spiritualist: without using an action, sacrifice any number of hit points; each prevents 1 point of damage to the manifested phantom.'
          }
        >
          <span>
            <HeartHandshake size={13} /> {name}
          </span>
        </InfoTip>
      </h4>
      <p className="muted small-text">
        {master.name} {m.current}/{m.max} HP · {c.name} {cp.current}/{cp.max} HP
        {missing === 0 ? ' (unhurt)' : ''}
      </p>
      <div className="companion-add-row">
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={limit}
          value={draft}
          placeholder={limit > 0 ? `1–${limit}` : '—'}
          aria-label={`${name} hit points`}
          disabled={limit === 0}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
        />
        <button type="button" className="small gold" disabled={!valid} onClick={send}>
          Sacrifice HP
        </button>
        {limit > 0 && (
          <button
            type="button"
            className="small"
            title={`Sacrifice ${limit}`}
            onClick={() =>
              dispatch(
                companionActions.hpLink.create({
                  companionId: c.id,
                  amount: limit,
                  chatId: newId(),
                  whisper: currentWhisper(),
                }),
              )
            }
          >
            Max ({limit})
          </button>
        )}
      </div>
    </div>
  );
}
