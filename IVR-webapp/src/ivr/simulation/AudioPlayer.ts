/**
 * Browser audio for the IVR Test Simulator.
 *
 * Prompts are played as REAL audio through an HTMLAudioElement:
 *  - TTS text   -> POST /api/v1/tts/preview (backend gTTS, same engine family
 *                  as the Asterisk TtsEngine) -> audio/mpeg Blob -> Object URL
 *  - Audio file -> GET  /api/v1/voice-prompts/stream?name=... (existing endpoint)
 *
 * The "playing" phase is only reported after the browser fires the `playing`
 * event, and completion is only reported on `ended` — the simulator never
 * fakes playback state.
 *
 * DTMF key tones / ringback are synthesized locally with the Web Audio API.
 */

export type PromptPhase =
  | 'generating' // waiting for backend TTS synthesis
  | 'loading'    // audio received, browser buffering/decoding
  | 'playing'    // audio is audibly playing
  | 'paused'
  | 'blocked'    // browser autoplay policy rejected play(); needs a user click
  | 'ended'
  | 'error'

export interface PlayPromptOptions {
  /** Text to synthesize (also used as fallback when audioFile can't be loaded). */
  text?: string
  /** BCP-47-ish language, e.g. 'en-US' or 'ar-SA'. */
  lang?: string
  /** Optional pre-recorded voice prompt name (served by /voice-prompts/stream). */
  audioFile?: string
  onPhase?: (phase: PromptPhase, detail?: string) => void
  /** Fired exactly once, when the prompt finishes playing naturally. */
  onEnd?: () => void
  /** Fired exactly once if the prompt cannot be generated or played. */
  onError?: (message: string) => void
}

const TTS_ENDPOINT = '/api/v1/tts/preview'
const STREAM_ENDPOINT = '/api/v1/voice-prompts/stream'

const DTMF_FREQUENCIES: Record<string, [number, number]> = {
  '1': [697, 1209], '2': [697, 1336], '3': [697, 1477],
  '4': [770, 1209], '5': [770, 1336], '6': [770, 1477],
  '7': [852, 1209], '8': [852, 1336], '9': [852, 1477],
  '*': [941, 1209], '0': [941, 1336], '#': [941, 1477],
}

function log(...args: unknown[]): void {
  console.info('[TTS]', ...args)
}

async function readErrorBody(res: Response): Promise<string> {
  try {
    const body = await res.text()
    try {
      const json = JSON.parse(body)
      return json.message || json.error || body
    } catch {
      return body.slice(0, 300)
    }
  } catch {
    return res.statusText
  }
}

class AudioPlayerService {
  private audioCtx: AudioContext | null = null
  private audio: HTMLAudioElement | null = null
  private objectUrl: string | null = null
  /** Incremented on every new prompt / stop, invalidating stale async work + callbacks. */
  private token = 0
  private endFired = false
  private currentPhaseCb: PlayPromptOptions['onPhase'] = undefined
  /** Session cache so replays / restarts don't re-synthesize identical prompts. */
  private ttsCache = new Map<string, Blob>()

  // ── Real prompt playback ────────────────────────────────────────────────

  public async playPrompt(opts: PlayPromptOptions): Promise<void> {
    this.stop()
    const myToken = ++this.token
    this.endFired = false
    this.currentPhaseCb = opts.onPhase

    const isCurrent = () => myToken === this.token
    let errorFired = false
    const fail = (message: string) => {
      if (!isCurrent() || errorFired) return
      errorFired = true
      log('Playback failed:', message)
      opts.onPhase?.('error', message)
      opts.onError?.(message)
    }

    if (typeof window === 'undefined' || typeof Audio === 'undefined') {
      fail('Audio playback is not available in this environment')
      return
    }

    let blob: Blob
    try {
      blob = await this.resolveAudioBlob(opts, isCurrent)
    } catch (e: any) {
      if (!isCurrent()) return
      log('Backend audio fetch failed:', e?.message || e, '— falling back to browser WebSpeech API')
      if (opts.text && typeof window !== 'undefined' && window.speechSynthesis) {
        this.speakWebSpeech(opts.text, opts.lang || 'en-US', opts.onEnd, opts.onPhase)
        return
      }
      fail(e?.message || String(e))
      return
    }
    if (!isCurrent()) return

    opts.onPhase?.('loading')
    const url = URL.createObjectURL(blob)
    const audio = new Audio()
    audio.preload = 'auto'
    this.audio = audio
    this.objectUrl = url

    audio.onplaying = () => {
      if (!isCurrent()) return
      log('Playback started')
      this.currentPhaseCb?.('playing')
    }
    audio.onpause = () => {
      if (!isCurrent() || audio.ended) return
      this.currentPhaseCb?.('paused')
    }
    audio.onended = () => {
      if (!isCurrent()) return
      log('Playback ended')
      this.currentPhaseCb?.('ended')
      if (!this.endFired) {
        this.endFired = true
        opts.onEnd?.()
      }
    }
    audio.onerror = () => {
      const err = audio.error
      if (!isCurrent()) return
      log('Audio element error:', err, 'Falling back to browser WebSpeech API')
      if (opts.text && typeof window !== 'undefined' && window.speechSynthesis) {
        this.speakWebSpeech(opts.text, opts.lang || 'en-US', opts.onEnd, opts.onPhase)
        return
      }
      fail(`Browser could not decode audio${err ? ` (code ${err.code}${err.message ? `: ${err.message}` : ''})` : ''}`)
    }

    audio.src = url
    try {
      await audio.play()
    } catch (e: any) {
      if (!isCurrent()) return
      if (e?.name === 'NotAllowedError') {
        log('Playback failed: NotAllowedError (browser autoplay policy) — waiting for user to press Play')
        opts.onPhase?.('blocked', 'Browser blocked autoplay. Press Play to hear the prompt.')
        return
      }
      if (e?.name === 'AbortError') return // superseded by stop()/new prompt
      log('audio.play() failed:', e?.message || e, 'Falling back to WebSpeech API')
      if (opts.text && typeof window !== 'undefined' && window.speechSynthesis) {
        this.speakWebSpeech(opts.text, opts.lang || 'en-US', opts.onEnd, opts.onPhase)
        return
      }
      fail(`${e?.name || 'Error'}: ${e?.message || e}`)
    }
  }

