import React from 'react';

type IconProps = React.SVGProps<SVGSVGElement>;

const baseProps: React.SVGProps<SVGSVGElement> = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

/** Octagonal alchemical caution prism with inner meridian */
export const AlertCircle: React.FC<IconProps> = (props) => (
  <svg {...baseProps} {...props}>
    <polygon points="8.5 2.5 15.5 2.5 21.5 8.5 21.5 15.5 15.5 21.5 8.5 21.5 2.5 15.5 2.5 8.5" />
    <line x1="12" y1="7" x2="12" y2="13.2" />
    <polygon points="12 16.2 13.1 17.3 12 18.4 10.9 17.3" fill="currentColor" stroke="none" />
  </svg>
);

/** Surveyor plumb-bob descending vector */
export const ArrowDown: React.FC<IconProps> = (props) => (
  <svg {...baseProps} {...props}>
    <line x1="12" y1="3" x2="12" y2="18.5" />
    <polygon points="12 21 8.5 15.5 12 17 15.5 15.5" />
    <circle cx="12" cy="5.5" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

/** Plumb-bob descending onto engraved datum horizon */
export const ArrowDownToLine: React.FC<IconProps> = (props) => (
  <svg {...baseProps} {...props}>
    <line x1="12" y1="3" x2="12" y2="15" />
    <polygon points="12 17 9 12.2 12 13.5 15 12.2" />
    <line x1="4.5" y1="20.5" x2="19.5" y2="20.5" />
    <circle cx="4.5" cy="20.5" r="1" fill="currentColor" stroke="none" />
    <circle cx="19.5" cy="20.5" r="1" fill="currentColor" stroke="none" />
  </svg>
);

/** Fletched astrolabe dart pointing east */
export const ArrowRight: React.FC<IconProps> = (props) => (
  <svg {...baseProps} {...props}>
    <line x1="3.5" y1="12" x2="20" y2="12" />
    <polyline points="14.5 7 20.5 12 14.5 17" />
    <polyline points="6 9.5 3.5 12 6 14.5" />
  </svg>
);

/** Ascending spire needle */
export const ArrowUp: React.FC<IconProps> = (props) => (
  <svg {...baseProps} {...props}>
    <line x1="12" y1="20.5" x2="12" y2="4.5" />
    <polygon points="12 3 8 9 12 7.5 16 9" fill="currentColor" stroke="none" />
    <line x1="9" y1="18.5" x2="15" y2="18.5" />
  </svg>
);

/** Sextant diagonal trajectory vector with origin node */
export const ArrowUpRight: React.FC<IconProps> = (props) => (
  <svg {...baseProps} {...props}>
    <circle cx="6.5" cy="17.5" r="2" />
    <line x1="8" y1="16" x2="18.5" y2="5.5" />
    <polyline points="11.5 5.5 18.5 5.5 18.5 12.5" />
  </svg>
);

/** Bisected octagonal wax seal */
export const Ban: React.FC<IconProps> = (props) => (
  <svg {...baseProps} {...props}>
    <polygon points="8 3 16 3 21 8 21 16 16 21 8 21 3 16 3 8" />
    <line x1="6.2" y1="17.8" x2="17.8" y2="6.2" />
    <circle cx="12" cy="12" r="2.2" />
  </svg>
);

/** Calligraphic nib checkmark with terminal dot */
export const Check: React.FC<IconProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M4.5 12.5L9.5 17.5L19.5 6.5" />
    <circle cx="19.5" cy="6.5" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

/** Mitered architectural chevron descending */
export const ChevronDown: React.FC<IconProps> = (props) => (
  <svg {...baseProps} {...props}>
    <polyline points="5.5 9 12 15.5 18.5 9" />
    <circle cx="12" cy="8.5" r="1" fill="currentColor" stroke="none" />
  </svg>
);

/** Mitered architectural chevron advancing */
export const ChevronRight: React.FC<IconProps> = (props) => (
  <svg {...baseProps} {...props}>
    <polyline points="9 5.5 15.5 12 9 18.5" />
    <circle cx="8.5" cy="12" r="1" fill="currentColor" stroke="none" />
  </svg>
);

/** Overlapping twin parchment folios with corner miter */
export const Copy: React.FC<IconProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M8 8H19V19H8V8Z" />
    <path d="M16 8V4.5H4.5V16H8" />
    <line x1="11" y1="12" x2="16" y2="12" />
    <line x1="11" y1="15" x2="14.5" y2="15" />
  </svg>
);

