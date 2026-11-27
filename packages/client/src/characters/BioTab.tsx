/**
 * Bio tab (Epic 10): portrait (with "Use as token image"), appearance and
 * personality, background, GM-only notes, the notes tree, the chronicle log,
 * JSON export and the PCGen XML compare.
 */
import { useMemo, useRef, useState } from 'react';
import { Download, FileCode2, ImageUp, Info, Lock, UserRound, X } from 'lucide-react';
import {
  BIO_FIELD_KEYS,
  BIO_FIELD_MAX,
  BIO_TEXT_MAX,
  canControlToken,
  canManageCharacter,
  characterBioActions,
  comparePcgenXml,
  computeCharacterStats,
  computeSkills,
  exportCharacter,
  isGm,
  isLocalPortraitPath,
  parseBaseXml,
  tokenActions,
  type BioFieldKey,
  type Character,
  type PcgenXmlSummary,
} from '@vtt/shared';
import { ImageUploadButton, TextAreaField, TextField } from '../components/fields';
import { InfoTip } from '../components/InfoTip';
import { uploadAsset } from '../lib/assets';
import { dateStamp, downloadText } from '../lib/download';
import { dispatch } from '../state/dispatch';
import { useGame, useSelf } from '../state/hooks';
import { notify } from '../state/notifications';
import { ChronicleLog } from './ChronicleLog';
import { NotesTree } from './NotesTree';

const FIELD_LABELS: Record<BioFieldKey, string> = {
  gender: 'Gender',
  age: 'Age',
  height: 'Height',
  weight: 'Weight',
  eyes: 'Eyes',
  hair: 'Hair',
  skin: 'Skin',
  handedness: 'Handedness',
  deity: 'Deity',
  homeland: 'Homeland / region',
  birthplace: 'Birthplace',
  birthday: 'Birthday',
  location: 'Residence',
  traits: 'Personality traits',
  speechPattern: 'Speech pattern',
  phobias: 'Phobias',
  interests: 'Interests',
  catchPhrase: 'Catchphrase',
};
const WIDE_FIELDS = new Set<BioFieldKey>(['traits', 'speechPattern', 'phobias', 'interests', 'catchPhrase']);
const MAX_XML_BYTES = 4 * 1024 * 1024;

function updateBio(c: Character, changes: Parameters<typeof characterBioActions.updateBio.create>[0]['changes']) {
  return dispatch(characterBioActions.updateBio.create({ id: c.id, changes }));
}

export function BioTab({ character: c }: { character: Character }) {
  const self = useSelf();
  const gm = isGm(self);
  const manage = canManageCharacter(self, c);
  const bio = c.bio;
  const shortFields = BIO_FIELD_KEYS.filter((k) => !WIDE_FIELDS.has(k));
  const longFields = BIO_FIELD_KEYS.filter((k) => WIDE_FIELDS.has(k));
  const anyField = BIO_FIELD_KEYS.some((k) => bio.fields[k]);

  return (
    <div className="bio-tab">
      <PortraitCard character={c} manage={manage} />

      <section className="bio-section">
        <h3>Appearance &amp; personality</h3>
        {!manage && !anyField ? (
          <p className="muted small-text">Nothing filled in.</p>
        ) : (
          <>
            <div className="bio-grid">
              {shortFields.map((k) => (
                <BioField key={k} c={c} k={k} manage={manage} />
              ))}
            </div>
            {longFields.map((k) => (
              <BioField key={k} c={c} k={k} manage={manage} />
            ))}
          </>
        )}
        <LongText c={c} manage={manage} label="Description" field="description" placeholder="What others see: build, clothes, scars, mannerisms…" />
        <LongText c={c} manage={manage} label="Background" field="biography" placeholder="Where they came from and why they adventure…" />
      </section>

      {gm && (
        <section className="bio-section gm-only">
          <h3>
            <Lock size={12} /> GM notes
            <InfoTip title="GM notes" body="Only GMs can see these. They are never sent to players, not even the character’s owner.">
              <span className="muted small-text" tabIndex={0} style={{ display: 'inline-flex', alignItems: 'center' }}>
                <Info size={12} />
              </span>
            </InfoTip>
          </h3>
          <TextAreaField
            label="Only visible to GMs"
            value={bio.dmNotes}
            rows={4}
            placeholder="Secrets, plot hooks, true motives…"
            onCommit={(text) => dispatch(characterBioActions.setDmNotes.create({ id: c.id, text: text.slice(0, BIO_TEXT_MAX) }))}
          />
        </section>
      )}

      <NotesTree character={c} manage={manage} />
      <ChronicleLog character={c} manage={manage} />
      <ExportSection character={c} gm={gm} />
    </div>
  );
}

