import { useCallback, useEffect, useState } from 'react';
import type { SnapshotInfo } from '@vtt/shared';
import { request } from '../net/rpc';
import { confirmDialog } from '../state/dialogs';
import { notify } from '../state/notifications';

const REASON_LABEL: Record<SnapshotInfo['reason'], string> = {
  auto: 'Automatic',
  manual: 'Saved',
  'pre-restore': 'Before restore',
  import: 'Imported',
};

function relativeTime(ms: number) {
  const diff = Date.now() - ms;
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** GM-only: room snapshots (automatic history and manual save points) with restore. */
export function HistoryPanel() {
  const [snapshots, setSnapshots] = useState<SnapshotInfo[] | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setSnapshots(await request('snapshots.list', {}));
    } catch (e) {
      notify((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function save() {
    void run(async () => {
      await request('snapshots.create', { label: label.trim() || undefined });
      setLabel('');
      notify('Snapshot saved', 'info');
    });
  }

  async function restore(s: SnapshotInfo) {
    const when = new Date(s.createdAt).toLocaleString();
    const ok = await confirmDialog({
      title: 'Restore snapshot?',
      message: `Restore the whole room to ${when}${s.label ? ` ("${s.label}")` : ''}?\n\nEveryone's view resets to that point. The current state is saved first so you can undo this.`,
      confirmLabel: 'Restore',
      danger: true,
    });
    if (!ok) return;
    void run(() => request('snapshots.restore', { id: s.id }));
  }

  return (
    <div className="panel-scroll">
      <section>
        <h3>Save a snapshot</h3>
        <div className="loot-toolbar">
          <input
            placeholder="Label, e.g. Before the dragon"
            value={label}
            maxLength={80}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
          <button type="button" className="primary" disabled={busy} onClick={save}>
            Save
          </button>
        </div>
        <p className="muted small-text">
          The room is also snapshotted automatically (hourly while in use, kept 2 days, then daily for 30 days). Saved
          snapshots are kept forever.
        </p>
      </section>
      <section>
        <div className="section-header">
          <h3>History</h3>
          <button type="button" className="small" disabled={busy} onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
        {snapshots === null && <p className="muted">Loading…</p>}
        {snapshots?.length === 0 && <p className="muted">No snapshots yet.</p>}
        <ul className="snapshot-list">
          {snapshots?.map((s) => (
            <li key={s.id}>
              <div className="snapshot-main">
                <span className="snapshot-title">{s.label ?? REASON_LABEL[s.reason]}</span>
                <span className="muted small-text" title={new Date(s.createdAt).toLocaleString()}>
                  #{s.id} · {relativeTime(s.createdAt)}
                  {s.label && ` · ${REASON_LABEL[s.reason]}`}
                </span>
              </div>
              <button type="button" className="small" disabled={busy} onClick={() => restore(s)}>
                Restore
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
