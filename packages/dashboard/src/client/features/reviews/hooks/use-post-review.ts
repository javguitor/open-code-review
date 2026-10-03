import { useCallback, useEffect, useRef, useState } from 'react'
import { useSocket, useSocketEvent } from '../../../providers/socket-provider'
import type { GitHubReviewState } from '@open-code-review/platform/verdict'
import type { PostReviewStep, PostCheckResult, PostSubmitResult, PostPreviewResult, ChatToolStatus } from '../../../lib/api-types'
import type { SubmitPayload } from '../../../lib/post-preview'
import { applyCheckResult, initialReviewState } from '../../../lib/review-state'
import { useT } from '../../../lib/i18n'

export type ActivityLogEntry = {
  tool: string
  detail: string
  timestamp: number
}

type UsePostReviewReturn = {
  step: PostReviewStep
  checkResult: PostCheckResult | null
  streamingContent: string
  generatedContent: string
  toolStatus: ChatToolStatus | null
  activityLog: ActivityLogEntry[]
  elapsedSeconds: number
  postResult: PostSubmitResult | null
  /** What `post:submit` would publish for the round (null until the server answers). */
  preview: PostPreviewResult | null
  requestPreview: (sessionId: string, roundNumber: number) => void
  error: string | null
  needsRecheck: boolean
  reviewState: GitHubReviewState
  setReviewState: (state: GitHubReviewState) => void
  checkGitHub: (sessionId: string) => void
  generate: (sessionId: string, roundNumber: number) => void
  cancelGeneration: (sessionId: string, roundNumber: number) => void
  saveDraft: (sessionId: string, roundNumber: number, content: string) => void
  submitToGitHub: (payload: SubmitPayload) => void
  recheck: () => void
  reset: () => void
  setStep: (step: PostReviewStep) => void
}