  public speakPrompt(
    text: string,
    onEnd?: () => void,
    lang: string = 'en-US',
    onPhase?: (phase: PromptPhase, detail?: string) => void
  ): void {
    this.playPrompt({
      text,
      lang,
      onEnd,
      onPhase,
      onError: (msg) => {
        log('speakPrompt error callback:', msg)
        onEnd?.()
      }
    })
  }

  private speakWebSpeech(
    text: string,
    lang: string = 'en-US',
    onEnd?: () => void,
    onPhase?: (phase: PromptPhase, detail?: string) => void
  ): void {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      onPhase?.('error', 'Browser SpeechSynthesis unavailable')
      onEnd?.()
      return
    }
    window.speechSynthesis.cancel()
    const cleanText = text.replace(/<[^>]*>?/gm, '').trim()
    if (!cleanText) {
      onEnd?.()
      return
    }

    const utterance = new SpeechSynthesisUtterance(cleanText)
    utterance.lang = lang.includes('ar') ? 'ar-SA' : 'en-US'
    utterance.rate = 1.0
    utterance.pitch = 1.0

    utterance.onstart = () => {
      log('WebSpeech started speaking:', cleanText)
      this.currentPhaseCb?.('playing')
      onPhase?.('playing')
    }

    utterance.onend = () => {
      log('WebSpeech ended speaking')
      this.currentPhaseCb?.('ended')
      onPhase?.('ended')
      if (!this.endFired) {
        this.endFired = true
        onEnd?.()
      }
    }

    utterance.onerror = (e) => {
      log('WebSpeech error:', e.error)
      this.currentPhaseCb?.('error', String(e.error))
      onPhase?.('error', String(e.error))
      onEnd?.()
    }

