import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { aiApi } from '../api/aiApi'
import QuotaWarningBanner from '../components/QuotaWarningBanner'
import {
  Undo2, Redo2, ShieldCheck, Save, Upload, Download,
  Sparkles, LogOut, Phone, Play, Square, ChevronUp, ChevronDown,
  Copy, Scissors, Trash2, EyeOff, Pencil, Group,
  CheckCircle, Info, GitBranch, Zap, Maximize2, Minimize2, Terminal, ZoomIn, ZoomOut, Move, PanelLeftClose,
  ArrowLeft,
} from 'lucide-react'
import FlowCanvas from '../ivr/FlowCanvas'
import NodeLibrary from '../ivr/NodeLibrary'
import PropertiesPanel, { type ValidationItem, isPlaceholderDestination } from '../ivr/PropertiesPanel'
import { INITIAL_NODES, INITIAL_EDGES, VERSIONS as INITIAL_VERSIONS } from '../ivr/initialFlow'
import { NODE_DEFS } from '../ivr/nodeConfig'
import { sanitizeFlow, generateUniqueId } from '../ivr/flowParser'
import { validateGraph, analyzeGraph, reconnectAfterDelete, optimizeFlow } from '../ivr/graphEngine'
import AiAssistantPanel from '../components/AiAssistantPanel'
import IvrSimulatorTab from '../ivr/simulator/IvrSimulatorTab'


interface LogEntry {
  id: string
  level: 'info' | 'warn' | 'error'
  msg: string
  time: string
}

interface SuggestionItem {
  id: string
  text: string
  icon: string
  severity: 'error' | 'warning' | 'info'
  nodeId?: string
  suggestionType?: string
  applyAction: () => boolean | void
}

const CONTEXT_MENU_ITEMS = [
  { icon: <Copy className="w-3.5 h-3.5" />, label: 'Duplicate', shortcut: '⌘D' },
  { icon: <Scissors className="w-3.5 h-3.5" />, label: 'Cut', shortcut: '⌘X' },
  { icon: <Copy className="w-3.5 h-3.5" />, label: 'Copy', shortcut: '⌘C' },
  null,
  { icon: <Pencil className="w-3.5 h-3.5" />, label: 'Rename', shortcut: 'F2' },
  { icon: <EyeOff className="w-3.5 h-3.5" />, label: 'Disable Node', shortcut: '' },
  { icon: <Group className="w-3.5 h-3.5" />, label: 'Group', shortcut: '⌘G' },
  null,
  { icon: <Trash2 className="w-3.5 h-3.5" />, label: 'Delete', shortcut: '⌫', danger: true },
]

type RightPanelTab = 'props' | 'versions' | 'validation'
type BottomTab = 'logs' | 'ai' | 'validation' | 'console'

function hasEndNode(nodes: FlowNode[]): boolean {
  return nodes.some(n => n.type === 'end')
}

function getNextNodeId(nodes: FlowNode[]): string {
  let max = 0
  nodes.forEach(n => {
    const match = n.id.match(/^n(\d+)$/)
    if (match) {
      const num = parseInt(match[1], 10)
      if (num > max) max = num
    }
  })
  return 'n' + (max + 1)
}

export function _hasGreetingEquivalent(nodes: FlowNode[]): boolean {
  if (nodes.some(n => n.type === 'greeting')) return true
  const startNode = nodes.find(n => n.type === 'start')
  if (startNode && startNode.subtitle && startNode.subtitle.trim() !== '') return true
  return nodes.some(n => ['tts', 'playback'].includes(n.type) && n.x <= 150)
}

