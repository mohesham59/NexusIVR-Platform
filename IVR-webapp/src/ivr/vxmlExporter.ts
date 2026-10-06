/**
 * vxmlExporter.ts
 * ───────────────
 * Converts a NexusIVR FlowNode/FlowEdge graph into a VoiceXML 2.1
 * document compatible with the AGI handler (VxmlAgiHandler.java).
 *
 * Mapping strategy (node type → VoiceXML construct):
 *   start        → root <vxml> application declaration + initial <form>
 *   greeting     → <form> with <block><prompt> (TTS or audio src)
 *   playback     → <form> with <block><prompt><audio src="…"/>
 *   tts          → <form> with <block><prompt> (TTS text)
 *   dtmf_menu    → <form> with <menu><prompt><choice …>…</choice></menu>
 *   dtmf_input   → <form> with <field type="digits"><prompt>…</prompt><filled>…</filled><noinput>…</noinput><nomatch>…</nomatch></field>
 *   queue        → <form> with <block><transfer type="blind">…</transfer></block>
 *   transfer     → <form> with <block><transfer type="bridge">…</transfer></block>
 *   extension    → <form> with <block><transfer type="blind" dest="…">
 *   voicemail    → <form> with <block><prompt>…</prompt><goto/></block> (no <record> — AGI does not support it)
 *   record       → <form> with <block><prompt>…</prompt><goto/></block>
 *   hours        → <form> with <block><if cond="…"><goto> open/closed
 *   holiday      → <form> with <block><if cond="…"><goto> holiday/normal
 *   condition    → <form> with <block><if cond="…">
 *   variable     → <form> with <block><assign>
 *   api          → <form> with <block><api url="…" var="…" saveResultAs="…"/>
 *   database     → <form> with <block><api url="…" var="…" saveResultAs="…"/>
 *   webhook      → <form> with <block><api url="…" var="…" saveResultAs="…"/>
 *   ai           → <form> with <block><ai role="…" options="…">…</ai></block>
 *   end          → <form> with <block><prompt>…</prompt><disconnect/></block>
 */

import type { FlowNode, FlowEdge } from './types'

// ─── helpers ────────────────────────────────────────────────────────────────

/** XML-safe attribute / text content */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Convert a node title to a safe VoiceXML form id */
function toFormId(node: FlowNode): string {
  return `form_${node.id.replace(/[^a-zA-Z0-9]/g, '_')}`
}

/** Convert a node title to a safe, human-readable label for prompts */
function toLabel(node: FlowNode): string {
  return node.title || node.id
}

/** Slugify a flow name into a safe filename stem */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'ivr_flow'
}

/** Find the first outgoing edge from a node via a given port (or any port) */
function firstTarget(
  nodeId: string,
  edges: FlowEdge[],
  port?: string
): string | undefined {
  const e = edges.find(e => e.sourceId === nodeId && (port == null || e.sourcePort === port))
  return e?.targetId
}

/** Return the target form id for a goto, or 'end_call' if not found */
function gotoId(targetId: string | undefined, nodes: FlowNode[]): string {
  if (!targetId) return 'form_end_call'
  const target = nodes.find(n => n.id === targetId)
  return target ? toFormId(target) : 'form_end_call'
}

// ─── per-node VXML form renderers ───────────────────────────────────────────

