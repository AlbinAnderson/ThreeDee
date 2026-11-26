import { useMemo } from 'react';
import { canManageCharacter, characterActions, type Token } from '@vtt/shared';
import { dispatch } from '../state/dispatch';
import { useGame, useSelf } from '../state/hooks';
import { useUi } from '../state/uiStore';
import { useCharactersUi } from './store';

/** Token inspector: which character this token represents. */
export function CharacterLinkField({ token }: { token: Token }) {
  const self = useSelf();
  const characters = useGame((s) => s.characters);
  const linked = useMemo(() => Object.values(characters).find((c) => c.tokenId === token.id), [characters, token.id]);
  const options = useMemo(
    () => Object.values(characters).filter((c) => canManageCharacter(self, c)).sort((a, b) => a.name.localeCompare(b.name)),
    [characters, self],
  );
  if (!options.length && !linked) return null;

  function change(characterId: string) {
    if (linked && linked.id !== characterId) dispatch(characterActions.linkToken.create({ id: linked.id, tokenId: null }));
    if (characterId) dispatch(characterActions.linkToken.create({ id: characterId, tokenId: token.id }));
  }

  return (
    <div className="field">
      <label>Character</label>
      <div className="field-row">
        <select value={linked?.id ?? ''} onChange={(e) => change(e.target.value)} disabled={!!linked && !canManageCharacter(self, linked)}>
          <option value="">None</option>
          {linked && !options.includes(linked) && <option value={linked.id}>{linked.name}</option>}
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {linked && (
          <button
            type="button"
            className="small"
            title="Open in the Characters panel"
            onClick={() => {
              useCharactersUi.setState({ selectedId: linked.id });
              useUi.getState().setSidebarPanel('characters');
            }}
          >
            Open
          </button>
        )}
      </div>
    </div>
  );
}
