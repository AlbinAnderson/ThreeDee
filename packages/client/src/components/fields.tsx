/**
 * Small form controls that commit on blur / Enter instead of on every
 * keystroke, so editing a field doesn't flood the server with actions.
 */
import { useEffect, useId, useState, type ReactNode } from 'react';

interface FieldProps<T> {
  label: string;
  value: T;
  onCommit: (value: T) => void;
  disabled?: boolean;
}

function Field({ label, id, children, inline }: { label: string; id: string; children: ReactNode; inline?: boolean }) {
  return (
    <div className={`field${inline ? ' inline' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}

export function TextField({ label, value, onCommit, disabled, placeholder }: FieldProps<string> & { placeholder?: string }) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <Field label={label} id={id}>
      <input
        id={id}
        value={draft}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setDraft(value);
        }}
      />
    </Field>
  );
}

export function NumberField({
  label,
  value,
  onCommit,
  disabled,
  min,
  max,
  step,
}: FieldProps<number> & { min?: number; max?: number; step?: number }) {
  const id = useId();
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    let n = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(n)) return setDraft(String(value));
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    setDraft(String(n));
    if (n !== value) onCommit(n);
  };
  return (
    <Field label={label} id={id}>
      <input
        id={id}
        type="number"
        value={draft}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
    </Field>
  );
}

export function ColorField({ label, value, onCommit, disabled }: FieldProps<string>) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <Field label={label} id={id} inline>
      <input
        id={id}
        type="color"
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        // native color pickers fire change continuously; commit when closed
        onBlur={() => draft !== value && onCommit(draft)}
      />
    </Field>
  );
}

export function CheckboxField({ label, value, onCommit, disabled }: FieldProps<boolean>) {
  const id = useId();
  return (
    <Field label={label} id={id} inline>
      <input id={id} type="checkbox" checked={value} disabled={disabled} onChange={(e) => onCommit(e.target.checked)} />
    </Field>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  onCommit,
  options,
  disabled,
}: FieldProps<T> & { options: { value: T; label: string }[] }) {
  const id = useId();
  return (
    <Field label={label} id={id}>
      <select id={id} value={value} disabled={disabled} onChange={(e) => onCommit(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

const IMAGE_TYPES = 'image/png,image/jpeg,image/webp,image/gif,image/avif';

/** Button that opens a file picker (images by default). `onFile` runs once per chosen file. */
export function ImageUploadButton({
  label,
  onFile,
  disabled,
  accept = IMAGE_TYPES,
  multiple = false,
}: {
  label: string;
  onFile: (file: File) => void | Promise<void>;
  disabled?: boolean;
  accept?: string;
  multiple?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <label className={`button${disabled || busy ? ' disabled' : ''}`}>
      {busy ? 'Uploading…' : label}
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        disabled={disabled || busy}
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (!files.length) return;
          setBusy(true);
          try {
            for (const file of files) await onFile(file);
          } finally {
            setBusy(false);
          }
        }}
      />
    </label>
  );
}

export function TextAreaField({
  label,
  value,
  onCommit,
  disabled,
  placeholder,
  rows = 4,
}: FieldProps<string> & { placeholder?: string; rows?: number }) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <Field label={label} id={id}>
      <textarea
        id={id}
        value={draft}
        rows={rows}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== value && onCommit(draft)}
      />
    </Field>
  );
}

/** A number that may be left blank (null = automatic / not set). */
export function OptionalNumberField({
  label,
  value,
  onCommit,
  disabled,
  min,
  max,
  placeholder,
}: FieldProps<number | null> & { min?: number; max?: number; placeholder?: string }) {
  const id = useId();
  const [draft, setDraft] = useState(value === null ? '' : String(value));
  useEffect(() => setDraft(value === null ? '' : String(value)), [value]);
  const commit = () => {
    if (draft.trim() === '') return value !== null && onCommit(null);
    let n = Math.round(Number(draft));
    if (!Number.isFinite(n)) return setDraft(value === null ? '' : String(value));
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    setDraft(String(n));
    if (n !== value) onCommit(n);
  };
  return (
    <Field label={label} id={id}>
      <input
        id={id}
        type="number"
        value={draft}
        min={min}
        max={max}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
    </Field>
  );
}
