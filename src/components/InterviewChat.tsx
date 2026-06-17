import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Bot, Loader2, Send, Sparkles, UserRound, Volume2, VolumeX } from 'lucide-react';
import { apiFetch } from '../lib/apiFetch';
import type { Answers } from '../lib/briefSchema';
import type { Brief, CurrentUser } from '../lib/types';
import { MicButton } from './MicButton';

type Msg = { role: 'user' | 'assistant'; content: string };

const GREETING =
  "Hi — I'll ask a few quick questions to build the pre-analysis brief. To start: what's the client's name, and is this a Pension, ISA or GIA transfer?";

const SpeechRecognitionImpl: any =
  typeof window !== 'undefined' ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;
const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

export function InterviewChat({ user }: { user: CurrentUser | null }) {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Msg[]>([{ role: 'assistant', content: GREETING }]);
  const [answers, setAnswers] = useState<Answers>(() => {
    const init: Answers = {};
    if (user?.email) init.email = user.email;
    return init;
  });
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Voice-to-voice
  const [voiceMode, setVoiceMode] = useState(false);
  const [voiceState, setVoiceState] = useState<'idle' | 'speaking' | 'listening'>('idle');

  const endRef = useRef<HTMLDivElement>(null);
  // Refs to avoid stale closures inside the speak→listen→send loop.
  const messagesRef = useRef(messages); useEffect(() => { messagesRef.current = messages; }, [messages]);
  const answersRef = useRef(answers); useEffect(() => { answersRef.current = answers; }, [answers]);
  const voiceModeRef = useRef(voiceMode); useEffect(() => { voiceModeRef.current = voiceMode; }, [voiceMode]);
  const sendingRef = useRef(false);
  const recogRef = useRef<any>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, sending, voiceState]);

  function stopVoice() {
    if (ttsSupported) window.speechSynthesis.cancel();
    try { recogRef.current?.abort(); } catch { /* noop */ }
    recogRef.current = null;
    setVoiceState('idle');
  }
  useEffect(() => () => stopVoice(), []); // cleanup on unmount

  function startListening() {
    if (!SpeechRecognitionImpl || sendingRef.current) return;
    try {
      const rec = new SpeechRecognitionImpl();
      rec.lang = 'en-GB';
      rec.interimResults = false;
      rec.continuous = false;
      rec.onresult = (e: any) => {
        const text = e.results?.[0]?.[0]?.transcript || '';
        if (text.trim()) sendText(text);
      };
      rec.onend = () => { if (voiceState === 'listening') setVoiceState('idle'); };
      rec.onerror = () => setVoiceState('idle');
      recogRef.current = rec;
      setVoiceState('listening');
      rec.start();
    } catch { setVoiceState('idle'); }
  }

  function speak(text: string) {
    if (!ttsSupported || !voiceModeRef.current) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-GB';
    u.onend = () => { if (voiceModeRef.current) startListening(); };
    setVoiceState('speaking');
    window.speechSynthesis.speak(u);
  }

  async function sendText(text: string) {
    const t = text.trim();
    if (!t || sendingRef.current) return;
    setError(null);
    const next = [...messagesRef.current, { role: 'user' as const, content: t }];
    setMessages(next);
    setInput('');
    setSending(true); sendingRef.current = true;
    setVoiceState('idle');
    try {
      const res = await apiFetch('/api/interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next, answers: answersRef.current }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `AI request failed (HTTP ${res.status})`);
      if (body.answers && typeof body.answers === 'object') setAnswers((prev) => ({ ...prev, ...body.answers }));
      const reply = body.reply || '(no reply)';
      setMessages((m) => [...m, { role: 'assistant', content: reply }]);
      if (body.done) setDone(true);
      speak(reply); // no-op unless voice mode is on
    } catch (err: any) {
      setError(err?.message || 'AI request failed.');
    } finally {
      setSending(false); sendingRef.current = false;
    }
  }

  function toggleVoiceMode() {
    if (voiceMode) { setVoiceMode(false); stopVoice(); return; }
    if (!ttsSupported && !SpeechRecognitionImpl) {
      setError('Voice mode needs a browser with speech support (Chrome or Edge).');
      return;
    }
    setVoiceMode(true);
    voiceModeRef.current = true;
    // Read the latest assistant message, then auto-listen.
    const lastAssistant = [...messagesRef.current].reverse().find((m) => m.role === 'assistant');
    if (lastAssistant) speak(lastAssistant.content);
    else startListening();
  }

  async function createDraft() {
    setCreating(true); setError(null); stopVoice();
    try {
      const res = await apiFetch('/api/briefs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers, draft: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Could not save draft (HTTP ${res.status})`);
      const brief: Brief = body;
      navigate(`/brief/${brief.id}/edit`, { state: { justSavedDraft: true } });
    } catch (err: any) {
      setError(err?.message || 'Could not save draft.');
      setCreating(false);
    }
  }

  const capturedCount = Object.values(answers).filter((v) => String(v ?? '').trim()).length;
  const voiceLabel = voiceState === 'speaking' ? 'Speaking…' : voiceState === 'listening' ? 'Listening…' : 'Voice on';

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <div className="awm-card mb-6 border-l-4 border-l-[var(--color-gold)] p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <Sparkles className="text-[var(--color-gold)]" size={22} /> AI interview
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--color-muted-text)]">
              Answer conversationally — by text or voice — and the assistant builds the brief. When done,
              save it as a draft and review/complete the form before submitting.
              <span className="mt-1 block text-amber-300/90">It only captures what you tell it — review everything before submitting.</span>
            </p>
          </div>
          <button
            onClick={toggleVoiceMode}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition
              ${voiceMode ? 'bg-[rgba(212,160,23,0.15)] text-[var(--color-gold)]' : 'awm-btn-ghost'}`}
            title={voiceMode ? 'Turn voice off' : 'Hands-free voice mode (speaks questions, listens for answers)'}
          >
            {voiceMode ? <Volume2 size={16} /> : <VolumeX size={16} />}
            {voiceMode ? voiceLabel : 'Voice mode'}
          </button>
        </div>
        {voiceMode && (
          <p className="mt-2 text-xs text-[var(--color-muted-text)]">
            Hands-free: it reads each question aloud, then listens for your answer. Click <strong>Voice mode</strong> again to stop.
            {!SpeechRecognitionImpl && ' (Live listening needs Chrome/Edge — your replies will be spoken, but type your answers.)'}
          </p>
        )}
      </div>

      <div className="awm-card p-4">
        <div className="max-h-[55vh] space-y-4 overflow-y-auto p-2">
          {messages.map((m, i) => (
            <div key={i} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${m.role === 'user' ? 'bg-[var(--color-navy-light)] text-[var(--color-gold)]' : 'bg-sky-500/15 text-sky-300'}`}>
                {m.role === 'user' ? <UserRound size={15} /> : <Bot size={15} />}
              </div>
              <div className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${m.role === 'user' ? 'bg-[var(--color-gold)] text-[#1a1206]' : 'bg-white/5 text-slate-100'}`}>
                {m.content}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex items-center gap-2 text-sm text-[var(--color-muted-text)]">
              <Loader2 size={15} className="animate-spin" /> thinking…
            </div>
          )}
          {voiceState === 'listening' && !sending && (
            <div className="flex items-center gap-2 text-sm text-red-300">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-400" /> listening…
            </div>
          )}
          <div ref={endRef} />
        </div>

        {error && <p className="px-2 py-1 text-sm text-red-400">{error}</p>}

        <div className="mt-2 flex items-end gap-2 border-t border-[var(--color-border-dark)] pt-3">
          <MicButton value={input} onChange={setInput} />
          <textarea
            className="awm-input min-h-[2.75rem]"
            rows={1}
            placeholder="Type your answer…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(input); } }}
            disabled={creating}
          />
          <button className="awm-btn-gold flex items-center gap-1.5" onClick={() => sendText(input)} disabled={sending || creating || !input.trim()}>
            <Send size={16} /> Send
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-[var(--color-muted-text)]">{capturedCount} field{capturedCount === 1 ? '' : 's'} captured so far</span>
        <button
          className="awm-btn-gold flex items-center gap-2"
          onClick={createDraft}
          disabled={creating || capturedCount === 0}
          title={done ? 'Save the captured answers as a draft' : 'You can save a draft any time'}
        >
          {creating ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
          {done ? 'Save draft & review' : 'Save draft now'}
        </button>
      </div>
    </div>
  );
}