export function usePostReview(verdict: string | null): UsePostReviewReturn {
  const { socket } = useSocket()
  const { t } = useT()

  const [step, setStep] = useState<PostReviewStep>('idle')
  const [checkResult, setCheckResult] = useState<PostCheckResult | null>(null)
  const [streamingContent, setStreamingContent] = useState('')
  const [generatedContent, setGeneratedContent] = useState('')
  const [toolStatus, setToolStatus] = useState<ChatToolStatus | null>(null)
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([])
  const [postResult, setPostResult] = useState<PostSubmitResult | null>(null)
  const [preview, setPreview] = useState<PostPreviewResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reviewState, setReviewState] = useState<GitHubReviewState>('comment')
  const [needsRecheck, setNeedsRecheck] = useState(false)

  // Latest values for callbacks that must not go stale or re-subscribe
  const verdictRef = useRef(verdict)
  verdictRef.current = verdict
  const stepRef = useRef(step)
  stepRef.current = step
  const reviewStateRef = useRef(reviewState)
  reviewStateRef.current = reviewState
  // A check started from idle/error is the dialog's first look at the PR, so
  // the verdict-derived state applies; from ready/preview it keeps the user's pick.
  const freshCheckRef = useRef(true)
  // Step the in-flight submit started from, restored on a needs-recheck failure
  const submitOriginRef = useRef<PostReviewStep>('ready')
  const lastSessionIdRef = useRef<string | null>(null)
  const lastRoundRef = useRef<number | null>(null)

  const streamingRef = useRef('')
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Elapsed timer — ticks every second while generating
  useEffect(() => {
    if (step === 'generating') {
      setElapsedSeconds(0)
      timerRef.current = setInterval(() => setElapsedSeconds((s) => s + 1), 1000)
    } else if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [step])

  // ── GitHub check result ──
  useSocketEvent<PostCheckResult>(
    'post:gh-result',
    useCallback((data) => {
      setCheckResult(data)
      setNeedsRecheck(false)
      if (data.authenticated && data.prNumber) {
        const next = applyCheckResult({
          step: stepRef.current,
          reviewState: reviewStateRef.current,
          verdict: verdictRef.current,
          ownership: data.ownership,
        })
        setStep(next.step)
        setReviewState(
          freshCheckRef.current
            ? initialReviewState(verdictRef.current, data.ownership)
            : next.reviewState,
        )
      } else {
        setReviewState(initialReviewState(verdictRef.current, data.ownership))
        setError(data.error ?? t('reviews.gh_check_failed'))
        setStep('error')
      }
    }, [t]),
  )

  // ── Streaming tokens ──
  useSocketEvent<{ token: string }>(
    'post:token',
    useCallback((data) => {
      streamingRef.current += data.token
      setStreamingContent(streamingRef.current)
    }, []),
  )

  // ── Clear stream (reasoning text discarded when a tool fires) ──
  useSocketEvent(
    'post:clear-stream',
    useCallback(() => {
      streamingRef.current = ''
      setStreamingContent('')
    }, []),
  )

  // ── Tool status ──
  useSocketEvent<{ tool: string; detail: string }>(
    'post:status',
    useCallback((data) => {
      const entry: ActivityLogEntry = {
        tool: data.tool,
        detail: data.detail,
        timestamp: Date.now(),
      }
      setToolStatus(entry)
      setActivityLog((prev) => [...prev, entry])
    }, []),
  )

  // ── Preview of what will be published (summary + inline comments) ──
  useSocketEvent<PostPreviewResult>(
    'post:preview-result',
    useCallback((data) => {
      setPreview(data)
    }, []),
  )

  // ── Generation done ──
  useSocketEvent<{ content: string }>(
    'post:done',
    useCallback((data) => {
      setGeneratedContent(data.content)
      setStreamingContent('')
      setToolStatus(null)
      streamingRef.current = ''
      setStep('preview')
      // The skill also wrote the inline comments file: ask for the full preview
      const sessionId = lastSessionIdRef.current
      const round = lastRoundRef.current
      if (socket && sessionId && round !== null) {
        socket.emit('post:preview', { sessionId, roundNumber: round })
      }
    }, [socket]),
  )

  // ── Generation cancelled ──
  useSocketEvent(
    'post:cancelled',
    useCallback(() => {
      setStreamingContent('')
      setToolStatus(null)
      streamingRef.current = ''
      setStep('ready')
    }, []),
  )

  // ── Error ──
  useSocketEvent<{ error: string }>(
    'post:error',
    useCallback((data) => {
      setError(data.error)
      setStreamingContent('')
      setToolStatus(null)
      streamingRef.current = ''
      setStep('error')
    }, []),
  )

  // ── Save result ──
  useSocketEvent<{ success: boolean; error?: string }>(
    'post:save-result',
    useCallback((data) => {
      if (!data.success) {
        setError(data.error ?? t('reviews.save_draft_failed'))
      }
    }, [t]),
  )

  // ── Submit result ──
  useSocketEvent<PostSubmitResult>(
    'post:submit-result',
    useCallback((data) => {
      setPostResult(data)
      if (data.success) {
        setStep('posted')
      } else {
        setError(data.error)
        if (data.code === 'needs-recheck') {
          setNeedsRecheck(true)
          setStep(submitOriginRef.current)
        } else {
          setStep('error')
        }
      }
    }, []),
  )

  // ── Actions ──

  const checkGitHub = useCallback(
    (sessionId: string) => {
      if (!socket) return
      lastSessionIdRef.current = sessionId
      freshCheckRef.current = stepRef.current === 'idle' || stepRef.current === 'error'
      setStep('checking')
      setError(null)
      setCheckResult(null)
      socket.emit('post:check-gh', { sessionId })
    },
    [socket],
  )

  const recheck = useCallback(() => {
    const sessionId = lastSessionIdRef.current
    if (!sessionId) return
    const current = stepRef.current
    if (current === 'idle' || current === 'ready' || current === 'error') {
      checkGitHub(sessionId)
    } else if (current === 'preview' && socket) {
      // Stay in preview: the draft and the selection must survive the check
      freshCheckRef.current = false
      setError(null)
      socket.emit('post:check-gh', { sessionId })
    }
  }, [checkGitHub, socket])

  const requestPreview = useCallback(
    (sessionId: string, roundNumber: number) => {
      if (!socket) return
      lastSessionIdRef.current = sessionId
      lastRoundRef.current = roundNumber
      socket.emit('post:preview', { sessionId, roundNumber })
    },
    [socket],
  )

  const generate = useCallback(
    (sessionId: string, roundNumber: number) => {
      if (!socket) return
      lastSessionIdRef.current = sessionId
      lastRoundRef.current = roundNumber
      setStep('generating')
      setError(null)
      setStreamingContent('')
      setGeneratedContent('')
      setPreview(null)
      setToolStatus(null)
      setActivityLog([])
      streamingRef.current = ''
      socket.emit('post:generate', { sessionId, roundNumber })
    },
    [socket],
  )

  const cancelGeneration = useCallback(
    (sessionId: string, roundNumber: number) => {
      if (!socket) return
      socket.emit('post:cancel', { sessionId, roundNumber })
    },
    [socket],
  )

  const saveDraft = useCallback(
    (sessionId: string, roundNumber: number, content: string) => {
      if (!socket) return
      socket.emit('post:save', { sessionId, roundNumber, content })
    },
    [socket],
  )

  const submitToGitHub = useCallback(
    (payload: SubmitPayload) => {
      if (!socket) return
      submitOriginRef.current = stepRef.current
      setStep('posting')
      setError(null)
      socket.emit('post:submit', payload)
    },
    [socket],
  )

  const reset = useCallback(() => {
    setStep('idle')
    setCheckResult(null)
    setStreamingContent('')
    setGeneratedContent('')
    setToolStatus(null)
    setActivityLog([])
    setPostResult(null)
    setPreview(null)
    setError(null)
    setReviewState('comment')
    setNeedsRecheck(false)
    streamingRef.current = ''
  }, [])

  return {
    step,
    checkResult,
    streamingContent,
    generatedContent,
    toolStatus,
    activityLog,
    elapsedSeconds,
    postResult,
    preview,
    requestPreview,
    error,
    needsRecheck,
    reviewState,
    setReviewState,
    checkGitHub,
    generate,
    cancelGeneration,
    saveDraft,
    submitToGitHub,
    recheck,
    reset,
    setStep,
  }
}
