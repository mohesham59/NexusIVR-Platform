import type { FlowNode, FlowEdge } from '../types'
import { validateFlowForSimulation } from './FlowValidator'
import { audioPlayer } from './AudioPlayer'
import { executeNode, handleDtmfInputForMenu, handleDtmfInputCompleted, type ExecutionContext } from './NodeExecutors'
import type { SimulationState, EngineListener, CallLogEntry, ExecutionTraceEntry } from './types'

export class SimulationEngine {
  private state: SimulationState = {
    status: 'idle',
    currentNodeId: null,
    previousNodeId: null,
    nowPlaying: null,
    inputBuffer: '',
    isWaitingForInput: false,
    expectedMaxDigits: 1,
    variables: {},
    callDurationSec: 0,
    nodesExecutedCount: 0,
    logs: [],
    executionTrace: [],
    validationIssues: [],
    resultSummary: null,
    simulatedEnvironment: {
      isBusinessHours: true,
      isHoliday: false,
      mockApiSuccess: true,
    },
  }

  private nodes: FlowNode[] = []
  private edges: FlowEdge[] = []
  private pathHistory: Array<{ nodeId: string; nodeTitle: string; nodeType: string }> = []
  private timerInterval: any = null
  private navTimeout: any = null
  private listeners: Set<EngineListener> = new Set()

  public getState(): SimulationState {
    return { ...this.state }
  }