function BioField({ c, k, manage }: { c: Character; k: BioFieldKey; manage: boolean }) {
  const value = c.bio.fields[k];
  if (!manage) {
    return value ? (
      <div className="field">
        <label>{FIELD_LABELS[k]}</label>
        <span>{value}</span>
      </div>
    ) : null;
  }
  return <TextField label={FIELD_LABELS[k]} value={value} onCommit={(v) => updateBio(c, { fields: { [k]: v.trim().slice(0, BIO_FIELD_MAX) } })} />;
}

function LongText({ c, manage, label, field, placeholder }: { c: Character; manage: boolean; label: string; field: 'description' | 'biography'; placeholder: string }) {
  const value = c.bio[field];
  if (!manage) {
    return value ? (
      <div className="field">
        <label>{label}</label>
        <div className="bio-prose">{value}</div>
      </div>
    ) : null;
  }
  return <TextAreaField label={label} value={value} rows={4} placeholder={placeholder} onCommit={(v) => updateBio(c, { [field]: v.slice(0, BIO_TEXT_MAX) })} />;
}

function PortraitCard({ character: c, manage }: { character: Character; manage: boolean }) {
  const self = useSelf();
  const token = useGame((s) => (c.tokenId ? s.tokens[c.tokenId] : undefined));
  const url = c.bio.portraitUrl;
  const localPath = !url && isLocalPortraitPath(c.bio.pcgPortrait);
  const canSetToken = !!url && !!token && canControlToken(self, token);
  const tokenHasIt = !!token && token.imageUrl === url;

  return (
    <section className="bio-portrait">
      <div className="portrait-frame">{url ? <img src={url} alt={`${c.name} portrait`} /> : <UserRound size={44} strokeWidth={1.2} />}</div>
      <div className="portrait-side">
        {manage && (
          <div className="button-row">
            <ImageUploadButton
              label={url ? 'Replace portrait' : 'Upload portrait'}
              onFile={async (file) => {
                try {
                  updateBio(c, { portraitUrl: await uploadAsset(file) });
                } catch (e) {
                  notify((e as Error).message);
                }
              }}
            />
            {url && (
              <button type="button" className="small" title="Remove portrait" onClick={() => updateBio(c, { portraitUrl: null })}>
                <X size={12} /> Remove
              </button>
            )}
          </div>
        )}
        {canSetToken && (
          <button
            type="button"
            className="small gold"
            disabled={tokenHasIt}
            title={tokenHasIt ? 'The linked token already uses this portrait' : `Set ${token!.name || 'the token'}’s image to this portrait`}
            onClick={() => dispatch(tokenActions.update.create({ id: token!.id, changes: { imageUrl: url } }))}
          >
            <ImageUp size={12} /> {tokenHasIt ? 'Token uses this image' : 'Use as token image'}
          </button>
        )}
        {localPath && (
          <p className="muted small-text portrait-note">
            PCGen portrait: <code title={c.bio.pcgPortrait ?? ''}>{c.bio.pcgPortrait}</code>. That’s a file on the PCGen computer, which the browser can’t read
            {manage ? ': upload the image here to use it.' : '.'}
          </p>
        )}
      </div>
    </section>
  );
}

