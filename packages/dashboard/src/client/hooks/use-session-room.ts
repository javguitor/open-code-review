import { useEffect } from 'react'
import { useSocket } from '../providers/socket-provider'

/** Mounted users per room. Module-level: the round page and the workbench share one room. */
const users = new Map<string, number>()

/**
 * Joins the session's socket room while the calling component is mounted.
 * `round:updated` is emitted only to that room, so every page that reacts to it
 * needs this. The room is left when the last mounted user goes away, so
 * navigating between two pages of one session never drops it.
 */
export function useSessionRoom(sessionId: string | undefined): void {
  const { joinRoom, leaveRoom } = useSocket()
  useEffect(() => {
    if (!sessionId) return
    users.set(sessionId, (users.get(sessionId) ?? 0) + 1)
    joinRoom(sessionId)
    return () => {
      const left = (users.get(sessionId) ?? 1) - 1
      if (left > 0) {
        users.set(sessionId, left)
      } else {
        users.delete(sessionId)
        leaveRoom(sessionId)
      }
    }
  }, [sessionId, joinRoom, leaveRoom])
}
