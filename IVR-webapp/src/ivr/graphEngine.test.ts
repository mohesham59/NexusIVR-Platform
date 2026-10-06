import { analyzeGraph, reconnectAfterDelete } from './graphEngine'
import type { FlowNode, FlowEdge } from './types'

export function testSmartDeleteDiagnosticsRecomputation(): boolean {
  // 7 nodes: Start -> Menu -> [TechSupport, ProfDev, ResourceCenter, GradeTracking] -> EndCall
  let nodes: FlowNode[] = [
    { id: 'start', type: 'start', title: 'Start Call', subtitle: '', status: 'valid', collapsed: false, disabled: false, x: 0, y: 0, ports: [] },
    { id: 'menu', type: 'dtmf_menu', title: 'Main Menu', subtitle: '', status: 'valid', collapsed: false, disabled: false, x: 100, y: 0, ports: [] },
    { id: 'tech', type: 'greeting', title: 'Technical support', subtitle: '', status: 'valid', collapsed: false, disabled: false, x: 200, y: 0, ports: [] },
    { id: 'prof', type: 'greeting', title: 'Professional development', subtitle: '', status: 'valid', collapsed: false, disabled: false, x: 200, y: 100, ports: [] },
    { id: 'res', type: 'greeting', title: 'Resource center', subtitle: '', status: 'valid', collapsed: false, disabled: false, x: 200, y: 200, ports: [] },
    { id: 'grade', type: 'greeting', title: 'Grade tracking', subtitle: '', status: 'valid', collapsed: false, disabled: false, x: 200, y: 300, ports: [] },
    { id: 'end', type: 'end', title: 'End Call', subtitle: '', status: 'valid', collapsed: false, disabled: false, x: 400, y: 0, ports: [] },
  ]

  let edges: FlowEdge[] = [
    { id: 'e1', sourceId: 'start', sourcePort: 'out', targetId: 'menu', targetPort: 'in' },
    { id: 'e2', sourceId: 'menu', sourcePort: 'key1', targetId: 'tech', targetPort: 'in' },
    { id: 'e3', sourceId: 'menu', sourcePort: 'key2', targetId: 'prof', targetPort: 'in' },
    { id: 'e4', sourceId: 'menu', sourcePort: 'key3', targetId: 'res', targetPort: 'in' },
    { id: 'e5', sourceId: 'menu', sourcePort: 'key4', targetId: 'grade', targetPort: 'in' },
    { id: 'e6', sourceId: 'tech', sourcePort: 'out', targetId: 'end', targetPort: 'in' },
    { id: 'e7', sourceId: 'prof', sourcePort: 'out', targetId: 'end', targetPort: 'in' },
    { id: 'e8', sourceId: 'res', sourcePort: 'out', targetId: 'end', targetPort: 'in' },
    { id: 'e9', sourceId: 'grade', sourcePort: 'out', targetId: 'end', targetPort: 'in' },
  ]

  let diag = analyzeGraph(nodes, edges)
  if (!diag.convergingNodes.some(c => c.id === 'end')) {
    throw new Error('Initial flow must detect converging paths into End Call')
  }

  // Delete leaf node 1: TechSupport
  let res = reconnectAfterDelete(nodes, edges, 'tech')
  nodes = res.nodes
  edges = res.edges

  // Delete leaf node 2: ProfDev
  res = reconnectAfterDelete(nodes, edges, 'prof')
  nodes = res.nodes
  edges = res.edges

  // Delete the Menu node itself last
  res = reconnectAfterDelete(nodes, edges, 'menu')
  nodes = res.nodes
  edges = res.edges

  diag = analyzeGraph(nodes, edges)

  // Verify convergingNodes is NOT empty! It must detect the collapsed branching hub
  if (diag.convergingNodes.length === 0) {
    throw new Error('Smart Deleting Menu node must NOT leave convergingNodes empty!')
  }

  const hasStartOrEndHub = diag.convergingNodes.some(c => c.id === 'start' || c.id === 'end')
  if (!hasStartOrEndHub) {
    throw new Error('Smart Deleting Menu node must flag Start or End node in convergingNodes / collapsed hubs')
  }

  return true
}

