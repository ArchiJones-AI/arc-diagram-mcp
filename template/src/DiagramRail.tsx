import { Fragment, useEffect, type ReactNode } from 'react';

interface DiagramRailProps {
  diagrams: Array<{ id: string; title: string; section?: string }>;
  activeIndex: number;
  collapsed: boolean;
  onToggle(): void;
  onSelect(index: number): void;
  /** Merged inspector mode: the detail panels ride below the diagram list,
   *  each half an independently scrolling flex track. */
  children?: ReactNode;
}

export function DiagramRail({
  diagrams,
  activeIndex,
  collapsed,
  onToggle,
  onSelect,
  children,
}: DiagramRailProps) {
  useEffect(() => {
    const activeItem = document.querySelector<HTMLElement>(
      '.dg-diagram-list [aria-current="true"]',
    );
    if (activeItem && typeof activeItem.scrollIntoView === 'function') {
      activeItem.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  return (
    <aside
      className="dg-diagram-rail"
      aria-label="Diagrams"
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      <header className="dg-diagram-rail-head">
        <span className="dg-diagram-rail-title">Diagrams · {diagrams.length}</span>
        <button
          type="button"
          className="dg-tool dg-diagram-rail-toggle"
          aria-expanded={!collapsed}
          aria-controls="dg-diagram-list"
          title="Collapse or expand the diagram list (L)"
          onClick={onToggle}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </header>
      <ol className="dg-diagram-list" id="dg-diagram-list">
        {diagrams.map((diagram, index) => {
          const ordinal = index + 1;
          const showSection = Boolean(diagram.section?.trim())
            && diagram.section !== diagrams[index - 1]?.section;
          return (
            <Fragment key={diagram.id}>
              {showSection && (
                <li className="dg-diagram-section" role="presentation">
                  {diagram.section}
                </li>
              )}
              <li>
                <button
                  type="button"
                  className="dg-diagram-item"
                  data-diagram-id={diagram.id}
                  aria-current={index === activeIndex ? 'true' : undefined}
                  onClick={() => onSelect(index)}
                >
                  <span
                    className="dg-diagram-no"
                    title={ordinal === 10 ? 'key 0' : undefined}
                  >
                    {ordinal === 10 ? '0' : ordinal}
                  </span>
                  <span className="dg-diagram-title">{diagram.title}</span>
                </button>
              </li>
            </Fragment>
          );
        })}
      </ol>
      {children}
    </aside>
  );
}