/** Crucible funnel descending onto pedestal */
export const Download: React.FC<IconProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M12 3.5V14.5" />
    <polygon points="12 16 8.5 11.5 15.5 11.5" />
    <path d="M4.5 16.5L6.5 20.5H17.5L19.5 16.5" />
  </svg>
);

/** Vesica piscis ocular glyph */
export const Eye: React.FC<IconProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M2.5 12C5.2 7.5 8.4 5.5 12 5.5C15.6 5.5 18.8 7.5 21.5 12C18.8 16.5 15.6 18.5 12 18.5C8.4 18.5 5.2 16.5 2.5 12Z" />
    <polygon points="12 8.5 15.5 12 12 15.5 8.5 12" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

/** Eclipsed vesica piscis ocular glyph */
export const EyeOff: React.FC<IconProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M3 12C5.6 7.8 8.6 5.8 12 5.8C15.4 5.8 18.4 7.8 21 12C18.4 16.2 15.4 18.2 12 18.2C8.6 18.2 5.6 16.2 3 12Z" />
    <line x1="4" y1="20" x2="20" y2="4" />
    <circle cx="12" cy="12" r="1.5" />
  </svg>
);

/** Alchemical bifurcation node graph */
export const GitBranch: React.FC<IconProps> = (props) => (
  <svg {...baseProps} {...props}>
    <polygon points="6.5 3.5 9 6 6.5 8.5 4 6" />
    <polygon points="17.5 6.5 20 9 17.5 11.5 15 9" />
    <polygon points="6.5 15.5 9 18 6.5 20.5 4 18" />
    <line x1="6.5" y1="8.5" x2="6.5" y2="15.5" />
    <path d="M17.5 11.5C17.5 14.5 12 15 6.5 15.5" />
  </svg>
);

/** Ornate warded skeleton key with quatrefoil bow */
export const KeyRound: React.FC<IconProps> = (props) => (
  <svg {...baseProps} {...props}>
    <polygon points="7.5 6 11 9.5 7.5 13 4 9.5" />
    <circle cx="7.5" cy="9.5" r="1.2" fill="currentColor" stroke="none" />
    <line x1="11" y1="9.5" x2="20.5" y2="9.5" />
    <polyline points="16.5 9.5 16.5 13.5 18.5 13.5" />
    <line x1="20" y1="9.5" x2="20" y2="14" />
  </svg>
);

/** Isometric parchment strata */
export const Layers: React.FC<IconProps> = (props) => (
  <svg {...baseProps} {...props}>
    <polygon points="12 3 21 8 12 13 3 8" />
    <polyline points="3 12.5 12 17.5 21 12.5" />
    <polyline points="3 16.5 12 21.5 21 16.5" />
  </svg>
);

/** Interlocking infinity clasp with center pin */
export const Link2: React.FC<IconProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M9.5 7.5H6.5C4.2 7.5 2.5 9.5 2.5 12C2.5 14.5 4.2 16.5 6.5 16.5H9.5" />
    <path d="M14.5 7.5H17.5C19.8 7.5 21.5 9.5 21.5 12C21.5 14.5 19.8 16.5 17.5 16.5H14.5" />
    <line x1="7.5" y1="12" x2="16.5" y2="12" />
    <polygon points="12 10.2 13.8 12 12 13.8 10.2 12" fill="currentColor" stroke="none" />
  </svg>
);

/** Celestial astrolabe orbital spinner */
export const Loader2: React.FC<IconProps> = (props) => (
  <svg {...baseProps} {...props}>
    <circle cx="12" cy="12" r="8.5" strokeDasharray="18 8 4 8" />
    <circle cx="12" cy="3.5" r="1.6" fill="currentColor" stroke="none" />
    <polygon points="12 8 16 12 12 16 8 12" />
  </svg>
);

/** Surveyor corner reticle expansion frame */
export const Maximize2: React.FC<IconProps> = (props) => (
  <svg {...baseProps} {...props}>
    <polyline points="14.5 3.5 20.5 3.5 20.5 9.5" />
    <polyline points="9.5 20.5 3.5 20.5 3.5 14.5" />
    <line x1="20.5" y1="3.5" x2="14" y2="10" />
    <line x1="3.5" y1="20.5" x2="10" y2="14" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

/** Manuscript ruled ledger lines with rubric dot */
export const Menu: React.FC<IconProps> = (props) => (
  <svg {...baseProps} {...props}>
    <circle cx="4.5" cy="7" r="1.3" fill="currentColor" stroke="none" />
    <line x1="8.5" y1="7" x2="20" y2="7" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="17" x2="15.5" y2="17" />
  </svg>
);

/** Waning crescent moon with guiding polar star */
export const Moon: React.FC<IconProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M18.5 14.8A7.5 7.5 0 0 1 9.2 5.5A7.5 7.5 0 1 0 18.5 14.8Z" />
    <path d="M17.5 5.5V8.5M16 7H19" />
  </svg>
);