    window.speechSynthesis.speak(utterance)
  }

  private async resolveAudioBlob(opts: PlayPromptOptions, isCurrent: () => boolean): Promise<Blob> {
    if (opts.audioFile) {
      try {
        return await this.fetchAudioFile(opts.audioFile)
      } catch (e: any) {
        if (!opts.text) throw e
        log(`Audio file "${opts.audioFile}" unavailable (${e?.message}); falling back to TTS`)
        if (!isCurrent()) throw new Error('cancelled')
      }
    }
    if (!opts.text || !opts.text.trim()) {
      throw new Error('Audio configuration is missing (no prompt text or audio file).')
    }
    opts.onPhase?.('generating')
    return this.fetchTts(opts.text, opts.lang || 'en-US')
  }

  private async fetchTts(rawText: string, lang: string): Promise<Blob> {
    const text = rawText.replace(/<[^>]*>?/gm, '').trim()
    const key = `${lang}|${text}`
    const cached = this.ttsCache.get(key)
    if (cached) {
      log('Cache hit for text:', text)
      return cached
    }

    log('Request started')
    log('Text:', text, `(lang=${lang})`)
    const res = await fetch(TTS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text, language: lang }),
    })
    const contentType = res.headers.get('Content-Type') || ''
    log('Response status:', res.status)
    log('Content-Type:', contentType)

    if (!res.ok) {
      throw new Error(`TTS request failed (HTTP ${res.status}): ${await readErrorBody(res)}`)
    }
    if (!contentType.startsWith('audio/')) {
      throw new Error(`TTS endpoint returned non-audio content (${contentType || 'unknown'}): ${await readErrorBody(res)}`)
    }
    const blob = await res.blob()
    log('Audio size:', blob.size, 'bytes')
    if (blob.size === 0) throw new Error('TTS endpoint returned empty audio')

    this.ttsCache.set(key, blob)
    return blob
  }

  private async fetchAudioFile(name: string): Promise<Blob> {
    log('Loading audio file:', name)
    const res = await fetch(`${STREAM_ENDPOINT}?name=${encodeURIComponent(name)}`)
    const contentType = res.headers.get('Content-Type') || ''
    log('Response status:', res.status, 'Content-Type:', contentType)
    if (!res.ok) throw new Error(`Audio file request failed (HTTP ${res.status})`)
    if (!contentType.startsWith('audio/')) throw new Error(`Audio file endpoint returned ${contentType || 'unknown content'}`)
    const blob = await res.blob()
    log('Audio size:', blob.size, 'bytes')
    if (blob.size === 0) throw new Error('Audio file is empty')
    return blob
  }

  /** Stops current prompt immediately. Its onEnd/onError callbacks will never fire. */
  public stop(): void {
    this.token++
    this.currentPhaseCb = undefined
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      try { window.speechSynthesis.cancel() } catch {}
    }
    if (this.audio) {
      const a = this.audio
      a.onplaying = a.onpause = a.onended = a.onerror = null
      try { a.pause() } catch { /* ignore */ }
      a.removeAttribute('src')
      try { a.load() } catch { /* ignore */ }
      this.audio = null
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl)
      this.objectUrl = null
    }
  }

  public stopSpeech(): void {
    this.stop()
  }

  public pauseSpeech(): void {
    if (this.audio) {
      try { this.audio.pause() } catch {}
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      try { window.speechSynthesis.pause() } catch {}
    }
  }

  public resumeSpeech(): void {
    if (this.audio && this.audio.paused) {
      this.audio.play().catch(() => {})
    }
    if (typeof window !== 'undefined' && window.speechSynthesis && window.speechSynthesis.paused) {
      window.speechSynthesis.resume()
    }
  }

  public isCurrentlySpeaking(): boolean {
    if (this.audio && !this.audio.paused && !this.audio.ended) return true
    if (typeof window !== 'undefined' && window.speechSynthesis && window.speechSynthesis.speaking && !window.speechSynthesis.paused) return true
    return false
  }

  public isCurrentlyPaused(): boolean {
    if (this.audio && this.audio.paused && !this.audio.ended) return true
    if (typeof window !== 'undefined' && window.speechSynthesis && window.speechSynthesis.paused) return true
    return false
  }

  /** Play/pause toggle. Also resumes a prompt blocked by autoplay policy (user gesture). */
  public togglePause(): void {
    if (this.isCurrentlyPaused()) {
      this.resumeSpeech()
    } else if (this.isCurrentlySpeaking()) {
      this.pauseSpeech()
    }
  }

  /** Restarts the current prompt from the beginning (does not re-advance the flow if it already ended). */
  public replay(): boolean {
    const a = this.audio
    if (!a) return false
    a.currentTime = 0
    a.play().catch(e => log('Playback failed:', e?.name || e))
    return true
  }

  public hasActivePrompt(): boolean {
    return this.audio !== null || (typeof window !== 'undefined' && Boolean(window.speechSynthesis?.speaking))
  }

  // ── Locally synthesized tones (Web Audio) ───────────────────────────────

  private getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null
    if (!this.audioCtx) {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext
      if (Ctx) this.audioCtx = new Ctx()
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {})
    }
    return this.audioCtx
  }

  private playDualTone(f1: number, f2: number, durationMs: number, gain: number): void {
    const ctx = this.getAudioContext()
    if (!ctx) return
    try {
      const osc1 = ctx.createOscillator()
      const osc2 = ctx.createOscillator()
      const g = ctx.createGain()
      osc1.frequency.value = f1
      osc2.frequency.value = f2
      const end = ctx.currentTime + durationMs / 1000
      g.gain.setValueAtTime(gain, ctx.currentTime)
      g.gain.exponentialRampToValueAtTime(0.001, end)
      osc1.connect(g)
      osc2.connect(g)
      g.connect(ctx.destination)
      osc1.start()
      osc2.start()
      osc1.stop(end)
      osc2.stop(end)
    } catch {
      // autoplay restrictions / closed context — tones are non-critical
    }
  }

  public playDtmfTone(key: string, durationMs = 120): void {
    const freqs = DTMF_FREQUENCIES[key]
    if (freqs) this.playDualTone(freqs[0], freqs[1], durationMs, 0.12)
  }

  public playRingtone(durationMs = 800): void {
    this.playDualTone(440, 480, durationMs, 0.08)
  }

  public playCallEndBeep(): void {
    this.playDualTone(425, 425, 300, 0.1)
  }
}

export const audioPlayer = new AudioPlayerService()
