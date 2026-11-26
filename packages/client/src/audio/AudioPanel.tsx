import { useMemo } from 'react';
import { audioActions, newId, type AudioTrack } from '@vtt/shared';
import { ImageUploadButton } from '../components/fields';
import { uploadAsset } from '../lib/assets';
import { dispatch } from '../state/dispatch';
import { useGame, useIsGm } from '../state/hooks';
import { notify } from '../state/notifications';
import { useUi } from '../state/uiStore';

const AUDIO_TYPES = 'audio/mpeg,audio/ogg,audio/wav,audio/webm,audio/mp4,audio/x-m4a,audio/aac,audio/flac,.mp3,.ogg,.wav,.m4a,.flac';

export function AudioPanel() {
  const tracks = useGame((s) => s.audio);
  const gm = useIsGm();
  const master = useUi((s) => s.masterVolume);
  const setMaster = useUi((s) => s.setMasterVolume);
  const list = useMemo(() => Object.values(tracks).sort((a, b) => a.createdAt - b.createdAt), [tracks]);
  const nowPlaying = list.filter((t) => t.startedAt !== null);

  async function addFile(file: File) {
    try {
      const url = await uploadAsset(file);
      dispatch(
        audioActions.add.create({
          track: {
            id: newId(),
            name: file.name.replace(/\.[^.]+$/, '').slice(0, 80) || 'Track',
            url,
            volume: 0.8,
            loop: true,
            startedAt: null,
            createdAt: Date.now(),
          },
        }),
      );
    } catch (e) {
      notify(`${file.name}: ${(e as Error).message}`);
    }
  }

  return (
    <div className="panel-scroll">
      <section>
        <h3>Your volume</h3>
        <label className="inline-control volume">
          🔈
          <input type="range" min={0} max={1} step={0.05} value={master} onChange={(e) => setMaster(Number(e.target.value))} />
          {Math.round(master * 100)}%
        </label>
        <p className="muted small-text">
          {nowPlaying.length ? `Now playing: ${nowPlaying.map((t) => t.name).join(', ')}` : 'Nothing playing.'}
        </p>
      </section>
      {gm && (
        <section>
          <div className="section-header">
            <h3>Jukebox</h3>
            <div className="button-row compact">
              {nowPlaying.length > 0 && (
                <button type="button" className="small" onClick={() => dispatch(audioActions.stop.create({}))}>
                  Stop all
                </button>
              )}
              <ImageUploadButton label="+ Upload" accept={AUDIO_TYPES} multiple onFile={addFile} />
            </div>
          </div>
          {list.length === 0 && <p className="muted">Upload music or ambience (mp3, ogg, wav, m4a). Several tracks can play at once.</p>}
          <ul className="track-list">
            {list.map((t) => (
              <TrackRow key={t.id} track={t} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function TrackRow({ track: t }: { track: AudioTrack }) {
  const playing = t.startedAt !== null;
  const update = (changes: Parameters<typeof audioActions.update.create>[0]['changes']) =>
    dispatch(audioActions.update.create({ id: t.id, changes }));
  return (
    <li className={playing ? 'playing' : ''}>
      <button
        type="button"
        className="icon-button"
        title={playing ? 'Stop' : 'Play for everyone'}
        onClick={() => dispatch(playing ? audioActions.stop.create({ id: t.id }) : audioActions.play.create({ id: t.id }))}
      >
        {playing ? '■' : '▶'}
      </button>
      <span className="track-name" title={t.name}>
        {t.name}
      </span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={t.volume}
        title="Track volume (for everyone)"
        onChange={(e) => update({ volume: Number(e.target.value) })}
      />
      <button type="button" className={`icon-button${t.loop ? ' on' : ''}`} title={t.loop ? 'Looping' : 'Plays once'} onClick={() => update({ loop: !t.loop })}>
        ⟳
      </button>
      <button type="button" className="icon-button" title="Delete" onClick={() => confirm(`Delete "${t.name}"?`) && dispatch(audioActions.remove.create({ id: t.id }))}>
        ×
      </button>
    </li>
  );
}
