export type NodeType =
  | 'start'
  | 'greeting'
  | 'playback'
  | 'tts'
  | 'dtmf_menu'
  | 'dtmf_input'
  | 'voicemail'
  | 'api'
  | 'variable'
  | 'ai'
  | 'end'
  | 'queue'
  | 'transfer'
  | 'extension'
  | 'record'
  | 'hours'
  | 'holiday'
  | 'condition'
  | 'database'
  | 'webhook'

export interface NodePort {
  id: string
  label: string
  type: 'output' | 'input'
  color: string
}

export interface FlowNode {
  id: string
  type: NodeType
  x: number
  y: number
  title: string
  subtitle: string
  status: 'valid' | 'warning' | 'error' | 'idle'
  collapsed: boolean
  disabled: boolean
  ports: NodePort[]
  transferDestination?: string
  dest?: string
  prompt?: string
  promptEn?: string
  promptAr?: string
  audioEn?: string
  audioAr?: string
  aiRole?: string
  maxDigits?: string
  menuOptionsCount?: number
  variableName?: string
  variableValue?: string
  url?: string
  saveResultAs?: string
  jsonPath?: string
  options?: any[]
  conditionField?: string
  conditionOperator?: string
  conditionValue?: string
}


export interface FlowEdge {
  id: string
  sourceId: string
  sourcePort: string
  targetId: string
  targetPort: string
  label?: string
  animated?: boolean
}

export interface FlowVersion {
  id: string
  versionId: string
  sessionId: string
  createdAt: string
  savedAt: string
  label: string
  tag: 'draft' | 'published' | 'archived'
  author: string
  flow: { nodes: FlowNode[]; edges: FlowEdge[] }
  nodes?: FlowNode[]
  edges?: FlowEdge[]
  summary?: string
  prompt?: string
  score?: number
}