function ExportSection({ character: c, gm }: { character: Character; gm: boolean }) {
  const [summary, setSummary] = useState<{ key: number; fileName: string; data: PcgenXmlSummary } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  function downloadJson() {
    const doc = exportCharacter(c, { includeDmNotes: gm, now: Date.now() });
    const slug = c.name.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'character';
    downloadText(`${slug}-${dateStamp()}.json`, 'application/json', JSON.stringify(doc, null, 2));
  }

  async function openXml(file: File) {
    if (file.size > MAX_XML_BYTES) return notify(`${file.name} is too large`);
    try {
      setSummary({ key: Date.now(), fileName: file.name, data: parseBaseXml(await file.text()) });
    } catch (e) {
      notify(`Could not read ${file.name}: ${(e as Error).message}`);
    }
  }

  return (
    <section className="bio-section">
      <h3>Export &amp; PCGen check</h3>
      <div className="button-row">
        <button type="button" className="small" onClick={downloadJson} title={gm ? 'Includes GM notes' : 'Everything you can see on this character'}>
          <Download size={12} /> Download JSON
        </button>
        <button type="button" className="small" onClick={() => input.current?.click()} title="Compare with numbers from PCGen’s XML export (File → Export, base.xml)">
          <FileCode2 size={12} /> Compare PCGen XML…
        </button>
        <input
          ref={input}
          type="file"
          accept=".xml,text/xml,application/xml"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void openXml(file);
          }}
        />
      </div>
      {summary && <XmlCompare key={summary.key} character={c} fileName={summary.fileName} summary={summary.data} onClose={() => setSummary(null)} />}
    </section>
  );
}

function XmlCompare({ character: c, fileName, summary, onClose }: { character: Character; fileName: string; summary: PcgenXmlSummary; onClose: () => void }) {
  const rows = useMemo(() => {
    const stats = computeCharacterStats(c);
    const skills = new Map(computeSkills(c, stats).rows.map((r) => [r.name, r.total.total]));
    return comparePcgenXml(summary, stats, skills);
  }, [c, summary]);
  const mismatches = rows.filter((r) => !r.match).length;
  const [onlyDiff, setOnlyDiff] = useState(mismatches > 0);
  const shown = onlyDiff ? rows.filter((r) => !r.match) : rows;

  return (
    <div className="xml-compare">
      <div className="section-header">
        <strong className="small-text">
          {summary.name || 'PCGen export'} <span className="muted">· {fileName}</span>
        </strong>
        <button type="button" className="icon-button" aria-label="Close comparison" onClick={onClose}>
          <X size={13} />
        </button>
      </div>
      {summary.name && summary.name !== c.build.bio.name && <p className="warn-text small-text">This export is for “{summary.name}”, not {c.name}.</p>}
      <p className="small-text">
        {rows.length === 0 ? 'No comparable numbers in this file.' : mismatches === 0 ? `All ${rows.length} numbers match PCGen.` : `${mismatches} of ${rows.length} numbers differ from PCGen.`}
      </p>
      {rows.length > 0 && (
        <>
          <label className="checkbox-row small-text">
            <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> Only show differences
          </label>
          <table className="xml-compare-table tnum">
            <thead>
              <tr>
                <th />
                <th>PCGen</th>
                <th>VTT</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={`${r.label}|${i}`} className={r.match ? undefined : 'diff'}>
                  <td>{r.label}</td>
                  <td>{r.pcgen}</td>
                  <td>{r.vtt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {summary.attacks.length > 0 && (
        <details className="inspector-section">
          <summary>PCGen attacks ({summary.attacks.length})</summary>
          <ul className="small-text">
            {summary.attacks.map((a, i) => (
              <li key={`${a.name}|${i}`}>
                <strong>{a.name}</strong> {a.toHit} · {a.damage}
                {a.critical ? ` · ${a.critical}` : ''}
                {a.range ? ` · ${a.range}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
      {summary.spells.length > 0 && (
        <details className="inspector-section">
          <summary>PCGen known spells</summary>
          {summary.spells.map((s) => (
            <div key={s.className} className="small-text">
              <strong>
                {s.className}
                {s.casterLevel !== null ? ` (CL ${s.casterLevel})` : ''}
              </strong>
              {s.levels.map((l) => (
                <div key={l.level}>
                  {l.level}: {l.spells.join(', ')}
                </div>
              ))}
            </div>
          ))}
        </details>
      )}
      <p className="muted small-text">The VTT doesn’t change anything from this file. Fix differences in Sheet settings or the skill/inventory tabs.</p>
    </div>
  );
}
