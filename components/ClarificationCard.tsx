'use client';

import { useRef, useState } from 'react';
import { ArrowRight, Check, MessageSquare } from 'lucide-react';
import type { Clarification, InteractionRequest } from '@/shared/conversation';
import styles from './ClarificationCard.module.css';

type Props = {
  clarification: Clarification;
  revision: number;
  busy: boolean;
  onSubmit: (request: InteractionRequest) => Promise<void>;
};

export default function ClarificationCard({ clarification, revision, busy, onSubmit }: Props) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const retry = useRef<InteractionRequest | null>(null);
  const draftVersion = useRef(clarification.version);
  const waiting = clarification.status === 'awaiting_input';
  const unanswered = clarification.questions.filter(question => !question.answer);
  const hasAnswer = unanswered.some(question => drafts[question.id]?.trim());

  async function submit() {
    if (sending || busy || !waiting || !hasAnswer) return;
    const answers = unanswered.flatMap(question => {
      const answer = drafts[question.id]?.trim();
      return answer ? [{ questionId: question.id, answer }] : [];
    });
    // Keep the original version and operation ID if a response is lost after saving.
    // Editing a draft explicitly creates a new submission against the visible questions.
    const request = retry.current || {
      instruction: answers.map(answer => `${clarification.questions.find(question => question.id === answer.questionId)?.question}\n${answer.answer}`).join('\n\n').slice(0, 4000),
      agent: 'principal' as const,
      elementId: null,
      baseRevision: revision,
      operationId: crypto.randomUUID(),
      intent: 'answer_clarification' as const,
      clarificationId: clarification.id,
      clarificationVersion: draftVersion.current,
      answers,
    };
    retry.current = request;
    setSending(true); setError('');
    try {
      await onSubmit(request);
      retry.current = null;
      setDrafts(current => Object.fromEntries(Object.entries(current).filter(([id]) => !answers.some(answer => answer.questionId === id))));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Your answers could not be saved. Try again.');
    } finally { setSending(false); }
  }

  return <section className={styles.card} aria-label="Principal clarification">
    <div className={styles.heading}><MessageSquare size={16} /><span>YOUR PRINCIPAL</span></div>
    <h3>{waiting ? 'A few details before we begin.' : 'Your answers are saved.'}</h3>
    <p className={styles.introduction}>{waiting ? 'Answer below or talk it through in the conversation. Your team continues once the required answers are saved.' : clarification.detail || 'Your team will continue automatically when a run is available.'}</p>
    {waiting ? <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      {clarification.questions.map(question => <div className={styles.question} key={question.id}>
        {question.answer ? <><p>{question.question}</p><p className={styles.saved}><Check size={13} /><span>{question.answer}</span></p></> : <label htmlFor={`clarification-${question.id}`}>{question.question}<textarea
          id={`clarification-${question.id}`}
          value={drafts[question.id] || ''}
          rows={2}
          maxLength={2000}
          disabled={sending || busy}
          placeholder="Your answer…"
          onChange={event => {
            draftVersion.current = clarification.version;
            retry.current = null; setError('');
            setDrafts(current => ({ ...current, [question.id]: event.target.value }));
          }}
        /></label>}
      </div>)}
      {error && <p className={styles.error} role="alert">{error}</p>}
      <button className="button full" disabled={sending || busy || !hasAnswer} type="submit">{sending ? 'Saving answers…' : 'Save answers & continue'}<ArrowRight size={15} /></button>
      <p className={styles.hint}>You can answer one question at a time.</p>
    </form> : <p className={styles.continuing} role="status">Continuation queued · no need to start again</p>}
  </section>;
}
