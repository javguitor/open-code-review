/** sessionStorage key where the workbench leaves a chat prefill for the round page. */
export function chatPrefillKey(sessionId: string, round: number): string {
  return `ocr.chat.prefill.${sessionId}.${round}`
}

type StorageLike = Pick<Storage, 'getItem' | 'removeItem'>

/** Reads and removes the prefill. Storage can throw (private mode, blocked) — that just means no prefill. */
export function takeChatPrefill(storage: StorageLike | undefined, sessionId: string, round: number): string | null {
  if (!storage) return null
  try {
    const key = chatPrefillKey(sessionId, round)
    const value = storage.getItem(key)
    if (value === null) return null
    storage.removeItem(key)
    return value.trim() ? value : null
  } catch {
    return null
  }
}
