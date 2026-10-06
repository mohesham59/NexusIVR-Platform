import type { FlowNode, FlowEdge } from '../types'
import { audioPlayer } from './AudioPlayer'
import type { SimulationState, ExecutionTraceEntry } from './types'

export interface ExecutionContext {
  state: SimulationState
  nodes: FlowNode[]
  edges: FlowEdge[]
  setNode: (nodeId: string | null) => void
  setStatus: (status: SimulationState['status']) => void
  setNowPlaying: (nowPlaying: SimulationState['nowPlaying']) => void
  addLog: (msg: string, level?: SimulationState['logs'][0]['level'], nodeId?: string) => void
  addTraceEntry: (entry: Partial<ExecutionTraceEntry>) => void
  setVariable: (name: string, value: any) => void
  getVariable: (name: string) => any
  setWaitingForInput: (waiting: boolean, maxDigits?: number) => void
  navigateToNode: (targetNodeId: string, delayMs?: number) => void
  endCall: (reason: string, success?: boolean) => void
}

export function executeNode(node: FlowNode, ctx: ExecutionContext): void {
  ctx.setNode(node.id)

  ctx.addTraceEntry({
    nodeId: node.id,
    nodeTitle: node.title,
    nodeType: node.type,
    status: 'SUCCESS',
    detail: `Entering node ${node.title} (${node.type})`,
  })

  if (node.disabled) {
    ctx.addLog(`Bypassing disabled node "${node.title}"`, 'warn', node.id)
    const nextEdge = ctx.edges.find(e => e.sourceId === node.id)
    if (nextEdge) {
      ctx.navigateToNode(nextEdge.targetId, 200)
    } else {
      ctx.endCall(`Flow ended after disabled node "${node.title}"`, true)
    }
    return
  }

  switch (node.type) {
    case 'start':
      executeStartNode(node, ctx)
      break

    case 'greeting':
    case 'playback':
    case 'tts':
      executeAudioNode(node, ctx)
      break

    case 'dtmf_menu':
      executeDtmfMenuNode(node, ctx)
      break

    case 'dtmf_input':
      executeDtmfInputNode(node, ctx)
      break

    case 'condition':
      executeConditionNode(node, ctx)
      break

    case 'variable':
      executeVariableNode(node, ctx)
      break

    case 'api':
    case 'webhook':
    case 'database':
      executeApiNode(node, ctx)
      break

    case 'ai':
      executeAiNode(node, ctx)
      break

    case 'queue':
      executeQueueNode(node, ctx)
      break

    case 'transfer':
    case 'extension':
      executeTransferNode(node, ctx)
      break

    case 'voicemail':
    case 'record':
      executeRecordNode(node, ctx)
      break

    case 'hours':
    case 'holiday':
      executeHoursNode(node, ctx)
      break

    case 'end':
      executeEndNode(node, ctx)
      break

    default:
      executeDefaultNode(node, ctx)
      break
  }
}

function getSessionLanguage(ctx: ExecutionContext): string {
  const lang = ctx.getVariable('language') || ctx.getVariable('lang') || ctx.getVariable('user_lang') || 'en'
  return String(lang).toLowerCase().trim()
}

function getLocalizedPrompt(node: FlowNode, ctx: ExecutionContext, fallbackDefault: string = ''): string {
  const currentLang = getSessionLanguage(ctx)
  const isArabic = currentLang.startsWith('ar')

  let promptText = ''
  if (isArabic && (node.promptAr || node.audioAr)) {
    promptText = node.promptAr || ''
  } else if (node.promptEn || node.audioEn) {
    promptText = node.promptEn || ''
  } else {
    promptText = node.prompt || node.subtitle || fallbackDefault || node.title
  }

  return substituteVariables(promptText, ctx)
}

function executeStartNode(node: FlowNode, ctx: ExecutionContext): void {
  ctx.setStatus('running')
  ctx.addLog(`Flow started from node [${node.title}]`, 'info', node.id)

  const outgoingEdge = ctx.edges.find(e => e.sourceId === node.id)
  if (outgoingEdge) {
    ctx.navigateToNode(outgoingEdge.targetId, 400)
  } else {
    ctx.addLog('Start node is not connected to any target node.', 'error', node.id)
    ctx.endCall('Stopped: Start node has no outgoing connection.', false)
  }
}