/** Generate parallel <prompt xml:lang="en|ar"> blocks if configured, falling back to legacy prompt. */
function renderBilingualPrompts(node: FlowNode, bargein: boolean = false, fallbackEn: string = ''): string {
  let prompts = ''
  const b = bargein ? ' bargein="true"' : ' bargein="false"'

  const hasEn = !!node.promptEn || !!node.audioEn
  const hasAr = !!node.promptAr || !!node.audioAr

  // If no bilingual fields are set, use legacy title/subtitle fallback
  if (!hasEn && !hasAr) {
    const text = node.subtitle || fallbackEn || toLabel(node)
    // If it looks like an audio file, render <audio>
    if (text.endsWith('.wav') || text.endsWith('.mp3')) {
      return `      <prompt${b}>\n        <audio src="${esc(text)}">${esc(toLabel(node))}</audio>\n      </prompt>`
    }
    return `      <prompt${b}>${esc(text)}</prompt>`
  }

  if (hasEn) {
    if (node.audioEn) {
      prompts += `      <prompt${b} xml:lang="en">\n        <audio src="${esc(node.audioEn)}">${esc(node.promptEn || '')}</audio>\n      </prompt>\n`
    } else {
      prompts += `      <prompt${b} xml:lang="en">${esc(node.promptEn || '')}</prompt>\n`
    }
  }
  
  if (hasAr) {
    if (node.audioAr) {
      prompts += `      <prompt${b} xml:lang="ar">\n        <audio src="${esc(node.audioAr)}">${esc(node.promptAr || '')}</audio>\n      </prompt>\n`
    } else {
      prompts += `      <prompt${b} xml:lang="ar">${esc(node.promptAr || '')}</prompt>\n`
    }
  }

  return prompts.trimEnd()
}

function renderStart(node: FlowNode, nodes: FlowNode[], edges: FlowEdge[]): string {
  const next = firstTarget(node.id, edges)
  const nextId = gotoId(next, nodes)
  return `
  <!-- ═══════════════════════════════ START ═════════════════════════════════ -->
  <form id="${toFormId(node)}">
    <block>
      <!-- Flow entry point: ${esc(toLabel(node))} -->
      <goto next="#${nextId}"/>
    </block>
  </form>`
}

function renderGreeting(node: FlowNode, nodes: FlowNode[], edges: FlowEdge[]): string {
  const next = firstTarget(node.id, edges)
  const nextId = gotoId(next, nodes)
  return `
  <!-- ═════════════════════════════ GREETING ════════════════════════════════ -->
  <form id="${toFormId(node)}">
    <block>
${renderBilingualPrompts(node, false, slugify(node.title) + '.wav')}
      <goto next="#${nextId}"/>
    </block>
  </form>`
}

function renderPlayback(node: FlowNode, nodes: FlowNode[], edges: FlowEdge[]): string {
  const next = firstTarget(node.id, edges)
  const nextId = gotoId(next, nodes)
  return `
  <!-- ════════════════════════════ PLAYBACK ═════════════════════════════════ -->
  <form id="${toFormId(node)}">
    <block>
${renderBilingualPrompts(node, true, slugify(node.title) + '.wav')}
      <goto next="#${nextId}"/>
    </block>
  </form>`
}

function renderTts(node: FlowNode, nodes: FlowNode[], edges: FlowEdge[]): string {
  const next = firstTarget(node.id, edges)
  const nextId = gotoId(next, nodes)
  return `
  <!-- ══════════════════════════ TEXT-TO-SPEECH ═════════════════════════════ -->
  <form id="${toFormId(node)}">
    <block>
${renderBilingualPrompts(node, true)}
      <goto next="#${nextId}"/>
    </block>
  </form>`
}

