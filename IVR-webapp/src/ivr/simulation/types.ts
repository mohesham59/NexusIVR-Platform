import type { PromptPhase } from './AudioPlayer'

export type CallStatus =
  | 'idle'
  | 'calling'
  | 'connected'
  | 'running'
  | 'playing'
  | 'waiting_input'
  | 'processing'
  | 'transferring'
  | 'queued'
  | 'ended'
  | 'error'

export interface CallLogEntry {
  id: string
  timestamp: string
  level: 'info' | 'warn' | 'error' | 'success' | 'dtmf'
  message: string
  nodeId?: string
  nodeTitle?: string
}

export interface ValidationIssue {
  type: 'error' | 'warning' | 'info'
  code: string
  message: string
  nodeId?: string
}

export interface SimulationResultSummary {
  success: boolean
  message: string
  durationSec: number
  formattedDuration: string
  nodesExecutedCount: number
  pathTaken: Array<{ nodeId: string; nodeTitle: string; nodeType: string }>
}

export interface NowPlayingState {
  title: string
  promptText?: string
  isTts: boolean
  audioUrl?: string
  /** Real playback phase reported by the HTMLAudioElement. */
  phase: PromptPhase
  /** True only while audio is audibly playing (phase === 'playing'). */
  isPlaying: boolean
  error?: string
}

export interface SimulatedEnvironment {
  isBusinessHours: boolean
  isHoliday: boolean
  mockApiSuccess: boolean
}

export interface ExecutionTraceEntry {
  step: number
  nodeId: string
  nodeTitle: string
  nodeType: string
  timestamp: string
  input?: string
  variables: Record<string, any>
  selectedBranch?: string
  targetNodeId?: string
  status: 'SUCCESS' | 'WAITING' | 'WARN' | 'ERROR'
  detail?: string
}

export interface SimulationState {
  status: CallStatus
  currentNodeId: string | null
  previousNodeId: string | null
  nowPlaying: NowPlayingState | null
  inputBuffer: string
  isWaitingForInput: boolean
  expectedMaxDigits?: number
  variables: Record<string, any>
  callDurationSec: number
  nodesExecutedCount: number
  logs: CallLogEntry[]
  executionTrace: ExecutionTraceEntry[]
  validationIssues: ValidationIssue[]
  resultSummary: SimulationResultSummary | null
  simulatedEnvironment: SimulatedEnvironment
}

export interface EngineListener {
  (state: SimulationState): void
}
