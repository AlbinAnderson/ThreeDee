import { useEffect, useState, type FormEvent } from 'react';
import { closeDialog, useDialogStore, type PromptRequest } from '../state/dialogs';

export function DialogHost() {
  const current = useDialogStore((s) => s.current);

  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeDialog();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [current]);

  if (!current) return null;

  if (current.kind === 'confirm') {
    const finish = (ok: boolean) => {
      useDialogStore.setState({ current: null });
      current.resolve(ok);
    };
    return (
      <div className="modal-backdrop" onClick={() => finish(false)}>
        <div className={`dialog-card${current.danger ? ' danger' : ''}`} role="alertdialog" aria-modal="true" aria-label={current.title} onClick={(e) => e.stopPropagation()}>
          <h2 className="dialog-title">{current.title}</h2>
          <p className="dialog-message">{current.message}</p>
          <div className="dialog-actions">
            <button type="button" onClick={() => finish(false)}>
              {current.cancelLabel}
            </button>
            <button type="button" autoFocus className={current.danger ? 'danger solid' : 'gold'} onClick={() => finish(true)}>
              {current.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <PromptCard key={`${current.title}-${current.defaultValue}`} req={current} />;
}

function PromptCard({ req }: { req: PromptRequest }) {
  const [value, setValue] = useState(req.defaultValue);
  const finish = (result: string | null) => {
    useDialogStore.setState({ current: null });
    req.resolve(result);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    finish(value.trim() ? value : null);
  };
  return (
    <div className="modal-backdrop" onClick={() => finish(null)}>
      <form className="dialog-card" role="dialog" aria-modal="true" aria-label={req.title} onSubmit={submit} onClick={(e) => e.stopPropagation()}>
        <h2 className="dialog-title">{req.title}</h2>
        {req.message && <p className="dialog-message">{req.message}</p>}
        <div className="field">
          {req.label && <label>{req.label}</label>}
          <input
            autoFocus
            value={value}
            placeholder={req.placeholder}
            maxLength={req.maxLength}
            onChange={(e) => setValue(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>
        <div className="dialog-actions">
          <button type="button" onClick={() => finish(null)}>
            Cancel
          </button>
          <button type="submit" className="gold" disabled={!value.trim()}>
            {req.confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