/** Bound folio spine with inward folding margin */
export const PanelLeftClose: React.FC<IconProps> = (props) => (
  <svg {...baseProps} {...props}>
    <rect x="3.5" y="4" width="17" height="16" rx="1.5" />
    <line x1="9.5" y1="4" x2="9.5" y2="20" />
    <polyline points="16.5 9.5 13.5 12 16.5 14.5" />
  </svg>
);

/** Bound folio spine with outward unfolding margin */
export const PanelLeftOpen: React.FC<IconProps> = (props) => (
  <svg {...baseProps} {...props}>
    <rect x="3.5" y="4" width="17" height="16" rx="1.5" />
    <line x1="9.5" y1="4" x2="9.5" y2="20" />
    <polyline points="13.5 9.5 16.5 12 13.5 14.5" />
  </svg>
);

/** Brass manuscript clasp pin */
export const Paperclip: React.FC<IconProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M18.5 10.5L10.2 18.8A4.2 4.2 0 0 1 4.2 12.8L13.2 3.8A2.8 2.8 0 0 1 17.2 7.8L8.5 16.5A1.4 1.4 0 0 1 6.5 14.5L14.2 6.8" />
    <circle cx="18.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
  </svg>
);

/** Drafting ink quill stylus */
export const Pencil: React.FC<IconProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M15.5 4.5L19.5 8.5L8.5 19.5H4.5V15.5L15.5 4.5Z" />
    <line x1="13" y1="7" x2="17" y2="11" />
    <line x1="4.5" y1="19.5" x2="7.5" y2="16.5" />
  </svg>
);

/** Harmonic prism play triangle with center node */
export const Play: React.FC<IconProps> = (props) => (
  <svg {...baseProps} {...props}>
    <polygon points="6.5 4.5 19.5 12 6.5 19.5" />
    <circle cx="10.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

/** Precision crosshair plus with center aperture */
export const Plus: React.FC<IconProps> = (props) => (
  <svg {...baseProps} {...props}>
    <line x1="12" y1="4" x2="12" y2="9.5" />
    <line x1="12" y1="14.5" x2="12" y2="20" />
    <line x1="4" y1="12" x2="9.5" y2="12" />
    <line x1="14.5" y1="12" x2="20" y2="12" />
    <circle cx="12" cy="12" r="1.6" />
  </svg>
);

/** Ouroboros dual-arc cycle */
export const RefreshCw: React.FC<IconProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M20 11A8 8 0 0 0 6.5 6.2" />
    <polyline points="20.5 6.5 20.5 11.2 15.8 11.2" />
    <path d="M4 13A8 8 0 0 0 17.5 17.8" />
    <polyline points="3.5 17.5 3.5 12.8 8.2 12.8" />
  </svg>
);

/** Counter-clockwise chronometer rewind arc */
export const RotateCcw: React.FC<IconProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M4.5 12A7.5 7.5 0 1 0 7 6.4" />
    <polyline points="3.5 4.5 3.5 9.2 8.2 9.2" />
    <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
  </svg>
);

/** Magnifying loupe with internal reticle crosshair */
export const Search: React.FC<IconProps> = (props) => (
  <svg {...baseProps} {...props}>
    <circle cx="10.5" cy="10.5" r="6.8" />
    <line x1="10.5" y1="7.5" x2="10.5" y2="13.5" />
    <line x1="7.5" y1="10.5" x2="13.5" y2="10.5" />
    <line x1="15.5" y1="15.5" x2="20.5" y2="20.5" />
  </svg>
);

/** Ascending beacon signal from chalice tray */
export const Share: React.FC<IconProps> = (props) => (
  <svg {...baseProps} {...props}>
    <line x1="12" y1="15" x2="12" y2="3.5" />
    <polyline points="8.5 7 12 3.5 15.5 7" />
    <path d="M5 13.5V19.5H19V13.5" />
  </svg>
);

