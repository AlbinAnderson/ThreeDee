/**
 * Import (or re-import) a PCGen .pcg file: parse in the browser, preview,
 * then save. Re-import shows what changed and what is kept.
 */
import { useMemo, useState } from 'react';
import {
  buildName,
  characterActions,
  createCharacterFromPcg,
  diffCharacterBuild,
  isGm,
  newId,
  parsePcg,
  type BuildChange,
} from '@vtt/shared';
import { dispatch } from '../state/dispatch';
import { useGame, useSelf } from '../state/hooks';
import { notify } from '../state/notifications';
import { CharacterSummary } from './CharacterSummary';
import { useCharactersUi, useImportDialog, type ImportState } from './store';

const MAX_FILE_BYTES = 600 * 1024;
/** Messages over ~1 MB are refused by the server. */
const MAX_PAYLOAD_CHARS = 900_000;

/** Read + parse a file and open the preview. Returns false (with a toast) if it isn't a usable .pcg. */
export async function openImport(file: File, targetId?: string): Promise<boolean> {
  if (!/\.pcg$/i.test(file.name)) {
    notify('That is not a PCGen .pcg file');
    return false;
  }
  if (file.size > MAX_FILE_BYTES) {
    notify(`${file.name} is too large (${Math.round(file.size / 1024)} KB)`);
    return false;
  }
  try {
    const build = parsePcg(await file.text());
    const looksLikePcg =
      build.system.pcgVersion !== null ||
      build.bio.name !== null ||
      Object.keys(build.attributes.stats).length > 0 ||
      build.classes.length > 0 ||
      build.equipment.length > 0;
    if (!looksLikePcg) {
      notify(`${file.name} does not look like a PCGen .pcg file`);
      return false;
    }
    useImportDialog.setState({ current: { openId: newId(), build, fileName: file.name, targetId } });
    return true;
  } catch (e) {
    notify(`Could not read ${file.name}: ${(e as Error).message}`);
    return false;
  }
}

export function ImportDialog() {
  const current = useImportDialog((s) => s.current);
  if (!current) return null;
  return <ImportDialogBody key={current.openId} state={current} />;
}

function close() {
  useImportDialog.setState({ current: null });
}

function ImportDialogBody({ state }: { state: ImportState }) {
  const self = useSelf();
  const gm = isGm(self);
  const users = useGame((s) => s.users);
  const isReimport = !!state.targetId;
  const target = useGame((s) => (state.targetId ? s.characters[state.targetId] : undefined));
  const targetMissing = isReimport && !target;
  const players = useMemo(() => Object.values(users).filter((u) => u.role !== 'gm'), [users]);
  const [ownerId, setOwnerId] = useState<string | null>(gm ? null : self.id);
  const [replaceInventory, setReplaceInventory] = useState(false);
  const changes = useMemo(() => (target ? diffCharacterBuild(target.build, state.build) : null), [target, state.build]);

  function save() {
    if (isReimport) {
      if (!target) {
        notify('That character is no longer available');
        close();
        return;
      }
      const action = characterActions.reimport.create({ id: target.id, build: state.build, fileName: state.fileName, replaceInventory });
      if (JSON.stringify(action).length > MAX_PAYLOAD_CHARS) return notify('This character is too large to upload');
      if (dispatch(action)) {
        notify(`${target.name} updated from ${state.fileName}`, 'info');
        close();
      }
      return;
    }
    const character = createCharacterFromPcg(state.build, {
      id: newId(),
      ownerId,
      fileName: state.fileName,
      importedBy: self.id,
      now: Date.now(),
    });
    const action = characterActions.import.create({ character });
    if (JSON.stringify(action).length > MAX_PAYLOAD_CHARS) return notify('This character is too large to upload');
    if (dispatch(action)) {
      useCharactersUi.setState({ selectedId: character.id });
      notify(`Imported ${character.name}`, 'info');
      close();
    }
  }

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal import-modal">
        <div className="inspector-header">
          <strong>
            {isReimport ? `Re-import ${target?.name ?? 'character'}` : `Import ${buildName(state.build)}`}
            <span className="muted small-text"> · {state.fileName}</span>
          </strong>
          <button type="button" className="icon-button" onClick={close} title="Cancel">
            ×
          </button>
        </div>

        {targetMissing ? (
          <p className="muted">This character was deleted or is no longer accessible.</p>
        ) : isReimport ? (
          <>
            <ReimportChanges changes={changes ?? []} />
            <label className="checkbox-row" title="Your VTT inventory (items, slots, loadouts, coins) is kept by default, since it changes in play">
              <input type="checkbox" checked={replaceInventory} onChange={(e) => setReplaceInventory(e.target.checked)} /> Replace the inventory with
              this file’s gear and money (discards changes made here)
            </label>
          </>
        ) : (
          <div className="field">
            <label>Played by</label>
            {gm ? (
              <select value={ownerId ?? ''} onChange={(e) => setOwnerId(e.target.value || null)}>
                <option value="">GM (NPC)</option>
                {players.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            ) : (
              <span>You</span>
            )}
          </div>
        )}

        {!targetMissing && <CharacterSummary build={state.build} compact={isReimport} />}

        <div className="button-row modal-actions">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={save} disabled={targetMissing}>
            {isReimport ? 'Apply update' : 'Import character'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReimportChanges({ changes }: { changes: BuildChange[] }) {
  const bySection = useMemo(() => {
    const m = new Map<string, BuildChange[]>();
    for (const c of changes) m.set(c.section, [...(m.get(c.section) ?? []), c]);
    return [...m.entries()];
  }, [changes]);
  return (
    <div className="reimport-diff">
      <p className="small-text">
        Kept as-is: who plays it, its token link, party sharing, a name you changed here, the inventory, and table state such as
        current HP and spent uses.
      </p>
      {changes.length === 0 ? (
        <p className="muted">No differences in the build data.</p>
      ) : (
        bySection.map(([section, items]) => (
          <div key={section} className="diff-section">
            <div className="field-label">{section}</div>
            <ul>
              {items.map((c, i) => (
                <li key={i} className={`diff-${c.kind}`}>
                  {c.kind === 'added' ? '+ ' : c.kind === 'removed' ? '− ' : '~ '}
                  {c.text}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}