  public subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener)
    listener(this.getState())
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(): void {
    const currentState = this.getState()
    this.listeners.forEach(l => l(currentState))
  }

  public updateSimulatedEnvironment(patch: Partial<SimulationState['simulatedEnvironment']>): void {
    this.state.simulatedEnvironment = {
      ...this.state.simulatedEnvironment,
      ...patch,
    }
    this.addLog(`Updated simulated environment: ${JSON.stringify(patch)}`, 'info')
    this.notify()
  }

  public startCall(nodes: FlowNode[], edges: FlowEdge[]): boolean {
    this.stopAllTimers()
    audioPlayer.stopSpeech()

    this.nodes = nodes
    this.edges = edges
    this.pathHistory = []

    const validation = validateFlowForSimulation(nodes, edges)
    this.state.validationIssues = validation.issues

    if (!validation.valid || !validation.startNode) {
      this.state.status = 'error'
      this.addLog('Failed to start call: flow validation errors found.', 'error')
      this.notify()
      return false
    }

    const startNode = validation.startNode

    this.state.status = 'calling'
    this.state.currentNodeId = null
    this.state.previousNodeId = null
    this.state.nowPlaying = null
    this.state.inputBuffer = ''
    this.state.isWaitingForInput = false
    this.state.variables = {}
    this.state.callDurationSec = 0
    this.state.nodesExecutedCount = 0
    this.state.logs = []
    this.state.executionTrace = []
    this.state.resultSummary = null

    this.addLog(`Initiating test call to IVR Extension 1001...`, 'info')
    audioPlayer.playRingtone(800)
    this.notify()

    this.startTimer()

    this.navTimeout = setTimeout(() => {
      this.state.status = 'connected'
      this.addLog(`Call Connected (00:01)`, 'success')
      this.notify()

      this.executeNodeById(startNode.id)
    }, 900)

    return true
  }

  private addTraceEntry(entry: Partial<ExecutionTraceEntry>): void {
    const step = this.state.executionTrace.length + 1
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false })
    const fullEntry: ExecutionTraceEntry = {
      step,
      nodeId: entry.nodeId || this.state.currentNodeId || '',
      nodeTitle: entry.nodeTitle || '',
      nodeType: entry.nodeType || '',
      timestamp,
      input: entry.input,
      variables: { ...this.state.variables },
      selectedBranch: entry.selectedBranch,
      targetNodeId: entry.targetNodeId,
      status: entry.status || 'SUCCESS',
      detail: entry.detail,
    }
    this.state.executionTrace = [...this.state.executionTrace, fullEntry]
  }

  private executeNodeById(nodeId: string): void {
    if (this.state.status === 'ended' || this.state.status === 'idle') return

    const node = this.nodes.find(n => n.id === nodeId)
    if (!node) {
      this.addLog(`Error: target node "${nodeId}" not found in flow graph.`, 'error')
      this.endCall(`Test stopped: target node missing (${nodeId})`, false)
      return
    }

    this.state.previousNodeId = this.state.currentNodeId
    this.state.currentNodeId = node.id
    this.state.nodesExecutedCount += 1
    this.pathHistory.push({ nodeId: node.id, nodeTitle: node.title, nodeType: node.type })

    this.notify()

    const context: ExecutionContext = {
      state: this.state,
      nodes: this.nodes,
      edges: this.edges,
      setNode: (id) => {
        this.state.currentNodeId = id
        this.notify()
      },
      setStatus: (status) => {
        this.state.status = status
        this.notify()
      },
      setNowPlaying: (np) => {
        this.state.nowPlaying = np
        this.notify()
      },
      addLog: (msg, level, nId) => {
        this.addLog(msg, level, nId)
      },
      addTraceEntry: (entry) => {
        this.addTraceEntry(entry)
      },
      setVariable: (name, val) => {
        this.state.variables = { ...this.state.variables, [name]: val }
        this.notify()
      },
      getVariable: (name) => this.state.variables[name],
      setWaitingForInput: (waiting, maxDigits = 1) => {
        this.state.isWaitingForInput = waiting
        this.state.expectedMaxDigits = maxDigits
        if (waiting) this.state.inputBuffer = ''
        this.notify()
      },
      navigateToNode: (targetId, delayMs = 300) => {
        this.navTimeout = setTimeout(() => {
          this.executeNodeById(targetId)
        }, delayMs)
      },
      endCall: (reason, success = true) => {
        this.endCall(reason, success)
      },
    }

    executeNode(node, context)
  }

  public pressDtmfKey(digit: string): void {
    if (this.state.status === 'ended' || this.state.status === 'idle' || !this.state.currentNodeId) return

    audioPlayer.playDtmfTone(digit)

    const currentNode = this.nodes.find(n => n.id === this.state.currentNodeId)
    if (!currentNode) return

    const context: ExecutionContext = {
      state: this.state,
      nodes: this.nodes,
      edges: this.edges,
      setNode: (id) => { this.state.currentNodeId = id; this.notify() },
      setStatus: (status) => { this.state.status = status; this.notify() },
      setNowPlaying: (np) => { this.state.nowPlaying = np; this.notify() },
      addLog: (msg, level, nId) => { this.addLog(msg, level, nId) },
      addTraceEntry: (entry) => { this.addTraceEntry(entry) },
      setVariable: (name, val) => { this.state.variables = { ...this.state.variables, [name]: val }; this.notify() },
      getVariable: (name) => this.state.variables[name],
      setWaitingForInput: (waiting, maxDigits = 1) => {
        this.state.isWaitingForInput = waiting
        this.state.expectedMaxDigits = maxDigits
        if (waiting) this.state.inputBuffer = ''
        this.notify()
      },
      navigateToNode: (targetId, delayMs = 300) => {
        this.navTimeout = setTimeout(() => {
          this.executeNodeById(targetId)
        }, delayMs)
      },
      endCall: (reason, success = true) => { this.endCall(reason, success) },
    }

    if (currentNode.type === 'dtmf_menu') {
      this.state.inputBuffer = digit
      this.notify()
      handleDtmfInputForMenu(digit, currentNode, context)
      return
    }

    if (currentNode.type === 'dtmf_input') {
      const max = this.state.expectedMaxDigits || parseInt(currentNode.maxDigits || '4', 10)
      if (digit === '#') {
        const input = this.state.inputBuffer
        this.addLog(`User pressed "#" to submit input "${input}"`, 'dtmf', currentNode.id)
        handleDtmfInputCompleted(input, currentNode, context)
      } else {
        const nextBuffer = this.state.inputBuffer + digit
        this.state.inputBuffer = nextBuffer
        this.addLog(`Keypad digit "${digit}" (Buffer: ${nextBuffer})`, 'dtmf', currentNode.id)
        this.notify()

        if (nextBuffer.length >= max) {
          handleDtmfInputCompleted(nextBuffer, currentNode, context)
        }
      }
      return
    }

    // Default keypress handling during playing
    this.addLog(`Keypad digit "${digit}" entered during call`, 'dtmf', currentNode.id)
    if (this.state.nowPlaying?.isPlaying) {
      audioPlayer.stopSpeech()
      this.state.nowPlaying = { ...this.state.nowPlaying, isPlaying: false }
      this.notify()
    }
  }

  public replayCurrentPrompt(): void {
    if (!this.state.currentNodeId) return
    const node = this.nodes.find(n => n.id === this.state.currentNodeId)
    if (!node) return

    const promptText = node.prompt || node.promptEn || node.promptAr || node.subtitle || node.title
    this.addLog(`Replaying prompt in [${node.title}]`, 'info', node.id)

    this.state.nowPlaying = {
      title: node.title,
      promptText,
      isTts: true,
      phase: 'playing',
      isPlaying: true,
    }
    this.notify()

    audioPlayer.speakPrompt(promptText, () => {
      this.state.nowPlaying = {
        title: node.title,
        promptText,
        isTts: true,
        phase: 'ended',
        isPlaying: false,
      }
      this.notify()
    })
  }

  public togglePausePrompt(): void {
    if (audioPlayer.isCurrentlyPaused()) {
      audioPlayer.resumeSpeech()
      if (this.state.nowPlaying) {
        this.state.nowPlaying = { ...this.state.nowPlaying, isPlaying: true }
      }
    } else if (audioPlayer.isCurrentlySpeaking()) {
      audioPlayer.pauseSpeech()
      if (this.state.nowPlaying) {
        this.state.nowPlaying = { ...this.state.nowPlaying, isPlaying: false }
      }
    }
    this.notify()
  }

  public restartCall(): void {
    if (this.nodes.length > 0 && this.edges.length >= 0) {
      this.startCall(this.nodes, this.edges)
    }
  }

  public endCall(reason = 'Call ended by user', success = true): void {
    this.stopAllTimers()
    audioPlayer.stopSpeech()

    this.state.status = 'ended'
    this.state.isWaitingForInput = false
    if (this.state.nowPlaying) {
      this.state.nowPlaying = { ...this.state.nowPlaying, isPlaying: false }
    }

    const durationSec = this.state.callDurationSec
    const mins = Math.floor(durationSec / 60)
    const secs = durationSec % 60
    const formattedDuration = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`

    this.state.resultSummary = {
      success,
      message: reason,
      durationSec,
      formattedDuration,
      nodesExecutedCount: this.state.nodesExecutedCount,
      pathTaken: [...this.pathHistory],
    }

    this.addLog(`Call Terminated: ${reason} (Duration: ${formattedDuration})`, success ? 'success' : 'warn')
    this.notify()
  }

  private addLog(msg: string, level: CallLogEntry['level'] = 'info', nodeId?: string): void {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false })
    const entry: CallLogEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      timestamp,
      level,
      message: msg,
      nodeId: nodeId || this.state.currentNodeId || undefined,
      nodeTitle: nodeId ? this.nodes.find(n => n.id === nodeId)?.title : undefined,
    }
    this.state.logs = [entry, ...this.state.logs]
  }

  private startTimer(): void {
    this.stopAllTimers()
    this.timerInterval = setInterval(() => {
      this.state.callDurationSec += 1
      this.notify()
    }, 1000)
  }

  private stopAllTimers(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval)
      this.timerInterval = null
    }
    if (this.navTimeout) {
      clearTimeout(this.navTimeout)
      this.navTimeout = null
    }
  }
}

export const simulationEngine = new SimulationEngine()
