import { useRef, useState } from 'react';
import { Loader2, Mic, Square } from 'lucide-react';
import { apiFetch } from '../lib/apiFetch';

/**
 * Real-time dictation, OpenAI-powered. While recording, the cumulative audio is
 * sent to OpenAI every few seconds so the field fills in as you speak (no
 * browser speech recognition involved). On stop, a final pass also runs an
 * OpenAI "tidy" to fix punctuation / obvious mishears using context.
 */

type State = 'idle' | 'recording' | 'transcribing';
const CHUNK_MS = 4000;

function pickMime(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}
const extFor = (mime: string) => (mime.includes('mp4') ? 'mp4' : mime.includes('ogg') ? 'ogg' : 'webm');

export function MicButton({ value, onChange }: { value: string; onChange: (full: string) => void }) {
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const baseRef = useRef('');
  const mimeRef = useRef('');
  const inFlightRef = useRef(false);
  const stoppingRef = useRef(false);

  // Transcribe everything captured so far and write it into the field.
  async function transcribeSoFar(final: boolean) {
    if (!chunksRef.current.length) return;
    if (inFlightRef.current && !final) return; // skip live ticks while one is running
    inFlightRef.current = true;
    try {
      const blob = new Blob(chunksRef.current, { type: mimeRef.current || 'audio/webm' });
      if (blob.size === 0) return;
      const fd = new FormData();
      fd.append('audio', blob, `audio.${extFor(blob.type)}`);
      if (final) fd.append('tidy', 'true');
      const res = await apiFetch('/api/transcribe', { method: 'POST', body: fd });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        const text = String(body?.text || '').trim();
        if (text) { const base = baseRef.current.trim(); onChange(base ? `${base} ${text}` : text); }
      } else if (final) {
        setError(body?.error || `Transcription failed (HTTP ${res.status})`);
      }
    } catch (err: any) {
      if (final) setError(err?.message || 'Transcription failed.');
    } finally {
      inFlightRef.current = false;
    }
  }

  async function start() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Recording is not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      streamRef.current = stream;
      baseRef.current = value;
      chunksRef.current = [];
      stoppingRef.current = false;
      const mime = pickMime();
      mimeRef.current = mime;
      const rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 128000 });
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
        if (!stoppingRef.current) void transcribeSoFar(false); // live update
      };
      rec.onstop = async () => {
        setState('transcribing');
        await transcribeSoFar(true); // final + tidy
        setState('idle');
      };
      rec.start(CHUNK_MS); // emit a chunk every few seconds → live transcripts
      recRef.current = rec;
      setState('recording');
    } catch (err: any) {
      setError(err?.name === 'NotAllowedError' ? 'Microphone permission denied.' : (err?.message || 'Could not start recording.'));
    }
  }

  function stop() {
    stoppingRef.current = true;
    recRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  const recording = state === 'recording';
  const transcribing = state === 'transcribing';

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={recording ? stop : start}
        disabled={transcribing}
        title={recording ? 'Stop' : 'Dictate'}
        aria-label={recording ? 'Stop' : 'Dictate'}
        className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition
          ${recording
            ? 'border-red-500/50 bg-red-500/15 text-red-300 animate-pulse'
            : 'border-[var(--color-border-dark)] bg-white/5 text-slate-300 hover:border-[var(--color-gold)] hover:text-[var(--color-gold)]'}
          disabled:opacity-50`}
      >
        {transcribing ? <Loader2 size={15} className="animate-spin" /> : recording ? <Square size={14} /> : <Mic size={15} />}
      </button>
      {recording && <span className="text-xs text-red-300">Listening… text appears as you speak</span>}
      {transcribing && <span className="text-xs text-[var(--color-muted-text)]">Finalising…</span>}
      {error && <span className="text-xs text-amber-400">{error}</span>}
    </span>
  );
}