export function testApplySuggestionIdempotency(): boolean {
  let nodes: FlowNode[] = [
    { id: 'start', type: 'start', title: 'Start Call', subtitle: '', status: 'valid', collapsed: false, disabled: false, x: 0, y: 0, ports: [] },
    { id: 'menu', type: 'dtmf_menu', title: 'Main Menu', subtitle: '', status: 'valid', collapsed: false, disabled: false, x: 100, y: 0, ports: [] },
    { id: 'end', type: 'end', title: 'End Call', subtitle: '', status: 'valid', collapsed: false, disabled: false, x: 300, y: 0, ports: [] },
  ]
  let edges: FlowEdge[] = [
    { id: 'e1', sourceId: 'start', sourcePort: 'out', targetId: 'menu', targetPort: 'in' },
  ]

  const applyFallbackPath = (nId: string): boolean => {
    let targetNode = nodes.find(target => target.id !== nId && (target.type === 'end' || target.type === 'voicemail'))
    if (targetNode && edges.some(e => e.sourceId === nId && e.targetId === targetNode!.id)) return false
    if (edges.some(e => e.sourceId === nId && (e.sourcePort === 'timeout' || e.sourcePort === 'error' || e.sourcePort === 'invalid'))) return false

    if (!targetNode) {
      targetNode = { id: 'fallback_end', type: 'end', x: 400, y: 100, title: 'Fallback End', subtitle: '', status: 'valid', collapsed: false, disabled: false, ports: [] }
      nodes.push(targetNode)
    }

    edges.push({ id: `e_fallback_${nId}_${targetNode.id}`, sourceId: nId, sourcePort: 'timeout', targetId: targetNode.id, targetPort: 'in' })
    return true
  }

  const initialEdgeCount = edges.length
  const res1 = applyFallbackPath('menu')
  if (!res1) throw new Error('First apply of fallback path must return true')
  if (edges.length !== initialEdgeCount + 1) throw new Error('First apply must add exactly 1 edge')

  const res2 = applyFallbackPath('menu')
  if (res2 !== false) throw new Error('Second apply of fallback path must return false')
  if (edges.length !== initialEdgeCount + 1) throw new Error('Second apply must not create duplicate edge')

  return true
}

export function testSmartDeleteAndApplySuggestionStateReconciliation(): boolean {
  let nodes: FlowNode[] = [
    { id: 'start', type: 'start', title: 'Start Call', subtitle: '', status: 'valid', collapsed: false, disabled: false, x: 0, y: 0, ports: [] },
    { id: 'tech', type: 'greeting', title: 'Tech', subtitle: '', status: 'valid', collapsed: false, disabled: false, x: 100, y: 0, ports: [] },
    { id: 'prof', type: 'greeting', title: 'Prof', subtitle: '', status: 'valid', collapsed: false, disabled: false, x: 100, y: 100, ports: [] },
    { id: 'res', type: 'greeting', title: 'Res', subtitle: '', status: 'valid', collapsed: false, disabled: false, x: 100, y: 200, ports: [] },
    { id: 'end', type: 'end', title: 'End Call', subtitle: '', status: 'valid', collapsed: false, disabled: false, x: 300, y: 0, ports: [] },
  ]
  let edges: FlowEdge[] = [
    { id: 'e1', sourceId: 'start', sourcePort: 'out', targetId: 'tech', targetPort: 'in' },
    { id: 'e2', sourceId: 'start', sourcePort: 'out', targetId: 'prof', targetPort: 'in' },
    { id: 'e3', sourceId: 'start', sourcePort: 'out', targetId: 'res', targetPort: 'in' },
    { id: 'e4', sourceId: 'tech', sourcePort: 'out', targetId: 'end', targetPort: 'in' },
    { id: 'e5', sourceId: 'prof', sourcePort: 'out', targetId: 'end', targetPort: 'in' },
    { id: 'e6', sourceId: 'res', sourcePort: 'out', targetId: 'end', targetPort: 'in' },
  ]

  // Step 1: Delete 1 intermediate node (tech), leaving prof and res converging into end
  let res = reconnectAfterDelete(nodes, edges, 'tech')
  nodes = res.nodes; edges = res.edges

  // Step 2: Diagnostics flag converging paths on Start or End
  let diag = analyzeGraph(nodes, edges)
  if (diag.convergingNodes.length === 0) {
    throw new Error('Deleting intermediate node with multiple remaining branches must flag converging paths / collapsed hub')
  }

  // Step 3: Simulate suggestion generation with deterministic ID
  const suggId = `sugg_local_converging_${diag.convergingNodes[0].id}`
  const ignoredSuggestionIds = new Set<string>()

  // Step 4: Apply suggestion (re-insert Menu node)
  const menuNode: FlowNode = { id: 'menu_reinserted', type: 'dtmf_menu', title: 'Main Menu', subtitle: '', status: 'valid', collapsed: false, disabled: false, x: 200, y: 0, ports: [] }
  nodes.push(menuNode)
  edges = [
    { id: 'e_new1', sourceId: 'start', sourcePort: 'out', targetId: 'menu_reinserted', targetPort: 'in' },
    { id: 'e_new2', sourceId: 'menu_reinserted', sourcePort: 'key1', targetId: 'end', targetPort: 'in' }
  ]

  // Add applied suggestion ID to ignored set immediately
  ignoredSuggestionIds.add(suggId)

  // Step 5: Assert (a) suggestion is gone, (b) badge count is 0, (c) validation is clean
  diag = analyzeGraph(nodes, edges)
  const remainingSuggestions = diag.convergingNodes.filter(c => !ignoredSuggestionIds.has(`sugg_local_converging_${c.id}`))

  if (remainingSuggestions.length !== 0) {
    throw new Error('Applied suggestion must be removed immediately from active suggestions list')
  }
  if (diag.convergingNodes.length !== 0) {
    throw new Error('Re-inserting menu node must resolve convergingNodes in graph diagnostics')
  }

  return true
}