/** Brass vernier tuning abacus with diamond stops */
export const SlidersHorizontal: React.FC<IconProps> = (props) => (
  <svg {...baseProps} {...props}>
    <line x1="3.5" y1="6.5" x2="20.5" y2="6.5" />
    <polygon points="9 4.5 11 6.5 9 8.5 7 6.5" fill="currentColor" stroke="none" />
    <line x1="3.5" y1="12" x2="20.5" y2="12" />
    <polygon points="15.5 10 17.5 12 15.5 14 13.5 12" fill="currentColor" stroke="none" />
    <line x1="3.5" y1="17.5" x2="20.5" y2="17.5" />
    <polygon points="10.5 15.5 12.5 17.5 10.5 19.5 8.5 17.5" fill="currentColor" stroke="none" />
  </svg>
);

/** Pocket slate monolith with acoustic notch */
export const Smartphone: React.FC<IconProps> = (props) => (
  <svg {...baseProps} {...props}>
    <rect x="6" y="2.5" width="12" height="19" rx="2" />
    <line x1="10" y1="5.5" x2="14" y2="5.5" />
    <polygon points="12 17.2 13.2 18.4 12 19.6 10.8 18.4" fill="currentColor" stroke="none" />
  </svg>
);

/** Chamfered obsidian stop-seal */
export const Square: React.FC<IconProps> = (props) => (
  <svg {...baseProps} {...props}>
    <polygon points="6.5 4.5 17.5 4.5 19.5 6.5 19.5 17.5 17.5 19.5 6.5 19.5 4.5 17.5 4.5 6.5" />
  </svg>
);

/** Helios solstice orb with alternating rays */
export const Sun: React.FC<IconProps> = (props) => (
  <svg {...baseProps} {...props}>
    <circle cx="12" cy="12" r="4.2" />
    <line x1="12" y1="2.5" x2="12" y2="5" />
    <line x1="12" y1="19" x2="12" y2="21.5" />
    <line x1="2.5" y1="12" x2="5" y2="12" />
    <line x1="19" y1="12" x2="21.5" y2="12" />
    <line x1="5.3" y1="5.3" x2="7.2" y2="7.2" />
    <line x1="16.8" y1="16.8" x2="18.7" y2="18.7" />
    <line x1="18.7" y1="5.3" x2="16.8" y2="7.2" />
    <line x1="7.2" y1="16.8" x2="5.3" y2="18.7" />
  </svg>
);

/** Fluted incinerator urn with lid */
export const Trash2: React.FC<IconProps> = (props) => (
  <svg {...baseProps} {...props}>
    <line x1="4" y1="6.5" x2="20" y2="6.5" />
    <path d="M9.5 6.5V4H14.5V6.5" />
    <path d="M6.5 6.5L7.8 20H16.2L17.5 6.5" />
    <line x1="10.2" y1="10" x2="10.6" y2="16.5" />
    <line x1="13.8" y1="10" x2="13.4" y2="16.5" />
  </svg>
);

/** Acoustic gramophone horn with concentric ripples */
export const Volume2: React.FC<IconProps> = (props) => (
  <svg {...baseProps} {...props}>
    <polygon points="3.5 9.5 8 9.5 13.5 5 13.5 19 8 14.5 3.5 14.5" />
    <path d="M16.5 8.8A4.8 4.8 0 0 1 16.5 15.2" />
    <path d="M19 6.2A8.2 8.2 0 0 1 19 17.8" />
  </svg>
);

/** Severed harmonic waves with eclipse slash */
export const WifiOff: React.FC<IconProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M4.5 10A11 11 0 0 1 19.5 10" />
    <path d="M8 13.5A6 6 0 0 1 16 13.5" />
    <circle cx="12" cy="17.5" r="1.3" fill="currentColor" stroke="none" />
    <line x1="4" y1="4" x2="20" y2="20" />
  </svg>
);

/** Saltire crosshairs with clipped diamond center */
export const X: React.FC<IconProps> = (props) => (
  <svg {...baseProps} {...props}>
    <line x1="5" y1="5" x2="9.8" y2="9.8" />
    <line x1="14.2" y1="14.2" x2="19" y2="19" />
    <line x1="19" y1="5" x2="14.2" y2="9.8" />
    <line x1="9.8" y1="14.2" x2="5" y2="19" />
    <polygon points="12 10.5 13.5 12 12 13.5 10.5 12" fill="currentColor" stroke="none" />
  </svg>
);

/** Alchemical spark glyph */
export const Zap: React.FC<IconProps> = (props) => (
  <svg {...baseProps} {...props}>
    <polygon points="13.5 2.5 5.5 13 11.5 13 10.5 21.5 18.5 11 12.5 11" />
  </svg>
);