function renderDtmfMenu(node: FlowNode, nodes: FlowNode[], edges: FlowEdge[]): string {
  // Build choices from outgoing edges (one choice per port)
  const outEdges = edges.filter(e => e.sourceId === node.id && !['timeout', 'error', 'invalid', 'nomatch'].includes(e.sourcePort))
  const timeoutEdge = edges.find(e => e.sourceId === node.id && e.sourcePort === 'timeout')

  // Map port names to DTMF digits: key1→1, key2→2, … key0→0
  function portToDigit(port: string): string {
    const match = port.match(/key(\d+)/)
    return match ? match[1] : port
  }

  const choices = outEdges.map(e => {
    const digit = portToDigit(e.sourcePort)
    const targetLabel = nodes.find(n => n.id === e.targetId)?.title || e.targetId
    const nextId = gotoId(e.targetId, nodes)
    return `      <choice dtmf="${esc(digit)}" next="#${nextId}">${esc(targetLabel)}</choice>`
  }).join('\n')

  const timeoutGoto = timeoutEdge
    ? `<goto next="#${gotoId(timeoutEdge.targetId, nodes)}"/>`
    : `<reprompt/>`

  return `
  <!-- ═══════════════════════════ DTMF MENU ═════════════════════════════════ -->
  <menu id="${toFormId(node)}">
${renderBilingualPrompts(node, true, slugify(node.title) + '.wav')}
${choices}
    <noinput>
      <prompt xml:lang="en">We did not receive any input. Please try again.</prompt>
      <prompt xml:lang="ar">لم نتلق أي إدخال. يرجى المحاولة مرة أخرى.</prompt>
      ${timeoutGoto}
    </noinput>
    <nomatch>
      <prompt xml:lang="en">Invalid option. Please try again.</prompt>
      <prompt xml:lang="ar">خيار غير صالح. يرجى المحاولة مرة أخرى.</prompt>
      <reprompt/>
    </nomatch>
  </menu>`
}

function renderDtmfInput(node: FlowNode, nodes: FlowNode[], edges: FlowEdge[]): string {
  const successEdge = edges.find(e => e.sourceId === node.id && e.sourcePort === 'success')
  const timeoutEdge = edges.find(e => e.sourceId === node.id && e.sourcePort === 'timeout')
  const successId = gotoId(successEdge?.targetId, nodes)
  const timeoutId = gotoId(timeoutEdge?.targetId, nodes)
  const varName = `var_${node.id.replace(/[^a-zA-Z0-9]/g, '_')}`

  return `
  <!-- ══════════════════════════ DTMF INPUT ═════════════════════════════════ -->
  <form id="${toFormId(node)}">
    <field name="${varName}" type="digits"${node.maxDigits ? ` maxlen="${esc(node.maxDigits)}"` : ''}>
${renderBilingualPrompts(node, true, 'Please enter your selection followed by the pound sign.')}
      <filled>
        <goto next="#${successId}"/>
      </filled>
      <noinput>
        <prompt xml:lang="en">We did not receive any input. Please try again.</prompt>
        <prompt xml:lang="ar">لم نتلق أي إدخال. يرجى المحاولة مرة أخرى.</prompt>
        <goto next="#${timeoutId}"/>
      </noinput>
      <nomatch>
        <prompt xml:lang="en">Invalid option. Please try again.</prompt>
        <prompt xml:lang="ar">خيار غير صالح. يرجى المحاولة مرة أخرى.</prompt>
        <reprompt/>
      </nomatch>
    </field>
  </form>`
}

function renderQueue(node: FlowNode, nodes: FlowNode[], edges: FlowEdge[]): string {
  const answeredEdge = edges.find(e => e.sourceId === node.id && e.sourcePort === 'answered')
  const abandonedEdge = edges.find(e => e.sourceId === node.id && e.sourcePort === 'abandoned')
  const overflowEdge  = edges.find(e => e.sourceId === node.id && e.sourcePort === 'overflow')
  const queueNum = node.subtitle || 'sip:queue@pbx.example.com'

  return `
  <!-- ═════════════════════════════ QUEUE ══════════════════════════════════ -->
  <form id="${toFormId(node)}">
    <block>
${renderBilingualPrompts(node, true, 'Please hold. Your call is being connected.')}
      <transfer name="queue_result" dest="${esc(queueNum)}" type="blind"/>
    </block>
    <block>
      <if cond="queue_result == 'answered'">
        <goto next="#${gotoId(answeredEdge?.targetId, nodes)}"/>
      <elseif cond="queue_result == 'busy' || queue_result == 'noanswer'"/>
        <goto next="#${gotoId(overflowEdge?.targetId ?? abandonedEdge?.targetId, nodes)}"/>
      <else/>
        <goto next="#${gotoId(abandonedEdge?.targetId, nodes)}"/>
      </if>
    </block>
  </form>`
}

