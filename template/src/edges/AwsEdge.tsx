import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react';
import { ControlChips } from '../nodes/ControlChips';
import type { DiagramFlowEdge } from '../buildGraph';
import { pointAlongSmoothStepPath } from './pathPoint';
import { STEP_CHIP_DROP, useEdgeRoute } from './useEdgeRoutes';

export function AwsEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps<DiagramFlowEdge>) {
  // The routes provider reconstructs this edge's smoothstep path from its
  // fixed handle sides (identical geometry) and runs the automatic label
  // placer over it; path and label position come from the same computation
  // so the chip always sits on the rendered line. Local computation is the
  // fallback when the provider has no entry (e.g. first render).
  const route = useEdgeRoute(id);
  const [localPath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 8,
    offset: 20,
  });
  const interaction = data?.interaction ?? 'rest';
  const kind = data?.def.kind ?? 'flow';
  const stepNo = data?.def.stepNo;
  const path = route?.path ?? localPath;
  const positionFraction = data?.positionFraction ?? 0.5;
  const localPosition = positionFraction === 0.5
    ? { x: labelX, y: labelY }
    : pointAlongSmoothStepPath(
      localPath,
      positionFraction,
      { x: labelX, y: labelY },
    );
  const position = route?.labelPosition ?? localPosition;

  return (
    <>
      <BaseEdge
        path={path}
        markerEnd={markerEnd}
        className={`dg-edge-path dg-aws-edge is-${interaction} is-${kind}${data?.def.emphasis === 'bold' ? ' is-bold' : ''}`}
        interactionWidth={20}
      />
      {(stepNo !== undefined || data?.def.label || !!data?.def.controls?.length) && (
        <EdgeLabelRenderer>
          {stepNo !== undefined && (
            <button
              className={[
                'dg-step-marker',
                data?.stepActive ? 'is-active' : '',
                interaction === 'dim' ? 'is-dim' : '',
              ].filter(Boolean).join(' ')}
              type="button"
              aria-label={`Highlight runtime step ${stepNo}`}
              aria-pressed={data?.stepActive}
              style={{ transform: `translate(-50%, -50%) translate(${position.x}px, ${position.y}px)` }}
              onClick={(event) => {
                event.stopPropagation();
                data?.onStepSelect?.(stepNo);
              }}
            >
              {stepNo}
            </button>
          )}
          {(data?.def.label || !!data?.def.controls?.length) && (() => {
            const chip = route?.labelChipPosition
              ?? { x: position.x, y: position.y + (stepNo !== undefined ? STEP_CHIP_DROP : 0) };
            return (
              <div
                data-edge-id={id}
                className={`${data?.def.label ? 'dg-edge-label dg-edge-label-aws' : 'dg-edge-annotation'} is-${interaction}`}
                style={{ transform: `translate(-50%, -50%) translate(${chip.x}px, ${chip.y}px)` }}
              >
                {data?.def.label}
                <ControlChips controls={data?.def.controls} />
              </div>
            );
          })()}
        </EdgeLabelRenderer>
      )}
    </>
  );
}
