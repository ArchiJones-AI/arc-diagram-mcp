import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { DiagramLeafNode, PyramidChromeNode } from '../buildGraph';
import { NodeNote } from './NodeNote';

/**
 * Pyramid dialect color ramp (dark teal -> pale blue), interpolated across
 * however many tiers the diagram authors. Anchors sampled from the ratified
 * editorial reference (prestige-and-selectivity gradient).
 */
const RAMP: Array<[number, number, number]> = [
  [23, 61, 74], // #173d4a deep teal — apex
  [31, 79, 96], // #1f4f60
  [63, 108, 126], // #3f6c7e
  [113, 149, 168], // #7195a8
  [199, 221, 238], // #c7ddee pale blue — base
];

function rampColor(t: number): { css: string; luminance: number } {
  const clamped = Math.min(1, Math.max(0, t));
  const scaled = clamped * (RAMP.length - 1);
  const lower = Math.floor(scaled);
  const upper = Math.min(RAMP.length - 1, lower + 1);
  const frac = scaled - lower;
  const [r, g, b] = RAMP[lower].map((channel, index) => (
    Math.round(channel + (RAMP[upper][index] - channel) * frac)
  ));
  return {
    css: `rgb(${r}, ${g}, ${b})`,
    luminance: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255,
  };
}

function PyramidBarComponent({ data }: NodeProps<DiagramLeafNode>) {
  const { def, interaction, embedMode, pyramidRow = 0, pyramidRows = 1 } = data;
  const t = pyramidRows > 1 ? pyramidRow / (pyramidRows - 1) : 0;
  const { css, luminance } = rampColor(t);
  const onDark = luminance < 0.55;

  return (
    <div
      className={`dg-pyr-bar is-${interaction} ${onDark ? 'is-on-dark' : 'is-on-light'}`}
      style={{ background: css }}
    >
      <span className="dg-pyr-bar-line">
        <strong>{def.title}</strong>
        {def.subtitle && <span className="dg-pyr-bar-facts"> · {def.subtitle}</span>}
      </span>
      {embedMode && def.detail && <NodeNote detail={def.detail} citations={def.citations} />}
    </div>
  );
}

export const PyramidBar = memo(PyramidBarComponent);

function PyramidChromeComponent({ data }: NodeProps<PyramidChromeNode>) {
  const { title, subtitle, axisLabel, axisTop, axisHeight } = data;

  return (
    <div className="dg-pyr-chrome" aria-hidden="true">
      <div className="dg-pyr-heading">
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="dg-pyr-axis" style={{ top: axisTop, height: axisHeight }}>
        <svg
          className="dg-pyr-axis-arrow"
          viewBox={`0 0 16 ${Math.max(axisHeight, 40)}`}
          width="16"
          height={Math.max(axisHeight, 40)}
          preserveAspectRatio="none"
        >
          <line x1="8" y1={Math.max(axisHeight, 40)} x2="8" y2="12" stroke="currentColor" strokeWidth="1.6" />
          <polygon points="8,0 3,13 13,13" fill="currentColor" />
        </svg>
        {axisLabel && <span className="dg-pyr-axis-label">{axisLabel}</span>}
      </div>
    </div>
  );
}

export const PyramidChrome = memo(PyramidChromeComponent);
