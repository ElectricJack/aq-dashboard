import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Conversation as Snapshot, ConversationMessage } from '../../../api/sessionConversation';
import styles from './History.module.css';

const roleName: Record<ConversationMessage['role'], string> = {
  user: 'You',
  assistant: 'Agent',
};

function conversationMatches(messages: Snapshot["messages"], needle: string) {
    if (!needle) return [];
    const literal = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
    return messages.flatMap(({ text }, message) =>
      Array.from(text.matchAll(literal), hit => ({ message, start: hit.index, end: hit.index + hit[0].length })));
}

function ConversationOutput({ messages, hit, mark }: {
  messages: Snapshot["messages"]; hit?: ReturnType<typeof conversationMatches>[number]; mark: RefObject<HTMLElement | null>;
}) {
  return <div className={styles.output} tabIndex={0} aria-label="Saved conversation">
      <ol className={styles.messages}>
        {messages.map(({ role, text }, message) => <li key={message}>
          <strong>{roleName[role]}</strong>
          <p>{hit?.message === message
            ? <>{text.slice(0, hit.start)}<mark ref={mark}>{text.slice(hit.start, hit.end)}</mark>{text.slice(hit.end)}</>
            : text}</p>
        </li>)}
      </ol>
    </div>;
}

function SearchNotice({ notice, needle, index, found, count }: {
  notice: string; needle: string; index: number; found: boolean; count: number;
}) {
  if (!notice && !needle) return null;
  const result = found ? `Match ${index + 1} of ${count}` : 'No matches in conversation.';
  return <p className={styles.notice} role="status">{notice || result}</p>;
}

export function Conversation({ id, snapshot }: { id: string; snapshot: Snapshot }) {
  const [draft, setDraft] = useState('');
  const [needle, setNeedle] = useState('');
  const [index, setIndex] = useState(0);
  const [notice, setNotice] = useState('');
  const mark = useRef<HTMLElement>(null);
  const hits = useMemo(() => conversationMatches(snapshot.messages, needle), [needle, snapshot]);
  const hit = hits[index];

  useEffect(() => { if (hit) mark.current?.scrollIntoView({ block: 'center' }); }, [hit]);

  const plainText = () => snapshot.messages.map(({ role, text }) => `${roleName[role]}\n${text}`).join('\n\n');
  async function copy() {
    try {
      await navigator.clipboard.writeText(window.getSelection()?.toString() || plainText());
      setNotice('Copied.');
    } catch {
      setNotice('Copy failed.');
    }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([plainText()], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `session-${id}-conversation.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return <>
    {snapshot.partial && <p className={styles.notice}>Partial conversation recording</p>}
    <form className={styles.toolbar} onSubmit={event => {
      event.preventDefault();
      setNeedle(draft.trim());
      setIndex(0);
      setNotice('');
    }}>
      <label>Find in conversation<input value={draft} maxLength={200} onChange={event => setDraft(event.target.value)} /></label>
      <button disabled={!draft.trim()}>Find</button>
      <button type="button" onClick={() => setIndex(index - 1)} disabled={index <= 0}>Previous</button>
      <button type="button" onClick={() => setIndex(index + 1)} disabled={index >= hits.length - 1}>Next</button>
      <button type="button" onClick={() => void copy()}>Copy selection or conversation</button>
      <button type="button" onClick={download}>Download conversation</button>
    </form>
    <SearchNotice notice={notice} needle={needle} index={index} found={!!hit} count={hits.length} />
    <ConversationOutput messages={snapshot.messages} hit={hit} mark={mark} />
  </>;
}