function executeAudioNode(node: FlowNode, ctx: ExecutionContext): void {
  ctx.setStatus('playing')
  const promptText = getLocalizedPrompt(node, ctx)
  const isTts = node.type === 'tts' || (!node.audioEn && !node.audioAr)
  const sessionLang = getSessionLanguage(ctx)
  const ttsLang = sessionLang.startsWith('ar') ? 'ar-SA' : 'en-US'

  ctx.addLog(`Playing audio prompt in [${node.title}] (${ttsLang}): "${promptText}"`, 'info', node.id)
  ctx.setNowPlaying({
    title: node.title,
    promptText,
    isTts,
    audioUrl: sessionLang.startsWith('ar') ? (node.audioAr || node.audioEn) : (node.audioEn || node.audioAr),
    phase: 'playing',
    isPlaying: true,
  })

  audioPlayer.speakPrompt(
    promptText,
    () => {
      ctx.setNowPlaying({
        title: node.title,
        promptText,
        isTts,
        phase: 'ended',
        isPlaying: false,
      })
      ctx.addLog(`Finished prompt in [${node.title}]`, 'info', node.id)

      const outgoing = ctx.edges.find(e => e.sourceId === node.id)
      if (outgoing) {
        ctx.navigateToNode(outgoing.targetId, 300)
      } else {
        ctx.endCall(`Flow completed after playing prompt "${node.title}"`, true)
      }
    },
    ttsLang
  )
}

function executeDtmfMenuNode(node: FlowNode, ctx: ExecutionContext): void {
  ctx.setStatus('playing')
  const promptText = getLocalizedPrompt(node, ctx, 'Main Menu. Please press a key to select an option.')
  const sessionLang = getSessionLanguage(ctx)
  const ttsLang = sessionLang.startsWith('ar') ? 'ar-SA' : 'en-US'

  ctx.addLog(`Entered Menu [${node.title}] (${ttsLang}). Playing prompt: "${promptText}"`, 'info', node.id)
  ctx.setNowPlaying({
    title: node.title,
    promptText,
    isTts: true,
    phase: 'playing',
    isPlaying: true,
  })

  const startWaiting = () => {
    ctx.setStatus('waiting_input')
    ctx.setNowPlaying({
      title: node.title,
      promptText,
      isTts: true,
      phase: 'ended',
      isPlaying: false,
    })
    ctx.setWaitingForInput(true, 1)
    ctx.addLog(`Menu [${node.title}] waiting for DTMF keypad selection (1-9, 0, *, #)...`, 'info', node.id)
  }

  audioPlayer.speakPrompt(
    promptText,
    () => {
      startWaiting()
    },
    ttsLang
  )
}

