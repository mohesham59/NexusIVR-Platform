import { useState } from 'react'
import {
  Terminal, Info, AlertTriangle, CheckCircle, XCircle, Search,
  Database, Activity, Settings2
} from 'lucide-react'
import type { SimulationState } from '../simulation/types'
import { simulationEngine } from '../simulation/SimulationEngine'
import type { FlowNode, FlowEdge } from '../types'
import { NODE_DEFS } from '../nodeConfig'

interface DebugPanelProps {
  state: SimulationState
  nodes: FlowNode[]
  edges?: FlowEdge[]
  onSelectNodeOnCanvas?: (nodeId: string) => void
}

type TabType = 'timeline' | 'trace' | 'variables' | 'validation' | 'env'

export default function DebugPanel({ state, nodes, onSelectNodeOnCanvas }: DebugPanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>('timeline')
  const [logSearch, setLogSearch] = useState('')
  const [logFilter, setLogFilter] = useState<'all' | 'info' | 'dtmf' | 'success' | 'warn' | 'error'>('all')

  const currentNode = nodes.find(n => n.id === state.currentNodeId) || null
  const currentNodeDef = currentNode ? NODE_DEFS[currentNode.type] : null

  const filteredLogs = state.logs.filter(line => {
    const matchesLevel = logFilter === 'all' || line.level === logFilter
    const matchesSearch =
      !logSearch ||
      line.message.toLowerCase().includes(logSearch.toLowerCase()) ||
      (line.nodeTitle && line.nodeTitle.toLowerCase().includes(logSearch.toLowerCase()))
    return matchesLevel && matchesSearch
  })

  return (
    <div className="flex flex-col h-full bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden select-none">
      {/* Top Header / KPI Bar */}
      <div className="bg-slate-900 text-white p-3 flex items-center justify-between border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
            <Activity className="w-4 h-4 text-white" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-slate-100">Call Execution Debugger</h3>
            <p className="text-[10px] text-slate-400">Real-time IVR scenario trace</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
              state.status === 'idle'
                ? 'bg-slate-800 text-slate-300 border border-slate-700'
                : state.status === 'connected' || state.status === 'playing'
                ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                : state.status === 'waiting_input'
                ? 'bg-purple-950 text-purple-300 border border-purple-800'
                : state.status === 'ended'
                ? 'bg-blue-950 text-blue-300 border border-blue-800'
                : 'bg-rose-950 text-rose-300 border border-rose-800'
            }`}
          >
            {state.status}
          </span>
        </div>
      </div>

      {/* Active Node Card Inspector */}
      {currentNode && (
        <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-base"
              style={{ backgroundColor: currentNodeDef?.iconBg || '#EFF6FF' }}
            >
              {currentNodeDef?.label ? currentNodeDef.label.charAt(0) : '⚡'}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-800 truncate">{currentNode.title}</span>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 font-semibold uppercase">
                  {currentNode.type}
                </span>
              </div>
              <p className="text-[10px] text-slate-500 truncate mt-0.5">
                {currentNode.prompt || currentNode.subtitle || `Node ID: ${currentNode.id}`}
              </p>
            </div>
          </div>

          {onSelectNodeOnCanvas && (
            <button
              onClick={() => onSelectNodeOnCanvas(currentNode.id)}
              className="px-2 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 text-[10px] font-bold transition-colors flex-shrink-0"
            >
              Focus Node
            </button>
          )}
        </div>
      )}

      {/* Panel Navigation Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 px-3 bg-slate-100/60 overflow-x-auto">
        {[
          { id: 'timeline' as const, label: 'Execution Log', icon: <Terminal className="w-3.5 h-3.5" />, badge: state.logs.length },
          { id: 'trace' as const, label: 'Execution Trace', icon: <Activity className="w-3.5 h-3.5" />, badge: state.executionTrace?.length || 0 },
          { id: 'variables' as const, label: 'Variables', icon: <Database className="w-3.5 h-3.5" />, badge: Object.keys(state.variables).length },
          { id: 'validation' as const, label: 'Validation', icon: <Info className="w-3.5 h-3.5" />, badge: state.validationIssues.length },
          { id: 'env' as const, label: 'Environment', icon: <Settings2 className="w-3.5 h-3.5" /> },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 h-9 px-3 text-xs font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? 'border-blue-600 text-blue-600 bg-white'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className="w-4 h-4 rounded-full bg-slate-200 text-slate-700 text-[9px] font-bold flex items-center justify-center">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Main Tab Content */}
      <div className="flex-1 overflow-y-auto p-3 bg-slate-50">
        {activeTab === 'timeline' && (
          <div className="flex flex-col gap-2 h-full">
            {/* Filter toolbar */}
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200">
              <div className="relative flex-1">
                <Search className="w-3 h-3 text-slate-400 absolute left-2 top-2" />
                <input
                  type="text"
                  placeholder="Filter logs..."
                  value={logSearch}
                  onChange={e => setLogSearch(e.target.value)}
                  className="w-full pl-6 pr-2 py-1 border border-slate-200 rounded-lg text-[10px] bg-white outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex items-center gap-1">
                {['all', 'dtmf', 'info', 'success', 'warn', 'error'].map(lvl => (
                  <button
                    key={lvl}
                    onClick={() => setLogFilter(lvl as any)}
                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase transition-colors ${
                      logFilter === lvl ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                    }`}
                  >
                    {lvl}
                  </button>
                ))}
              </div>
            </div>

            {/* Log Entries */}
            <div className="flex-1 overflow-y-auto space-y-1 font-mono text-[11px]">
              {filteredLogs.length === 0 ? (
                <p className="text-xs text-slate-400 py-6 text-center italic">No log entries recorded yet.</p>
              ) : (
                filteredLogs.map(line => (
                  <div
                    key={line.id}
                    className="p-1.5 rounded-lg border border-slate-200/80 bg-white flex items-start gap-2 text-slate-700 leading-snug"
                  >
                    <span className="text-slate-400 text-[10px] font-semibold w-14 flex-shrink-0">{line.timestamp}</span>
                    <span
                      className={`font-bold uppercase text-[9px] w-12 flex-shrink-0 ${
                        line.level === 'dtmf'
                          ? 'text-purple-600'
                          : line.level === 'success'
                          ? 'text-emerald-600'
                          : line.level === 'warn'
                          ? 'text-amber-600'
                          : line.level === 'error'
                          ? 'text-rose-600'
                          : 'text-blue-600'
                      }`}
                    >
                      [{line.level}]
                    </span>
                    <span className="flex-1 text-slate-800">{line.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === 'trace' && (
          <div className="space-y-2 font-mono text-[11px]">
            <h4 className="text-xs font-bold font-sans text-slate-700">Step-by-Step Scenario Execution Trace</h4>
            {(!state.executionTrace || state.executionTrace.length === 0) ? (
              <p className="text-xs font-sans text-slate-400 py-6 text-center italic bg-white rounded-xl border border-slate-200">
                No execution trace steps recorded yet. Start a call to record step transitions.
              </p>
            ) : (
              <div className="space-y-2">
                {state.executionTrace.map(tr => (
                  <div key={tr.step} className="p-2.5 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-blue-600">
                        Step #{tr.step}: [{tr.nodeTitle || tr.nodeId}] ({tr.nodeType})
                      </span>
                      <span className="text-[10px] text-slate-400 font-sans">{tr.timestamp}</span>
                    </div>
                    {tr.detail && <p className="text-slate-700 text-[10px]">{tr.detail}</p>}
                    {tr.input && <p className="text-purple-700 text-[10px]">Input: {tr.input}</p>}
                    {tr.selectedBranch && (
                      <p className="text-emerald-700 text-[10px]">
                        Branch: {tr.selectedBranch} → Target: {tr.targetNodeId || 'End'}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'variables' && (
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-slate-700">Execution Variables</h4>
            {Object.keys(state.variables).length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center italic bg-white rounded-xl border border-slate-200">
                No variables set yet during call simulation.
              </p>
            ) : (
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden text-xs">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase">
                      <th className="p-2">Variable Name</th>
                      <th className="p-2">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                    {Object.entries(state.variables).map(([k, v]) => (
                      <tr key={k}>
                        <td className="p-2 font-semibold text-blue-600">{k}</td>
                        <td className="p-2 text-slate-800">{String(v)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'validation' && (
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-slate-700">Pre-flight Validation Issues</h4>
            {state.validationIssues.length === 0 ? (
              <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-medium flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-600" />
                <span>Flow structure passed validation cleanly with 0 errors!</span>
              </div>
            ) : (
              <div className="space-y-1.5">
                {state.validationIssues.map((issue, idx) => (
                  <div
                    key={idx}
                    className={`p-2.5 rounded-xl border text-xs flex items-start gap-2 bg-white ${
                      issue.type === 'error'
                        ? 'border-rose-200 text-rose-800'
                        : issue.type === 'warning'
                        ? 'border-amber-200 text-amber-800'
                        : 'border-blue-200 text-blue-800'
                    }`}
                  >
                    {issue.type === 'error' ? (
                      <XCircle className="w-4 h-4 text-rose-500 flex-shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1">
                      <p className="font-semibold">{issue.message}</p>
                      {issue.code && <span className="text-[9px] opacity-7 font-mono font-bold uppercase">{issue.code}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'env' && (
          <div className="space-y-3 bg-white p-3 rounded-xl border border-slate-200 text-xs">
            <h4 className="font-bold text-slate-800 border-b border-slate-100 pb-1.5">Simulated Environment Controls</h4>
            <p className="text-[11px] text-slate-500">
              Toggle environmental conditions to test branching logic in Hours, Holiday, and Condition nodes.
            </p>

            <div className="space-y-2 pt-1">
              <label className="flex items-center justify-between p-2 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
                <div>
                  <span className="font-semibold text-slate-800 block">Business Hours</span>
                  <span className="text-[10px] text-slate-400">Simulate Open vs Closed status for Hours nodes</span>
                </div>
                <input
                  type="checkbox"
                  checked={state.simulatedEnvironment.isBusinessHours}
                  onChange={e => simulationEngine.updateSimulatedEnvironment({ isBusinessHours: e.target.checked })}
                  className="w-4 h-4 text-blue-600 rounded"
                />
              </label>

              <label className="flex items-center justify-between p-2 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
                <div>
                  <span className="font-semibold text-slate-800 block">Holiday Calendar</span>
                  <span className="text-[10px] text-slate-400">Simulate Holiday active status</span>
                </div>
                <input
                  type="checkbox"
                  checked={state.simulatedEnvironment.isHoliday}
                  onChange={e => simulationEngine.updateSimulatedEnvironment({ isHoliday: e.target.checked })}
                  className="w-4 h-4 text-blue-600 rounded"
                />
              </label>

              <label className="flex items-center justify-between p-2 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
                <div>
                  <span className="font-semibold text-slate-800 block">API Mock Response</span>
                  <span className="text-[10px] text-slate-400">Simulate API / Webhook HTTP 200 Success vs 500 Failure</span>
                </div>
                <input
                  type="checkbox"
                  checked={state.simulatedEnvironment.mockApiSuccess}
                  onChange={e => simulationEngine.updateSimulatedEnvironment({ mockApiSuccess: e.target.checked })}
                  className="w-4 h-4 text-blue-600 rounded"
                />
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
