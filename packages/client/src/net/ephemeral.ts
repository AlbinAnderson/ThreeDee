import type { EphemeralEvent, UserId } from '@vtt/shared';

type Kind = EphemeralEvent['kind'];
type Handler<K extends Kind> = (from: UserId, event: Extract<EphemeralEvent, { kind: K }>) => void;
type AnyHandler = (from: UserId, event: EphemeralEvent) => void;

const handlers = new Map<Kind, Set<AnyHandler>>();

/** Subscribe to relayed ephemeral events of one kind. Returns an unsubscribe fn. */
export function onEphemeral<K extends Kind>(kind: K, handler: Handler<K>) {
  let set = handlers.get(kind);
  if (!set) handlers.set(kind, (set = new Set()));
  set.add(handler as unknown as AnyHandler);
  return () => {
    set.delete(handler as unknown as AnyHandler);
  };
}

export function emitEphemeral(from: UserId, event: EphemeralEvent) {
  handlers.get(event.kind)?.forEach((h) => h(from, event));
}
