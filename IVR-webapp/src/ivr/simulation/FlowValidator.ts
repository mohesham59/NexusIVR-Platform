import type { FlowNode, FlowEdge } from '../types'
import type { ValidationIssue } from './types'

export function validateFlowForSimulation(nodes: FlowNode[], edges: FlowEdge[]): {
  valid: boolean
  issues: ValidationIssue[]
  startNode: FlowNode | null
} {
  const issues: ValidationIssue[] = []

  if (!nodes || nodes.length === 0) {
    issues.push({
      type: 'error',
      code: 'EMPTY_FLOW',
      message: 'The IVR flow canvas is completely empty. Add nodes to test the scenario.',
    })
    return { valid: false, issues, startNode: null }
  }

  const startNode = nodes.find(n => n.type === 'start') || null

  if (!startNode) {
    issues.push({
      type: 'error',
      code: 'MISSING_START_NODE',
      message: 'The IVR does not contain a Start Call node. Add a Start node to begin the flow.',
    })
  } else {
    const startOutgoing = edges.filter(e => e.sourceId === startNode.id)
    if (startOutgoing.length === 0) {
      issues.push({
        type: 'error',
        code: 'START_DISCONNECTED',
        message: 'The Start Call node is not connected to any subsequent node.',
        nodeId: startNode.id,
      })
    }
  }

  const hasEndNode = nodes.some(n => n.type === 'end' || n.type === 'transfer' || n.type === 'voicemail')
  if (!hasEndNode) {
    issues.push({
      type: 'warning',
      code: 'MISSING_TERMINATION_NODE',
      message: 'The flow does not contain an End Call, Transfer, or Voicemail node.',
    })
  }

  // Validate individual node configurations
  nodes.forEach(node => {
    if (node.disabled) {
      issues.push({
        type: 'warning',
        code: 'NODE_DISABLED',
        message: `Node "${node.title}" is currently disabled and will be bypassed.`,
        nodeId: node.id,
      })
      return
    }

    if (['greeting', 'playback'].includes(node.type)) {
      const promptText = node.prompt || node.promptEn || node.promptAr || node.subtitle
      const audioFile = node.audioEn || node.audioAr || node.subtitle
      if (!promptText && !audioFile) {
        issues.push({
          type: 'warning',
          code: 'MISSING_AUDIO_PROMPT',
          message: `Playback node "${node.title}" has no audio file or prompt text configured.`,
          nodeId: node.id,
        })
      }
    }

    if (node.type === 'tts') {
      const promptText = node.prompt || node.promptEn || node.promptAr || node.subtitle
      if (!promptText || promptText.trim() === '') {
        issues.push({
          type: 'warning',
          code: 'MISSING_TTS_TEXT',
          message: `Text to Speech node "${node.title}" has empty spoken text.`,
          nodeId: node.id,
        })
      }
    }

    if (node.type === 'dtmf_menu') {
      const outgoing = edges.filter(e => e.sourceId === node.id)
      if (outgoing.length === 0) {
        issues.push({
          type: 'error',
          code: 'MENU_NO_BRANCHES',
          message: `DTMF Menu node "${node.title}" has no outgoing connection routes configured.`,
          nodeId: node.id,
        })
      }
    }

    if (node.type === 'transfer' || node.type === 'extension') {
      const dest = node.transferDestination || node.dest
      if (!dest || dest.trim() === '' || dest.toLowerCase() === 'placeholder') {
        issues.push({
          type: 'warning',
          code: 'UNCONFIGURED_TRANSFER_DESTINATION',
          message: `Transfer node "${node.title}" destination is unconfigured or set to placeholder.`,
          nodeId: node.id,
        })
      }
    }

    if (node.type === 'api' || node.type === 'webhook') {
      const endpoint = node.subtitle || node.prompt
      if (!endpoint || !endpoint.startsWith('http')) {
        issues.push({
          type: 'warning',
          code: 'INVALID_API_URL',
          message: `API node "${node.title}" is missing a valid HTTP URL endpoint.`,
          nodeId: node.id,
        })
      }
    }

    // Check outgoing edge validity (broken connection check)
    if (node.type !== 'end' && node.type !== 'transfer' && node.type !== 'voicemail') {
      const outgoing = edges.filter(e => e.sourceId === node.id)
      if (outgoing.length === 0 && !node.disabled) {
        issues.push({
          type: 'info',
          code: 'DEAD_END_NODE',
          message: `Node "${node.title}" has no outgoing connection to next step.`,
          nodeId: node.id,
        })
      } else {
        outgoing.forEach(edge => {
          const targetExists = nodes.some(n => n.id === edge.targetId)
          if (!targetExists) {
            issues.push({
              type: 'error',
              code: 'BROKEN_EDGE',
              message: `Node "${node.title}" connects to a missing node target (${edge.targetId}).`,
              nodeId: node.id,
            })
          }
        })
      }
    }
  })

  const hasErrors = issues.some(i => i.type === 'error')
  return {
    valid: !hasErrors,
    issues,
    startNode,
  }
}
