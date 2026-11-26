import { useState, type FormEvent } from 'react';
import { newId, RoomIdSchema, UserNameSchema } from '@vtt/shared';
import { joinRoom, useSession } from '../state/session';

const PROFILE_KEY = 'vtt.profile';

interface Profile {
  userId: string;
  name: string;
  roomId: string;
  asGm: boolean;
}

function loadProfile(): Profile {
  try {
    const saved = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null') as Partial<Profile> | null;
    if (saved?.userId) return { name: '', roomId: 'main', asGm: false, ...saved } as Profile;
  } catch {
    /* ignore */
  }
  return { userId: newId(), name: '', roomId: 'main', asGm: false };
}

function saveProfile(p: Profile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export function JoinScreen() {
  const error = useSession((s) => s.error);
  const [profile, setProfile] = useState(loadProfile);
  const [gmPassword, setGmPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const name = UserNameSchema.safeParse(profile.name);
    if (!name.success) return setFormError('Enter a name (max 40 characters)');
    const roomId = RoomIdSchema.safeParse(profile.roomId.trim().toLowerCase());
    if (!roomId.success) return setFormError(roomId.error.issues[0]?.message ?? 'Invalid room');
    const next = { ...profile, name: name.data, roomId: roomId.data };
    saveProfile(next);
    setFormError(null);
    joinRoom({
      roomId: next.roomId,
      userId: next.userId,
      name: next.name,
      asGm: next.asGm,
      gmPassword: next.asGm && gmPassword ? gmPassword : undefined,
    });
  }

  return (
    <div className="join-screen">
      <form className="join-card" onSubmit={onSubmit}>
        <h1>Tabletop</h1>
        <label>
          Your name
          <input autoFocus value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
        </label>
        <label>
          Room
          <input value={profile.roomId} onChange={(e) => setProfile({ ...profile, roomId: e.target.value })} />
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={profile.asGm} onChange={(e) => setProfile({ ...profile, asGm: e.target.checked })} />
          Join as GM
        </label>
        {profile.asGm && (
          <label>
            GM password <span className="muted">(if the server has one)</span>
            <input type="password" value={gmPassword} onChange={(e) => setGmPassword(e.target.value)} />
          </label>
        )}
        {(formError ?? error) && <p className="error">{formError ?? error}</p>}
        <button type="submit" className="primary">
          Join
        </button>
      </form>
    </div>
  );
}