export function handleDtmfInputForMenu(digit: string, node: FlowNode, ctx: ExecutionContext): boolean {
  audioPlayer.stopSpeech()
  ctx.setWaitingForInput(false)
  ctx.setStatus('processing')
  ctx.addLog(`Received DTMF key "${digit}" for Menu [${node.title}]`, 'dtmf', node.id)

  const outgoingEdges = ctx.edges.filter(e => e.sourceId === node.id)
  if (outgoingEdges.length === 0) {
    ctx.addLog(`DTMF Menu [${node.title}] has no outgoing connections configured.`, 'error', node.id)
    ctx.endCall(`Test stopped: Menu [${node.title}] has no routes.`, false)
    return false
  }

  let matchedEdge: FlowEdge | undefined = outgoingEdges.find(e => {
    const p = e.sourcePort.toLowerCase()
    const l = (e.label || '').toLowerCase()
    return (
      p === `key${digit}` ||
      p === `option_${digit}` ||
      p === digit ||
      l === digit ||
      l === `key ${digit}` ||
      l === `option ${digit}`
    )
  })

  if (!matchedEdge && (digit === '1' || digit === '0')) {
    matchedEdge = outgoingEdges.find(e => e.sourcePort === 'out' || e.sourcePort === 'success') || outgoingEdges[0]
  }

  if (matchedEdge) {
    const targetNode = ctx.nodes.find(n => n.id === matchedEdge!.targetId)
    ctx.addLog(`DTMF "${digit}" matched route -> [${targetNode?.title || matchedEdge.targetId}]`, 'success', node.id)
    ctx.addTraceEntry({
      nodeId: node.id,
      input: digit,
      selectedBranch: matchedEdge.sourcePort,
      targetNodeId: matchedEdge.targetId,
      status: 'SUCCESS',
      detail: `DTMF key ${digit} matched route to ${targetNode?.title || matchedEdge.targetId}`,
    })
    ctx.navigateToNode(matchedEdge.targetId, 400)
    return true
  } else {
    ctx.addLog(`No route configured for DTMF digit "${digit}" in Menu [${node.title}]`, 'warn', node.id)
    const timeoutEdge = outgoingEdges.find(e => e.sourcePort === 'timeout' || e.sourcePort === 'error')
    if (timeoutEdge) {
      ctx.addLog(`Following fallback/timeout route for invalid digit "${digit}"`, 'info', node.id)
      ctx.navigateToNode(timeoutEdge.targetId, 400)
      return true
    } else {
      audioPlayer.speakPrompt(`Option ${digit} is not valid. Please try again.`, () => {
        executeDtmfMenuNode(node, ctx)
      })
      return false
    }
  }
}

function executeDtmfInputNode(node: FlowNode, ctx: ExecutionContext): void {
  ctx.setStatus('playing')
  const promptText = substituteVariables(node.prompt || node.subtitle || 'Please enter your digits on the keypad.', ctx)
  const maxDigits = parseInt(node.maxDigits || '4', 10)

  ctx.addLog(`Collecting digit input in [${node.title}] (Max: ${maxDigits} digits)`, 'info', node.id)
  ctx.setNowPlaying({
    title: node.title,
    promptText,
    isTts: true,
    phase: 'playing',
    isPlaying: true,
  })

  audioPlayer.speakPrompt(promptText, () => {
    ctx.setStatus('waiting_input')
    ctx.setNowPlaying({
      title: node.title,
      promptText,
      isTts: true,
      phase: 'ended',
      isPlaying: false,
    })
    ctx.setWaitingForInput(true, maxDigits)
  })
}

export function handleDtmfInputCompleted(digits: string, node: FlowNode, ctx: ExecutionContext): void {
  ctx.setWaitingForInput(false)
  ctx.setStatus('processing')
  const varName = node.variableName || 'user_dtmf_input'
  ctx.setVariable(varName, digits)
  ctx.addLog(`Collected input "${digits}" stored in variable "${varName}"`, 'success', node.id)
  ctx.addTraceEntry({
    nodeId: node.id,
    input: digits,
    status: 'SUCCESS',
    detail: `Input ${digits} stored in variable ${varName}`,
  })

  const outgoing = ctx.edges.find(e => e.sourceId === node.id && (e.sourcePort === 'success' || e.sourcePort === 'out')) || ctx.edges.find(e => e.sourceId === node.id)
  if (outgoing) {
    ctx.navigateToNode(outgoing.targetId, 400)
  } else {
    ctx.endCall(`Completed digit input [${node.title}]`, true)
  }
}

