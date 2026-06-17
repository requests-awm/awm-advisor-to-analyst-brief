import { useRef, useState } from 'react';
import { Loader2, Mic, Square } from 'lucide-react';
import { apiFetch } from '../lib/apiFetch';

/**
 * Dictation with live + accurate transcription.
 *
 *  • While recording, the browser SpeechRecognition API streams words into the
 *    field in real time (so you SEE what's being captured).
 *  • On stop, the recorded audio is sent to OpenAI for a higher-accuracy final
 *    transcript that replaces the live text.
 *
 * If SpeechRecognition isn't available (e.g. Firefox/Safari), it degrades to
 * record → OpenAI on stop (no live preview). If OpenAI fails, the live text is
 * kept rather than wiped.
 *
 * Props: `value` (current field text) and `onChange` (set the whole field).
 */

type State = 'idle' | 'recording' | 'transcribing';

const SpeechRecognitionImpl: any =
  typeof window !== 'undefined' ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;

function pickMime(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}
const extFor = (mime: string) => (mime.includes('mp4') ? 'mp4' : mime.includes('ogg') ? 'ogg' : 'webm');

type MicButtonProps = {
  value: string;
  onChange: (full: string) => void;
  /** Live, not-yet-finalised words ("still being heard"). Cleared on stop. */
  onInterim?: (text: string) => void;
};

export function MicButton({ value, onChange, onInterim }: MicButtonProps) {
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<any>(null);
  const recordingRef = useRef(false);
  const baseRef = useRef('');          // field text when recording began
  const finalRef = useRef('');         // accumulated final speech segments

  const compose = (extra: string) => {
    const base = baseRef.current.trim();
    const t = extra.trim();
    return base && t ? `${base} ${t}` : base || t;
  };

  function startLiveRecognition() {
    if (!SpeechRecognitionImpl) return;
    try {
      const rec = new SpeechRecognitionImpl();
      rec.lang = 'en-GB';
      rec.interimResults = true;
      rec.continuous = true;
      rec.onresult = (e: any) => {
        let interim = '';
        let gotFinal = false;
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const txt = e.results[i][0].transcript;
          if (e.results[i].isFinal) { finalRef.current += txt; gotFinal = true; }
          else interim += txt;
        }
        // Commit finalised phrases into the field; show interim separately (greyed).
        if (gotFinal) onChange(compose(finalRef.current));
        onInterim?.(interim.trim());
      };
      rec.onerror = () => { /* non-fatal — OpenAI still runs on stop */ };
      rec.onend = () => { if (recordingRef.current) { try { rec.start(); } catch { /* already started */ } } };
      rec.start();
      recognitionRef.current = rec;
    } catch { /* live preview unavailable — OpenAI still runs on stop */ }
  }

  async function start() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Recording is not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      baseRef.current = value;
      finalRef.current = '';

      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => upload(new Blob(chunksRef.current, { type: rec.mimeType || mime || 'audio/webm' }));
      rec.start();
      recorderRef.current = rec;

      recordingRef.current = true;
      startLiveRecognition();
      setState('recording');
    } catch (err: any) {
      setError(err?.name === 'NotAllowedError' ? 'Microphone permission denied.' : (err?.message || 'Could not start recording.'));
    }
  }

  function stop() {
    recordingRef.current = false;
    onInterim?.('');
    try { recognitionRef.current?.stop(); } catch { /* noop */ }
    recognitionRef.current = null;
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setState('transcribing');
  }

  async function upload(blob: Blob) {
    if (blob.size === 0) { setState('idle'); return; }
    try {
      const fd = new FormData();
      fd.append('audio', blob, `audio.${extFor(blob.type)}`);
      const res = await apiFetch('/api/transcribe', { method: 'POST', body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Transcription failed (HTTP ${res.status})`);
      const text = String(body?.text || '').trim();
      // Replace the live (browser) text with the accurate OpenAI transcript.
      if (text) onChange(compose(text));
    } catch (err: any) {
      // Keep whatever the live recognition captured rather than wiping it.
      setError(`${err?.message || 'Transcription failed'} — kept the live transcript.`);
    } finally {
      setState('idle');
    }
  }

  const recording = state === 'recording';
  const transcribing = state === 'transcribing';

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={recording ? stop : start}
        disabled={transcribing}
        title={recording ? 'Stop & finalise' : 'Dictate'}
        aria-label={recording ? 'Stop and finalise' : 'Dictate'}
        className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition
          ${recording
            ? 'border-red-500/50 bg-red-500/15 text-red-300 animate-pulse'
            : 'border-[var(--color-border-dark)] bg-white/5 text-slate-300 hover:border-[var(--color-gold)] hover:text-[var(--color-gold)]'}
          disabled:opacity-50`}
      >
        {transcribing ? <Loader2 size={15} className="animate-spin" /> : recording ? <Square size={14} /> : <Mic size={15} />}
      </button>
      {recording && <span className="text-xs text-red-300">Listening… click to finalise</span>}
      {transcribing && <span className="text-xs text-[var(--color-muted-text)]">Finalising transcript…</span>}
      {error && <span className="text-xs text-amber-400">{error}</span>}
    </span>
  );
}
