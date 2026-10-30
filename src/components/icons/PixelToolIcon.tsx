import React from 'react';

// Pixelarticons 2.4.2 by Gerrit Halfmann (MIT). Unchanged upstream SVG paths.
// Source: https://github.com/halfmage/pixelarticons
// Licence: public/assets/icons/pixelarticons-LICENSE.txt
const TOOL_PATHS: Record<string, readonly string[]> = {
  'new-document': [ // file.svg
    'M6 4H4v16h2zm10-2H6v2h10zm4 4h-2v14h2zm-2 14H6v2h12zM16 4h2v2h-2zm-4 0h2v6h-2z',
    'M12 8h6v2h-6z',
  ],
  'selection': [ // section.svg
    'M5 21H3v-2h2v2Zm4 0H7v-2h2v2Zm4 0h-2v-2h2v2Zm4 0h-2v-2h2v2Zm4 0h-2v-2h2v2ZM5 17H3v-2h2v2Zm16 0h-2v-2h2v2ZM5 13H3v-2h2v2Zm16 0h-2v-2h2v2ZM5 9H3V7h2v2Zm16 0h-2V7h2v2ZM5 5H3V3h2v2Zm4 0H7V3h2v2Zm4 0h-2V3h2v2Zm4 0h-2V3h2v2Zm4 0h-2V3h2v2Z',
  ],
  'brush': [ // pencil.svg
    'M4 16H6V18H8V20H10V22H2V14H4V16ZM12 20H10V18H12V20ZM14 18H12V16H14V18ZM10 16H8V14H10V16ZM16 16H14V14H16V16ZM6 14H4V12H6V14ZM12 14H10V12H12V14ZM18 14H16V12H18V14ZM8 12H6V10H8V12ZM14 12H12V10H14V12ZM20 12H18V10H20V12ZM10 10H8V8H10V10ZM18 10H16V8H18V10ZM22 10H20V8H22V10ZM12 8H10V6H12V8ZM16 8H14V6H16V8ZM20 8H18V6H20V8ZM14 6H12V4H14V6ZM18 6H16V4H18V6ZM16 4H14V2H16V4Z',
  ],
  'eraser': [ // eraser.svg
    'M15 18h6v2H7v-2h6v-2h2v2Zm-8 0H5v-2h2v2Zm-2-2H3v-2h2v2Zm12 0h-2v-2h2v2ZM7 14H5v-2h2v2Zm8 0h-2v-2h2v2Zm4 0h-2v-2h2v2ZM9 12H7v-2h2v2Zm4 0h-2v-2h2v2Zm8 0h-2v-2h2v2Zm-10-2H9V8h2v2Zm8 0h-2V8h2v2Zm-6-2h-2V6h2v2Zm4 0h-2V6h2v2Zm-2-2h-2V4h2v2Z',
  ],
  'color-picker': [ // pipette.svg
    'M3 15h2v4H3zm2 4h4v2H5zm0-6h2v2H5zm4 4h2v2H9zm-2-6h2v2H7zm4 4h2v2h-2zM9 9h2v2H9zm4 4h2v2h-2zm-2-6h2v2h-2zM9 5h2v2H9zm2-2h2v2h-2zm2 2h2v2h-2zm2-2h2v2h-2zm2-2h2v2h-2zm2 2h2v2h-2zm2 2h2v2h-2zm-2 2h2v2h-2zm-2 2h2v2h-2zm2 2h2v2h-2zm-2 2h2v2h-2zm-4-4h2v2h-2zm2 2h2v2h-2zM1 19h2v4H1z',
    'M1 21h4v2H1z',
  ],
  'magic-wand': [ // wand.svg
    'M14 22H12V20H14V22ZM20 22H18V20H20V22ZM5 19H9V21H3V15H5V19ZM18 20H16V18H18V20ZM22 20H20V18H22V20ZM11 19H9V16H11V19ZM20 18H18V16H20V18ZM13 16H11V13H13V16ZM8 15H5V13H8V15ZM11 13H8V11H11V13ZM15 13H13V11H15V13ZM21 13H19V11H21V13ZM4 12H2V10H4V12ZM13 11H11V9H13V11ZM17 11H15V9H17V11ZM15 9H13V7H15V9ZM19 9H17V7H19V9ZM6 8H4V6H6V8ZM17 7H15V5H17V7ZM21 7H19V5H17V3H21V7ZM4 6H2V4H4V6ZM8 6H6V4H8V6ZM13 5H11V3H13V5ZM6 4H4V2H6V4Z',
  ],
  'save': [ // save.svg
    'M20 22H4V20H6V14H8V20H16V14H18V20H20V22ZM4 20H2V4H4V20ZM22 20H20V6H22V20ZM16 14H8V12H16V14ZM12 10H6V6H12V10ZM20 6H18V4H20V6ZM18 4H4V2H18V4Z',
  ],
  'load': [ // folder.svg
    'M4 4h6v2H4zm0 14h16v2H4zM20 8h2v10h-2zM2 6h2v12H2zm8 0h10v2H10z',
  ],
  'export': [ // upload.svg
    'M19 21H5v-2h14v2ZM5 19H3v-4h2v4Zm16 0h-2v-4h2v4ZM13 5h2v2h2v2h-4v8h-2V9H7V7h2V5h2V3h2v2Z',
  ],
  'reference-studio': [ // image.svg
    'M4 2h16v2H4zm0 18h16v2H4zM2 4h2v16H2zm18 0h2v16h-2zm-4 8h2v2h-2zm-2 2h2v2h-2zm4 0h2v2h-2zm-8 0h2v2h-2zm2 2h2v2h-2zm2 2h2v2h-2z',
    'M20 16h2v2h-2zM8 16h2v2H8zm-2 2h2v2H6zM8 6h2v2H8zM6 8h2v2H6zm2 2h2v2H8zm2-2h2v2h-2z',
  ],
  'grid-toggle': [ // grid-3x3.svg
    'M4 2h16v2H4zm0 18h16v2H4zM2 4h2v16H2zm18 0h2v16h-2zM4 8h16v2H4zm0 6h16v2H4z',
    'M8 4h2v16H8zm6 0h2v16h-2z',
  ],
  'options': [ // settings-cog.svg
    'M4 20h3v-2h4v4h2v-4h4v2h-2v4H9v-4H7v2H2v-5h2v3Zm18 2h-5v-2h3v-3h2v5ZM6 11H2v2h4v4H4v-2H0V9h4V7h2v4Zm14-2h4v6h-4v2h-2v-4h4v-2h-4V7h2v2Zm-6 7h-4v-2h4v2Zm-4-2H8v-4h2v4Zm6 0h-2v-4h2v4Zm-2-4h-4V8h4v2ZM7 4H4v3H2V2h5v2Zm8 0h2V2h5v5h-2V4h-3v2h-4V2h-2v4H7V4h2V0h6v4Z',
  ],
  'multiplayer': [ // users.svg
    'M5 2h6v2H5zm10 0h4v2h-4zM5 10h6v2H5zm10 0h4v2h-4zm4-6h2v6h-2zm-8 0h2v6h-2zM3 4h2v6H3zM0 18h2v4H0zm14 0h2v4h-2zm8 0h2v4h-2zM4 14h8v2H4zm12 0h4v2h-4zM2 16h2v2H2zm10 0h2v2h-2zm8 0h2v2h-2z',
  ],
};

export function PixelToolIcon({ tool }: { tool: string }) {
  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {(TOOL_PATHS[tool] ?? TOOL_PATHS.brush).map((path, index) => (
        <path key={index} d={path} />
      ))}
    </svg>
  );
}