function renderTransfer(node: FlowNode, nodes: FlowNode[], edges: FlowEdge[]): string {
  const successEdge = edges.find(e => e.sourceId === node.id && e.sourcePort === 'success')
  const failEdge    = edges.find(e => e.sourceId === node.id && e.sourcePort === 'fail')
  const dest = node.subtitle || 'sip:agent@pbx.example.com'

  return `
  <!-- ══════════════════════════ AGENT TRANSFER ════════════════════════════ -->
  <form id="${toFormId(node)}">
    <block>
${renderBilingualPrompts(node, true, 'Please hold while I transfer your call.')}
      <transfer name="xfer_result" dest="${esc(dest)}" type="bridge"/>
    </block>
    <block>
      <if cond="xfer_result == 'transferred'">
        <goto next="#${gotoId(successEdge?.targetId, nodes)}"/>
      <else/>
        <prompt>Transfer unsuccessful. Please try again.</prompt>
        <goto next="#${gotoId(failEdge?.targetId, nodes)}"/>
      </if>
    </block>
  </form>`
}

function renderExtension(node: FlowNode, nodes: FlowNode[], edges: FlowEdge[]): string {
  const answeredEdge  = edges.find(e => e.sourceId === node.id && e.sourcePort === 'answered')
  const noanswEdge    = edges.find(e => e.sourceId === node.id && e.sourcePort === 'noanswer')
  const ext = node.subtitle || 'sip:100@pbx.example.com'

  return `
  <!-- ═════════════════════════════ EXTENSION ══════════════════════════════ -->
  <form id="${toFormId(node)}">
    <block>
      <transfer name="ext_result" dest="${esc(ext)}" type="blind"/>
    </block>
    <block>
      <if cond="ext_result == 'answered'">
        <goto next="#${gotoId(answeredEdge?.targetId, nodes)}"/>
      <else/>
        <goto next="#${gotoId(noanswEdge?.targetId, nodes)}"/>
      </if>
    </block>
  </form>`
}

function renderVoicemail(node: FlowNode, nodes: FlowNode[], edges: FlowEdge[]): string {
   const next = firstTarget(node.id, edges)
   const nextId = gotoId(next, nodes)

   return `
   <!-- ════════════════════════════ VOICEMAIL ════════════════════════════════ -->
   <form id="${toFormId(node)}">
     <block>
${renderBilingualPrompts(node, true, 'Please leave your message after the beep. Press any key when done.')}
       <goto next="#${nextId}"/>
     </block>
   </form>`
 }

function renderRecord(node: FlowNode, nodes: FlowNode[], edges: FlowEdge[]): string {
   const next = firstTarget(node.id, edges)
   const nextId = gotoId(next, nodes)

   return `
   <!-- ══════════════════════════ RECORD CALL ════════════════════════════════ -->
   <form id="${toFormId(node)}">
     <block>
${renderBilingualPrompts(node, true, 'Call recording started. ' + toLabel(node))}
       <goto next="#${nextId}"/>
     </block>
   </form>`
 }

function renderHours(node: FlowNode, nodes: FlowNode[], edges: FlowEdge[]): string {
  const openEdge   = edges.find(e => e.sourceId === node.id && e.sourcePort === 'open')
  const closedEdge = edges.find(e => e.sourceId === node.id && e.sourcePort === 'closed')

  return `
  <!-- ═══════════════════════ BUSINESS HOURS CHECK ═════════════════════════ -->
  <form id="${toFormId(node)}">
    <block>
      <!--
        Replace the cond below with your platform's time-of-day function.
        Example (Voxeo/Aspect): cond="session.time >= '0800' &amp;&amp; session.time &lt;= '1700'"
      -->
      <if cond="true /* TODO: replace with platform hours check */">
        <goto next="#${gotoId(openEdge?.targetId, nodes)}"/>
      <else/>
        <goto next="#${gotoId(closedEdge?.targetId, nodes)}"/>
      </if>
    </block>
  </form>`
}

