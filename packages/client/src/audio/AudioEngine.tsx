import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import type { AudioTrack } from '@vtt/shared';
import { serverNow } from '../state/gameStore';
import { useGame } from '../state/hooks';
import { useUi } from '../state/uiStore';

/** Set when the browser blocked autoplay; a click on the banner unlocks it. */
export const useAudioBlocked = create<{ blocked: boolean }>(() => ({ blocked: false }));

interface Playing {
  el: HTMLAudioElement;
  startedAt: number;
}

/**
 * Plays whatever the GM has started, seeked to where it should be now.
 * Renders nothing except an "enable audio" banner when autoplay is blocked.
 */
export function AudioEngine() {
  const tracks = useGame((s) => s.audio);
  const master = useUi((s) => s.masterVolume);
  const blocked = useAudioBlocked((s) => s.blocked);
  const playing = useRef(new Map<string, Playing>());
  const [, force] = useState(0);

  useEffect(() => {
    const map = playing.current;
    const wanted = new Map(Object.values(tracks).filter((t) => t.startedAt !== null).map((t) => [t.id, t]));

    // Stop tracks that were stopped, deleted, or restarted.
    for (const [id, p] of map) {
      const t = wanted.get(id);
      if (!t || t.startedAt !== p.startedAt) {
        p.el.pause();
        p.el.src = '';
        map.delete(id);
      }
    }
    // Start new ones; keep volume/loop of running ones in sync.
    for (const t of wanted.values()) {
      const p = map.get(t.id);
      if (p) {
        p.el.volume = t.volume * master;
        p.el.loop = t.loop;
        continue;
      }
      map.set(t.id, { el: start(t, master), startedAt: t.startedAt! });
    }
  }, [tracks, master]);

  // Stop everything when leaving the room.
  useEffect(() => {
    const map = playing.current;
    return () => {
      for (const p of map.values()) {
        p.el.pause();
        p.el.src = '';
      }
      map.clear();
    };
  }, []);

  if (!blocked) return null;
  return (
    <button
      type="button"
      className="audio-unlock"
      onClick={() => {
        useAudioBlocked.setState({ blocked: false });
        for (const p of playing.current.values()) void p.el.play().catch(() => useAudioBlocked.setState({ blocked: true }));
        force((n) => n + 1);
      }}
    >
      🔇 The GM is playing audio. Click to listen.
    </button>
  );
}

function start(t: AudioTrack, master: number): HTMLAudioElement {
  const el = new Audio(t.url);
  el.loop = t.loop;
  el.volume = t.volume * master;
  el.preload = 'auto';
  el.addEventListener(
    'loadedmetadata',
    () => {
      const elapsed = Math.max(0, (serverNow() - (t.startedAt ?? 0)) / 1000);
      const d = el.duration;
      if (Number.isFinite(d) && d > 0) {
        if (t.loop) el.currentTime = elapsed % d;
        else if (elapsed < d) el.currentTime = elapsed;
        else return; // already finished
      }
      el.play().catch((e: Error) => {
        if (e.name === 'NotAllowedError') useAudioBlocked.setState({ blocked: true });
      });
    },
    { once: true },
  );
  return el;
}