export function testNoConvergingMisfireOnMenuFallbackEdges(): boolean {
  const nodes: FlowNode[] = [
    { id: 'start', type: 'start', title: 'Start Call', subtitle: '', status: 'valid', collapsed: false, disabled: false, x: 0, y: 0, ports: [] },
    { id: 'menu', type: 'dtmf_menu', title: 'Main Menu', subtitle: '', status: 'valid', collapsed: false, disabled: false, x: 100, y: 0, ports: [] },
    { id: 'end', type: 'end', title: 'End Call', subtitle: '', status: 'valid', collapsed: false, disabled: false, x: 300, y: 0, ports: [] },
  ]
  const edges: FlowEdge[] = [
    { id: 'e1', sourceId: 'start', sourcePort: 'out', targetId: 'menu', targetPort: 'in' },
    { id: 'e2', sourceId: 'menu', sourcePort: 'option_1', targetId: 'end', targetPort: 'in' },
    { id: 'e3', sourceId: 'menu', sourcePort: 'error', targetId: 'end', targetPort: 'in' },
    { id: 'e4', sourceId: 'menu', sourcePort: 'timeout', targetId: 'end', targetPort: 'in' },
  ]

  const diag = analyzeGraph(nodes, edges)
  if (diag.convergingNodes.some(c => c.id === 'end')) {
    throw new Error('Multiple option/fallback edges from a single DTMF Menu into End Call must NOT misfire as a converging node!')
  }
  return true
}

export function testDuplicateMenuDetection(): boolean {
  const nodes: FlowNode[] = [
    { id: 'start', type: 'start', title: 'Start Call', subtitle: '', status: 'valid', collapsed: false, disabled: false, x: 0, y: 0, ports: [] },
    { id: 'menu1', type: 'dtmf_menu', title: 'Main Menu', subtitle: '', status: 'valid', collapsed: false, disabled: false, x: 100, y: 0, ports: [] },
    { id: 'menu2', type: 'dtmf_menu', title: 'Main Menu', subtitle: '', status: 'valid', collapsed: false, disabled: false, x: 250, y: 0, ports: [] },
    { id: 'end', type: 'end', title: 'End Call', subtitle: '', status: 'valid', collapsed: false, disabled: false, x: 400, y: 0, ports: [] },
  ]
  const edges: FlowEdge[] = [
    { id: 'e1', sourceId: 'start', sourcePort: 'out', targetId: 'menu1', targetPort: 'in' },
    { id: 'e2', sourceId: 'menu1', sourcePort: 'option_1', targetId: 'menu2', targetPort: 'in' },
    { id: 'e3', sourceId: 'menu2', sourcePort: 'option_1', targetId: 'end', targetPort: 'in' },
  ]

  const diag = analyzeGraph(nodes, edges)
  if (diag.duplicateMenus.length === 0) {
    throw new Error('Graph containing duplicate Main Menu nodes must be flagged in duplicateMenus!')
  }
  if (diag.valid !== false) {
    throw new Error('Graph containing duplicate Main Menu nodes must have valid=false!')
  }
  return true
}

// Execute inline for compile/runtime verification
testSmartDeleteDiagnosticsRecomputation()
testApplySuggestionIdempotency()
testSmartDeleteAndApplySuggestionStateReconciliation()
testNoConvergingMisfireOnMenuFallbackEdges()
testDuplicateMenuDetection()


