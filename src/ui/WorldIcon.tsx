import type { ReactNode, SVGProps } from 'react';

export type WorldIconName = 'home' | 'camera' | 'room' | 'spaces' | 'settings' | 'scan' | 'objects' | 'places' | 'actions' | 'measure' | 'floorplan' | 'image' | 'notes' | 'device' | 'privacy';

// One 24-unit grid, rounded terminals, and a quiet second tone at every size.
// Glyphs contain no IDs, so any number can appear in the same document.
const glyphs: Record<WorldIconName, ReactNode> = {
  home: <>
    <path className="world-icon-tone" d="m3.5 10 8.5-7 8.5 7v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z"/>
    <path d="m2.5 10 8.2-6.7a2 2 0 0 1 2.6 0l8.2 6.7M4.5 8.5V19a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8.5"/>
    <path className="world-icon-solid" d="M9 21v-6.5a1.5 1.5 0 0 1 1.5-1.5h3a1.5 1.5 0 0 1 1.5 1.5V21Z"/>
    <path d="M10.5 8.5h3"/>
  </>,
  camera: <>
    <path className="world-icon-tone" d="M3 8.5A2.5 2.5 0 0 1 5.5 6H8l1.5-2h5L16 6h2.5A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5Z"/>
    <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6H8l1.5-2h5L16 6h2.5A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5Z"/>
    <circle cx="12" cy="13" r="4"/>
    <path className="world-icon-solid" d="M12 10.75a2.25 2.25 0 1 1-2.25 2.25H12Z"/>
    <circle className="world-icon-solid" cx="17.75" cy="9" r=".9"/>
  </>,
  room: <>
    <path className="world-icon-tone" d="m3 7 9-4 9 4v10l-9 4-9-4Z"/>
    <path d="m3 7 9-4 9 4v10l-9 4-9-4Zm9-4v10m-9 4 9-4 9 4"/>
    <path className="world-icon-solid" d="m6 15.7 6-2.7 6 2.7-6 2.6Z"/>
  </>,
  spaces: <>
    <path className="world-icon-tone" d="M7 7h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"/>
    <path d="M5 16H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2"/>
    <rect x="5" y="7" width="16" height="14" rx="2.5"/>
    <path className="world-icon-solid" d="M15 7v7l-2.5-1.8L10 14V7Z"/>
    <path d="M9 17h5"/>
  </>,
  settings: <>
    <path className="world-icon-tone" d="M6 3a2 2 0 0 1 2 2v14a2 2 0 0 1-4 0V5a2 2 0 0 1 2-2Zm12 0a2 2 0 0 1 2 2v14a2 2 0 0 1-4 0V5a2 2 0 0 1 2-2Z"/>
    <path d="M6 3v5m0 6v7M18 3v10m0 6v2"/>
    <rect x="2.5" y="8" width="7" height="6" rx="2.5"/>
    <rect className="world-icon-solid" x="14.5" y="13" width="7" height="6" rx="2.5"/>
  </>,
  scan: <>
    <path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3"/>
    <rect className="world-icon-tone" x="7" y="7" width="10" height="10" rx="3"/>
    <path d="M7 10V9a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1M7 14v1a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-1m-13-2h16"/>
  </>,
  objects: <>
    <rect className="world-icon-tone" x="3" y="3" width="11" height="11" rx="3"/>
    <rect x="3" y="3" width="11" height="11" rx="3"/>
    <circle className="world-icon-tone" cx="16.5" cy="16.5" r="4.5"/>
    <circle cx="16.5" cy="16.5" r="4.5"/>
    <path d="M17 4h3m-1.5-1.5v3M4 18.5h3"/>
  </>,
  places: <>
    <path className="world-icon-tone" d="M18 9c0 4.5-6 9-6 9S6 13.5 6 9a6 6 0 0 1 12 0Z"/>
    <path d="M18 9c0 4.5-6 9-6 9S6 13.5 6 9a6 6 0 0 1 12 0Z"/>
    <circle className="world-icon-solid" cx="12" cy="9" r="2"/>
    <path d="M6 17.5c-2 .4-3 1-3 1.5 0 1.1 4 2 9 2s9-.9 9-2c0-.5-1-1.1-3-1.5"/>
  </>,
  actions: <>
    <rect className="world-icon-tone" x="3" y="3" width="18" height="18" rx="5"/>
    <path d="M9 3H7a4 4 0 0 0-4 4v10a4 4 0 0 0 4 4h10a4 4 0 0 0 4-4v-2"/>
    <path className="world-icon-solid" d="m14 2-5.5 11H13l-1 7L21 8h-5Z"/>
  </>,
  measure: <>
    <path className="world-icon-tone" d="m3.5 15.5 12-12a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8l-12 12a2 2 0 0 1-2.8 0l-2.2-2.2a2 2 0 0 1 0-2.8Z"/>
    <path d="m3.5 15.5 12-12a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8l-12 12a2 2 0 0 1-2.8 0l-2.2-2.2a2 2 0 0 1 0-2.8ZM14 5l2 2m-5 1 1.5 1.5M8 11l2 2m-5 1 1.5 1.5"/>
  </>,
  floorplan: <>
    <rect className="world-icon-tone" x="3" y="3" width="18" height="18" rx="3"/>
    <rect x="3" y="3" width="18" height="18" rx="3"/>
    <path d="M12 3v8m0 7v3M3 13h6m7-3h5"/>
    <path className="world-icon-solid" d="M6 6h3v4H6Z"/>
  </>,
  image: <>
    <rect className="world-icon-tone" x="3" y="3" width="18" height="18" rx="4"/>
    <rect x="3" y="3" width="18" height="18" rx="4"/>
    <path className="world-icon-solid" d="m4 17 5-5 4 4 3-3 5 5v.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5Z"/>
    <circle className="world-icon-solid" cx="15.5" cy="8" r="1.7"/>
  </>,
  notes: <>
    <path className="world-icon-tone" d="M7 3h8l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/>
    <path d="M7 3h8l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/>
    <path className="world-icon-solid" d="M14 3v6h6Z"/>
    <path d="M9 13h7m-7 4h4"/>
  </>,
  device: <>
    <rect className="world-icon-tone" x="5" y="2.5" width="14" height="19" rx="3.5"/>
    <rect x="5" y="2.5" width="14" height="19" rx="3.5"/>
    <path d="M10 6h4m-4 12h4"/>
  </>,
  privacy: <>
    <path className="world-icon-tone" d="m12 2 8 3v6c0 5-3 8-8 11-5-3-8-6-8-11V5Z"/>
    <path d="m12 2 8 3v6c0 5-3 8-8 11-5-3-8-6-8-11V5Z"/>
    <path d="m8.5 11.5 2.5 2.5 4.5-5"/>
  </>,
};

type WorldIconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'name'> & { name: WorldIconName; size?: number };

/** Decorative feature icon; the surrounding control supplies its accessible label. */
export default function WorldIcon({name, size=24, className='', ...props}: WorldIconProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...props} className={`world-icon world-icon-${name} ${className}`.trim()} aria-hidden="true" focusable="false">{glyphs[name]}</svg>;
}
