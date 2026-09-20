import { CONTROL_CHIP_ROW_H, controlChipRows } from '../layout';

/**
 * Control tags on a card or an edge label. A dedicated content slot: the
 * embed-mode notes chip keeps its own independent overlay, and `layout.ts`
 * reserves this row's height from the SAME `controlChipRows` function, so
 * the placer and the renderer can never disagree about how tall it is.
 */
export function ControlChips({ controls }: { controls?: string[] }) {
  const rows = controlChipRows(controls);
  if (!rows.length) return null;
  return (
    <div className="dg-control-chips" style={{ gridAutoRows: CONTROL_CHIP_ROW_H, height: rows.length * CONTROL_CHIP_ROW_H }}>
      {rows.flatMap((row, rowIndex) => row.map((tag, columnIndex) => (
        <span className="dg-control-chip" key={`${rowIndex}-${columnIndex}-${tag}`} style={{ gridRow: rowIndex + 1, gridColumn: rowIndex === 1 ? '1 / -1' : columnIndex + 1 }}>
          {tag}
        </span>
      )))}
    </div>
  );
}
