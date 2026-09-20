import { useCallback, useRef } from 'react';
import { useDismissMenu } from './useDismissMenu';
import type { SidecarMode, ToolPrefs, UiPrefs } from './persistState';
import type { DiagramTheme } from './theme';

interface SettingsMenuProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  theme: DiagramTheme;
  onToggleTheme(): void;
  spacing: number;
  onSpacingChange(value: number): void;
  spacingStep: number;
  onReset(): void;
  exporting: boolean;
  onDownloadPng(): void;
  onDownloadOffline(): void;
  ui: UiPrefs;
  onSidecarChange(mode: SidecarMode): void;
  onToolChange(tool: keyof ToolPrefs, on: boolean): void;
}

const SIDECAR_OPTIONS: Array<{ value: SidecarMode; label: string }> = [
  { value: 'hidden', label: 'Hidden' },
  { value: 'right', label: 'Right column' },
  { value: 'left', label: 'In the diagram list' },
];

const TOOL_OPTIONS: Array<{ value: keyof ToolPrefs; label: string }> = [
  { value: 'zoom', label: 'Zoom and fit buttons' },
  { value: 'lock', label: 'Interactivity lock' },
  { value: 'readout', label: 'Zoom percentage' },
  { value: 'minimap', label: 'Minimap' },
];

function GearGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.6v2.6M12 18.8v2.6M4.4 7.8l2.3 1.3M17.3 14.9l2.3 1.3M4.4 16.2l2.3-1.3M17.3 9.1l2.3-1.3" />
    </svg>
  );
}

/**
 * The settings dropdown: everything you set once and rarely touch again —
 * theme, downloads, spacing, reset, where the inspector lives, which canvas
 * tools show. The everyday actions (edit, text size, inspector toggle) stay
 * on the canvas toolbar where they can be reached without a click first.
 */
export function SettingsMenu({
  open,
  onOpenChange,
  theme,
  onToggleTheme,
  spacing,
  onSpacingChange,
  spacingStep,
  onReset,
  exporting,
  onDownloadPng,
  onDownloadOffline,
  ui,
  onSidecarChange,
  onToolChange,
}: SettingsMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  useDismissMenu(open, close, [panelRef, triggerRef]);

  const tools = ui.tools;

  return (
    <div className="dg-menu-host">
      <button
        ref={triggerRef}
        className={`dg-tool dg-tool-icon ${open ? 'is-active' : ''}`}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Settings"
        title="Settings — theme, downloads, spacing, inspector and canvas tools"
        onClick={() => onOpenChange(!open)}
      >
        <GearGlyph />
      </button>
      {open && (
        <div className="dg-menu" role="menu" ref={panelRef} aria-label="Settings">
          <div className="dg-menu-group">
            <span className="dg-menu-heading">Appearance</span>
            <button type="button" role="menuitem" onClick={onToggleTheme}>
              {theme === 'dark' ? 'Light theme' : 'Dark theme'}
              <span className="dg-menu-hint">D</span>
            </button>
          </div>

          <div className="dg-menu-group">
            <span className="dg-menu-heading">Layout</span>
            <div className="dg-menu-row">
              <span>Spacing</span>
              <span className="dg-menu-stepper">
                <button
                  type="button"
                  aria-label="Tighten spacing"
                  onClick={() => onSpacingChange(spacing - spacingStep)}
                >
                  −
                </button>
                <span className="dg-spacing-value">{spacing.toFixed(2)}×</span>
                <button
                  type="button"
                  aria-label="Add breathing room"
                  onClick={() => onSpacingChange(spacing + spacingStep)}
                >
                  +
                </button>
              </span>
            </div>
            <button type="button" role="menuitem" onClick={onReset}>
              Reset this diagram&rsquo;s edits
            </button>
          </div>

          <div className="dg-menu-group">
            <span className="dg-menu-heading">Inspector</span>
            {SIDECAR_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={ui.sidecar === option.value}
                className={ui.sidecar === option.value ? 'is-checked' : ''}
                onClick={() => onSidecarChange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="dg-menu-group">
            <span className="dg-menu-heading">Canvas tools</span>
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={tools.master}
              className={tools.master ? 'is-checked' : ''}
              onClick={() => onToolChange('master', !tools.master)}
            >
              Show canvas tools
            </button>
            {TOOL_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="menuitemcheckbox"
                aria-checked={tools[option.value]}
                className={`dg-menu-sub ${tools[option.value] ? 'is-checked' : ''}`}
                disabled={!tools.master}
                onClick={() => onToolChange(option.value, !tools[option.value])}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="dg-menu-group">
            <span className="dg-menu-heading">Download</span>
            <button type="button" role="menuitem" disabled={exporting} onClick={onDownloadPng}>
              {exporting ? 'Exporting…' : `PNG — current diagram (${theme})`}
            </button>
            <button type="button" role="menuitem" onClick={onDownloadOffline}>
              Offline HTML — all diagrams
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
