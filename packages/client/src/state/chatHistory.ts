/** Lines you sent in chat this session (newest last), for ArrowUp / ArrowDown recall. Local only. */
export const CHAT_HISTORY_MAX = 30;

let history: string[] = [];

export function getChatHistory(): readonly string[] {
  return history;
}

export function pushChatHistory(line: string) {
  const text = line.trim();
  if (!text) return;
  history = [...history.filter((h) => h !== text), text].slice(-CHAT_HISTORY_MAX);
}

export function resetChatHistory() {
  history = [];
}