function executeConditionNode(node: FlowNode, ctx: ExecutionContext): void {
  ctx.setStatus('processing')

  const varName = node.conditionField || node.variableName || 'language'
  const operator = node.conditionOperator || '=='
  const expectedVal = node.conditionValue || node.variableValue || 'ar'

  let currentVal = ctx.getVariable(varName)
  if (currentVal === undefined) {
    if (varName === 'isBusinessHours') {
      currentVal = ctx.state.simulatedEnvironment.isBusinessHours
    } else {
      currentVal = ''
    }
  }

  const strCurrent = String(currentVal).trim().toLowerCase()
  const strExpected = String(expectedVal).trim().toLowerCase()

  let isTrue = false
  switch (operator) {
    case '!=':
    case '<>':
      isTrue = strCurrent !== strExpected
      break
    case '>':
      isTrue = parseFloat(strCurrent) > parseFloat(strExpected)
      break
    case '<':
      isTrue = parseFloat(strCurrent) < parseFloat(strExpected)
      break
    case 'contains':
      isTrue = strCurrent.includes(strExpected)
      break
    case '==':
    case '=':
    default:
      isTrue = strCurrent === strExpected
      break
  }

  const resultPort = isTrue ? 'true' : 'false'
  const detailMsg = `Condition (${varName} ${operator} ${expectedVal}) -> ${isTrue ? 'TRUE' : 'FALSE'}`

  ctx.addLog(`Evaluating Condition [${node.title}]: ${varName} (${strCurrent}) ${operator} ${expectedVal} => ${isTrue ? 'TRUE' : 'FALSE'}`, 'info', node.id)
  ctx.addTraceEntry({
    nodeId: node.id,
    nodeTitle: node.title,
    nodeType: node.type,
    selectedBranch: resultPort,
    status: 'SUCCESS',
    detail: detailMsg,
  })

  const outgoing = ctx.edges.find(e => e.sourceId === node.id && (e.sourcePort === resultPort || e.sourcePort === (isTrue ? 'yes' : 'no'))) || ctx.edges.find(e => e.sourceId === node.id)
  if (outgoing) {
    ctx.navigateToNode(outgoing.targetId, 400)
  } else {
    ctx.endCall(`Condition node [${node.title}] completed (${resultPort}).`, true)
  }
}

function executeVariableNode(node: FlowNode, ctx: ExecutionContext): void {
  ctx.setStatus('processing')
  let varName = node.variableName || 'language'
  let varVal = node.variableValue || 'ar'

  if (node.subtitle && node.subtitle.includes('=')) {
    const parts = node.subtitle.split('=')
    const parsedName = parts[0].replace(/set\s+/i, '').trim()
    const parsedVal = parts[1].trim()
    if (parsedName) varName = parsedName
    if (parsedVal) varVal = parsedVal
  }

  ctx.setVariable(varName, varVal)
  ctx.addLog(`Set variable "${varName}" = "${varVal}" in node [${node.title}]`, 'success', node.id)
  ctx.addTraceEntry({
    nodeId: node.id,
    nodeTitle: node.title,
    nodeType: node.type,
    status: 'SUCCESS',
    detail: `Variable: ${varName} = ${varVal}`,
  })

  const outgoing = ctx.edges.find(e => e.sourceId === node.id)
  if (outgoing) {
    ctx.navigateToNode(outgoing.targetId, 300)
  } else {
    ctx.endCall(`Flow completed after Set Variable node [${node.title}]`, true)
  }
}

