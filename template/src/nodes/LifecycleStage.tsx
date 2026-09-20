import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { DiagramLeafNode, LifecycleChromeNode } from '../buildGraph';
import { NodeNote } from './NodeNote';

/**
 * One chevron in the lifecycle pipeline: a flat left edge and a point on the
 * right, exactly as the source figure draws it. The silhouette is a clip-path
 * rather than a border so the point stays crisp at any zoom; a same-shape
 * element one pixel behind supplies the hairline outline the figure has.
 */
function LifecycleStageComponent({ data }: NodeProps<DiagramLeafNode>) {
  const { def, interaction, embedMode, lifecyclePoint = 18 } = data;
  const clip = `polygon(0 0, calc(100% - ${lifecyclePoint}px) 0, 100% 50%, calc(100% - ${lifecyclePoint}px) 100%, 0 100%)`;

  return (
    <div className={`dg-lc-stage is-${interaction} ink-${def.accentInk ?? 'dark'}`}>
      <div className="dg-lc-stage-outline" style={{ clipPath: clip }} aria-hidden="true" />
      <div className="dg-lc-stage-face" style={{ clipPath: clip, background: def.accent }}>
        <span className="dg-lc-stage-label">{def.title}</span>
      </div>
      {/* Anchors for the feedback bus; the bus is drawn by LifecycleBusEdge. */}
      <Handle type="source" position={Position.Bottom} isConnectable={false} className="dg-lc-handle" />
      <Handle type="target" position={Position.Bottom} isConnectable={false} className="dg-lc-handle" />
      {embedMode && def.detail && <NodeNote detail={def.detail} citations={def.citations} compact />}
    </div>
  );
}

export const LifecycleStage = memo(LifecycleStageComponent);

/** A full-width substrate band beneath the frame (the Foundation layer). */
function LifecycleBandComponent({ data }: NodeProps<DiagramLeafNode>) {
  const { def, interaction, embedMode } = data;
  return (
    <div className={`dg-lc-band is-${interaction}`}>
      <span className="dg-lc-band-label">{def.title}</span>
      {embedMode && def.detail && <NodeNote detail={def.detail} citations={def.citations} compact />}
    </div>
  );
}

export const LifecycleBand = memo(LifecycleBandComponent);

/** Non-interactive chrome: the frame, its corner tab and its centred title. */
function LifecycleChromeComponent({ data }: NodeProps<LifecycleChromeNode>) {
  const { tab, frameTitle, tabHeight, tabWidth } = data;
  return (
    <div className="dg-lc-chrome" aria-hidden="true">
      {tab && (
        <div className="dg-lc-tab" style={{ height: tabHeight, width: tabWidth }}>
          <span>{tab}</span>
        </div>
      )}
      <div className="dg-lc-frame" style={{ top: tabHeight }}>
        {frameTitle && <span className="dg-lc-frame-title">{frameTitle}</span>}
      </div>
    </div>
  );
}

export const LifecycleChrome = memo(LifecycleChromeComponent);
