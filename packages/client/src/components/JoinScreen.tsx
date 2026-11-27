import { useState, type FormEvent } from 'react';
import { Dices, Shield } from 'lucide-react';
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
        <div className="join-brand">
          <div className="join-emblem">
            <Dices size={22} strokeWidth={1.9} />
          </div>
          <div>
            <h1>ThreeDee</h1>
            <p>Pathfinder 1e Virtual Tabletop</p>
          </div>
        </div>
        <label>
          Your name
          <input autoFocus placeholder="e.g. Valeros" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
        </label>
        <label>
          Room code
          <input placeholder="main" value={profile.roomId} onChange={(e) => setProfile({ ...profile, roomId: e.target.value })} />
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={profile.asGm} onChange={(e) => setProfile({ ...profile, asGm: e.target.checked })} />
          <Shield size={14} />
          <span>Join as Game Master</span>
        </label>
        {profile.asGm && (
          <label>
            GM password <span className="muted">(if the server has one)</span>
            <input type="password" value={gmPassword} onChange={(e) => setGmPassword(e.target.value)} />
          </label>
        )}
        {(formError ?? error) && <p className="error small-text">{formError ?? error}</p>}
        <button type="submit" className="gold">
          Enter Table
        </button>
      </form>
    </div>
  );
}
