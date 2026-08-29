const CHAT_BUSY_EVENT = 'iam-chat-busy-change';

let chatBusyCount = 0;

export function setChatActivityBusy(busy: boolean): void {
  const next = busy ? chatBusyCount + 1 : Math.max(0, chatBusyCount - 1);
  if (next === chatBusyCount) return;
  chatBusyCount = next;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(CHAT_BUSY_EVENT, { detail: { busy: chatBusyCount > 0, count: chatBusyCount } }),
    );
  }
}

export function isChatActivityBusy(): boolean {
  return chatBusyCount > 0;
}

export function subscribeChatActivityBusy(onChange: (busy: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<{ busy?: boolean }>).detail;
    onChange(detail?.busy === true);
  };
  window.addEventListener(CHAT_BUSY_EVENT, handler);
  return () => window.removeEventListener(CHAT_BUSY_EVENT, handler);
}
