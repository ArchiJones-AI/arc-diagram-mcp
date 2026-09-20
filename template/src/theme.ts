export type DiagramTheme = 'light' | 'dark';

export interface DiagramThemePalette {
  floatingMarker: string;
  floatingMarkerDim: string;
  awsMarker: string;
  awsMarkerDim: string;
  activeMarker: string;
  islandMarker: string;
  /** csdm dialect: the quilt keeps its CSDM colours in both themes, so the
   *  arrowheads over it keep one ink in both themes too. */
  csdmMarker: string;
  csdmMarkerDim: string;
}

/** React Flow materialises marker colors in SVG defs, so these follow React state. */
export const DIAGRAM_THEME_PALETTES: Record<DiagramTheme, DiagramThemePalette> = {
  light: {
    floatingMarker: '#000000',
    floatingMarkerDim: 'rgba(0,0,0,0.12)',
    awsMarker: '#9a9a9a',
    awsMarkerDim: 'rgba(154,154,154,0.12)',
    activeMarker: '#000000',
    islandMarker: '#000000',
    csdmMarker: '#2d4b57',
    csdmMarkerDim: 'rgba(45,75,87,0.14)',
  },
  dark: {
    floatingMarker: '#ffffff',
    floatingMarkerDim: 'rgba(255,255,255,0.12)',
    awsMarker: '#8a8a8a',
    awsMarkerDim: 'rgba(138,138,138,0.12)',
    activeMarker: '#ffffff',
    islandMarker: '#000000',
    csdmMarker: '#2d4b57',
    csdmMarkerDim: 'rgba(45,75,87,0.14)',
  },
};
