import type { CsdmIcon } from '../model';

/**
 * Domain pictograms, drawn as inline SVG inside a region's header band. They
 * are DECORATION: the header band is already one obstacle for the edge-label
 * placer, so a glyph inside it costs no layout of its own.
 */
export function CsdmDomainIcon({ icon }: { icon: CsdmIcon }) {
  return (
    <svg className="dg-csdm-icon" viewBox="0 0 24 24" aria-hidden="true">
      {icon === 'diamond' && <path d="M12 3 21 12 12 21 3 12Z" />}
      {icon === 'bulb' && (
        <>
          <path d="M12 3a6 6 0 0 0-3.6 10.8V16h7.2v-2.2A6 6 0 0 0 12 3Z" />
          <path d="M9.6 18.4h4.8M10.4 21h3.2" />
        </>
      )}
      {icon === 'spanner' && (
        <path d="M20 5.2a4.6 4.6 0 0 1-6.1 6.1L6.4 18.8a2 2 0 0 1-2.8-2.8l7.5-7.5A4.6 4.6 0 0 1 17.2 2.4l-3 3 2.4 2.4 3-3Z" />
      )}
      {icon === 'monitor' && (
        <>
          <rect x="3" y="4.5" width="18" height="12" rx="1.6" />
          <path d="M8.5 20h7M12 16.5V20" />
        </>
      )}
      {icon === 'briefcase' && (
        <>
          <rect x="2.6" y="7" width="18.8" height="12.4" rx="2" />
          <path d="M9 7V5.4A1.4 1.4 0 0 1 10.4 4h3.2A1.4 1.4 0 0 1 15 5.4V7M2.6 12.4h18.8" />
        </>
      )}
      {icon === 'building' && (
        <>
          <rect x="4" y="6" width="16" height="14" rx="1.2" />
          <path d="M7.6 9.6h2.2M14.2 9.6h2.2M7.6 13.2h2.2M14.2 13.2h2.2M10.6 20v-3.4h2.8V20" />
        </>
      )}
      {icon === 'stairs' && <path d="M3 20h5v-4h5v-4h5V8h3" />}
    </svg>
  );
}

/** The role glyph: a head and shoulders, as the source draws its people. */
export function CsdmRoleGlyph() {
  return (
    <svg className="dg-csdm-figure-glyph" viewBox="0 0 28 34" aria-hidden="true">
      <circle cx="14" cy="8.6" r="5" />
      <path d="M3.4 31.6a10.6 10.6 0 0 1 21.2 0" />
      <path d="M3.4 31.6h21.2" />
    </svg>
  );
}