async function executeApiNode(node: FlowNode, ctx: ExecutionContext): Promise<void> {
  ctx.setStatus('processing')
  let rawUrl = node.subtitle || node.url || 'https://api.nexusivr.com/v1/lookup'
  const targetUrl = substituteVariables(rawUrl, ctx)
  const saveResultAs = node.saveResultAs || 'api_result'
  const jsonPath = node.jsonPath

  ctx.addLog(`Calling external API/Webhook [${node.title}]: ${targetUrl}`, 'info', node.id)

  try {
    const res = await fetch(targetUrl, { method: 'GET', headers: { Accept: 'application/json' } })
    if (res.ok) {
      const responseText = await res.text()
      let extractedResult = responseText
      if (jsonPath) {
        try {
          const parsed = JSON.parse(responseText)
          let current = parsed
          for (const part of jsonPath.split('.')) {
            if (current && typeof current === 'object' && part in current) {
              current = current[part]
            }
          }
          if (typeof current === 'string' || typeof current === 'number' || typeof current === 'boolean') {
            extractedResult = String(current)
          }
        } catch {}
      }
      ctx.setVariable(saveResultAs, extractedResult)
      ctx.addLog(`API [${node.title}] returned ${res.status} OK. Saved result in "${saveResultAs}"`, 'success', node.id)
      ctx.addTraceEntry({
        nodeId: node.id,
        status: 'SUCCESS',
        detail: `API ${targetUrl} returned 200. ${saveResultAs}=${extractedResult}`,
      })

      const outgoing = ctx.edges.find(e => e.sourceId === node.id && (e.sourcePort === 'success' || e.sourcePort === 'found' || e.sourcePort === 'out')) || ctx.edges.find(e => e.sourceId === node.id)
      if (outgoing) ctx.navigateToNode(outgoing.targetId, 300)
      else ctx.endCall(`API call [${node.title}] succeeded.`, true)
    } else {
      throw new Error(`HTTP ${res.status}`)
    }
  } catch (e: any) {
    ctx.addLog(`API [${node.title}] request failed (${e?.message || e}). Falling back to simulated status.`, 'warn', node.id)
    const isSuccess = ctx.state.simulatedEnvironment.mockApiSuccess
    if (isSuccess) {
      ctx.addLog(`API [${node.title}] fallback OK`, 'success', node.id)
      const outgoing = ctx.edges.find(e => e.sourceId === node.id && (e.sourcePort === 'success' || e.sourcePort === 'found' || e.sourcePort === 'out')) || ctx.edges.find(e => e.sourceId === node.id)
      if (outgoing) ctx.navigateToNode(outgoing.targetId, 300)
      else ctx.endCall(`API call [${node.title}] completed.`, true)
    } else {
      ctx.addLog(`API [${node.title}] fallback Error`, 'error', node.id)
      const errorOutgoing = ctx.edges.find(e => e.sourceId === node.id && (e.sourcePort === 'error' || e.sourcePort === 'notfound')) || ctx.edges.find(e => e.sourceId === node.id)
      if (errorOutgoing) ctx.navigateToNode(errorOutgoing.targetId, 300)
      else ctx.endCall(`API call [${node.title}] failed with error.`, false)
    }
  }
}

async function executeAiNode(node: FlowNode, ctx: ExecutionContext): Promise<void> {
  ctx.setStatus('processing')
  const role = node.aiRole || 'Customer Support Agent'
  const options = node.options || ''
  ctx.addLog(`Executing AI Assistant node [${node.title}] (Role: ${role})`, 'info', node.id)

  const aiPrompt = substituteVariables(node.prompt || 'Welcome to Nexus AI voice agent. How may I assist your call today?', ctx)
  ctx.setNowPlaying({
    title: node.title,
    promptText: aiPrompt,
    isTts: true,
    phase: 'playing',
    isPlaying: true,
  })

  audioPlayer.speakPrompt(aiPrompt, async () => {
    ctx.addLog(`Sending prompt to AI LLM Backend...`, 'info', node.id)

    try {
      const res = await fetch('/api/v1/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userMessage: aiPrompt,
          role,
          options,
        }),
      })

      if (res.ok) {
        const json = await res.json()
        const reply = json.reply || json.response || 'I understand your request.'
        ctx.addLog(`AI LLM Response: "${reply}"`, 'success', node.id)
        ctx.addTraceEntry({
          nodeId: node.id,
          status: 'SUCCESS',
          detail: `AI Response: ${reply}`,
        })
      }
    } catch {
      ctx.addLog(`AI LLM completed request for [${node.title}]`, 'success', node.id)
    }

    const outgoing = ctx.edges.find(e => e.sourceId === node.id && (e.sourcePort === 'resolved' || e.sourcePort === 'out' || e.sourcePort === 'success')) || ctx.edges.find(e => e.sourceId === node.id)
    if (outgoing) ctx.navigateToNode(outgoing.targetId, 400)
    else ctx.endCall(`AI conversation completed in [${node.title}]`, true)
  })
}

function executeQueueNode(node: FlowNode, ctx: ExecutionContext): void {
  ctx.setStatus('queued')
  ctx.addLog(`Caller placed into wait Queue [${node.title}]`, 'info', node.id)

  const holdText = `You are placed in queue for ${node.title}. Please hold for the next available representative.`
  ctx.setNowPlaying({
    title: node.title,
    promptText: holdText,
    isTts: true,
    phase: 'playing',
    isPlaying: true,
  })

  audioPlayer.speakPrompt(holdText, () => {
    ctx.addLog(`Wait Queue [${node.title}] agent assignment ready`, 'success', node.id)
    const outgoing = ctx.edges.find(e => e.sourceId === node.id)
    if (outgoing) ctx.navigateToNode(outgoing.targetId, 500)
    else ctx.endCall(`Call completed in Queue [${node.title}]`, true)
  })
}

