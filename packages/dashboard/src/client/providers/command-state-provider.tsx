/**
 * Global command execution state with multi-tab support.
 *
 * Lives above the router so running-command state (output, tabs, etc.)
 * survives page navigation. Hydrates from GET /api/commands/active on mount
 * and on every socket connect to handle page refreshes and dropped connections mid-command. Supports multiple concurrent
 * commands, each tracked as a separate tab.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useSocket, useSocketEvent } from './socket-provider'
import { fetchApi } from '../lib/utils'
import type { CommandEventsResponse, StreamEvent } from '../lib/api-types'

export type TabStatus = 'running' | 'complete' | 'incomplete' | 'cancelled' | 'failed'

/** Maps the server's CommandOutcome onto the client's TabStatus vocabulary. */
function outcomeToTabStatus(
  outcome: 'success' | 'incomplete' | 'failed' | 'cancelled' | null,
): TabStatus {
  if (outcome === 'success') return 'complete'
  if (outcome === 'incomplete') return 'incomplete'
  if (outcome === 'failed') return 'failed'
  if (outcome === 'cancelled') return 'cancelled'
  return 'running'
}

export type CommandTab = {
  executionId: number
  command: string
  /** Arguments as the server parsed them (absent on tabs created before they were sent). */
  args?: string[]
  /**
   * Legacy human-readable summary stream — populated from the
   * `command:output` socket channel and used by the existing
   * `WorkflowOutput` line-parser. Phase 3's renderer prefers `events`.
   */
  output: string
  /**
   * Typed event stream from the AI CLI adapter. Empty for non-AI
   * commands (utility subcommands like `state` or `progress`) and
   * for AI executions that predate the events feature. The Phase 3
   * `EventStreamRenderer` switches in only when this is non-empty.
   */
  events: StreamEvent[]
  status: TabStatus
  exitCode: number | null
  startedAt: string
}

type ActiveCommandsResponse = {
  running_count: number
  commands: Array<{
    execution_id: number
    command: string
    args?: string[]
    started_at: string
    output: string
  }>
}

type CommandStateContextValue = {
  tabs: CommandTab[]
  activeTabId: number | null
  runningCount: number
  isRunning: boolean
  setActiveTabId: (id: number) => void
  dismissTab: (id: number) => void
  cancelCommand: (executionId: number) => void
}

const CommandStateContext = createContext<CommandStateContextValue | null>(null)

