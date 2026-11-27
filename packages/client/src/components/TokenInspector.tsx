import { useMemo, useState } from 'react';
import { BookOpen, ChevronDown, ChevronUp, Maximize2, X } from 'lucide-react';
import { canControlToken, isGm, tokenActions, type Token } from '@vtt/shared';
import { uploadAsset } from '../lib/assets';
import { characterForToken, openCharacterSheet } from '../lib/tokens';
import { hpColor } from '../config/conditions';
import { confirmDialog } from '../state/dialogs';
import { dispatch } from '../state/dispatch';
import { useGame, useSelf } from '../state/hooks';
import { notify } from '../state/notifications';
import { useUi } from '../state/uiStore';
import { addSelectedToCombat } from '../panels/CombatPanel';
import { CheckboxField, ColorField, ImageUploadButton, NumberField, TextField } from './fields';
import { ConditionsEditor, HpEditor, VisionEditor } from './TokenStatusEditors';
import { CharacterLinkField } from '../characters/CharacterLinkField';

/** Floating editor for the single selected token. */
export function TokenInspector() {
  const selected = useUi((s) => s.selectedTokenIds);
  const token = useGame((s) => (selected.length === 1 ? s.tokens[selected[0]!] : undefined));
  const self = useSelf();
  if (!token || !canControlToken(self, token)) return null;
  return <Inspector key={token.id} token={token} />;
}

function Inspector({ token }: { token: Token }) {
  const self = useSelf();
  const users = useGame((s) => s.users);
  const gm = isGm(self);
  const characters = useGame((s) => s.characters);
  const linked = useMemo(() => characterForToken({ characters }, token.id), [characters, token.id]);
  const collapsed = useUi((s) => s.inspectorCollapsed);
  const setCollapsed = useUi((s) => s.setInspectorCollapsed);
  const [conditionsOpen, setConditionsOpen] = useState(token.conditions.length > 0);
  const players = useMemo(() => Object.values(users).filter((u) => u.role !== 'gm'), [users]);

  const update = (changes: Parameters<typeof tokenActions.update.create>[0]['changes']) =>
    dispatch(tokenActions.update.create({ id: token.id, changes }));

  function toggleOwner(userId: string, owned: boolean) {
    const ownerIds = owned ? [...token.ownerIds, userId] : token.ownerIds.filter((id) => id !== userId);
    update({ ownerIds });
  }

  async function deleteToken() {
    const ok = await confirmDialog({
      title: 'Remove token?',
      message: `Remove "${token.name || 'Token'}" from the scene?`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    if (dispatch(tokenActions.remove.create({ id: token.id }))) useUi.getState().clearSelection();
  }

  const hp = token.hp;
  const header = (
    <div className="inspector-header">
      <strong className="inspector-title" title={token.name || 'Token'}>
        {token.name || 'Token'}
      </strong>
      {collapsed && hp && (
        <span className="inspector-hp-badge tnum" style={{ color: hpColor(hp.value, hp.max) }} title={`${hp.value} / ${hp.max} HP${hp.temp ? ` (+${hp.temp} temp)` : ''}`}>
          {hp.value}/{hp.max}
          {hp.temp ? <span className="temp-hp">+{hp.temp}</span> : null}
        </span>
      )}
      <div className="inspector-header-actions">
        {linked && (
          <>
            <button type="button" className="icon-button" title={`Open ${linked.name}'s sheet`} aria-label="Open character sheet" onClick={() => openCharacterSheet(linked.id)}>
              <BookOpen size={14} />
            </button>
            <button
              type="button"
              className="icon-button"
              title={`Expand ${linked.name}'s sheet`}
              aria-label="Expand character sheet"
              onClick={() => openCharacterSheet(linked.id, { popout: true })}
            >
              <Maximize2 size={14} />
            </button>
          </>
        )}
        <button
          type="button"
          className="icon-button"
          title={collapsed ? 'Expand inspector' : 'Collapse inspector'}
          aria-label={collapsed ? 'Expand inspector' : 'Collapse inspector'}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
        </button>
        <button type="button" className="icon-button" onClick={() => useUi.getState().clearSelection()} title="Deselect (Esc)" aria-label="Close inspector">
          <X size={15} />
        </button>
      </div>
    </div>
  );

  if (collapsed) return <div className="inspector collapsed">{header}</div>;

  return (
    <div className="inspector">
      {header}
      <TextField label="Name" value={token.name} onCommit={(name) => update({ name })} />
      <div className="field-row">
        <ColorField label="Color" value={token.color} onCommit={(color) => update({ color })} />
        <NumberField label="Size" value={token.size} min={0.25} max={20} step={0.5} onCommit={(size) => update({ size })} />
      </div>
      <div className="button-row">
        <ImageUploadButton
          label={token.imageUrl ? 'Replace image' : 'Set image'}
          onFile={async (file) => {
            try {
              update({ imageUrl: await uploadAsset(file) });
            } catch (e) {
              notify((e as Error).message);
            }
          }}
        />
        {token.imageUrl && (
          <button type="button" onClick={() => update({ imageUrl: null })}>
            Clear image
          </button>
        )}
      </div>
      <CheckboxField label="Show name" value={token.showName} onCommit={(showName) => update({ showName })} />
      <CharacterLinkField token={token} />
      <details className="inspector-section" open>
        <summary>Hit points</summary>
        <HpEditor token={token} />
      </details>
      <details className="inspector-section" open={conditionsOpen} onToggle={(e) => setConditionsOpen(e.currentTarget.open)}>
        <summary>Conditions{token.conditions.length ? ` (${token.conditions.length})` : ''}</summary>
        <ConditionsEditor token={token} />
      </details>
      <details className="inspector-section">
        <summary>Vision &amp; light</summary>
        <VisionEditor token={token} />
      </details>
      {gm && (
        <>
          <CheckboxField label="Hidden from players" value={token.hidden} onCommit={(hidden) => update({ hidden })} />
          {players.length > 0 && (
            <fieldset className="owners">
              <legend>Controlled by</legend>
              {players.map((u) => (
                <CheckboxField
                  key={u.id}
                  label={u.name}
                  value={token.ownerIds.includes(u.id)}
                  onCommit={(owned) => toggleOwner(u.id, owned)}
                />
              ))}
            </fieldset>
          )}
        </>
      )}
      <div className="button-row">
        <button type="button" onClick={addSelectedToCombat}>
          Add to combat
        </button>
        <button type="button" className="danger" onClick={() => void deleteToken()}>
          Delete token
        </button>
      </div>
    </div>
  );
}
