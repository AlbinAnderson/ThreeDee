import { create } from 'zustand';
import { newId } from '@vtt/shared';

export interface Toast {
  id: string;
  message: string;
  kind: 'info' | 'error';
}

export const useToasts = create<{ toasts: Toast[] }>(() => ({ toasts: [] }));

export function notify(message: string, kind: Toast['kind'] = 'error') {
  const id = newId();
  useToasts.setState((s) => ({ toasts: [...s.toasts.slice(-4), { id, message, kind }] }));
  setTimeout(() => useToasts.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4000);
}