function renderHoliday(node: FlowNode, nodes: FlowNode[], edges: FlowEdge[]): string {
  const holidayEdge = edges.find(e => e.sourceId === node.id && e.sourcePort === 'holiday')
  const normalEdge  = edges.find(e => e.sourceId === node.id && e.sourcePort === 'normal')

  return `
  <!-- ══════════════════════════ HOLIDAY CHECK ═════════════════════════════ -->
  <form id="${toFormId(node)}">
    <block>
      <!--
        Replace the cond below with your platform's holiday-calendar check.
      -->
      <if cond="false /* TODO: replace with holiday calendar check */">
        <goto next="#${gotoId(holidayEdge?.targetId, nodes)}"/>
      <else/>
        <goto next="#${gotoId(normalEdge?.targetId, nodes)}"/>
      </if>
    </block>
  </form>`
}

function renderCondition(node: FlowNode, nodes: FlowNode[], edges: FlowEdge[]): string {
  const trueEdge  = edges.find(e => e.sourceId === node.id && e.sourcePort === 'true')
  const falseEdge = edges.find(e => e.sourceId === node.id && e.sourcePort === 'false')

  return `
  <!-- ════════════════════════════ CONDITION ════════════════════════════════ -->
  <form id="${toFormId(node)}">
    <block>
      <!--
        Condition: ${esc(node.subtitle || toLabel(node))}
        Replace cond attribute with the actual ECMAScript expression.
      -->
      <if cond="true /* TODO: ${esc(node.subtitle || toLabel(node))} */">
        <goto next="#${gotoId(trueEdge?.targetId, nodes)}"/>
      <else/>
        <goto next="#${gotoId(falseEdge?.targetId, nodes)}"/>
      </if>
    </block>
  </form>`
}