export default function IVRBuilder({ onLogout }: { onLogout: () => void }) {
  const navigate = useNavigate()
  const location = useLocation()
  const passedFlow = location.state as { nodes?: FlowNode[]; edges?: FlowEdge[]; flowName?: string; sessionId?: string } | null

  const [sessionId] = useState<string>(() => {
    return (passedFlow as any)?.sessionId ?? localStorage.getItem('nexus_ai_session_id') ?? 'default_session_id'
  })

  const getInitialFlow = (currentSessionId: string) => {
    let initialN: FlowNode[] = []
    let initialE: FlowEdge[] = []

    if (passedFlow?.nodes && (passedFlow as any).sessionId === currentSessionId) {
      initialN = passedFlow.nodes
      initialE = passedFlow.edges ?? []
    } else {
      const savedN = localStorage.getItem(`nexus_builder_nodes_${currentSessionId}`)
      const savedE = localStorage.getItem(`nexus_builder_edges_${currentSessionId}`)
      if (savedN) {
        try {
          const parsedN = JSON.parse(savedN)
          if (Array.isArray(parsedN)) initialN = parsedN
        } catch {}
      }
      if (savedE) {
        try {
          const parsedE = JSON.parse(savedE)
          if (Array.isArray(parsedE)) initialE = parsedE
        } catch {}
      }
    }

    if (initialN.length === 0 && currentSessionId === 'default_session_id') {
      initialN = INITIAL_NODES
      initialE = INITIAL_EDGES
    }

    return sanitizeFlow({ nodes: initialN, edges: initialE })
  }

  const [nodes, setNodes] = useState<FlowNode[]>(() => getInitialFlow(sessionId).nodes)
  const [edges, setEdges] = useState<FlowEdge[]>(() => getInitialFlow(sessionId).edges)

  const nodesRef = useRef<FlowNode[]>([])
  const edgesRef = useRef<FlowEdge[]>([])
  useEffect(() => { nodesRef.current = nodes }, [nodes])
  useEffect(() => { edgesRef.current = edges }, [edges])

  const [flowName, setFlowName] = useState(() => {
    return passedFlow && (passedFlow as any).sessionId === sessionId && passedFlow.flowName
      ? passedFlow.flowName
      : localStorage.getItem(`nexus_builder_flowname_${sessionId}`) ?? (sessionId === 'default_session_id' ? 'Hospital Main IVR' : 'New IVR Flow')
  })

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [viewport, setViewport] = useState<{ x: number; y: number; scale: number }>(() => {
    return (passedFlow as any)?.viewport ?? { x: -40, y: -80, scale: 0.82 }
  })
  const [builderTab, setBuilderTab] = useState<'build' | 'test'>('build')


  const [libCollapsed, setLibCollapsed] = useState(false)
  const [rightTab, setRightTab] = useState<RightPanelTab>('props')
  const [bottomOpen, setBottomOpen] = useState(true)
  const [bottomTab, setBottomTab] = useState<BottomTab>('logs')
  const [bottomHeight, setBottomHeight] = useState(() => {
    const saved = localStorage.getItem('nexus_builder_bottom_height')
    return saved ? parseInt(saved, 10) : 190
  })
  const [isMaximized, setIsMaximized] = useState(false)
  const [simulatingId, setSimulatingId] = useState<string | null>(null)
  const [isSimulating, setIsSimulating] = useState(false)
  const [isSaved, setIsSaved] = useState(false)
  const [isPublished, setIsPublished] = useState(false)
  const [aiPanelOpen, setAiPanelOpen] = useState(true)
  const [showPublishModal, setShowPublishModal] = useState(false)
  const [publishExtension, setPublishExtension] = useState('')
  const [publishFilename, setPublishFilename] = useState('')
  const [isPublishing, setIsPublishing] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editingTitleValue, setEditingTitleValue] = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)
  const [versionsList, setVersionsList] = useState<FlowVersion[]>(() => {
    const saved = localStorage.getItem(`nexus_builder_versions_${sessionId}`)
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed)) return parsed
      } catch {}
    }
    if (sessionId === 'default_session_id') {
      return INITIAL_VERSIONS.map(v => ({
        ...v,
        versionId: v.id,
        sessionId: 'default_session_id',
        createdAt: v.savedAt,
        flow: { nodes: INITIAL_NODES, edges: INITIAL_EDGES }
      }))
    }
    return []
  })

  const [logs, setLogs] = useState<LogEntry[]>([
    { id: '1', level: 'info', msg: 'IVR Canvas initialized with active flow schema', time: new Date().toLocaleTimeString('en-US', { hour12: false }) },
    { id: '2', level: 'info', msg: 'Realtime validation check completed — 0 syntax errors', time: new Date().toLocaleTimeString('en-US', { hour12: false }) }
  ])
  const [logSearch, setLogSearch] = useState('')
  const [logFilter, setLogFilter] = useState<'all' | 'info' | 'warn' | 'error'>('all')

  const addLog = useCallback((msg: string, level: 'info' | 'warn' | 'error' = 'info') => {
    const timeStr = new Date().toLocaleTimeString('en-US', { hour12: false })
    const uniqueId = `log_${generateUniqueId()}`
    setLogs(l => [{ id: uniqueId, level, msg, time: timeStr }, ...l])
  }, [])

  const [ignoredSuggestionIds, setIgnoredSuggestionIds] = useState<Set<string>>(new Set())
  const [backendValidationIssues, setBackendValidationIssues] = useState<any[]>([])
  const [appliedSuggestionCount, setAppliedSuggestionCount] = useState(0)
  const appliedSuggestionHistoryRef = useRef<Map<string, number>>(new Map())
  const [quotaWarnings] = useState<Array<{ provider: string; model?: string; attempt: number }>>([])

  useEffect(() => {
    let active = true
    const runValidation = async () => {
      try {
        const res = await aiApi.validateFlow({ nodes, edges })
        if (active && res && res.issues) {
          setBackendValidationIssues(res.issues)
          const errs = res.issues.filter((i: any) => i.severity === 'error').length
          const warns = res.issues.filter((i: any) => i.severity === 'warning').length
          if (errs > 0) {
            addLog(`Backend validation completed — found ${errs} error(s), ${warns} warning(s)`, 'error')
          } else if (warns > 0) {
            addLog(`Backend validation completed — found 0 errors, ${warns} warning(s)`, 'warn')
          } else {
            addLog('Backend validation completed — 0 errors, 0 warnings', 'info')
          }
        }
      } catch (err) {
        console.warn('[IVRBuilder] Backend validation failed:', err)
      }
    }
    const timer = setTimeout(() => { runValidation() }, 100)
    return () => { active = false; clearTimeout(timer) }
  }, [nodes, edges, addLog])
  const [clipboardNode, setClipboardNode] = useState<FlowNode | null>(null)
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)
  const [draftNodes, setDraftNodes] = useState<FlowNode[] | null>(null)
  const [draftEdges, setDraftEdges] = useState<FlowEdge[] | null>(null)

  const [historyStack, setHistoryStack] = useState<{ nodes: FlowNode[]; edges: FlowEdge[] }[]>([
    { nodes: INITIAL_NODES, edges: INITIAL_EDGES }
  ])
  const [historyIndex, setHistoryIndex] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const loadingSessionRef = useRef<string | null>(null)

  useEffect(() => {
    if (!sessionId) return
    loadingSessionRef.current = sessionId
    const data = getInitialFlow(sessionId)
    setNodes(data.nodes)
    setEdges(data.edges)
    const name = passedFlow && (passedFlow as any).sessionId === sessionId && passedFlow.flowName
      ? passedFlow.flowName
      : localStorage.getItem(`nexus_builder_flowname_${sessionId}`) ?? (sessionId === 'default_session_id' ? 'Hospital Main IVR' : 'New IVR Flow')
    setFlowName(name)
    const savedV = localStorage.getItem(`nexus_builder_versions_${sessionId}`)
    let loadedVersions: FlowVersion[] = []
    if (savedV) {
      try {
        const parsedV = JSON.parse(savedV)
        if (Array.isArray(parsedV)) loadedVersions = parsedV
      } catch {}
    } else if (sessionId === 'default_session_id') {
      loadedVersions = INITIAL_VERSIONS.map(v => ({
        ...v,
        versionId: v.id,
        sessionId: 'default_session_id',
        createdAt: v.savedAt,
        flow: { nodes: INITIAL_NODES, edges: INITIAL_EDGES }
      }))
    }
    setVersionsList(loadedVersions)
    setSelectedVersionId(null)
    setDraftNodes(null)
    setDraftEdges(null)
    const timer = setTimeout(() => {
      if (loadingSessionRef.current === sessionId) loadingSessionRef.current = null
    }, 50)
    return () => clearTimeout(timer)
  }, [sessionId])

  useEffect(() => {
    if (!sessionId) return
    if (loadingSessionRef.current) return
    localStorage.setItem(`nexus_builder_nodes_${sessionId}`, JSON.stringify(nodes))
    localStorage.setItem(`nexus_builder_edges_${sessionId}`, JSON.stringify(edges))
    localStorage.setItem(`nexus_builder_flowname_${sessionId}`, flowName)
    localStorage.setItem(`nexus_builder_versions_${sessionId}`, JSON.stringify(versionsList))
  }, [nodes, edges, flowName, versionsList, sessionId])

  useEffect(() => {
    localStorage.setItem('nexus_builder_bottom_height', String(bottomHeight))
  }, [bottomHeight])

  const pushHistory = useCallback((newNodes: FlowNode[], newEdges: FlowEdge[]) => {
    setHistoryStack(stack => {
      const sliced = stack.slice(0, historyIndex + 1)
      return [...sliced, { nodes: newNodes, edges: newEdges }]
    })
    setHistoryIndex(i => i + 1)
  }, [historyIndex])

  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const target = historyStack[historyIndex - 1]
      setNodes(target.nodes)
      setEdges(target.edges)
      setHistoryIndex(historyIndex - 1)
      addLog('Undo action performed', 'info')
    }
  }, [historyIndex, historyStack, addLog])

  const handleRedo = useCallback(() => {
    if (historyIndex < historyStack.length - 1) {
      const target = historyStack[historyIndex + 1]
      setNodes(target.nodes)
      setEdges(target.edges)
      setHistoryIndex(historyIndex + 1)
      addLog('Redo action performed', 'info')
    }
  }, [historyIndex, historyStack, addLog])

  const simIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const simNodesRef = useRef<FlowNode[]>([])
  const simEdgesRef = useRef<FlowEdge[]>([])

  const startSimulation = useCallback(() => {
    if (isSimulating) return

    const validated = validateGraph(nodes, edges)
    if (validated.nodes.length === 0) {
      addLog('Cannot preview: flow is empty', 'error')
      return
    }

    const startNode = validated.nodes.find(n => n.type === 'start')
    if (!startNode) {
      addLog('Cannot preview: flow has no start node', 'error')
      return
    }

    simNodesRef.current = validated.nodes
    simEdgesRef.current = validated.edges

    const adjacency = new Map<string, FlowEdge[]>()
    validated.edges.forEach(edge => {
      const list = adjacency.get(edge.sourceId) || []
      list.push(edge)
      adjacency.set(edge.sourceId, list)
    })

    setIsSimulating(true)
    setSimulatingId(startNode.id)
    addLog(`Started preview from node: ${startNode.title}`, 'info')

    let currentNodeId = startNode.id

    const interval = setInterval(() => {
      const currentNodes = simNodesRef.current
      const currentEdges = simEdgesRef.current
      const outgoingEdges = currentEdges.filter(e => e.sourceId === currentNodeId)

      if (outgoingEdges.length === 0) {
        clearInterval(interval)
        simIntervalRef.current = null
        setIsSimulating(false)
        setSimulatingId(null)
        addLog('Preview complete: reached end of flow', 'info')
        return
      }

      const nextEdge = outgoingEdges.find(e => e.sourcePort === 'out' || e.sourcePort === 'success') || outgoingEdges[0]
      const nextNode = currentNodes.find(n => n.id === nextEdge.targetId)

      if (!nextNode || nextNode.type === 'end') {
        clearInterval(interval)
        simIntervalRef.current = null
        setIsSimulating(false)
        setSimulatingId(null)
        if (nextNode) {
          addLog(`Preview complete: reached ${nextNode.title}`, 'info')
        } else {
          addLog('Preview complete: target node not found', 'warn')
        }
        return
      }

      currentNodeId = nextEdge.targetId
      setSimulatingId(currentNodeId)
    }, 800)

    simIntervalRef.current = interval
  }, [isSimulating, nodes, edges, addLog])

  useEffect(() => {
    return () => {
      if (simIntervalRef.current) {
        clearInterval(simIntervalRef.current)
        simIntervalRef.current = null
      }
    }
  }, [])

  const isDraggingRef = useRef(false)
  const startYRef = useRef(0)
  const startHeightRef = useRef(190)

  const lastPassedFlowJsonRef = useRef<string>('')
  useEffect(() => {
    if (passedFlow?.nodes && passedFlow.nodes.length > 0) {
      const jsonStr = JSON.stringify({
        flowName: passedFlow.flowName,
        nodeCount: passedFlow.nodes.length,
        edgeCount: (passedFlow.edges ?? []).length,
        nodes: passedFlow.nodes.map(n => ({ id: n.id, title: n.title, type: n.type })),
        edges: (passedFlow.edges ?? []).map(e => ({ id: e.id, sourceId: e.sourceId, targetId: e.targetId }))
      })
      if (jsonStr !== lastPassedFlowJsonRef.current) {
        lastPassedFlowJsonRef.current = jsonStr
        const validated = validateGraph(passedFlow.nodes, passedFlow.edges ?? [])
        setNodes(validated.nodes)
        setEdges(validated.edges)
        if (passedFlow.flowName) setFlowName(passedFlow.flowName)
        if ((passedFlow as any).viewport) setViewport((passedFlow as any).viewport)
        addLog(`Canvas updated with flow state (${validated.nodes.length} nodes, ${validated.edges.length} connections)`, 'info')
      }
    }
  }, [passedFlow, addLog])

  const selectedNode = nodes.find(n => n.id === selectedId) ?? null

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.getAttribute('contenteditable') === 'true')) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) handleRedo()
        else handleUndo()
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); handleRedo() }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId) {
          e.preventDefault()
          const target = nodes.find(n => n.id === selectedId)
          const isStartNode = target?.type === 'start'
          const isOnlyStart = nodes.filter(n => n.type === 'start').length === 1

          if (isStartNode && isOnlyStart) {
            addLog('Cannot delete the only Start node — it is the flow entry point. Add another Start node first or cancel.', 'error')
            setSelectedId(null)
            return
          }

          const result = reconnectAfterDelete(nodes, edges, selectedId)
          const validated = validateGraph(result.nodes, result.edges)
          setNodes(validated.nodes)
          setEdges(validated.edges)
          setSelectedId(null)
          setIgnoredSuggestionIds(new Set())
          pushHistory(validated.nodes, validated.edges)
          addLog(`Smart Deleted Node [${target?.title || selectedId}] — auto-reconnected ${result.reconnectedCount} path(s)`, 'warn')
        } else if (selectedEdgeId) {
          e.preventDefault()
          const updatedEdges = edges.filter(ed => ed.id !== selectedEdgeId)
          setEdges(updatedEdges)
          setSelectedEdgeId(null)
          pushHistory(nodes, updatedEdges)
          addLog(`Deleted Connection [${selectedEdgeId}] via keyboard shortcut`, 'warn')
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        if (selectedId) {
          const target = nodes.find(n => n.id === selectedId)
          if (target) { e.preventDefault(); setClipboardNode(target); addLog(`Copied Node [${target.title}] to clipboard`, 'info') }
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        if (clipboardNode) {
          e.preventDefault()
          const newNode: FlowNode = { ...clipboardNode, id: generateUniqueId(), x: clipboardNode.x + 48, y: clipboardNode.y + 48, title: `${clipboardNode.title} (Copy)` }
          const updatedNodes = [...nodes, newNode]
          const validated = validateGraph(updatedNodes, edges)
          setNodes(validated.nodes)
          setSelectedId(newNode.id)
          pushHistory(validated.nodes, edges)
          addLog(`Pasted Node [${newNode.title}]`, 'info')
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        if (selectedId) {
          const target = nodes.find(n => n.id === selectedId)
          if (target) {
            e.preventDefault()
            const newNode: FlowNode = { ...target, id: generateUniqueId(), x: target.x + 48, y: target.y + 48, title: `${target.title} (Copy)` }
            const updatedNodes = [...nodes, newNode]
            const validated = validateGraph(updatedNodes, edges)
            setNodes(validated.nodes)
            setSelectedId(newNode.id)
            pushHistory(validated.nodes, edges)
            addLog(`Duplicated Node [${target.title}]`, 'info')
          }
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [nodes, edges, selectedId, selectedEdgeId, clipboardNode, handleUndo, handleRedo, pushHistory, addLog])

  const handleSelectNodeAndCenter = (nodeId?: string) => {
    if (!nodeId) return
    setSelectedId(nodeId)
    setRightTab('props')
    const node = nodes.find(n => n.id === nodeId)
    if (node) {
      const containerW = 1000
      const containerH = 600
      const scale = 1.0
      const targetX = containerW / 2 - (node.x + 110) * scale
      const targetY = containerH / 2 - (node.y + 54) * scale
      setViewport({ x: targetX, y: targetY, scale })
      addLog(`Focused and centered on Node [${node.title}]`, 'info')
    }
  }

  const diagnostics = useMemo(() => analyzeGraph(nodes, edges), [nodes, edges])

  const validationItems = useMemo((): ValidationItem[] => {
    const items: ValidationItem[] = []
    if (diagnostics.missingStart) items.push({ type: 'error', code: 'MISSING_START', message: 'Flow has no Start Call node entry point.' })
    if (diagnostics.missingHangup) items.push({ type: 'error', code: 'MISSING_HANGUP', message: 'Flow has no End Call node terminating call execution.' })
    diagnostics.orphanNodes.forEach(n => items.push({ type: 'warning', code: 'ORPHAN_NODE', message: `Node "${n.title}" is unreachable (no incoming connections).`, nodeId: n.id }))
    diagnostics.deadEnds.forEach(n => items.push({ type: 'info', code: 'DEAD_END', message: `Node "${n.title}" has no outgoing connection path.`, nodeId: n.id }))
    diagnostics.missingErrorPath.forEach(n => items.push({ type: 'warning', code: 'MISSING_ERROR_PATH', message: `Node "${n.title}" is missing Timeout/Error fallback path.`, nodeId: n.id }))
    diagnostics.convergingNodes.forEach(c => {
      const existingMenu = nodes.find(n => (n.type === 'dtmf_menu' || (n.type as string) === 'menu') && n.id !== c.id)
      const isAlreadyConnected = existingMenu ? edges.some(e =>
        (e.sourceId === existingMenu.id && e.targetId === c.id) ||
        (e.sourceId === c.id && e.targetId === existingMenu.id)
      ) : false
      if (!isAlreadyConnected) {
        items.push({ type: 'warning', code: 'CONVERGING_PATHS', message: `Branching hub deleted or collapsed routing around "${c.title}" without a Menu.`, nodeId: c.id })
      }
    })
    diagnostics.duplicateMenus.forEach(m => items.push({ type: 'error', code: 'DUPLICATE_MENU', message: `Duplicate Menu node "${m.title}" found.`, nodeId: m.id }))

    nodes.forEach(n => {
      if (n.disabled) items.push({ type: 'warning', code: 'NODE_DISABLED', message: `Node "${n.title}" is currently disabled.`, nodeId: n.id })
      if (n.type === 'greeting' && (!n.subtitle || n.subtitle.trim() === '')) items.push({ type: 'error', code: 'MISSING_AUDIO', message: `Greeting node "${n.title}" is missing an audio file selection.`, nodeId: n.id })
      if (n.type === 'api' && (!n.subtitle || !n.subtitle.startsWith('http'))) items.push({ type: 'error', code: 'INVALID_ENDPOINT', message: `API Request node "${n.title}" is missing a valid HTTP endpoint URL.`, nodeId: n.id })
    })

    backendValidationIssues.forEach(issue => {
      if (issue.nodeId) {
        if (issue.code === 'CONVERGING_PATHS' || issue.code === 'DELETED_BRANCHING_HUB' || issue.message.includes('converge')) {
          const existingMenu = nodes.find(n => (n.type === 'dtmf_menu' || (n.type as string) === 'menu') && n.id !== issue.nodeId)
          const isAlreadyConnected = existingMenu ? edges.some(e =>
            (e.sourceId === existingMenu.id && e.targetId === issue.nodeId) ||
            (e.sourceId === issue.nodeId && e.targetId === existingMenu.id)
          ) : false
          if (isAlreadyConnected) return
        }
        if (issue.message.includes('unreachable') || issue.message.includes('disconnected')) {
          const isOrphan = diagnostics.orphanNodes.some(n => n.id === issue.nodeId)
          const isDisconnected = diagnostics.disconnectedNodes.some(n => n.id === issue.nodeId)
          if (!isOrphan && !isDisconnected) return
        }
      }

      const severity: 'error' | 'warning' | 'info' = issue.severity === 'error' ? 'error' : issue.severity === 'warning' ? 'warning' : 'info'
      const exists = items.some(item => item.message === issue.message && item.nodeId === issue.nodeId)
      if (!exists) items.push({ type: severity, code: issue.code || 'VALIDATION_ISSUE', message: issue.message, nodeId: issue.nodeId })
    })
    return items
  }, [nodes, edges, diagnostics, backendValidationIssues])

  const validateAndFixSuggestionApply = useCallback((updatedNodes: FlowNode[], updatedEdges: FlowEdge[]) => {
    const startNode = updatedNodes.find(n => n.type === 'start')
    const startId = startNode?.id
    const nodeIdsWithIncoming = new Set(updatedEdges.map(e => e.targetId))
    const orphanedNodes = updatedNodes.filter(n => n.id !== startId && !nodeIdsWithIncoming.has(n.id))
    if (orphanedNodes.length > 0) {
      addLog(`Auto-repaired (Safety Net): reconnected ${orphanedNodes.length} orphaned node(s)`, 'info')
      orphanedNodes.forEach(orphan => {
        const precedingNode = updatedNodes.find(prev => prev.id !== orphan.id && prev.type !== 'end') || startNode
        if (precedingNode && precedingNode.id !== orphan.id) {
          updatedEdges.push({ id: `e_reconnect_${precedingNode.id}_${orphan.id}`, sourceId: precedingNode.id, sourcePort: 'out', targetId: orphan.id, targetPort: 'in', label: 'Auto-Reconnected' })
        }
      })
    }
    const greetingNodes = updatedNodes.filter(n => n.type === 'greeting')
    if (greetingNodes.length > 1) {
      const duplicateGreetingIds = new Set(greetingNodes.slice(1).map(n => n.id))
      addLog(`Auto-repaired (Safety Net): removed ${duplicateGreetingIds.size} duplicate greeting node(s)`, 'info')
      updatedNodes = updatedNodes.filter(n => !duplicateGreetingIds.has(n.id))
      updatedEdges = updatedEdges.filter(e => !duplicateGreetingIds.has(e.targetId))
    }
    const isMenuType = (t: string) => t === 'dtmf_menu' || (t as string) === 'menu'
    const menuNodes = updatedNodes.filter(n => isMenuType(n.type))
    if (menuNodes.length > 1) {
      const menuByTitle = new Map<string, FlowNode[]>()
      menuNodes.forEach(m => {
        const titleKey = (m.title || 'menu').trim().toLowerCase()
        if (!menuByTitle.has(titleKey)) menuByTitle.set(titleKey, [])
        menuByTitle.get(titleKey)!.push(m)
      })

      const duplicateMenuIds = new Set<string>()
      menuByTitle.forEach((group) => {
        if (group.length > 1) {
          const primary = group[0]
          group.slice(1).forEach(dup => {
            duplicateMenuIds.add(dup.id)
            updatedEdges = updatedEdges.map(e => {
              let newSource = e.sourceId
              let newTarget = e.targetId
              if (e.sourceId === dup.id) newSource = primary.id
              if (e.targetId === dup.id) newTarget = primary.id
              return { ...e, sourceId: newSource, targetId: newTarget }
            }).filter(e => e.sourceId !== e.targetId)
          })
          addLog(`Auto-repaired: merged ${group.length - 1} duplicate menu node(s) titled "${primary.title}"`, 'info')
        }
      })
      if (duplicateMenuIds.size > 0) {
        updatedNodes = updatedNodes.filter(n => !duplicateMenuIds.has(n.id))
      }
    }
    const endNodes = updatedNodes.filter(n => n.type === 'end')
    if (endNodes.length > 1) {
      const duplicateEndIds = new Set(endNodes.slice(1).map(n => n.id))
      addLog(`AI Suggestion validation: removed ${duplicateEndIds.size} duplicate end node(s)`, 'warn')
      updatedNodes = updatedNodes.filter(n => !duplicateEndIds.has(n.id))
      updatedEdges = updatedEdges.filter(e => !duplicateEndIds.has(e.targetId) && !duplicateEndIds.has(e.sourceId))
    }
    return { nodes: updatedNodes, edges: updatedEdges }
  }, [addLog])

  const getFirstValidOutputPort = useCallback((type: string): string => {
    const def = NODE_DEFS[type as NodeType]
    if (def && def.outputPorts && def.outputPorts.length > 0) return def.outputPorts[0].id
    return 'out'
  }, [])

  const applyReinsertMenuForNode = useCallback((targetNodeId: string): boolean => {
    const srcNode = nodes.find(n => n.id === targetNodeId)
    if (!srcNode) return false

    const inEdges = edges.filter(e => e.targetId === targetNodeId)
    const outEdges = edges.filter(e => e.sourceId === targetNodeId)

    if (inEdges.length < 2 && outEdges.length < 2) return false

    // Requirement 1 & 2: Reuse existing MENU node if one exists
    const existingMenu = nodes.find(n => (n.type === 'dtmf_menu' || (n.type as string) === 'menu') && n.id !== targetNodeId)

    if (existingMenu) {
      const remainingEdges = [...edges]

      if (inEdges.length >= 2) {
        const sourceNodeIds = Array.from(new Set(inEdges.map(e => e.sourceId)))
        sourceNodeIds.forEach(sId => {
          remainingEdges.forEach(e => {
            if (e.sourceId === sId && e.targetId === targetNodeId) {
              e.targetId = existingMenu.id
              e.targetPort = 'in'
            }
          })
        })
        const alreadyConnected = remainingEdges.some(e => e.sourceId === existingMenu.id && e.targetId === targetNodeId)
        if (!alreadyConnected) {
          const availPort = existingMenu.ports?.find(p => p.type === 'output')?.id || 'option_1'
          remainingEdges.push({
            id: `e_${existingMenu.id}_${srcNode.id}`,
            sourceId: existingMenu.id,
            sourcePort: availPort,
            targetId: srcNode.id,
            targetPort: 'in',
            label: 'Selected',
          })
        }
      } else if (outEdges.length >= 2) {
        const targetNodeIds = outEdges.map(e => e.targetId)
        remainingEdges.forEach(e => {
          if (e.sourceId === targetNodeId && targetNodeIds.includes(e.targetId)) {
            e.sourceId = existingMenu.id
          }
        })
        const alreadyConnectedSrc = remainingEdges.some(e => e.sourceId === targetNodeId && e.targetId === existingMenu.id)
        if (!alreadyConnectedSrc) {
          const srcPort = getFirstValidOutputPort(srcNode.type) || 'out'
          remainingEdges.push({
            id: `e_${srcNode.id}_${existingMenu.id}`,
            sourceId: srcNode.id,
            sourcePort: srcPort,
            targetId: existingMenu.id,
            targetPort: 'in',
            label: 'Menu',
          })
        }
      }

      const validated = validateGraph(nodes, remainingEdges)
      const { nodes: fixedNodes, edges: fixedEdges } = validateAndFixSuggestionApply(validated.nodes, validated.edges)

      const isIdentical = fixedNodes.length === nodes.length &&
                          fixedEdges.length === edges.length &&
                          edges.every(origE => fixedEdges.some(fE => fE.sourceId === origE.sourceId && fE.sourcePort === origE.sourcePort && fE.targetId === origE.targetId && fE.targetPort === origE.targetPort))

      if (isIdentical) {
        addLog(`No change needed — "${srcNode.title}" is already connected to ${existingMenu.title}`, 'info')
        return false
      }

      setNodes(fixedNodes)
      setEdges(fixedEdges)
      pushHistory(fixedNodes, fixedEdges)
      addLog(`Applied AI Suggestion: Reused existing Menu "${existingMenu.title}" for "${srcNode.title}"`, 'info')
      return true
    }

    // No existing menu found — create a new Menu node with collision-free title
    const menuId = getNextNodeId(nodes)

    if (inEdges.length >= 2) {
      const sourceNodeIds = Array.from(new Set(inEdges.map(e => e.sourceId)))
      const menuPorts = sourceNodeIds.map((sId, idx) => {
        const sNode = nodes.find(n => n.id === sId)
        return {
          id: `option_${idx + 1}`,
          label: `Option ${idx + 1} (${sNode?.title || 'Branch'})`,
          color: '#3B82F6',
          type: 'output' as const,
        }
      })

      const existingTitles = new Set(nodes.map(n => n.title.toLowerCase()))
      const menuTitle = !existingTitles.has('main menu') ? 'Main Menu' : `Branch Menu ${nodes.filter(n => n.type === 'dtmf_menu').length + 1}`

      const menuNode: FlowNode = {
        id: menuId,
        type: 'dtmf_menu',
        x: Math.max(100, srcNode.x - 220),
        y: srcNode.y,
        title: menuTitle,
        subtitle: 'DTMF Menu',
        status: 'valid',
        collapsed: false,
        disabled: false,
        ports: menuPorts,
      }

      const updatedNodes = [...nodes, menuNode]
      const remainingEdges = edges.filter(e => e.targetId !== targetNodeId)

      sourceNodeIds.forEach(sId => {
        const sNode = nodes.find(n => n.id === sId)
        const srcPort = sNode ? (getFirstValidOutputPort(sNode.type) || 'out') : 'out'
        remainingEdges.push({
          id: `e_${sId}_${menuId}`,
          sourceId: sId,
          sourcePort: srcPort,
          targetId: menuId,
          targetPort: 'in',
          label: 'To Menu',
        })
      })

      remainingEdges.push({
        id: `e_${menuId}_${srcNode.id}`,
        sourceId: menuId,
        sourcePort: 'option_1',
        targetId: srcNode.id,
        targetPort: 'in',
        label: 'Selected',
      })

      const validated = validateGraph(updatedNodes, remainingEdges)
      const { nodes: fixedNodes, edges: fixedEdges } = validateAndFixSuggestionApply(validated.nodes, validated.edges)
      setNodes(fixedNodes)
      setEdges(fixedEdges)
      pushHistory(fixedNodes, fixedEdges)
      addLog(`Applied AI Suggestion: Re-inserted Menu "${menuNode.title}" for converging paths into "${srcNode.title}"`, 'info')
      return true
    }

    const targetNodeIds = outEdges.map(e => e.targetId)
    const menuPorts = targetNodeIds.map((tId, idx) => {
      const tNode = nodes.find(n => n.id === tId)
      return {
        id: `option_${idx + 1}`,
        label: `Option ${idx + 1} (${tNode?.title || 'Branch'})`,
        color: '#3B82F6',
        type: 'output' as const,
      }
    })

    const existingTitles = new Set(nodes.map(n => n.title.toLowerCase()))
    const menuTitle = !existingTitles.has('main menu') ? 'Main Menu' : `Branch Menu ${nodes.filter(n => n.type === 'dtmf_menu').length + 1}`

    const menuNode: FlowNode = {
      id: menuId,
      type: 'dtmf_menu',
      x: srcNode.x + 220,
      y: srcNode.y,
      title: menuTitle,
      subtitle: 'DTMF Menu',
      status: 'valid',
      collapsed: false,
      disabled: false,
      ports: menuPorts,
    }

    const updatedNodes = [...nodes, menuNode]
    const remainingEdges = edges.filter(e => e.sourceId !== targetNodeId)

    const srcPort = getFirstValidOutputPort(srcNode.type) || 'out'
    remainingEdges.push({
      id: `e_${srcNode.id}_${menuId}`,
      sourceId: srcNode.id,
      sourcePort: srcPort,
      targetId: menuId,
      targetPort: 'in',
      label: 'Menu',
    })

    targetNodeIds.forEach((tId, idx) => {
      remainingEdges.push({
        id: `e_${menuId}_${idx + 1}_${tId}`,
        sourceId: menuId,
        sourcePort: `option_${idx + 1}`,
        targetId: tId,
        targetPort: 'in',
        label: `Option ${idx + 1}`,
      })
    })

    const validated = validateGraph(updatedNodes, remainingEdges)
    const { nodes: fixedNodes, edges: fixedEdges } = validateAndFixSuggestionApply(validated.nodes, validated.edges)
    setNodes(fixedNodes)
    setEdges(fixedEdges)
    pushHistory(fixedNodes, fixedEdges)
    addLog(`Applied AI Suggestion: Re-inserted Menu "${menuNode.title}" for "${srcNode.title}" with ${targetNodeIds.length} option branches`, 'info')
    return true
  }, [nodes, edges, getFirstValidOutputPort, validateAndFixSuggestionApply, pushHistory, addLog])

  const currentSuggestions = useMemo((): SuggestionItem[] => {
    const list: SuggestionItem[] = []
    const nodeCount = nodes.length

    if (nodeCount > 0) {
      const hasStart = nodes.some(n => n.type === 'start')
      if (!hasStart) {
        const suggId = 'sugg_add_start'
        list.push({
          id: suggId,
          text: 'Add a Start node to initialize the IVR flow',
          icon: '🚀',
          severity: 'error',
          applyAction: () => {
            if (nodes.some(n => n.type === 'start')) return false
            const newStart: FlowNode = {
              id: 'start',
              type: 'start',
              x: 100,
              y: 200,
              title: 'Start Call',
              subtitle: 'Entry Point',
              status: 'valid',
              collapsed: false,
              disabled: false,
              ports: [{ id: 'out', label: 'Call Connected', color: '#10B981', type: 'output' }],
            }
            const firstNode = nodes.find(n => n.id !== 'start')
            let updatedEdges = [...edges]
            if (firstNode) {
              updatedEdges.push({
                id: `e_start_${firstNode.id}`,
                sourceId: 'start',
                sourcePort: 'out',
                targetId: firstNode.id,
                targetPort: 'in',
                label: 'Begin Flow',
              })
            }
            const validated = validateGraph([newStart, ...nodes], updatedEdges)
            const { nodes: fixedNodes, edges: fixedEdges } = validateAndFixSuggestionApply(validated.nodes, validated.edges)
            setNodes(fixedNodes)
            setEdges(fixedEdges)
            setIgnoredSuggestionIds(prev => new Set(prev).add(suggId))
            pushHistory(fixedNodes, fixedEdges)
            addLog('Applied AI Suggestion: Added Start node', 'info')
            return true
          },
        })
      }

      const starts = nodes.filter(n => n.type === 'start')
      if (starts.length > 1) {
        const suggId = 'sugg_remove_extra_starts'
        list.push({
          id: suggId,
          text: `Remove ${starts.length - 1} duplicate Start node(s) — only 1 Start node is allowed`,
          icon: '⚠️',
          severity: 'error',
          applyAction: () => {
            const extraStartIds = new Set(starts.slice(1).map(n => n.id))
            const updatedNodes = nodes.filter(n => !extraStartIds.has(n.id))
            const updatedEdges = edges.filter(e => !extraStartIds.has(e.sourceId) && !extraStartIds.has(e.targetId))
            const validated = validateGraph(updatedNodes, updatedEdges)
            const { nodes: fixedNodes, edges: fixedEdges } = validateAndFixSuggestionApply(validated.nodes, validated.edges)
            setNodes(fixedNodes)
            setEdges(fixedEdges)
            setIgnoredSuggestionIds(prev => new Set(prev).add(suggId))
            pushHistory(fixedNodes, fixedEdges)
            addLog(`Applied AI Suggestion: Removed ${extraStartIds.size} duplicate Start node(s)`, 'info')
            return true
          },
        })
      }
    }

    const startNode = nodes.find(n => n.type === 'start')
    if (startNode) {
      const outFromStart = edges.filter(e => e.sourceId === startNode.id)
      if (outFromStart.length === 0) {
        const targetNode = nodes.find(n => n.id !== startNode.id && n.type !== 'end')
        if (targetNode) {
          const suggId = 'sugg_connect_start_out'
          list.push({
            id: suggId,
            text: `Connect Start node → "${targetNode.title}" to begin call handling`,
            icon: '🔗',
            severity: 'error',
            nodeId: startNode.id,
            applyAction: () => {
              const newEdge: FlowEdge = {
                id: `e_start_${targetNode.id}`,
                sourceId: startNode.id,
                sourcePort: 'out',
                targetId: targetNode.id,
                targetPort: 'in',
                label: 'Begin Flow',
              }
              const validated = validateGraph(nodes, [...edges, newEdge])
              const { nodes: fixedNodes, edges: fixedEdges } = validateAndFixSuggestionApply(validated.nodes, validated.edges)
              setNodes(fixedNodes)
              setEdges(fixedEdges)
              setIgnoredSuggestionIds(prev => new Set(prev).add(suggId))
              pushHistory(fixedNodes, fixedEdges)
              addLog(`Applied AI Suggestion: Connected Start node to ${targetNode.title}`, 'info')
              return true
            },
          })
        }
      }
    }

    diagnostics.disconnectedNodes.forEach(n => {
      if (n.type !== 'start') {
        const suggId = `sugg_disconnected_${n.id}`
        list.push({
          id: suggId,
          text: `Connect disconnected node "${n.title}" into the call flow`,
          icon: '🔌',
          severity: 'warning',
          nodeId: n.id,
          applyAction: () => {
            const precedingNode = nodes.find(sn => sn.id !== n.id && sn.type !== 'end') || startNode
            if (!precedingNode) return false
            const sourcePort = getFirstValidOutputPort(precedingNode.type)
            const newEdge: FlowEdge = {
              id: `e_disc_${precedingNode.id}_${n.id}`,
              sourceId: precedingNode.id,
              sourcePort,
              targetId: n.id,
              targetPort: 'in',
              label: 'Connect',
            }
            const validated = validateGraph(nodes, [...edges, newEdge])
            const { nodes: fixedNodes, edges: fixedEdges } = validateAndFixSuggestionApply(validated.nodes, validated.edges)
            setNodes(fixedNodes)
            setEdges(fixedEdges)
            setIgnoredSuggestionIds(prev => new Set(prev).add(suggId))
            pushHistory(fixedNodes, fixedEdges)
            addLog(`Applied AI Suggestion: Connected disconnected node ${n.title}`, 'info')
            return true
          },
        })
      }
    })

    diagnostics.missingErrorPath.forEach(n => {
      const suggId = `sugg_missing_error_${n.id}`
      list.push({
        id: suggId,
        text: `Add Error/Timeout fallback path for "${n.title}"`,
        icon: '⚠️',
        severity: 'warning',
        nodeId: n.id,
        applyAction: () => {
          setIgnoredSuggestionIds(prev => new Set(prev).add(suggId))
          const targetNode = nodes.find(sn => sn.id !== n.id && (sn.type === 'transfer' || sn.type === 'voicemail' || sn.type === 'end')) || nodes.find(sn => sn.type === 'end')
          if (!targetNode) return false
          if (edges.some(e => e.sourceId === n.id && e.targetId === targetNode.id && (e.sourcePort === 'error' || e.sourcePort === 'timeout' || e.sourcePort === 'out'))) {
            return false
          }
          const newEdge: FlowEdge = {
            id: `e_err_${n.id}_${targetNode.id}`,
            sourceId: n.id,
            sourcePort: 'error',
            targetId: targetNode.id,
            targetPort: 'in',
            label: 'On Error',
          }
          const updatedEdges = [...edges, newEdge]
          const validated = validateGraph(nodes, updatedEdges)
          const { nodes: fixedNodes, edges: fixedEdges } = validateAndFixSuggestionApply(validated.nodes, validated.edges)
          setNodes(fixedNodes)
          setEdges(fixedEdges)
          pushHistory(fixedNodes, fixedEdges)
          addLog(`Applied AI Suggestion: Added Fallback path from ${n.title} to ${targetNode.title}`, 'info')
          return true
        },
      })
    })

    diagnostics.deadEnds.forEach(n => {
      if (n.type !== 'end' && (n.type as string) !== 'disconnect') {
        const suggId = `sugg_deadend_${n.id}`
        list.push({
          id: suggId,
          text: `Connect dead-end node "${n.title}" → End Call`,
          icon: '🔚',
          severity: 'warning',
          nodeId: n.id,
          applyAction: () => {
            const endNode = nodes.find(sn => sn.type === 'end')
            let targetId = endNode?.id
            let updatedNodes = [...nodes]
            if (!targetId) {
              const newEndId = getNextNodeId(nodes)
              const newEnd: FlowNode = { id: newEndId, type: 'end', x: n.x + 260, y: n.y, title: 'End Call', subtitle: 'Hang up connection', status: 'valid', collapsed: false, disabled: false, ports: [] }
              updatedNodes.push(newEnd)
              targetId = newEndId
            }
            const newEdge: FlowEdge = { id: `e_deadend_${n.id}_${targetId}_${generateUniqueId()}`, sourceId: n.id, sourcePort: 'out', targetId: targetId!, targetPort: 'in', label: 'Completed' }
            const updatedEdges = [...edges, newEdge]
            const validated = validateGraph(updatedNodes, updatedEdges)
            const { nodes: fixedNodes, edges: fixedEdges } = validateAndFixSuggestionApply(validated.nodes, validated.edges)
            setNodes(fixedNodes)
            setEdges(fixedEdges)
            setIgnoredSuggestionIds(prev => new Set(prev).add(suggId))
            pushHistory(fixedNodes, fixedEdges)
            addLog(`Applied AI Suggestion: Connected dead-end ${n.title} to End Call`, 'info')
            return true
          },
        })
      }
    })

    backendValidationIssues.forEach(issue => {
      const node = nodes.find(n => n.id === issue.nodeId)
      if (issue.code === 'INVALID_PORT' && node) {
        const validPort = getFirstValidOutputPort(node.type)
        const suggId = `sugg_invalid_port_${issue.nodeId}`
        if (!list.some(s => s.id === suggId)) {
          list.push({
            id: suggId,
            text: `Fix invalid port connection on "${node.title}": map to valid "${validPort}" port`,
            icon: '🔌',
            severity: 'error',
            nodeId: issue.nodeId,
            applyAction: () => {
              const hasInvalid = edges.some(e => e.sourceId === node.id && e.sourcePort !== validPort)
              if (!hasInvalid) return false
              const updatedEdges = edges.map(e => e.sourceId === node.id ? { ...e, sourcePort: validPort } : e)
              const validated = validateGraph(nodes, updatedEdges)
              const { nodes: fixedNodes, edges: fixedEdges } = validateAndFixSuggestionApply(validated.nodes, validated.edges)
              setNodes(fixedNodes)
              setEdges(fixedEdges)
              setIgnoredSuggestionIds(prev => new Set(prev).add(suggId))
              pushHistory(fixedNodes, fixedEdges)
              addLog(`Applied AI Suggestion: Corrected invalid port connection to "${validPort}" on node "${node.title}"`, 'info')
              return true
            },
          })
        }
      }
      if ((issue.message.includes('unreachable') || issue.message.includes('disconnected')) && node) {
        const precedingNode = nodes.find(prev => prev.id !== node.id && prev.type !== 'end') || nodes.find(sn => sn.type === 'start')
        if (precedingNode) {
          const suggId = `sugg_reconnect_path_${issue.nodeId}`
          if (!list.some(s => s.id === suggId)) {
            list.push({
              id: suggId, text: `Connect unreachable node: "${precedingNode.title}" → "${node.title}"`, icon: '🔗', severity: 'warning', nodeId: issue.nodeId,
              applyAction: () => {
                if (edges.some(e => e.sourceId === precedingNode.id && e.targetId === node.id)) return false
                const sourcePort = getFirstValidOutputPort(precedingNode.type)
                const newEdge: FlowEdge = { id: `e_conn_${precedingNode.id}_${node.id}`, sourceId: precedingNode.id, sourcePort, targetId: node.id, targetPort: 'in', label: 'Auto-Connected' }
                const updatedEdges = [...edges, newEdge]
                const validated = validateGraph(nodes, updatedEdges)
                const { nodes: fixedNodes, edges: fixedEdges } = validateAndFixSuggestionApply(validated.nodes, validated.edges)
                setNodes(fixedNodes)
                setEdges(fixedEdges)
                setIgnoredSuggestionIds(prev => new Set(prev).add(suggId))
                pushHistory(fixedNodes, fixedEdges)
                addLog(`Applied AI Suggestion: Connected unreachable node "${node.title}" from "${precedingNode.title}"`, 'info')
                return true
              },
            })
          }
        }
      }
      if (issue.message.includes('No End node is reachable')) {
        if (hasEndNode(nodes)) {
          const endNode = nodes.find(n => n.type === 'end')!
          const deadEnd = nodes.find(n => n.type !== 'end' && !edges.some(e => e.sourceId === n.id))
          if (deadEnd) {
            const suggId = `sugg_connect_end_reachable_${deadEnd.id}`
            list.push({
              id: suggId, text: `Route path to End node: Connect "${deadEnd.title}" → "${endNode.title}"`, icon: '🔚', severity: 'error',
              applyAction: () => {
                if (edges.some(e => e.sourceId === deadEnd.id && e.targetId === endNode.id)) return false
                const newEdge: FlowEdge = { id: `e_end_conn_${deadEnd.id}_${endNode.id}`, sourceId: deadEnd.id, sourcePort: getFirstValidOutputPort(deadEnd.type), targetId: endNode.id, targetPort: 'in', label: 'To End' }
                const updatedEdges = [...edges, newEdge]
                const validated = validateGraph(nodes, updatedEdges)
                const { nodes: fixedNodes, edges: fixedEdges } = validateAndFixSuggestionApply(validated.nodes, validated.edges)
                setNodes(fixedNodes)
                setEdges(fixedEdges)
                setIgnoredSuggestionIds(prev => new Set(prev).add(suggId))
                pushHistory(fixedNodes, fixedEdges)
                addLog(`Applied AI Suggestion: Connected "${deadEnd.title}" to End node`, 'info')
                return true
              },
            })
          }
        } else {
          const suggId = 'sugg_add_end_node_reachable'
          list.push({
            id: suggId, text: 'Insert End Call node to provide a terminating call path', icon: '🔚', severity: 'error',
            applyAction: () => {
              if (hasEndNode(nodes)) return false
              const endId = getNextNodeId(nodes)
              const endNode: FlowNode = { id: endId, type: 'end', x: 700, y: 350, title: 'End Call', subtitle: 'Hang up connection', status: 'valid', collapsed: false, disabled: false, ports: [] }
              const updatedNodes = [...nodes, endNode]
              const precedingNode = nodes.find(n => n.type !== 'start' && n.type !== 'end' && !edges.some(e => e.sourceId === n.id))
              let updatedEdges = [...edges]
              if (precedingNode && !edges.some(e => e.sourceId === precedingNode.id && e.targetId === endId)) {
                updatedEdges.push({ id: `e_end_${precedingNode.id}_${endId}`, sourceId: precedingNode.id, sourcePort: getFirstValidOutputPort(precedingNode.type), targetId: endId, targetPort: 'in' })
              }
              const validated = validateGraph(updatedNodes, updatedEdges)
              const { nodes: fixedNodes, edges: fixedEdges } = validateAndFixSuggestionApply(validated.nodes, validated.edges)
              setNodes(fixedNodes)
              setEdges(fixedEdges)
              setIgnoredSuggestionIds(prev => new Set(prev).add(suggId))
              pushHistory(fixedNodes, fixedEdges)
              addLog('Applied AI Suggestion: Inserted End Call node and connected terminating path', 'info')
              return true
            },
          })
        }
      }
      if (issue.code === 'DELETED_BRANCHING_HUB' || issue.message.includes('branching menu node was likely deleted')) {
        const node = nodes.find(n => n.id === issue.nodeId)
        const suggId = `sugg_hub_deleted_${issue.nodeId}`
        if (!list.some(s => s.id === suggId)) {
          list.push({
            id: suggId,
            text: `Critical: Branching Menu node deleted — "${node?.title || issue.nodeId}" has multiple unbranched paths. Re-insert Menu node.`,
            icon: '🚨',
            severity: 'error',
            nodeId: issue.nodeId,
            applyAction: () => {
              const res = applyReinsertMenuForNode(issue.nodeId || node?.id || '')
              if (res) setIgnoredSuggestionIds(prev => new Set(prev).add(suggId))
              return res
            },
          })
        }
      }
      if (issue.message.includes('Multiple incoming paths') || issue.message.includes('converge into node') || issue.code === 'CONVERGING_PATHS') {
        const node = nodes.find(n => n.id === issue.nodeId)
        const suggId = `sugg_converging_${issue.nodeId}`
        if (!list.some(s => s.id === suggId)) {
          list.push({
            id: suggId,
            text: `Unbranched routing: ${issue.message}`,
            icon: '🔀',
            severity: 'error',
            nodeId: issue.nodeId,
            applyAction: () => {
              const res = applyReinsertMenuForNode(issue.nodeId || node?.id || '')
              if (res) setIgnoredSuggestionIds(prev => new Set(prev).add(suggId))
              return res
            },
          })
        }
      }
    })

    diagnostics.convergingNodes.forEach(c => {
      const existingMenu = nodes.find(n => (n.type === 'dtmf_menu' || (n.type as string) === 'menu') && n.id !== c.id)
      if (existingMenu) {
        const isAlreadyConnected = edges.some(e =>
          (e.sourceId === existingMenu.id && e.targetId === c.id) ||
          (e.sourceId === c.id && e.targetId === existingMenu.id)
        )
        const inEdges = edges.filter(e => e.targetId === c.id)
        const outEdges = edges.filter(e => e.sourceId === c.id)
        const unbranchedIn = inEdges.filter(e => e.sourceId !== existingMenu.id)
        const unbranchedOut = outEdges.filter(e => e.targetId !== existingMenu.id)
        if (isAlreadyConnected && unbranchedIn.length < 2 && unbranchedOut.length < 2) {
          return // Skip generating suggestion — target node is already satisfied
        }
      }

      const suggId = `sugg_local_converging_${c.id}`
      if (!list.some(s => s.id === suggId)) {
        list.push({
          id: suggId,
          text: `Branching hub deleted or collapsed routing: ${c.count} call paths converge/branch around "${c.title}" without a Menu`,
          icon: '🔀',
          severity: 'error',
          nodeId: c.id,
          applyAction: () => {
            const res = applyReinsertMenuForNode(c.id)
            if (res) setIgnoredSuggestionIds(prev => new Set(prev).add(suggId))
            return res
          },
        })
      }
    })

    diagnostics.duplicateMenus.forEach(m => {
      const suggId = `sugg_remove_duplicate_menu_${m.id}`
      if (!list.some(s => s.id === suggId)) {
        list.push({
          id: suggId,
          text: `Remove duplicate Menu node "${m.title}" — merge or remove redundant menu`,
          icon: '🗑️',
          severity: 'error',
          nodeId: m.id,
          applyAction: () => {
            const updatedNodes = nodes.filter(n => n.id !== m.id)
            const updatedEdges = edges.filter(e => e.sourceId !== m.id && e.targetId !== m.id)
            const validated = validateGraph(updatedNodes, updatedEdges)
            const { nodes: fixedNodes, edges: fixedEdges } = validateAndFixSuggestionApply(validated.nodes, validated.edges)
            setNodes(fixedNodes)
            setEdges(fixedEdges)
            setIgnoredSuggestionIds(prev => new Set(prev).add(suggId))
            pushHistory(fixedNodes, fixedEdges)
            addLog(`Applied AI Suggestion: Removed duplicate Menu node "${m.title}"`, 'info')
            return true
          },
        })
      }
    })

    const severityRank: Record<string, number> = { error: 0, warning: 1, info: 2 }
    const filtered = list.filter(s => !ignoredSuggestionIds.has(s.id))

    const seenSuggestionKeys = new Set<string>()
    const seenNodeStructuralFixes = new Set<string>()
    const deduplicatedSuggestions: SuggestionItem[] = []

    for (const item of filtered) {
      const normText = (item.text || '').toLowerCase().trim().replace(/\s+/g, ' ')
      const normNodeId = (item.nodeId || 'global').toLowerCase().trim()
      const key = `${normNodeId}::${normText}`

      const lowerText = item.text.toLowerCase()
      const isMenuReconnectFix = lowerText.includes('re-insert menu') || lowerText.includes('reused existing menu') || lowerText.includes('branching hub')
      if (isMenuReconnectFix && item.nodeId) {
        const structuralKey = `menu_fix::${item.nodeId}`
        if (seenNodeStructuralFixes.has(structuralKey)) {
          continue
        }
        seenNodeStructuralFixes.add(structuralKey)
      }

      if (!seenSuggestionKeys.has(key)) {
        seenSuggestionKeys.add(key)
        deduplicatedSuggestions.push(item)
      }
    }

    return deduplicatedSuggestions.sort((a, b) => (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9))
  }, [nodes, edges, diagnostics, ignoredSuggestionIds, pushHistory, addLog, backendValidationIssues, validateAndFixSuggestionApply, applyReinsertMenuForNode])

  const handleApplyAllSuggestions = useCallback(() => {
    if (currentSuggestions.length === 0) return
    addLog('Applying AI suggestions...', 'info')
    let appliedCount = 0
    let alreadySatisfiedCount = 0
    const initialEdgeCount = edges.length
    const initialNodeCount = nodes.length
    const appliedNodeIds = new Set<string>()

    for (const s of currentSuggestions) {
      if (s.nodeId && appliedNodeIds.has(s.nodeId)) continue
      if (s.applyAction) {
        const pastCount = (appliedSuggestionHistoryRef.current.get(s.id) || 0) + 1
        appliedSuggestionHistoryRef.current.set(s.id, pastCount)
        if (pastCount > 2) {
          addLog(`AI Suggestion "${s.text}" could not converge after ${pastCount - 1} attempts — stopping auto-apply for manual review`, 'warn')
          setIgnoredSuggestionIds(prev => new Set(prev).add(s.id))
          continue
        }
        const res = s.applyAction()
        if (res !== false) {
          appliedCount++
          if (s.nodeId) {
            appliedNodeIds.add(s.nodeId)
            const matchingIds = currentSuggestions.filter(item => item.nodeId === s.nodeId).map(item => item.id)
            setIgnoredSuggestionIds(prev => {
              const next = new Set(prev)
              matchingIds.forEach(id => next.add(id))
              return next
            })
          }
        } else {
          alreadySatisfiedCount++
        }
      }
    }

    const newConnectionsAdded = Math.max(0, edges.length - initialEdgeCount)
    const newNodesAdded = Math.max(0, nodes.length - initialNodeCount)

    if (appliedCount > 0) {
      setAppliedSuggestionCount(prev => prev + appliedCount)
      if (alreadySatisfiedCount > 0) {
        addLog(`AI suggestions evaluated: ${appliedCount} suggestion(s) applied — ${newConnectionsAdded} new connection(s) and ${newNodesAdded} new node(s) added (${alreadySatisfiedCount} were already satisfied)`, 'info')
      } else {
        addLog(`AI suggestions applied successfully (${appliedCount}) — ${newConnectionsAdded} new connection(s) added`, 'info')
      }
    } else if (alreadySatisfiedCount > 0) {
      addLog(`All ${alreadySatisfiedCount} AI suggestion(s) were already satisfied — no structural changes needed`, 'info')
    } else {
      addLog('No AI suggestions could be applied — manual review recommended', 'warn')
    }
  }, [currentSuggestions, edges.length, nodes.length, addLog])

  useEffect(() => {
    if (appliedSuggestionCount > 0) {
      const timer = setTimeout(() => setAppliedSuggestionCount(0), 3000)
      return () => clearTimeout(timer)
    }
  }, [appliedSuggestionCount])

  const handleGenerateSuggestionsAgain = useCallback(() => {
    setIgnoredSuggestionIds(new Set())
    addLog('Regenerated AI suggestions list', 'info')
  }, [addLog])

  const handleMoveNode = useCallback((id: string, x: number, y: number) => {
    setNodes(ns => ns.map(n => n.id === id ? { ...n, x, y } : n))
  }, [])

  const handleDropNode = useCallback((type: string, x: number, y: number) => {
    const def = NODE_DEFS[type as NodeType] || { label: type, description: '', outputPorts: [] }
    const id = generateUniqueId()
    const newNode: FlowNode = { id, type: type as NodeType, x, y, title: def.label, subtitle: def.description, status: 'idle', collapsed: false, disabled: false, ports: def.outputPorts.map(p => ({ ...p, type: 'output' })) }
    const updatedNodes = [...nodes, newNode]
    setNodes(updatedNodes)
    setSelectedId(id)
    pushHistory(updatedNodes, edges)
    addLog(`Added Node [${def.label}] to canvas`, 'info')
  }, [nodes, edges, pushHistory, addLog])

  const handleAddEdge = useCallback((edge: FlowEdge) => {
    const updatedEdges = [...edges, edge]
    setEdges(updatedEdges)
    pushHistory(nodes, updatedEdges)
    addLog(`Created Connection between ${edge.sourceId} and ${edge.targetId}`, 'info')
  }, [nodes, edges, pushHistory, addLog])

  const handleCollapseNode = useCallback((id: string) => {
    setNodes(ns => ns.map(n => n.id === id ? { ...n, collapsed: !n.collapsed } : n))
  }, [])

  const handleNodeChange = useCallback((updatedNode: FlowNode) => {
    setNodes(ns => ns.map(n => n.id === updatedNode.id ? updatedNode : n))
    addLog(`Updated Node parameters [${updatedNode.title}]`, 'info')
  }, [addLog])

  const handleEdgeChange = useCallback((updatedEdge: FlowEdge) => {
    setEdges(es => es.map(e => e.id === updatedEdge.id ? updatedEdge : e))
    addLog(`Updated Connection label [${updatedEdge.label || updatedEdge.id}]`, 'info')
  }, [addLog])

  const handleAutoLayout = useCallback(() => {
    const result = optimizeFlow(nodes, edges)
    setNodes(result.nodes)
    setEdges(result.edges)
    pushHistory(result.nodes, result.edges)
    addLog(`Applied Flow Optimization: ${result.summary}`, 'info')
  }, [nodes, edges, pushHistory, addLog])

  const handleExportVxml = async () => {
    try {
      const flowJsonStr = JSON.stringify({ name: flowName, nodes, edges })
      const { vxml } = await aiApi.exportVxml(flowJsonStr)
      const blob = new Blob([vxml], { type: 'application/voicexml+xml' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const slug = flowName
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'ivr_flow'
      a.download = `${slug}.vxml`
      a.click()
      URL.revokeObjectURL(url)
      addLog('Exported flow as VoiceXML (.vxml)', 'info')
    } catch (err: any) {
      console.error('[IVRBuilder] Failed to export VXML:', err)
      addLog(`Export failed: ${err.message || err}`, 'error')
    }
  }



  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Reset file input so the same file can be re-imported later
    e.target.value = ''

    const reader = new FileReader()
    reader.onload = async (event) => {
      const rawText = event.target?.result as string
      if (!rawText) return

      // Detect file type: VXML if the filename ends in .vxml OR content starts with XML declaration
      const isVxml = file.name.toLowerCase().endsWith('.vxml') || rawText.trimStart().startsWith('<?xml')

      if (isVxml) {
        // ── VXML path: send to backend VxmlToModelConverter ──────────────────
        addLog(`Importing VoiceXML file "${file.name}" via backend converter…`, 'info')
        try {
          const result = await aiApi.importVxml(rawText)
          console.log('[IVRBuilder] IMPORT_VXML API response payload:', result)

          if (result.nodes && Array.isArray(result.nodes) && result.nodes.length > 0) {
            addLog(`Received ${result.nodes.length} node(s) and ${(result.edges || []).length} edge(s) from VXML converter`, 'info')

            const hasValidPositions = result.nodes.every(
              (n: any) => typeof n.x === 'number' && typeof n.y === 'number' && (n.x !== 0 || n.y !== 0)
            )

            let renderableNodes = result.nodes.map((n: any, idx: number) => ({
              ...n,
              x: typeof n.x === 'number' && n.x !== 0 ? n.x : 100 + (idx % 4) * 260,
              y: typeof n.y === 'number' && n.y !== 0 ? n.y : 100 + Math.floor(idx / 4) * 160,
              status: n.status || 'valid',
              collapsed: n.collapsed || false,
              disabled: n.disabled || false,
              ports: n.ports || []
            }))

            let renderableEdges = result.edges || []

            // Automatically run auto-layout if nodes lack non-zero positions (freshly imported VXML nodes)
            if (!hasValidPositions) {
              addLog('Auto-arranging imported flow layout...', 'info')
              const layoutResult = optimizeFlow(renderableNodes, renderableEdges)
              renderableNodes = layoutResult.nodes
              renderableEdges = layoutResult.edges
            }

            const validated = validateGraph(renderableNodes, renderableEdges)
            setNodes(validated.nodes)
            setEdges(validated.edges)
            const importedFlowName = result.flowName || file.name.replace(/\.[^/.]+$/, '')
            setFlowName(importedFlowName)
            pushHistory(validated.nodes, validated.edges)
            syncFlowToSession(importedFlowName, validated.nodes, validated.edges)

            if (validated.nodes.length === 0) {
              console.warn('[IVRBuilder] Warning: Canvas rendered 0 nodes despite import response reporting nodes:', result)
              addLog(`Warning: Imported flow has 0 renderable nodes on canvas`, 'warn')
            } else {
              addLog(
                `Imported VoiceXML flow "${importedFlowName}" — ${validated.nodes.length} node(s) and ${validated.edges.length} connection(s) rendered on canvas.`,
                'info'
              )
            }
          } else {
            console.warn('[IVRBuilder] IMPORT_VXML API returned empty or invalid nodes array:', result)
            addLog(
              `Import failed: Backend returned no nodes for "${file.name}". The file may be empty or incompatible.`,
              'error'
            )
          }
        } catch (err: any) {
          const msg = err?.message || String(err)
          addLog(
            `Import failed for "${file.name}": ${msg}. Ensure the file is a valid VoiceXML 2.1 document exported from this application.`,
            'error'
          )
        }
      } else {
        // ── JSON path: client-side parse ─────────────────────────────
        try {
          const parsed = JSON.parse(rawText)
          if (parsed.nodes && Array.isArray(parsed.nodes) && parsed.nodes.length > 0) {
            const hasValidPositions = parsed.nodes.some(
              (n: any) => typeof n.x === 'number' && typeof n.y === 'number' && (n.x !== 0 || n.y !== 0)
            )

            let renderableNodes = parsed.nodes.map((n: any, idx: number) => ({
              ...n,
              x: typeof n.x === 'number' ? n.x : 100 + (idx % 4) * 260,
              y: typeof n.y === 'number' ? n.y : 100 + Math.floor(idx / 4) * 160,
              status: n.status || 'valid',
              collapsed: n.collapsed || false,
              disabled: n.disabled || false,
              ports: n.ports || []
            }))

            let renderableEdges = parsed.edges || []

            if (!hasValidPositions) {
              const layoutResult = optimizeFlow(renderableNodes, renderableEdges)
              renderableNodes = layoutResult.nodes
              renderableEdges = layoutResult.edges
            }


            const validated = validateGraph(renderableNodes, renderableEdges)
            setNodes(validated.nodes)
            setEdges(validated.edges)
            const importedFlowName = parsed.flowName || file.name.replace(/\.[^/.]+$/, '')
            setFlowName(importedFlowName)
            pushHistory(validated.nodes, validated.edges)
            syncFlowToSession(importedFlowName, validated.nodes, validated.edges)

            addLog(`Imported flow schema "${importedFlowName}" — ${validated.nodes.length} node(s) loaded.`, 'info')
          } else {
            addLog(
              `Import failed for "${file.name}": JSON does not contain a valid flow (missing "nodes" array).`,
              'error'
            )
          }
        } catch (err: any) {
          addLog(
            `Import failed for "${file.name}": Not valid JSON or VoiceXML. Only .json flow exports and .vxml files are supported.`,
            'error'
          )
          console.error('Failed to parse flow JSON', err)
        }
      }

    }
    reader.readAsText(file)
  }

  const handleContextMenu = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, nodeId })
    setSelectedId(nodeId)
  }, [])

  const handleContextMenuAction = (label: string) => {
    if (!contextMenu?.nodeId) { setContextMenu(null); return }
    const id = contextMenu.nodeId
    if (label === 'Duplicate') {
      const target = nodes.find(n => n.id === id)
      if (target) {
        const newNode: FlowNode = { ...target, id: generateUniqueId(), x: target.x + 40, y: target.y + 40, title: `${target.title} (Copy)` }
        const updatedNodes = [...nodes, newNode]
        const validated = validateGraph(updatedNodes, edges)
        setNodes(validated.nodes)
        pushHistory(validated.nodes, edges)
        addLog(`Duplicated Node [${target.title}]`, 'info')
      }
    } else if (label === 'Delete Node' || label === 'Delete') {
      const target = nodes.find(n => n.id === id)
      const isStartNode = target?.type === 'start'
      const isOnlyStart = nodes.filter(n => n.type === 'start').length === 1

      if (isStartNode && isOnlyStart) {
        addLog('Cannot delete the only Start node — it is the flow entry point. Add another Start node first or cancel.', 'error')
        setContextMenu(null)
        return
      }

      const result = reconnectAfterDelete(nodes, edges, id)
      const validated = validateGraph(result.nodes, result.edges)
      setNodes(validated.nodes)
      setEdges(validated.edges)
      setSelectedId(null)
      setIgnoredSuggestionIds(new Set())
      pushHistory(validated.nodes, validated.edges)
      addLog(`Smart Deleted Node [${target?.title || id}] — auto-reconnected ${result.reconnectedCount} path(s)`, 'warn')
    } else if (label === 'Disable Node' || label === 'Enable Node') {
      const updatedNodes = nodes.map(n => n.id === id ? { ...n, disabled: !n.disabled } : n)
      setNodes(updatedNodes)
      pushHistory(updatedNodes, edges)
    } else if (label === 'Rename') {
      const name = prompt('Enter new node name:')
      if (name) {
        const updatedNodes = nodes.map(n => n.id === id ? { ...n, title: name } : n)
        setNodes(updatedNodes)
        pushHistory(updatedNodes, edges)
      }
    }
    setContextMenu(null)
  }

  const syncFlowToSession = (resolvedFlowName: string, nodesList: any[], edgesList: any[]) => {
    const canonicalFlowContext = JSON.stringify({
      flowName: resolvedFlowName,
      nodes: nodesList.map((n: any) => ({ id: n.id, type: n.type, label: n.title, title: n.title, name: n.title, description: n.subtitle, prompt: n.prompt })),
      edges: edgesList.map((e: any) => ({ id: e.id, source: e.sourceId, target: e.targetId, label: e.label })),
    })
    localStorage.setItem(`nexus_flow_${sessionId}`, JSON.stringify({ nodes: nodesList, edges: edgesList, flowName: resolvedFlowName }))
    localStorage.setItem(`nexus_builder_nodes_${sessionId}`, JSON.stringify(nodesList))
    localStorage.setItem(`nexus_builder_edges_${sessionId}`, JSON.stringify(edgesList))
    localStorage.setItem(`nexus_builder_flowname_${sessionId}`, resolvedFlowName)
    aiApi.sendMessage(`__flow_sync__:${resolvedFlowName}:${nodesList.length}`, sessionId, 'CHAT', canonicalFlowContext).catch(err => console.warn('[NexusIVR] Flow context sync to backend failed:', err))
  }

  const handleFlowGenerated = useCallback((flow: { nodes: FlowNode[]; edges: FlowEdge[]; flowName: string }) => {
    const validated = validateGraph(flow.nodes, flow.edges)
    setNodes(validated.nodes)
    setEdges(validated.edges)
    const resolvedFlowName = flow.flowName
    setFlowName(resolvedFlowName)
    pushHistory(validated.nodes, validated.edges)
    syncFlowToSession(resolvedFlowName, validated.nodes, validated.edges)
    addLog(`AI Flow Generation complete: ${validated.nodes.length} nodes created`, 'info')
  }, [pushHistory, addLog, sessionId])

  const handleMouseDownResize = (e: React.MouseEvent) => {
    e.preventDefault()
    isDraggingRef.current = true
    startYRef.current = e.clientY
    startHeightRef.current = bottomHeight
    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current) return
      const deltaY = startYRef.current - moveEvent.clientY
      const newHeight = Math.min(Math.max(startHeightRef.current + deltaY, 80), 500)
      setBottomHeight(newHeight)
    }
    const handleMouseUp = () => {
      isDraggingRef.current = false
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  const filteredLogs = logs.filter(log => {
    if (logFilter !== 'all' && log.level !== logFilter) return false
    if (logSearch && !log.msg.toLowerCase().includes(logSearch.toLowerCase())) return false
    return true
  })

  const handlePublish = useCallback(() => {
    const btn = document.activeElement as HTMLButtonElement
    if (btn) btn.blur()
    
    // Convert flowName to a safe lowercase slug filename
    const slug = flowName.trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    
    setPublishFilename(slug ? `${slug}.vxml` : 'published_flow.vxml')
    setPublishExtension('')
    setShowPublishModal(true)
  }, [flowName])

  const handlePublishSubmit = useCallback(async () => {
    addLog(`Publishing scenario "${flowName}" to backend...`, 'info')
    setIsPublishing(true)
    try {
      const resolvedSlug = publishFilename.replace(/\.vxml$/, '')
      const result = await aiApi.publishFlow({
        flowId: sessionId || `flow_${Date.now()}`,
        flowName: resolvedSlug,
        extension: publishExtension.trim() || undefined,
        flowJson: JSON.stringify({ nodes, edges }),
      })

      setIsPublished(true)
      const timestamp = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      const newVer: FlowVersion = {
        id: `v_${Date.now()}`, versionId: `v_${Date.now()}`, sessionId, createdAt: timestamp, savedAt: timestamp,
        label: `${flowName} — Production v${versionsList.length + 1}`, tag: 'published', author: 'Mohamed H.',
        flow: { nodes: [...nodes], edges: [...edges] }, nodes: [...nodes], edges: [...edges],
        summary: `Published VXML scenario to ${result.filename}`, prompt: '', score: result.validationScore || 100
      }
      setVersionsList(v => [newVer, ...v])

      if (result.status === 'partially_published' || result.extensionRegistered === false) {
        const msg = result.extensionMessage || result.warning || 'Extension registration failed'
        addLog(`Flow published to ${result.filePath}, but extension registration failed: ${msg}`, 'warn')
        alert(`Flow VXML scenario published successfully to ${result.filePath}, but extension registration encountered an issue:\n\n${msg}`)
      } else {
        const extMsg = result.extensionMessage ? ` (${result.extensionMessage})` : ''
        addLog(`Published production version v${versionsList.length + 1} to ${result.filePath}${extMsg}`, 'info')
        alert(`Published successfully!\n\nScenario: ${result.filename}\nExtension: ${publishExtension.trim() || 'Auto-allocated'}\nPath: ${result.filePath}`)
      }

      setShowPublishModal(false)
      setTimeout(() => setIsPublished(false), 2500)
    } catch (err: any) {
      addLog(`Publish failed: ${err.message}`, 'error')
      alert(`Publish failed: ${err.message}`)
    } finally {
      setIsPublishing(false)
    }
  }, [flowName, publishFilename, publishExtension, sessionId, nodes, edges, versionsList, addLog])

  const handleSave = useCallback(async () => {
    const btn = document.activeElement as HTMLButtonElement
    if (btn) btn.blur()

    const flowJson = JSON.stringify({ nodes, edges })

    try {

      const result = await aiApi.saveDraft(
        {
          flowId: sessionId || `flow_${Date.now()}`,
          flowName,
          flowJson,
        },
        (attempt, maxAttempts, errorMsg) => {
          addLog(`Save draft attempt ${attempt}/${maxAttempts} failed (${errorMsg}). Retrying...`, 'warn')
        }
      )

      // Only reach here if the backend confirmed the file exists on disk
      setIsSaved(true)
      const timestamp = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      const newVer: FlowVersion = {
        id: `v_${Date.now()}`, versionId: `v_${Date.now()}`, sessionId, createdAt: timestamp, savedAt: timestamp,
        label: `${flowName} — Draft v${result.version}`, tag: 'draft', author: 'Mohamed H.',
        flow: { nodes: [...nodes], edges: [...edges] }, nodes: [...nodes], edges: [...edges],
        summary: `Draft v${result.version} saved to ${result.filename}`, prompt: '', score: 95
      }
      setVersionsList(v => [newVer, ...v])
      addLog(`Saved draft version v${result.version} → ${result.filename}`, 'info')
      setTimeout(() => setIsSaved(false), 2000)
    } catch (err: any) {
      addLog(`Save failed: ${err.message || 'Backend draft write did not confirm success'}`, 'error')
      alert(`Save failed: ${err.message || 'Backend draft write did not confirm success'}`)
    }
  }, [flowName, versionsList, sessionId, nodes, edges, addLog])

  const handleTitleEditStart = useCallback(() => {
    setEditingTitleValue(flowName)
    setIsEditingTitle(true)
    setTimeout(() => {
      titleInputRef.current?.focus()
      titleInputRef.current?.select()
    }, 10)
  }, [flowName])

  const handleTitleEditCommit = useCallback(async () => {
    const trimmed = editingTitleValue.trim()
    setIsEditingTitle(false)
    if (!trimmed) return // blank → discard
    if (trimmed === flowName) return // no change
    setFlowName(trimmed)
    addLog(`Flow renamed to "${trimmed}"`, 'info')
    // Sync to AI session conversation title
    try {
      await aiApi.renameConversation(sessionId, trimmed)
    } catch {
      // Non-critical: session rename failure doesn't affect the local canvas
    }
  }, [editingTitleValue, flowName, sessionId, addLog])

  const handleTitleEditCancel = useCallback(() => {
    setIsEditingTitle(false)
    setEditingTitleValue('') // discard
  }, [])

  const handleRestoreVersion = useCallback((version: FlowVersion) => {
    if (version.nodes && version.nodes.length > 0) {
      const validated = validateGraph(version.nodes, version.edges || [])
      setNodes(validated.nodes)
      setEdges(validated.edges)
      pushHistory(validated.nodes, validated.edges)
      setSelectedVersionId(null)
      setDraftNodes(null)
      setDraftEdges(null)
      setRightTab('props')
      addLog(`Restored Flow Version: ${version.label}`, 'info')
    }
  }, [pushHistory, addLog])

  const handleExitPreview = useCallback(() => {
    if (draftNodes && draftEdges) {
      const validated = validateGraph([...draftNodes], [...draftEdges])
      setNodes(validated.nodes)
      setEdges(validated.edges)
    }
    setSelectedVersionId(null)
    setDraftNodes(null)
    setDraftEdges(null)
    addLog('Exited version preview mode', 'info')
  }, [draftNodes, draftEdges, addLog])

  const handleSelectVersion = useCallback((version: FlowVersion | null) => {
    if (version) {
      if (!selectedVersionId) {
        setDraftNodes([...nodes])
        setDraftEdges([...edges])
      }
      setSelectedVersionId(version.id)
      const validated = validateGraph(version.nodes || [], version.edges || [])
      setNodes(validated.nodes)
      setEdges(validated.edges)
      addLog(`Previewing Version snapshot: ${version.label}`, 'info')
    } else {
      handleExitPreview()
    }
  }, [selectedVersionId, nodes, edges, handleExitPreview, addLog])

  useEffect(() => {
    (window as any).__nexusOpenInBuilder = (flow: { nodes?: FlowNode[]; edges?: FlowEdge[]; flowName?: string }) => {
      if (flow?.nodes) {
        const validated = validateGraph(flow.nodes, flow.edges || [])
        setNodes(validated.nodes)
        setEdges(validated.edges)
        if (flow.flowName) setFlowName(flow.flowName)
        pushHistory(validated.nodes, validated.edges)
        addLog(`Opened flow "${flow.flowName}" from AI Assistant`, 'info')
      }
    }
    return () => { delete (window as any).__nexusOpenInBuilder }
  }, [pushHistory, addLog])

  const handleBack = useCallback(() => {
    if (historyIndex > 0) {
      const confirmLeave = window.confirm('You have unsaved changes in your IVR flow. Are you sure you want to leave?')
      if (!confirmLeave) return
    }
    navigate('/tenant/ai-assistant')
  }, [historyIndex, navigate])

  return (
    <div className="flex flex-col h-screen bg-[#F8FAFC] overflow-hidden" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
      onClick={() => { setContextMenu(null) }}>
      <input ref={fileInputRef} type="file" accept=".json,.vxml,.xml,application/json,text/xml,application/xml" className="hidden" onChange={handleImport} />

      {/* ── TOP BAR ─────────────────────────────────────────── */}
      <header className="h-12 bg-white border-b border-[#E5E7EB] flex items-center px-4 gap-2 flex-shrink-0 z-30">
        <button
          onClick={handleBack}
          title="Back to AI Assistant"
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[#374151] hover:bg-[#F3F4F6] border border-[#E5E7EB] text-xs font-semibold transition-colors mr-1"
        >
          <ArrowLeft className="w-3.5 h-3.5 text-[#6B7280]" />
          <span className="hidden sm:inline">Back</span>
        </button>

        <div className="flex items-center gap-2.5 pr-4 border-r border-[#E5E7EB]">
          <div className="w-7 h-7 rounded-lg bg-[#2563EB] flex items-center justify-center flex-shrink-0">
            <Phone className="w-3.5 h-3.5 text-white" />
          </div>
          <div className="hidden sm:block">
            <div className="text-[#1F2937] font-bold text-xs leading-tight">NexusIVR</div>
            <div className="text-[#9CA3AF] text-[9px] leading-tight">IVR Builder</div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 px-3">
          <GitBranch className="w-3.5 h-3.5 text-[#9CA3AF] flex-shrink-0" />
          {isEditingTitle ? (
            <input
              ref={titleInputRef}
              id="flow-title-input"
              type="text"
              value={editingTitleValue}
              maxLength={80}
              onChange={e => setEditingTitleValue(e.target.value)}
              onBlur={handleTitleEditCommit}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); handleTitleEditCommit() }
                if (e.key === 'Escape') { e.preventDefault(); handleTitleEditCancel() }
              }}
              className="text-[#1F2937] font-semibold text-xs bg-white border border-[#2563EB] rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-[#2563EB] min-w-[120px] max-w-[240px]"
            />
          ) : (
            <span
              id="flow-title-display"
              title="Click to rename flow"
              onClick={handleTitleEditStart}
              className="text-[#1F2937] font-semibold text-xs cursor-text hover:bg-[#F3F4F6] rounded px-1 py-0.5 transition-colors select-none max-w-[200px] truncate"
            >
              {flowName}
            </span>
          )}
          {!isEditingTitle && (
            <span title="Rename flow" onClick={handleTitleEditStart} className="inline-flex items-center">
              <Pencil
                className="w-3 h-3 text-[#9CA3AF] cursor-pointer hover:text-[#2563EB] flex-shrink-0 transition-colors"
              />
            </span>
          )}
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold bg-[#FEF9C3] text-[#A16207] flex-shrink-0">DRAFT</span>
          
          <div className="flex items-center bg-[#F1F5F9] p-0.5 rounded-lg border border-[#E2E8F0] ml-2">
            <button
              onClick={() => setBuilderTab('build')}
              className={`flex items-center gap-1.5 px-3 py-0.5 rounded-md text-xs font-bold transition-all ${
                builderTab === 'build'
                  ? 'bg-white text-[#2563EB] shadow-sm'
                  : 'text-[#64748B] hover:text-[#1E293B]'
              }`}
            >
              <Move className="w-3.5 h-3.5" />
              <span>Build</span>
            </button>
            <button
              onClick={() => setBuilderTab('test')}
              className={`flex items-center gap-1.5 px-3 py-0.5 rounded-md text-xs font-bold transition-all ${
                builderTab === 'test'
                  ? 'bg-[#2563EB] text-white shadow-sm'
                  : 'text-[#64748B] hover:text-[#1E293B]'
              }`}
            >
              <Phone className="w-3.5 h-3.5" />
              <span>Test</span>
            </button>
          </div>
        </div>

        <div className="w-px h-5 bg-[#E5E7EB] mx-1" />

        <button onClick={handleUndo} disabled={historyIndex <= 0} title="Undo (Ctrl+Z)"
          className="w-7 h-7 rounded-lg flex items-center justify-center text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#1F2937] disabled:opacity-40">
          <Undo2 className="w-3.5 h-3.5" />
        </button>
        <button onClick={handleRedo} disabled={historyIndex >= historyStack.length - 1} title="Redo (Ctrl+Y)"
          className="w-7 h-7 rounded-lg flex items-center justify-center text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#1F2937] disabled:opacity-40">
          <Redo2 className="w-3.5 h-3.5" />
        </button>

        <div className="w-px h-5 bg-[#E5E7EB] mx-1" />

        <button onClick={() => setViewport(v => ({ ...v, scale: Math.min(2.5, v.scale * 1.2) }))} title="Zoom In"
          className="w-7 h-7 rounded-lg flex items-center justify-center text-[#6B7280] hover:bg-[#F3F4F6]">
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => setViewport(v => ({ ...v, scale: Math.max(0.2, v.scale * 0.8) }))} title="Zoom Out"
          className="w-7 h-7 rounded-lg flex items-center justify-center text-[#6B7280] hover:bg-[#F3F4F6]">
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => setViewport({ x: -40, y: -80, scale: 0.82 })} title="Fit / Center View"
          className="w-7 h-7 rounded-lg flex items-center justify-center text-[#6B7280] hover:bg-[#F3F4F6]">
          <Minimize2 className="w-3.5 h-3.5" />
        </button>

        <div className="w-px h-5 bg-[#E5E7EB] mx-1" />

        <button onClick={handleAutoLayout} title="Auto Layout"
          className="flex items-center gap-1.5 h-7 px-2 rounded-lg text-[#6B7280] hover:bg-[#F3F4F6] text-xs font-medium">
          <Move className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Auto Layout</span>
        </button>

        <button onClick={() => setRightTab('validation')} title="Validate Flow"
          className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#1F2937] transition-colors text-xs font-medium">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Validate</span>
        </button>

        <button onClick={() => { if (isSimulating) { setIsSimulating(false); setSimulatingId(null); if (simIntervalRef.current) clearInterval(simIntervalRef.current) } else { startSimulation() } }}
          className={`flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-xs font-medium transition-all ${isSimulating ? 'bg-[#EF4444] text-white' : 'bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0] hover:bg-[#DCFCE7]'}`}>
          {isSimulating ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          <span className="hidden md:inline">{isSimulating ? 'Stop' : 'Preview'}</span>
          {isSimulating && <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}
        </button>

        <div className="w-px h-5 bg-[#E5E7EB] mx-1" />

        <button onClick={() => fileInputRef.current?.click()} title="Import flow (.json or .vxml)"
          className="flex items-center gap-1.5 h-7 px-2 rounded-lg text-[#6B7280] hover:bg-[#F3F4F6] text-xs font-medium">
          <Upload className="w-3.5 h-3.5" />
          <span className="hidden lg:inline">Import</span>
        </button>
        <button onClick={handleExportVxml} title="Export VXML"
          className="flex items-center gap-1.5 h-7 px-2 rounded-lg text-[#6B7280] hover:bg-[#F3F4F6] text-xs font-medium">
          <Download className="w-3.5 h-3.5" />
          <span className="hidden lg:inline">Export</span>
        </button>

        <div className="w-px h-5 bg-[#E5E7EB] mx-1" />

        <button
          onClick={() => setAiPanelOpen(prev => !prev)}
          className={`flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-xs font-bold transition-all ${
            aiPanelOpen
              ? 'bg-gradient-to-r from-[#8B5CF6] to-[#2563EB] text-white shadow-sm'
              : 'bg-[#F5F3FF] text-[#7C3AED] border border-[#DDD6FE] hover:bg-[#EDE9FE]'
          }`}
          title={aiPanelOpen ? 'Close AI Assistant' : 'Open AI Assistant'}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span className="hidden md:inline">{aiPanelOpen ? 'AI Assistant' : 'AI Generate'}</span>
          {aiPanelOpen && <PanelLeftClose className="w-3 h-3 hidden lg:inline" />}
        </button>

        <div className="flex-1" />

        <button onClick={handleSave}
          className={`flex items-center gap-1.5 h-7 px-3 rounded-lg text-xs font-medium transition-all ${isSaved ? 'bg-[#DCFCE7] text-[#15803D] border border-[#BBF7D0]' : 'bg-white border border-[#E5E7EB] text-[#374151] hover:border-[#2563EB] hover:text-[#2563EB]'}`}>
          {isSaved ? <CheckCircle className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
          {isSaved ? 'Saved!' : 'Save'}
        </button>

        <button onClick={handlePublish}
          className={`flex items-center gap-1.5 h-7 px-3 rounded-lg text-xs font-semibold transition-all shadow-sm ${isPublished ? 'bg-[#22C55E] text-white' : 'bg-[#2563EB] text-white hover:bg-[#1E40AF] shadow-[#2563EB]/20'}`}>
          {isPublished ? <CheckCircle className="w-3.5 h-3.5" /> : <Zap className="w-3.5 h-3.5" />}
          {isPublished ? 'Published!' : 'Publish'}
        </button>

        <div className="w-px h-5 bg-[#E5E7EB] mx-2" />

        <button onClick={onLogout} className="w-7 h-7 rounded-lg flex items-center justify-center text-[#9CA3AF] hover:text-[#EF4444] hover:bg-[#FEF2F2] transition-colors">
          <LogOut className="w-3.5 h-3.5" />
        </button>
      </header>

      {/* ── MAIN BODY ───────────────────────────────────────── */}
      {builderTab === 'test' ? (
        <IvrSimulatorTab
          nodes={nodes}
          edges={edges}
          flowName={flowName}
          onSelectNode={setSelectedId}
        />
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-50 w-full max-w-xl px-4">
            <QuotaWarningBanner warnings={quotaWarnings} />
          </div>

          <NodeLibrary collapsed={libCollapsed} onToggle={() => setLibCollapsed(!libCollapsed)} />

          <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
            <div className="flex-1 overflow-hidden relative flex">
              <FlowCanvas
                nodes={nodes}
                edges={edges}
                selectedId={selectedId}
                selectedEdgeId={selectedEdgeId}
                simulatingId={simulatingId}
                viewport={viewport}
                onViewportChange={setViewport}
                onSelectNode={setSelectedId}
                onSelectEdge={setSelectedEdgeId}
                onMoveNode={handleMoveNode}
                onDropNode={handleDropNode}
                onCollapseNode={handleCollapseNode}
                onContextMenu={handleContextMenu}
                onAddEdge={handleAddEdge}
              />

              {selectedVersionId && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 bg-[#EFF6FF] text-[#2563EB] border border-[#BFDBFE] px-4 py-2 rounded-xl shadow-lg">
                  <span className="w-2 h-2 rounded-full bg-[#2563EB] animate-pulse" />
                  <span className="text-xs font-semibold">Previewing version snapshots</span>
                  <button onClick={() => { const ver = versionsList.find(v => v.id === selectedVersionId); if (ver) handleRestoreVersion(ver) }} className="px-2 py-1 rounded bg-[#2563EB] text-white text-[10px] font-bold hover:bg-[#1E40AF]">Restore Version</button>
                  <button onClick={handleExitPreview} className="text-[#9CA3AF] hover:text-[#374151] text-xs">Exit Preview</button>
                </div>
              )}
            </div>

            <div className={`bg-white border-t border-[#E5E7EB] flex-shrink-0 transition-all ${bottomOpen ? '' : 'h-9'}`}
              style={{ height: bottomOpen ? (isMaximized ? '450px' : `${bottomHeight}px`) : '36px' }}>
              {bottomOpen && (
                <div onMouseDown={handleMouseDownResize}
                  className="h-1 bg-[#E5E7EB] hover:bg-[#2563EB] cursor-ns-resize w-full transition-colors flex items-center justify-center" title="Drag to resize panel" />
              )}

              <div className="flex items-center gap-0 h-9 border-b border-[#F3F4F6] px-2">
                {[
                  { id: 'logs' as const, label: 'Execution Logs', icon: <Info className="w-3.5 h-3.5" /> },
                  { id: 'validation' as const, label: 'Validation', icon: <ShieldCheck className="w-3.5 h-3.5" />, badge: validationItems.length },
                  { id: 'console' as const, label: 'Console', icon: <Terminal className="w-3.5 h-3.5" /> },
                ].map(tab => (
                  <button key={tab.id} onClick={() => { setBottomTab(tab.id); setBottomOpen(true) }}
                    className={`flex items-center gap-1.5 h-9 px-3 text-xs font-medium border-b-2 -mb-px transition-colors ${bottomTab === tab.id && bottomOpen ? 'border-[#2563EB] text-[#2563EB]' : 'border-transparent text-[#6B7280] hover:text-[#374151]'}`}>
                    {tab.icon}{tab.label}
                    {tab.badge === -1 ? (
                      <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-green-50 border border-green-200 text-green-700 text-[9px] font-bold">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                        Applied
                      </span>
                    ) : tab.badge && tab.badge > 0 && (
                      <span className="w-4 h-4 rounded-full bg-[#8B5CF6] text-white text-[9px] font-bold flex items-center justify-center">{tab.badge}</span>
                    )}
                  </button>
                ))}

                <div className="flex-1" />

                {bottomTab === 'logs' && bottomOpen && (
                  <div className="flex items-center gap-3 mr-2">
                    <input type="text" placeholder="Search logs..." value={logSearch} onChange={e => setLogSearch(e.target.value)}
                      className="px-2 py-0.5 border border-[#E5E7EB] rounded text-[10px] outline-none focus:border-[#2563EB] w-36 h-5" />
                    {['all', 'info', 'warn', 'error'].map(lvl => (
                      <button key={lvl} onClick={() => setLogFilter(lvl as any)}
                        className={`px-1.5 py-0.2 rounded text-[9px] font-semibold uppercase ${
                          logFilter === lvl ? 'bg-[#2563EB] text-white' : 'bg-[#F3F4F6] text-[#6B7280] hover:text-[#374151]'
                        }`}>
                        {lvl}
                      </button>
                    ))}
                    <div className="w-px h-3.5 bg-[#E5E7EB]" />
                    <button onClick={() => setLogs([])} className="text-[10px] text-[#6B7280] hover:text-[#EF4444] font-medium">Clear Logs</button>
                    <button onClick={() => {
                      const text = logs.map(l => `[${l.time}] [${l.level.toUpperCase()}] ${l.msg}`).join('\n')
                      const blob = new Blob([text], { type: 'text/plain' })
                      const a = document.createElement('a')
                      a.href = URL.createObjectURL(blob)
                      a.download = 'execution.log'
                      a.click()
                    }} className="text-[10px] text-[#2563EB] hover:underline font-medium">Export Logs</button>
                  </div>
                )}

                <button onClick={() => setIsMaximized(!isMaximized)} className="w-7 h-7 rounded-lg flex items-center justify-center text-[#9CA3AF] hover:bg-[#F3F4F6]">
                  {isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                </button>
                <button onClick={() => setBottomOpen(!bottomOpen)} className="w-7 h-7 rounded-lg flex items-center justify-center text-[#9CA3AF] hover:bg-[#F3F4F6]">
                  {bottomOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                </button>
              </div>

              {bottomOpen && (
                <div className="h-[calc(100%-40px)] overflow-y-auto px-3 py-2">
                  {bottomTab === 'logs' && (
                    <div className="space-y-1 font-mono">
                      {filteredLogs.map(line => (
                        <div key={line.id} className="flex items-start gap-2.5 py-0.5 text-[11px]">
                          <span className="text-[#9CA3AF] w-16 flex-shrink-0">{line.time}</span>
                          <span className={`font-bold uppercase w-10 flex-shrink-0 ${
                            line.level === 'warn' ? 'text-[#F59E0B]' : line.level === 'error' ? 'text-[#EF4444]' : 'text-[#2563EB]'
                          }`}>{line.level}</span>
                          <span className="text-[#374151]">{line.msg}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {bottomTab === 'ai' && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 pb-2 border-b border-[#F3F4F6]">
                        <button onClick={handleApplyAllSuggestions} disabled={currentSuggestions.length === 0}
                          className="px-3 py-1 bg-[#2563EB] text-white rounded text-[10px] font-semibold hover:bg-[#1E40AF] disabled:opacity-50">
                          Apply All
                        </button>
                        <button onClick={handleGenerateSuggestionsAgain}
                          className="px-3 py-1 bg-white border border-[#E5E7EB] text-[#374151] rounded text-[10px] font-medium hover:border-[#2563EB] hover:text-[#2563EB]">
                          Generate Again
                        </button>
                      </div>
                      {currentSuggestions.length === 0 ? (
                        <p className="text-xs text-[#9CA3AF] py-4 text-center">No AI suggestions found. Your flow graph looks clean!</p>
                      ) : (
                        currentSuggestions.map(s => (
                          <div key={s.id} className="flex items-center gap-3 p-2.5 rounded-lg border border-[#F3F4F6] bg-[#FAFAFA]">
                            <span className="text-base">{s.icon}</span>
                            <span className="text-[#374151] text-xs flex-1">{s.text}</span>
                            <button onClick={() => {
                              setIgnoredSuggestionIds(set => new Set(set).add(s.id))
                              const res = s.applyAction()
                              if (res !== false) {
                                setAppliedSuggestionCount(prev => prev + 1)
                              }
                            }} className="px-2 py-1 rounded bg-[#2563EB] text-white text-[10px] font-semibold hover:bg-[#1E40AF]">Apply</button>
                            <button onClick={() => setIgnoredSuggestionIds(set => new Set(set).add(s.id))} className="px-2 py-1 rounded bg-[#F3F4F6] text-[#6B7280] text-[10px] hover:text-[#374151]">Dismiss</button>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                  {bottomTab === 'validation' && (
                    <div className="space-y-1.5">
                      {validationItems.map((item, idx) => (
                        <div key={idx} onClick={() => item.nodeId && handleSelectNodeAndCenter(item.nodeId)} className="p-2 rounded border border-[#E5E7EB] flex items-center justify-between text-xs cursor-pointer hover:border-[#2563EB] bg-white">
                          <span className={item.type === 'error' ? 'text-[#EF4444] font-medium' : 'text-[#374151]'}>{item.message}</span>
                          {item.nodeId && <span className="text-[10px] text-[#2563EB] font-semibold">Focus Node</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  {bottomTab === 'console' && (
                    <div className="font-mono text-xs text-[#374151] space-y-1">
                      <p>&gt; NexusIVR Runtime Console Ready</p>
                      <p>&gt; Connected to local PostgreSQL DB &amp; Tomcat Engine</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="transition-all duration-300 ease-in-out" style={{ width: aiPanelOpen ? 380 : 0, overflow: 'hidden', flexShrink: 0 }}>
            {aiPanelOpen && (
              <AiAssistantPanel
                onFlowGenerated={handleFlowGenerated}
                onClose={() => setAiPanelOpen(false)}
              />
            )}
          </div>

          <PropertiesPanel
            selectedNode={selectedNode}
            selectedEdge={edges.find(e => e.id === selectedEdgeId) || null}
            flowName={flowName}
            nodesCount={nodes.length}
            edgesCount={edges.length}
            versions={versionsList}
            validationItems={validationItems}
            activeTab={rightTab}
            onTabChange={setRightTab}
            onNodeChange={handleNodeChange}
            onEdgeChange={handleEdgeChange}
            onRestoreVersion={handleRestoreVersion}
            onSelectNode={handleSelectNodeAndCenter}
            onSaveVersion={handleSave}
            selectedVersionId={selectedVersionId}
            onSelectVersion={handleSelectVersion}
            nodes={nodes}
            edges={edges}
          />
        </div>
      )}


      {contextMenu && (
        <div className="fixed z-[9999] bg-white rounded-xl border border-[#E5E7EB] shadow-2xl shadow-black/15 py-1.5 w-44 overflow-hidden"
          style={{ left: contextMenu.x, top: contextMenu.y }} onClick={e => e.stopPropagation()}>
          {CONTEXT_MENU_ITEMS.map((item, i) =>
            item === null ? <div key={i} className="h-px bg-[#F3F4F6] my-1 mx-2" /> : (
              <button key={item.label} onClick={() => handleContextMenuAction(item.label)}
                className={`w-full flex items-center gap-2.5 px-3.5 py-1.5 text-xs font-medium hover:bg-[#F9FAFB] ${(item as any).danger ? 'text-[#EF4444]' : 'text-[#374151]'}`}>
                {item.icon}
                <span className="flex-1 text-left">{item.label}</span>
              </button>
            )
          )}
        </div>
      )}

      {showPublishModal && (
        <div className="fixed inset-0 bg-[#0F172A]/40 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-[#EFF6FF] flex items-center justify-center text-[#2563EB]">
                  <Zap className="w-5 h-5" />
                </div>
                <h3 className="text-base font-bold text-[#1E293B]">Publish IVR Flow</h3>
              </div>

              <p className="text-xs text-[#64748B]">
                Publish your current flow to the production Asterisk server. This will generate a VoiceXML scenario file and optionally register an extension to handle calls.
              </p>

              {/* Warnings check */}
              {(() => {
                const unconfiguredTransfers = nodes.filter(n =>
                  (n.type === 'transfer' || n.type === 'extension') &&
                  isPlaceholderDestination(n.transferDestination ?? n.dest ?? '')
                );
                if (unconfiguredTransfers.length > 0) {
                  return (
                    <div className="bg-[#FEF3C7] border-l-4 border-[#D97706] text-[#92400E] p-3 rounded-lg text-[11px] flex flex-col gap-1">
                      <span className="font-bold flex items-center gap-1">
                        ⚠️ Non-Blocking Notice
                      </span>
                      <span>
                        This flow has {unconfiguredTransfers.length} unconfigured transfer destination(s) (e.g. 'placeholder'). The deployed VXML will contain literal placeholder strings for those nodes.
                      </span>
                    </div>
                  );
                }
                return null;
              })()}

              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-[#475569]">Target VXML File</label>
                  <input
                    type="text"
                    value={publishFilename}
                    onChange={e => setPublishFilename(e.target.value)}
                    placeholder="scenario_name.vxml"
                    className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg text-xs outline-none focus:border-[#2563EB] transition-colors"
                  />
                  <span className="text-[10px] text-[#94A3B8]">
                    VXML scenarios are saved directly to <code className="bg-[#F8FAFC] px-1 py-0.5 rounded border border-[#E2E8F0]">IVR-engine/scenarios/</code>
                  </span>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-[#475569]">Asterisk Extension Number</label>
                  <input
                    type="text"
                    value={publishExtension}
                    onChange={e => setPublishExtension(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="e.g. 1234"
                    className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg text-xs outline-none focus:border-[#2563EB] transition-colors"
                  />
                  <span className="text-[10px] text-[#94A3B8]">
                    Leave blank to automatically allocate the next available extension.
                  </span>
                </div>

                <div className="bg-[#0F172A] border border-[#1E293B] p-3.5 rounded-lg flex flex-col gap-2 relative">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#94A3B8]">Deployment Command</span>
                    <span className="text-[9px] font-bold uppercase tracking-wider bg-[#1E293B] text-[#94A3B8] px-1.5 py-0.5 rounded">SHELL SCRIPT</span>
                  </div>
                  <div className="text-xs font-mono break-all text-[#34D399] select-all bg-[#1E293B]/40 p-2 rounded flex items-center gap-1.5">
                    <span className="text-[#64748B] select-none">$</span>
                    <span>add_extension.sh {publishExtension.trim() || 'auto'} {publishFilename.replace(/\.vxml$/, '')}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#F1F5F9]">
                <button
                  type="button"
                  onClick={() => setShowPublishModal(false)}
                  disabled={isPublishing}
                  className="px-4 py-2 border border-[#E2E8F0] text-[#475569] hover:bg-[#F8FAFC] text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handlePublishSubmit}
                  disabled={isPublishing || !publishFilename.trim()}
                  className="px-4 py-2 bg-[#2563EB] text-white hover:bg-[#1D4ED8] text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isPublishing ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Publishing...
                    </>
                  ) : (
                    'Publish & Register'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
