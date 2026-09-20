import { BaseEdge, type EdgeProps } from '@xyflow/react';
import type { DiagramFlowEdge } from '../buildGraph';

/**
 * A feedback arrow in the lifecycle pipeline: down from the sending stage,
 * left along one shared horizontal rail, then up into the receiving stage.
 * Every arrow in the source figure sits on the SAME rail — they overlap
 * rather than nest — so the y comes from the diagram, not from the edge.
 *
 * `outOffset` / `inOffset` shift the two ends sideways when one stage both
 * sends and receives, which is the only reason the source's drop and arrow
 * are not both on the stage's centre line.
 */
const RADIUS = 6;

export function LifecycleBusEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerEnd,
  data,
}: EdgeProps<DiagramFlowEdge>) {
  const busY = data?.lifecycleBusY ?? Math.max(sourceY, targetY) + 46;
  const x1 = sourceX + (data?.lifecycleOutOffset ?? 0);
  const x2 = targetX + (data?.lifecycleInOffset ?? 0);
  const dir = x2 < x1 ? -1 : 1;
  const r = Math.min(RADIUS, Math.abs(x2 - x1) / 2, Math.abs(busY - sourceY));

  // Down · corner · rail · corner · up. Quadratics keep the elbow radius the
  // source figure draws without pulling in a path library.
  const path = [
    `M ${x1} ${sourceY}`,
    `L ${x1} ${busY - r}`,
    `Q ${x1} ${busY} ${x1 + dir * r} ${busY}`,
    `L ${x2 - dir * r} ${busY}`,
    `Q ${x2} ${busY} ${x2} ${busY - r}`,
    `L ${x2} ${targetY}`,
  ].join(' ');

  const interaction = data?.interaction ?? 'rest';

  return (
    <BaseEdge
      id={id}
      path={path}
      markerEnd={markerEnd}
      className={`dg-edge-path dg-lc-bus is-${interaction}`}
      interactionWidth={20}
    />
  );
}
