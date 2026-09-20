import { useState, type MouseEvent } from 'react';
import { Citations } from './Citations';

interface NodeNoteProps {
  detail: string;
  citations?: string[];
  /** Icon-sized chip, for a dialect whose cards have no room for a word. */
  compact?: boolean;
}

/**
 * Embed-mode-only notes affordance. Collapsed by default; local component state so multiple nodes can be expanded at once
 * without touching diagram-level React state. Renders as an overlay so it
 * never causes a permanent layout shift for neighbouring nodes.
 */
export function NodeNote({ detail, citations, compact }: NodeNoteProps) {
  const [open, setOpen] = useState(false);

  const stop = (event: MouseEvent) => event.stopPropagation();

  return (
    <div className="dg-node-note" onClick={stop}>
      <button
        type="button"
        className="dg-note-chip"
        aria-expanded={open}
        aria-label={compact ? (open ? 'Hide notes' : 'Show notes') : undefined}
        title={compact ? 'Notes' : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        {compact ? (open ? '\u2212' : '+') : (open ? '- notes' : '+ notes')}
      </button>
      {open && (
        <div className="dg-note-card" role="note">
          <p>{detail}</p>
          <Citations citations={citations} variant="note" />
        </div>
      )}
    </div>
  );
}
