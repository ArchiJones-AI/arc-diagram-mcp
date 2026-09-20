import { useState, type MouseEvent } from 'react';

interface CitationsProps {
  citations?: string[];
  /** 'panel' = right-rail detail panel; 'note' = embed-mode note card. */
  variant: 'panel' | 'note';
}

/**
 * Source citations, HIDDEN by default and collapsible (v1.5, 2026-09-03).
 * The audience of a shown diagram is rarely the audience of its evidence
 * trail: file paths and register ids read as plumbing in a client room. The
 * citations still ship in the data and are one click away for the author.
 */
export function Citations({ citations, variant }: CitationsProps) {
  const [open, setOpen] = useState(false);
  if (!citations || citations.length === 0) return null;
  const stop = (event: MouseEvent) => event.stopPropagation();
  const className = variant === 'panel' ? 'dg-citations' : 'dg-note-citations';
  return (
    <div className={`${className} ${open ? 'is-open' : ''}`} onClick={stop}>
      <button
        type="button"
        className="dg-citations-toggle"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? '- sources' : `+ sources (${citations.length})`}
      </button>
      {open && (
        <div className="dg-citations-list" aria-label="Source citations">
          {citations.map((citation) => (
            <code key={citation}>{citation}</code>
          ))}
        </div>
      )}
    </div>
  );
}