function renderVariable(node: FlowNode, nodes: FlowNode[], edges: FlowEdge[]): string {
  const next = firstTarget(node.id, edges)
  const nextId = gotoId(next, nodes)
  const varName = node.variableName || `var_${slugify(node.title)}`
  const varValue = node.variableValue || '1'
  let safeVarValue = varValue;
  if (!/^['"].*['"]$/.test(safeVarValue)) {
    safeVarValue = `'${safeVarValue}'`;
  }

  return `
  <!-- ════════════════════════════ SET VARIABLE ════════════════════════════ -->
  <form id="${toFormId(node)}">
    <block>
      <!-- ${esc(node.subtitle || toLabel(node))} -->
      <assign name="${esc(varName)}" expr="${esc(safeVarValue)}"/>
      <goto next="#${nextId}"/>
    </block>
  </form>`
}

function renderApi(node: FlowNode, nodes: FlowNode[], edges: FlowEdge[]): string {
   const successEdge = edges.find(e => e.sourceId === node.id && e.sourcePort === 'success')
   const errorEdge   = edges.find(e => e.sourceId === node.id && e.sourcePort === 'error')
   const url = node.subtitle || 'https://api.example.com/endpoint'
   const varName = `api_result_${node.id.replace(/[^a-zA-Z0-9]/g, '_')}`

   return `
   <!-- ════════════════════════════ API REQUEST ═════════════════════════════ -->
   <form id="${toFormId(node)}">
     <block>
       <api url="${esc(url)}" var="${varName}" saveResultAs="${varName}"/>
     </block>
     <block>
       <if cond="${varName} != null &amp;&amp; ${varName}.status == 'success'">
         <goto next="#${gotoId(successEdge?.targetId, nodes)}"/>
       <else/>
         <goto next="#${gotoId(errorEdge?.targetId, nodes)}"/>
       </if>
     </block>
   </form>`
 }

function renderDatabase(node: FlowNode, nodes: FlowNode[], edges: FlowEdge[]): string {
   const foundEdge    = edges.find(e => e.sourceId === node.id && e.sourcePort === 'found')
   const notFoundEdge = edges.find(e => e.sourceId === node.id && e.sourcePort === 'notfound')
   const varName = `db_result_${node.id.replace(/[^a-zA-Z0-9]/g, '_')}`

   return `
   <!-- ══════════════════════════ DATABASE LOOKUP ═══════════════════════════ -->
   <form id="${toFormId(node)}">
     <block>
       <api url="https://db.example.com/lookup" var="${varName}" saveResultAs="${varName}"/>
     </block>
     <block>
       <if cond="${varName} != null">
         <goto next="#${gotoId(foundEdge?.targetId, nodes)}"/>
       <else/>
         <goto next="#${gotoId(notFoundEdge?.targetId, nodes)}"/>
       </if>
     </block>
   </form>`
 }

function renderWebhook(node: FlowNode, nodes: FlowNode[], edges: FlowEdge[]): string {
   const successEdge = edges.find(e => e.sourceId === node.id && e.sourcePort === 'success')
   const errorEdge   = edges.find(e => e.sourceId === node.id && e.sourcePort === 'error')
   const url = node.subtitle || 'https://webhook.example.com/trigger'
   const varName = `webhook_result_${node.id.replace(/[^a-zA-Z0-9]/g, '_')}`

   return `
   <!-- ═════════════════════════════ WEBHOOK ════════════════════════════════ -->
   <form id="${toFormId(node)}">
     <block>
       <api url="${esc(url)}" var="${varName}" saveResultAs="${varName}"/>
     </block>
     <block>
       <if cond="${varName} != null">
         <goto next="#${gotoId(successEdge?.targetId, nodes)}"/>
       <else/>
         <goto next="#${gotoId(errorEdge?.targetId, nodes)}"/>
       </if>
     </block>
   </form>`
 }

function renderAi(node: FlowNode, nodes: FlowNode[], edges: FlowEdge[]): string {
   // Dynamically build AI routing options based on outbound edges
   const outEdges = edges.filter(e => e.sourceId === node.id)
   const dynamicOptions = outEdges.map(e => {
       const intentName = e.label || nodes.find(n => n.id === e.targetId)?.title || e.targetId
       const targetForm = gotoId(e.targetId, nodes)
       return `${esc(intentName.replace(/:/g, ''))}:${targetForm}`
   }).join(', ')
   
   // Fallback if no outbound connections are made yet
   const options = dynamicOptions || 'default:form_end_call'

   return `
   <!-- ══════════════════════════ AI ASSISTANT ══════════════════════════════ -->
   <form id="${toFormId(node)}">
     <block>
       <ai role="${esc(node.aiRole || 'You are a polite assistant.')}" options="${options}">
${renderBilingualPrompts(node, true, 'How can I help you today?')}
       </ai>
     </block>
   </form>`
 }

function renderEnd(node: FlowNode): string {
  return `
  <!-- ═══════════════════════════ END CALL ═════════════════════════════════ -->
  <form id="${toFormId(node)}">
    <block>
      <prompt bargein="false">${esc(node.subtitle || 'Thank you for calling. Goodbye.')}</prompt>
      <disconnect/>
    </block>
  </form>`
}

/** Fallback for unknown node types */
function renderUnknown(node: FlowNode, nodes: FlowNode[], edges: FlowEdge[]): string {
  const next = firstTarget(node.id, edges)
  const nextId = gotoId(next, nodes)
  return `
  <!-- ════════════════════════════ ${esc(node.type.toUpperCase())} (unrecognised type) ════════ -->
  <form id="${toFormId(node)}">
    <block>
      <!-- ${esc(toLabel(node))}: ${esc(node.subtitle || '')} -->
      <goto next="#${nextId}"/>
    </block>
  </form>`
}

// ─── public API ─────────────────────────────────────────────────────────────

export interface VxmlExportResult {
  /** Complete VoiceXML 2.1 document as a string */
  vxml: string
  /** Suggested download filename (e.g. "banking_ivr_flow.vxml") */
  filename: string
}

/**
 * Export a FlowNode/FlowEdge graph as a VoiceXML 2.1 document.
 *
 * @param flowName  Human-readable name of the flow (used for the file name)
 * @param nodes     Array of FlowNode objects
 * @param edges     Array of FlowEdge objects
 */
export function exportAsVxml(
  flowName: string,
  nodes: FlowNode[],
  edges: FlowEdge[]
): VxmlExportResult {
  const filename = `${slugify(flowName)}.vxml`

  // Topological order: start nodes first, then BFS
  const ordered: FlowNode[] = []
  const visited = new Set<string>()

  function visit(nodeId: string) {
    if (visited.has(nodeId)) return
    visited.add(nodeId)
    const node = nodes.find(n => n.id === nodeId)
    if (!node) return
    ordered.push(node)
    // Visit children in port order
    const out = edges.filter(e => e.sourceId === nodeId)
    out.forEach(e => visit(e.targetId))
  }

  // Seed with start nodes
  nodes.filter(n => n.type === 'start').forEach(n => visit(n.id))
  // Catch any disconnected nodes
  nodes.forEach(n => visit(n.id))

  const forms = ordered.map(node => {
    switch (node.type) {
      case 'start':      return renderStart(node, nodes, edges)
      case 'greeting':   return renderGreeting(node, nodes, edges)
      case 'playback':   return renderPlayback(node, nodes, edges)
      case 'tts':        return renderTts(node, nodes, edges)
      case 'dtmf_menu':  return renderDtmfMenu(node, nodes, edges)
      case 'dtmf_input': return renderDtmfInput(node, nodes, edges)
      case 'queue':      return renderQueue(node, nodes, edges)
      case 'transfer':   return renderTransfer(node, nodes, edges)
      case 'extension':  return renderExtension(node, nodes, edges)
      case 'voicemail':  return renderVoicemail(node, nodes, edges)
      case 'record':     return renderRecord(node, nodes, edges)
      case 'hours':      return renderHours(node, nodes, edges)
      case 'holiday':    return renderHoliday(node, nodes, edges)
      case 'condition':  return renderCondition(node, nodes, edges)
      case 'variable':   return renderVariable(node, nodes, edges)
      case 'api':        return renderApi(node, nodes, edges)
      case 'database':   return renderDatabase(node, nodes, edges)
      case 'webhook':    return renderWebhook(node, nodes, edges)
      case 'ai':         return renderAi(node, nodes, edges)
      case 'end':        return renderEnd(node)
      default:           return renderUnknown(node, nodes, edges)
    }
  }).join('\n')

  const generatedAt = new Date().toISOString()
  const name = flowName || 'Imported IVR Flow'

  const vxml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- FlowName: ${esc(name)} -->
<!--
  ╔══════════════════════════════════════════════════════════════════╗
  ║  NexusIVR — VoiceXML 2.1 Export                                 ║
  ║  Flow   : ${name.padEnd(52)}║
  ║  Nodes  : ${String(nodes.length).padEnd(52)}║
  ║  Edges  : ${String(edges.length).padEnd(52)}║
  ║  Exported: ${generatedAt.padEnd(51)}║
  ╚══════════════════════════════════════════════════════════════════╝

  IMPORTANT: This file requires platform-specific configuration:
    • Replace all audio src="*.wav" paths with your media server URLs.
    • Replace sip:*@pbx.example.com URIs with your PBX destinations.
    • Replace all "/* TODO */" ECMAScript conditions with real logic.
    • Validate with your VoiceXML platform before deploying.
-->
<vxml version="2.1"
      xmlns="http://www.w3.org/2001/vxml"
      xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
      xsi:schemaLocation="http://www.w3.org/2001/vxml
                          http://www.w3.org/TR/voicexml21/vxml.xsd"
      application="root.vxml">
${forms}
</vxml>`


  return { vxml, filename }
}

/**
 * Convenience function: triggers a browser download of the VXML file.
 */
export function downloadVxml(
  flowName: string,
  nodes: FlowNode[],
  edges: FlowEdge[]
): void {
  const { vxml, filename } = exportAsVxml(flowName, nodes, edges)
  const blob = new Blob([vxml], { type: 'application/voicexml+xml' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
