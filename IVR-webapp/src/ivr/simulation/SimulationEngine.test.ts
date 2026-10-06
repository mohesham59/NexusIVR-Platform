import { SimulationEngine } from './SimulationEngine'
import { validateFlowForSimulation } from './FlowValidator'
import type { FlowNode, FlowEdge } from '../types'

export function testFlowValidation(): boolean {
  const emptyRes = validateFlowForSimulation([], [])
  if (emptyRes.valid !== false) {
    throw new Error('Empty flow must fail simulation validation')
  }

  const noStartNodes: FlowNode[] = [
    { id: 'n1', type: 'greeting', title: 'Greeting', subtitle: '', status: 'valid', collapsed: false, disabled: false, x: 0, y: 0, ports: [] },
  ]
  const noStartRes = validateFlowForSimulation(noStartNodes, [])
  if (noStartRes.valid !== false || !noStartRes.issues.some(i => i.code === 'MISSING_START_NODE')) {
    throw new Error('Flow missing Start node must fail validation')
  }

  const validNodes: FlowNode[] = [
    { id: 'start', type: 'start', title: 'Start', subtitle: '', status: 'valid', collapsed: false, disabled: false, x: 0, y: 0, ports: [] },
    { id: 'end', type: 'end', title: 'End', subtitle: '', status: 'valid', collapsed: false, disabled: false, x: 200, y: 0, ports: [] },
  ]
  const validEdges: FlowEdge[] = [
    { id: 'e1', sourceId: 'start', sourcePort: 'out', targetId: 'end', targetPort: 'in' },
  ]
  const validRes = validateFlowForSimulation(validNodes, validEdges)
  if (!validRes.valid) {
    throw new Error('Valid flow must pass simulation validation')
  }

  return true
}

export function testSimulationEngineMenuBranching(): boolean {
  const engine = new SimulationEngine()

  const nodes: FlowNode[] = [
    { id: 'start', type: 'start', title: 'Start', subtitle: '', status: 'valid', collapsed: false, disabled: false, x: 0, y: 0, ports: [] },
    { id: 'menu', type: 'dtmf_menu', title: 'Main Menu', subtitle: 'Select 1 for Sales, 2 for Support', status: 'valid', collapsed: false, disabled: false, x: 200, y: 0, ports: [] },
    { id: 'sales', type: 'greeting', title: 'Sales Dept', subtitle: 'Welcome to Sales', status: 'valid', collapsed: false, disabled: false, x: 400, y: 0, ports: [] },
    { id: 'support', type: 'greeting', title: 'Support Dept', subtitle: 'Welcome to Support', status: 'valid', collapsed: false, disabled: false, x: 400, y: 150, ports: [] },
    { id: 'end', type: 'end', title: 'End Call', subtitle: '', status: 'valid', collapsed: false, disabled: false, x: 600, y: 0, ports: [] },
  ]

  const edges: FlowEdge[] = [
    { id: 'e1', sourceId: 'start', sourcePort: 'out', targetId: 'menu', targetPort: 'in' },
    { id: 'e2', sourceId: 'menu', sourcePort: 'key1', targetId: 'sales', targetPort: 'in', label: '1' },
    { id: 'e3', sourceId: 'menu', sourcePort: 'key2', targetId: 'support', targetPort: 'in', label: '2' },
    { id: 'e4', sourceId: 'sales', sourcePort: 'out', targetId: 'end', targetPort: 'in' },
    { id: 'e5', sourceId: 'support', sourcePort: 'out', targetId: 'end', targetPort: 'in' },
  ]

  const started = engine.startCall(nodes, edges)
  if (!started) {
    throw new Error('Engine must start valid call')
  }

  const initialState = engine.getState()
  if (initialState.status !== 'calling') {
    throw new Error('Call initial status must be calling')
  }

  engine.endCall('Test manual termination', true)
  const endedState = engine.getState()
  if (endedState.status !== 'ended' || !endedState.resultSummary) {
    throw new Error('Call must end with result summary')
  }

  return true
}

export function testBilingualLanguageSelection(): boolean {
  const engineEn = new SimulationEngine()
  const engineAr = new SimulationEngine()

  const nodes: FlowNode[] = [
    { id: 'start', type: 'start', title: 'Start', subtitle: '', status: 'valid', collapsed: false, disabled: false, x: 0, y: 0, ports: [] },
    { id: 'lang_menu', type: 'dtmf_menu', title: 'Lang Menu', promptEn: 'English 1, Arabic 2', promptAr: 'للإنجليزية 1، للعربية 2', status: 'valid', collapsed: false, disabled: false, x: 100, y: 0, ports: [] },
    { id: 'set_en', type: 'variable', title: 'Set EN', variableName: 'language', variableValue: 'en', status: 'valid', collapsed: false, disabled: false, x: 250, y: 0, ports: [] },
    { id: 'set_ar', type: 'variable', title: 'Set AR', variableName: 'language', variableValue: 'ar', status: 'valid', collapsed: false, disabled: false, x: 250, y: 150, ports: [] },
    { id: 'main_prompt', type: 'tts', title: 'Main Prompt', promptEn: 'Welcome to Hospital', promptAr: 'مرحبًا بكم في المستشفى', status: 'valid', collapsed: false, disabled: false, x: 400, y: 0, ports: [] },
    { id: 'end', type: 'end', title: 'End', subtitle: '', status: 'valid', collapsed: false, disabled: false, x: 550, y: 0, ports: [] },
  ]

  const edges: FlowEdge[] = [
    { id: 'e1', sourceId: 'start', sourcePort: 'out', targetId: 'lang_menu', targetPort: 'in' },
    { id: 'e2', sourceId: 'lang_menu', sourcePort: 'key1', targetId: 'set_en', targetPort: 'in', label: '1' },
    { id: 'e3', sourceId: 'lang_menu', sourcePort: 'key2', targetId: 'set_ar', targetPort: 'in', label: '2' },
    { id: 'e4', sourceId: 'set_en', sourcePort: 'out', targetId: 'main_prompt', targetPort: 'in' },
    { id: 'e5', sourceId: 'set_ar', sourcePort: 'out', targetId: 'main_prompt', targetPort: 'in' },
    { id: 'e6', sourceId: 'main_prompt', sourcePort: 'out', targetId: 'end', targetPort: 'in' },
  ]

  // Test 1: DTMF 1 -> EN
  engineEn.startCall(nodes, edges)
  engineEn.pressDtmfKey('1')
  const stateEn = engineEn.getState()
  if (stateEn.variables['language'] !== 'en') {
    throw new Error(`Expected language variable 'en', got '${stateEn.variables['language']}'`)
  }

  // Test 2: DTMF 2 -> AR
  engineAr.startCall(nodes, edges)
  engineAr.pressDtmfKey('2')
  const stateAr = engineAr.getState()
  if (stateAr.variables['language'] !== 'ar') {
    throw new Error(`Expected language variable 'ar', got '${stateAr.variables['language']}'`)
  }

  return true
}

// Run unit tests on load
testFlowValidation()
testSimulationEngineMenuBranching()
testBilingualLanguageSelection()