export function CommandStateProvider({ children }: { children: ReactNode }) {
  const [tabMap, setTabMap] = useState<Map<number, CommandTab>>(new Map())
  const [activeTabId, setActiveTabId] = useState<number | null>(null)
  const { socket, isConnected } = useSocket()

  // Derived values
  const tabs = useMemo(() => Array.from(tabMap.values()), [tabMap])
  const runningCount = useMemo(
    () => tabs.filter((t) => t.status === 'running').length,
    [tabs],
  )
  const isRunning = useMemo(() => runningCount > 0, [runningCount])

  // Hydrate from the server on mount and again on every socket (re)connect:
  // events emitted while disconnected (a start, a finish) never arrive, so the
  // server's list of running commands is the truth to merge with.
  const tabMapRef = useRef(tabMap)
  tabMapRef.current = tabMap

  useEffect(() => {
    // Tabs known before the request: one that starts while it is in flight is not "missing" from the snapshot.
    const knownBefore = new Set(tabMapRef.current.keys())
    let cancelled = false

    fetchApi<ActiveCommandsResponse>('/api/commands/active')
      .then((data) => {
        if (cancelled) return
        const serverIds = new Set(data.commands.map((c) => c.execution_id))
        setTabMap((prev) => {
          const next = new Map(prev)
          // A run that ended while we were not listening: outcome unknown.
          for (const [id, tab] of prev) {
            if (tab.status === 'running' && knownBefore.has(id) && !serverIds.has(id)) {
              next.set(id, { ...tab, status: 'incomplete' })
            }
          }
          for (const cmd of data.commands) {
            const existing = next.get(cmd.execution_id)
            next.set(cmd.execution_id, {
              executionId: cmd.execution_id,
              command: cmd.command,
              args: cmd.args,
              output: existing?.output ?? cmd.output ?? '',
              events: existing?.events ?? [],
              status: 'running',
              exitCode: null,
              startedAt: cmd.started_at,
            })
          }
          return next
        })
        const lastCmd = data.commands[data.commands.length - 1]
        if (lastCmd) setActiveTabId((current) => current ?? lastCmd.execution_id)

        // Rehydrate the typed event stream for each running execution —
        // the live socket subscription only sees events from now forward,
        // and a page reload mid-run would otherwise show a partial
        // timeline. Errors are non-fatal: empty `events` falls back to
        // the legacy line-parser rendering.
        for (const cmd of data.commands) {
          fetchApi<CommandEventsResponse>(`/api/commands/${cmd.execution_id}/events`)
            .then((eventsResp) => {
              if (cancelled || !eventsResp.events || eventsResp.events.length === 0) return
              setTabMap((prev) => {
                const existing = prev.get(cmd.execution_id)
                if (!existing) return prev
                // Don't clobber events received via the live socket while
                // we were fetching — append-with-dedup by seq.
                const seenSeqs = new Set(existing.events.map((e) => e.seq))
                const merged = [...existing.events]
                for (const evt of eventsResp.events) {
                  if (!seenSeqs.has(evt.seq)) merged.push(evt)
                }
                merged.sort((a, b) => a.seq - b.seq)
                const next = new Map(prev)
                next.set(cmd.execution_id, { ...existing, events: merged })
                return next
              })
            })
            .catch(() => {
              /* non-fatal — falls back to legacy rendering */
            })
        }
      })
      .catch(() => {
        // Non-fatal -- if hydration fails we keep whatever state we have
      })
    return () => {
      cancelled = true
    }
  }, [isConnected])

  // Socket listeners -- always active regardless of which page is mounted
  useSocketEvent<{ execution_id: number; command: string; args?: string[]; started_at: string }>(
    'command:started',
    (data) => {
      const tab: CommandTab = {
        executionId: data.execution_id,
        command: data.command,
        args: data.args,
        output: '',
        events: [],
        status: 'running',
        exitCode: null,
        startedAt: data.started_at,
      }

      setTabMap((prev) => {
        const next = new Map(prev)
        next.set(data.execution_id, tab)
        return next
      })
      setActiveTabId(data.execution_id)
    },
  )

  useSocketEvent<{ execution_id: number; content: string }>(
    'command:output',
    (data) => {
      setTabMap((prev) => {
        const existing = prev.get(data.execution_id)
        if (!existing) return prev

        const next = new Map(prev)
        next.set(data.execution_id, {
          ...existing,
          output: existing.output + data.content,
        })
        return next
      })
    },
  )

  // Live typed event stream from command-runner. The payload's `executionId`
  // (camelCase) is set by command-runner — distinct from the snake_case
  // `execution_id` used by the legacy channels.
  useSocketEvent<StreamEvent>('command:event', (evt) => {
    setTabMap((prev) => {
      const existing = prev.get(evt.executionId)
      if (!existing) return prev
      // Drop duplicate seqs that may arrive if the socket reconnects mid-flight.
      if (existing.events.some((e) => e.seq === evt.seq)) return prev
      const next = new Map(prev)
      next.set(evt.executionId, {
        ...existing,
        events: [...existing.events, evt],
      })
      return next
    })
  })

  useSocketEvent<{
    execution_id: number
    exitCode: number
    /**
     * Server-derived from (exit_code, linked workflow.status). Distinguishes
     * a cleanly-finished workflow from one whose parent process exited 0
     * mid-flight (macOS-sleep / network-drop). May be absent on rows from
     * older server builds — fall back to the exit-code-only mapping.
     */
    outcome?: 'success' | 'incomplete' | 'failed' | 'cancelled' | null
  }>('command:finished', (data) => {
    setTabMap((prev) => {
      const existing = prev.get(data.execution_id)
      if (!existing) return prev

      const next = new Map(prev)
      const status: TabStatus = data.outcome
        ? outcomeToTabStatus(data.outcome)
        : data.exitCode === -2
          ? 'cancelled'
          : data.exitCode === 0
            ? 'complete'
            : 'failed'

      next.set(data.execution_id, {
        ...existing,
        status,
        exitCode: data.exitCode,
      })
      return next
    })
  })

  // Actions
  const dismissTab = useCallback(
    (id: number) => {
      setTabMap((prev) => {
        const next = new Map(prev)
        next.delete(id)

        // Compute the next active tab from the updated map (not a stale closure)
        setActiveTabId((prevActive) => {
          if (prevActive !== id) return prevActive
          const remaining = Array.from(next.keys())
          return remaining.length > 0 ? remaining[remaining.length - 1]! : null
        })

        return next
      })
    },
    [],
  )

  const cancelCommand = useCallback(
    (executionId: number) => {
      socket?.emit('command:cancel', { execution_id: executionId })
    },
    [socket],
  )

  const value = useMemo<CommandStateContextValue>(
    () => ({
      tabs,
      activeTabId,
      runningCount,
      isRunning,
      setActiveTabId,
      dismissTab,
      cancelCommand,
    }),
    [tabs, activeTabId, runningCount, isRunning, dismissTab, cancelCommand],
  )

  return (
    <CommandStateContext value={value}>
      {children}
    </CommandStateContext>
  )
}

export function useCommandState(): CommandStateContextValue {
  const ctx = useContext(CommandStateContext)
  if (!ctx) throw new Error('useCommandState must be used within CommandStateProvider')
  return ctx
}
