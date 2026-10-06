import { useState, useEffect, useCallback } from 'react'
import type { FlowNode, FlowEdge } from '../types'
import { simulationEngine } from '../simulation/SimulationEngine'
import type { SimulationState } from '../simulation/types'
import PhoneWidget from './PhoneWidget'
import DebugPanel from './DebugPanel'
import FlowCanvas from '../FlowCanvas'

interface IvrSimulatorTabProps {
  nodes: FlowNode[]
  edges: FlowEdge[]
  flowName: string
  onSelectNode?: (nodeId: string | null) => void
}

export default function IvrSimulatorTab({
  nodes,
  edges,
  flowName,
  onSelectNode,
}: IvrSimulatorTabProps) {
  const [simState, setSimState] = useState<SimulationState>(() => simulationEngine.getState())
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [viewport, setViewport] = useState({ x: -40, y: -80, scale: 0.82 })

  useEffect(() => {
    const unsubscribe = simulationEngine.subscribe(updated => {
      setSimState(updated)
    })
    return () => unsubscribe()
  }, [])

  const handleStartCall = useCallback(() => {
    simulationEngine.startCall(nodes, edges)
  }, [nodes, edges])

  const handleEndCall = useCallback(() => {
    simulationEngine.endCall('Terminated by user button', true)
  }, [])

  const handleRestartCall = useCallback(() => {
    simulationEngine.startCall(nodes, edges)
  }, [nodes, edges])

  const handleFocusNodeOnCanvas = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId)
    onSelectNode?.(nodeId)
    const targetNode = nodes.find(n => n.id === nodeId)
    if (targetNode) {
      const containerW = 800
      const containerH = 500
      const scale = 1.0
      const targetX = containerW / 2 - (targetNode.x + 110) * scale
      const targetY = containerH / 2 - (targetNode.y + 54) * scale
      setViewport({ x: targetX, y: targetY, scale })
    }
  }, [nodes, onSelectNode])

  return (
    <div className="flex-1 flex overflow-hidden bg-slate-100 select-none">
      {/* Left Column: Phone Simulator Widget */}
      <div className="w-[380px] border-r border-slate-200 bg-slate-100 p-4 flex flex-col items-center justify-start overflow-y-auto flex-shrink-0">
        <div className="w-full max-w-sm">
          <PhoneWidget
            state={simState}
            nodes={nodes}
            edges={edges}
            flowName={flowName}
            onStartCall={handleStartCall}
            onEndCall={handleEndCall}
            onRestartCall={handleRestartCall}
          />
        </div>
      </div>

      {/* Center Column: Live Flow Canvas with Node Highlighting */}
      <div className="flex-1 flex flex-col min-w-0 border-r border-slate-200 relative overflow-hidden">
        <div className="bg-white px-3 py-2 border-b border-slate-200 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse" />
            <span className="text-xs font-bold text-slate-700">Interactive Canvas Synchronization</span>
          </div>
          <span className="text-[10px] text-slate-400 font-mono">Read-Only Simulation Mode</span>
        </div>

        <div className="flex-1 overflow-hidden relative">
          <FlowCanvas
            nodes={nodes}
            edges={edges}
            selectedId={selectedNodeId}
            simulatingId={simState.currentNodeId}
            viewport={viewport}
            onViewportChange={setViewport}
            onSelectNode={(id) => {
              setSelectedNodeId(id)
              onSelectNode?.(id)
            }}
            onMoveNode={() => {}}
            onDropNode={() => {}}
            onCollapseNode={() => {}}
            onContextMenu={() => {}}
          />
        </div>
      </div>

      {/* Right Column: Execution Debugger Panel */}
      <div className="w-[380px] p-3 bg-slate-100 flex flex-col flex-shrink-0">
        <DebugPanel
          state={simState}
          nodes={nodes}
          edges={edges}
          onSelectNodeOnCanvas={handleFocusNodeOnCanvas}
        />
      </div>
    </div>
  )
}
