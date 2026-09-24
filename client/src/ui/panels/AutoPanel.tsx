import { useState } from 'react';
import { useAnalysis, useAnalysisStore } from '../../state/analysisStore.ts';
import { useEditStore, useHistoryState } from '../../state/editStore.ts';
import { applyPending, reanalyze, requestInstruction } from '../../auto/autoEdit.ts';
import { Section } from '../controls/Section.tsx';

const EXAMPLES = ['Warmer and more cinematic', 'Moody black & white', 'Brighter, airy look', 'תעשה את השמיים יותר דרמטיים'];

export function AutoPanel({ photoId, ready }: { photoId: string; ready: boolean }) {
  const analysis = useAnalysis(photoId);
  const reset = useEditStore((s) => s.reset);
  const { isEdited } = useHistoryState(photoId);
  const [showWhy, setShowWhy] = useState(false);
  const claudeOff = analysis?.status === 'unavailable';

  const status = (() => {
    if (!analysis) return { icon: 'spinner', text: ready ? 'Preparing auto edit…' : 'Waiting for the photo…' };
    if (analysis.status === 'analyzing') {
      return { icon: 'spinner', text: 'Claude is analyzing the photo… (histogram edit applied meanwhile)' };
    }
    if (analysis.status === 'done' && analysis.source === 'claude') {
      return { icon: '✦', text: `Claude edit applied${analysis.sceneType ? ` · ${analysis.sceneType}` : ''}` };
    }
    if (analysis.status === 'done') return { icon: '✦', text: 'Histogram auto edit applied' };
    if (analysis.status === 'unavailable') return { icon: '◌', text: 'Histogram auto edit (Claude not configured)', detail: analysis.error };
    return { icon: '!', text: 'Claude analysis failed — histogram edit kept', detail: analysis.error };
  })();

  return (
    <Section title="Auto edit">
      <div className="auto-status" data-testid="auto-status" data-status={analysis?.status ?? 'none'} data-source={analysis?.source}>
        {status.icon === 'spinner' ? <span className="spinner" /> : <span className="auto-icon">{status.icon}</span>}
        <span>{status.text}</span>
      </div>
      {status.detail && <p className="hint">{status.detail}</p>}

      {analysis?.reasoning && analysis.source === 'claude' && (
        <button className="link-btn" onClick={() => setShowWhy(!showWhy)}>
          {showWhy ? 'Hide' : 'Why these settings?'}
        </button>
      )}
      {showWhy && analysis?.reasoning && <p className="reasoning">{analysis.reasoning}</p>}

      {analysis?.pending && (
        <div className="notice">
          <span>Claude's edit is ready ({analysis.pending.sceneType}). Applying it replaces your current adjustments (undoable).</span>
          <div className="notice-actions">
            <button className="btn small primary" onClick={() => applyPending(photoId)}>
              Apply
            </button>
            <button className="btn small" onClick={() => useAnalysisStore.getState().set(photoId, { pending: undefined })}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="button-row">
        <button className="btn small" disabled={!isEdited} onClick={() => reset(photoId)} title="Back to the automatic edit">
          Reset to auto
        </button>
        <button className="btn small" disabled={!ready || claudeOff || analysis?.status === 'analyzing'} onClick={() => reanalyze(photoId)}>
          Re-analyze
        </button>
      </div>

      <PromptBox photoId={photoId} disabled={!ready || claudeOff} />
      {claudeOff && <p className="hint">Set ANTHROPIC_API_KEY on the server to enable Claude and free-text requests.</p>}
    </Section>
  );
}

function PromptBox({ photoId, disabled }: { photoId: string; disabled: boolean }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<{ ok: boolean; text: string } | null>(null);

  const send = async (instruction = text) => {
    const trimmed = instruction.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setReply(null);
    try {
      const explanation = await requestInstruction(photoId, trimmed);
      setReply({ ok: true, text: explanation });
      setText('');
    } catch (e) {
      setReply({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="prompt-box">
      <label className="subhead" htmlFor="prompt-input">
        Ask for a change
      </label>
      <div className="prompt-row">
        <textarea
          id="prompt-input"
          dir="auto"
          rows={2}
          value={text}
          disabled={disabled || busy}
          placeholder="Any language — e.g. “make it warmer and more cinematic”"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          data-testid="prompt-input"
        />
        <button className="btn primary small" disabled={disabled || busy || !text.trim()} onClick={() => void send()}>
          {busy ? <span className="spinner" /> : 'Apply'}
        </button>
      </div>
      <div className="chips">
        {EXAMPLES.map((ex) => (
          <button key={ex} className="chip" dir="auto" disabled={disabled || busy} onClick={() => void send(ex)}>
            {ex}
          </button>
        ))}
      </div>
      {reply && (
        <p className={reply.ok ? 'reasoning' : 'hint error-text'} dir="auto">
          {reply.ok ? `✦ ${reply.text}` : reply.text}
        </p>
      )}
    </div>
  );
}
