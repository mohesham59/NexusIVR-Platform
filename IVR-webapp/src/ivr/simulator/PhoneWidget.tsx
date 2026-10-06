import { useState, useEffect, useCallback } from 'react'
import {
  Phone, PhoneOff, RotateCcw, Volume2, Play, Pause,
  AlertCircle, CheckCircle2, Clock
} from 'lucide-react'
import type { SimulationState } from '../simulation/types'
import { simulationEngine } from '../simulation/SimulationEngine'
import type { FlowNode, FlowEdge } from '../types'

interface PhoneWidgetProps {
  state: SimulationState
  nodes: FlowNode[]
  edges?: FlowEdge[]
  flowName: string
  onStartCall: () => void
  onEndCall: () => void
  onRestartCall: () => void
}

export default function PhoneWidget({
  state,
  nodes,
  flowName,
  onStartCall,
  onEndCall,
  onRestartCall,
}: PhoneWidgetProps) {
  const [pressedKey, setPressedKey] = useState<string | null>(null)

  const handleKeyPress = useCallback((digit: string) => {
    setPressedKey(digit)
    setTimeout(() => setPressedKey(null), 150)
    simulationEngine.pressDtmfKey(digit)
  }, [])

  // Listen for physical keyboard keypresses
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.getAttribute('contenteditable') === 'true')
      ) {
        return
      }

      if (['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '#'].includes(e.key)) {
        e.preventDefault()
        handleKeyPress(e.key)
      } else if (e.key === 'Enter' && state.status === 'idle') {
        e.preventDefault()
        onStartCall()
      } else if (e.key === 'Escape' && state.status !== 'idle' && state.status !== 'ended') {
        e.preventDefault()
        onEndCall()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyPress, state.status, onStartCall, onEndCall])

  const mins = Math.floor(state.callDurationSec / 60)
  const secs = state.callDurationSec % 60
  const formattedTime = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`

  const currentNode = nodes.find(n => n.id === state.currentNodeId)

  return (
    <div className="flex flex-col items-center justify-center p-4">
      {/* Phone chassis */}
      <div className="w-[340px] bg-[#0F172A] rounded-[40px] p-5 shadow-2xl border-4 border-[#1E293B] flex flex-col gap-4 text-white relative overflow-hidden select-none">
        {/* Top speaker notch & status bar */}
        <div className="flex items-center justify-between px-3 text-[10px] text-slate-400 font-mono">
          <span>Nexus Phone</span>
          <div className="w-12 h-3 bg-slate-800 rounded-full flex items-center justify-center">
            <div className="w-2 h-2 bg-slate-600 rounded-full" />
          </div>
          <span>1001</span>
        </div>

        {/* LCD Screen Display */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3 relative min-h-[190px] shadow-inner">
          {/* Header call info */}
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
            <div className="flex items-center gap-2">
              <div
                className={`w-2.5 h-2.5 rounded-full ${
                  state.status === 'idle'
                    ? 'bg-slate-500'
                    : state.status === 'connected' || state.status === 'playing'
                    ? 'bg-emerald-500 animate-pulse'
                    : state.status === 'calling'
                    ? 'bg-amber-500 animate-ping'
                    : state.status === 'waiting_input'
                    ? 'bg-purple-500 animate-pulse'
                    : 'bg-rose-500'
                }`}
              />
              <span className="text-xs font-semibold text-slate-200 capitalize">
                {state.status === 'idle'
                  ? 'Ready to Call'
                  : state.status === 'waiting_input'
                  ? 'Waiting for Input'
                  : state.status}
              </span>
            </div>
            <div className="flex items-center gap-1 font-mono text-xs text-slate-400">
              <Clock className="w-3 h-3 text-slate-500" />
              <span>{formattedTime}</span>
            </div>
          </div>

          {/* Scenario / Target Extension */}
          <div className="text-center pt-1">
            <p className="text-[10px] font-semibold tracking-wider text-blue-400 uppercase">
              {flowName || 'IVR Extension 1001'}
            </p>
            <h4 className="text-sm font-bold text-slate-100 truncate mt-0.5">
              {currentNode ? currentNode.title : state.status === 'idle' ? '☎ Extension 1001' : 'NexusIVR Call'}
            </h4>
          </div>

          {/* Now Playing Audio / Prompt Ticker */}
          {state.nowPlaying ? (
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-2.5 flex flex-col gap-1.5 animate-in fade-in duration-200">
              <div className="flex items-center justify-between text-[10px] font-semibold text-blue-400">
                <span className="flex items-center gap-1">
                  <Volume2 className="w-3 h-3 text-blue-400 animate-pulse" />
                  {state.nowPlaying.isPlaying ? 'Now Playing Prompt' : 'Prompt Paused'}
                </span>
                <span className="text-slate-500 text-[9px] uppercase">{state.nowPlaying.isTts ? 'TTS' : 'Audio'}</span>
              </div>
              <p className="text-[11px] text-slate-300 italic line-clamp-2 leading-relaxed">
                "{state.nowPlaying.promptText || 'Executing prompt audio...'}"
              </p>
              {/* Audio controls */}
              <div className="flex items-center justify-between pt-1 border-t border-slate-800/60 mt-0.5">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => simulationEngine.togglePausePrompt()}
                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-medium flex items-center gap-1"
                    title="Play / Pause Speech"
                  >
                    {state.nowPlaying.isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                  </button>
                  <button
                    onClick={() => simulationEngine.replayCurrentPrompt()}
                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-medium flex items-center gap-1"
                    title="Replay Prompt"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                </div>
                {state.nowPlaying.isPlaying && (
                  <div className="flex items-center gap-0.5">
                    <span className="w-1 h-3 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1 h-4 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-2">
              {state.status === 'idle' ? (
                <p className="text-xs text-slate-500">Press "Start Call" to simulate calling this IVR scenario.</p>
              ) : state.status === 'ended' ? (
                <p className="text-xs text-emerald-400 font-semibold">Call Completed</p>
              ) : (
                <p className="text-xs text-slate-400">Processing flow node...</p>
              )}
            </div>
          )}

          {/* DTMF Input Buffer indicator */}
          {state.isWaitingForInput && (
            <div className="bg-purple-950/40 border border-purple-800/60 rounded-lg p-1.5 flex items-center justify-between text-xs">
              <span className="text-[10px] text-purple-300 font-medium">Input Buffer:</span>
              <span className="font-mono text-purple-200 font-bold tracking-widest bg-purple-900/60 px-2 py-0.5 rounded">
                {state.inputBuffer || '_'}
              </span>
            </div>
          )}
        </div>

        {/* 3x4 DTMF Keypad Grid */}
        <div className="grid grid-cols-3 gap-2.5 py-1">
          {[
            { key: '1', sub: ' ' },
            { key: '2', sub: 'ABC' },
            { key: '3', sub: 'DEF' },
            { key: '4', sub: 'GHI' },
            { key: '5', sub: 'JKL' },
            { key: '6', sub: 'MNO' },
            { key: '7', sub: 'PQRS' },
            { key: '8', sub: 'TUV' },
            { key: '9', sub: 'WXYZ' },
            { key: '*', sub: ' ' },
            { key: '0', sub: '+' },
            { key: '#', sub: ' ' },
          ].map(item => {
            const isPressed = pressedKey === item.key
            return (
              <button
                key={item.key}
                disabled={state.status === 'idle' || state.status === 'ended'}
                onClick={() => handleKeyPress(item.key)}
                className={`h-12 rounded-2xl flex flex-col items-center justify-center transition-all ${
                  isPressed
                    ? 'bg-blue-600 text-white scale-95 shadow-lg shadow-blue-500/30'
                    : 'bg-slate-800/90 text-slate-200 hover:bg-slate-700 hover:text-white border border-slate-700/60 active:scale-95'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                <span className="text-base font-bold leading-none">{item.key}</span>
                {item.sub.trim() && <span className="text-[8px] text-slate-400 font-medium leading-tight">{item.sub}</span>}
              </button>
            )
          })}
        </div>

        {/* Action Controls Footer */}
        <div className="flex items-center justify-between gap-3 pt-2">
          {state.status === 'idle' || state.status === 'ended' ? (
            <button
              onClick={onStartCall}
              className="flex-1 h-11 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/30 transition-all active:scale-95"
            >
              <Phone className="w-4 h-4" />
              <span>{state.status === 'ended' ? 'Restart Call' : 'Start Call'}</span>
            </button>
          ) : (
            <>
              <button
                onClick={onRestartCall}
                title="Restart Call"
                className="w-11 h-11 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-2xl flex items-center justify-center border border-slate-700 transition-all"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button
                onClick={onEndCall}
                className="flex-1 h-11 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-rose-900/30 transition-all active:scale-95"
              >
                <PhoneOff className="w-4 h-4" />
                <span>End Call</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Call Summary Modal Overlay */}
      {state.status === 'ended' && state.resultSummary && (
        <div className="mt-4 w-[340px] bg-white rounded-2xl border border-slate-200 shadow-xl p-4 flex flex-col gap-3 animate-in fade-in duration-200">
          <div className="flex items-center gap-2">
            {state.resultSummary.success ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            ) : (
              <AlertCircle className="w-5 h-5 text-amber-500" />
            )}
            <h4 className="text-sm font-bold text-slate-800">Call Summary</h4>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 p-2.5 rounded-xl border border-slate-100 font-medium">
            <div>
              <span className="text-slate-400 text-[10px] block uppercase">Duration</span>
              <span className="text-slate-700 font-bold">{state.resultSummary.formattedDuration}</span>
            </div>
            <div>
              <span className="text-slate-400 text-[10px] block uppercase">Nodes Executed</span>
              <span className="text-slate-700 font-bold">{state.resultSummary.nodesExecutedCount}</span>
            </div>
          </div>

          <p className="text-xs text-slate-600 italic">"{state.resultSummary.message}"</p>

          <button
            onClick={onStartCall}
            className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl transition-colors flex items-center justify-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Test Scenario Again</span>
          </button>
        </div>
      )}
    </div>
  )
}