function executeTransferNode(node: FlowNode, ctx: ExecutionContext): void {
  ctx.setStatus('transferring')
  const dest = node.transferDestination || node.dest || 'Extension 1001'
  ctx.addLog(`Transferring call to [${node.title}] (${dest})...`, 'info', node.id)

  audioPlayer.playRingtone(1200)

  setTimeout(() => {
    ctx.addLog(`Call bridged successfully to destination ${dest}`, 'success', node.id)
    const outgoing = ctx.edges.find(e => e.sourceId === node.id && e.sourcePort === 'success') || ctx.edges.find(e => e.sourceId === node.id)
    if (outgoing) {
      ctx.navigateToNode(outgoing.targetId, 300)
    } else {
      ctx.endCall(`Call transferred to ${dest}`, true)
    }
  }, 1400)
}

function executeRecordNode(node: FlowNode, ctx: ExecutionContext): void {
  ctx.setStatus('playing')
  const promptText = substituteVariables(node.prompt || 'Please leave your message after the tone. Press # when finished.', ctx)

  ctx.addLog(`Prompting for voicemail recording in [${node.title}]`, 'info', node.id)
  audioPlayer.speakPrompt(promptText, () => {
    audioPlayer.playDtmfTone('#', 300)
    ctx.addLog(`Recording voice message in [${node.title}]...`, 'info', node.id)
    setTimeout(() => {
      ctx.addLog(`Recorded 5s audio message in [${node.title}]`, 'success', node.id)
      const outgoing = ctx.edges.find(e => e.sourceId === node.id)
      if (outgoing) ctx.navigateToNode(outgoing.targetId, 300)
      else ctx.endCall(`Voicemail recorded in [${node.title}]`, true)
    }, 2000)
  })
}

function executeHoursNode(node: FlowNode, ctx: ExecutionContext): void {
  ctx.setStatus('processing')
  const currentHour = new Date().getHours()
  const isOpen = ctx.state.simulatedEnvironment.isBusinessHours && (currentHour >= 8 && currentHour < 18)
  ctx.addLog(`Checking Business Hours status in [${node.title}] -> ${isOpen ? 'OPEN' : 'CLOSED'}`, 'info', node.id)

  const port = isOpen ? 'open' : 'closed'
  const outgoing = ctx.edges.find(e => e.sourceId === node.id && e.sourcePort === port) || ctx.edges.find(e => e.sourceId === node.id)

  if (outgoing) ctx.navigateToNode(outgoing.targetId, 400)
  else ctx.endCall(`Business hours check finished (${isOpen ? 'Open' : 'Closed'})`, true)
}

function executeEndNode(node: FlowNode, ctx: ExecutionContext): void {
  ctx.addLog(`Reached End Call node [${node.title}]. Terminating call.`, 'success', node.id)
  audioPlayer.playCallEndBeep()
  ctx.endCall(`Call completed successfully via [${node.title}]`, true)
}

function executeDefaultNode(node: FlowNode, ctx: ExecutionContext): void {
  ctx.addLog(`Executing node [${node.title}] (${node.type})`, 'info', node.id)
  const outgoing = ctx.edges.find(e => e.sourceId === node.id)
  if (outgoing) {
    ctx.navigateToNode(outgoing.targetId, 400)
  } else {
    ctx.endCall(`Reached end of path at node [${node.title}]`, true)
  }
}

function substituteVariables(text: string, ctx: ExecutionContext): string {
  if (!text) return ''
  return text.replace(/\{([a-zA-Z0-9_-]+)\}/g, (_, varName) => {
    const val = ctx.getVariable(varName)
    return val !== undefined ? String(val) : `{${varName}}`
  })
}


