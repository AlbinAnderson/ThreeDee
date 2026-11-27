/**
 * Imperative dark-mode Confirm & Prompt dialogs (replaces native browser confirm/prompt).
 */
import { create } from 'zustand';

export interface ConfirmRequest {
  kind: 'confirm';
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
}

export interface PromptRequest {
  kind: 'prompt';
  title: string;
  message?: string;
  label?: string;
  defaultValue: string;
  placeholder?: string;
  confirmLabel: string;
  maxLength?: number;
  resolve: (value: string | null) => void;
}

export type DialogRequest = ConfirmRequest | PromptRequest;

export const useDialogStore = create<{ current: DialogRequest | null }>(() => ({ current: null }));

export function confirmDialog(
  opts:
    | string
    | {
        title?: string;
        message: string;
        confirmLabel?: string;
        cancelLabel?: string;
        danger?: boolean;
      },
): Promise<boolean> {
  const cfg = typeof opts === 'string' ? { message: opts } : opts;
  return new Promise((resolve) => {
    // Dismiss any stale pending dialog safely
    const prev = useDialogStore.getState().current;
    if (prev) prev.kind === 'confirm' ? prev.resolve(false) : prev.resolve(null);
    useDialogStore.setState({
      current: {
        kind: 'confirm',
        title: cfg.title ?? 'Confirm',
        message: cfg.message,
        confirmLabel: cfg.confirmLabel ?? 'Confirm',
        cancelLabel: cfg.cancelLabel ?? 'Cancel',
        danger: cfg.danger ?? false,
        resolve,
      },
    });
  });
}

export function promptDialog(opts: {
  title: string;
  message?: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  maxLength?: number;
}): Promise<string | null> {
  return new Promise((resolve) => {
    const prev = useDialogStore.getState().current;
    if (prev) prev.kind === 'confirm' ? prev.resolve(false) : prev.resolve(null);
    useDialogStore.setState({
      current: {
        kind: 'prompt',
        title: opts.title,
        message: opts.message,
        label: opts.label,
        defaultValue: opts.defaultValue ?? '',
        placeholder: opts.placeholder,
        confirmLabel: opts.confirmLabel ?? 'Save',
        maxLength: opts.maxLength,
        resolve,
      },
    });
  });
}

export function closeDialog() {
  const cur = useDialogStore.getState().current;
  if (!cur) return;
  useDialogStore.setState({ current: null });
  if (cur.kind === 'confirm') cur.resolve(false);
  else cur.resolve(null);
}
