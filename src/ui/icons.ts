/**
 * The interface's icons: one family of outline drawings on a 24-unit grid, a 1.75 stroke with round ends,
 * drawn in the colour of the text round them (style.css, .ic), so they take a button's state as its label
 * does. Beside a label they are decoration and hidden from screen readers; on a button with no text, the
 * button's own title or aria-label names it.
 */
const P = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  'chev-down': '<path d="M6 9l6 6 6-6"/>',
  'chev-up': '<path d="M6 15l6-6 6 6"/>',
  'chev-left': '<path d="M15 6l-6 6 6 6"/>',
  'chev-right': '<path d="M9 6l6 6-6 6"/>',
  play: '<path d="M7.5 4.8v14.4L19 12z"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  back: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 5 5v6"/>',
  settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.2a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .9-1 1.6v.6"/><path d="M12 17h.01"/>',
  more: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  planet: '<circle cx="12" cy="12" r="5.5"/><path d="M6.6 14.6C3.4 16.6 2.3 18.5 3.6 19.4c1.9 1.3 8-1.3 13.4-5.6 5-4 7.2-7.8 5-8.6-1-.4-2.6 0-4.6 1"/>',
  crosshair: '<circle cx="12" cy="12" r="7"/><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
  move: '<path d="M12 3v18M3 12h18M9.5 5.5L12 3l2.5 2.5M9.5 18.5L12 21l2.5-2.5M5.5 9.5L3 12l2.5 2.5M18.5 9.5L21 12l-2.5 2.5"/>',
  push: '<circle cx="6" cy="18" r="2.2"/><path d="M7.6 16.4L18.5 5.5M11 5.5h7.5V13"/>',
  magnet: '<path d="M5 3.5h4.2V11a2.8 2.8 0 0 0 5.6 0V3.5H19V11a7 7 0 0 1-14 0z"/><path d="M5 8h4.2M14.8 8H19"/>',
  repel: '<circle cx="12" cy="12" r="2"/><path d="M12 7V3M12 21v-4M7 12H3M21 12h-4M10 4.8L12 3l2 1.8M10 19.2l2 1.8 2-1.8M4.8 10L3 12l1.8 2M19.2 10l1.8 2-1.8 2"/>',
  bolt: '<path d="M13.5 2.5L5 13.5h6.5l-1 8 8.5-11h-6.5z"/>',
  blast: '<path d="M12 2.5l1.9 5.4 5-2.7-2.6 5 5.2 1.8-5.2 1.8 2.6 5-5-2.7-1.9 5.4-1.9-5.4-5 2.7 2.6-5-5.2-1.8 5.2-1.8-2.6-5 5 2.7z"/>',
  comet: '<circle cx="16.5" cy="7.5" r="3.5"/><path d="M14 10L4 20M12.5 6.5L5.5 13.5M17.5 11.5l-7 7"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>',
  ruler: '<rect x="2.5" y="8" width="19" height="8" rx="1.5"/><path d="M6.5 8v3M10.5 8v4M14.5 8v3M18.5 8v4"/>',
  eraser: '<path d="M8 20.5h12M4.2 14.3l8.6-8.6a2 2 0 0 1 2.8 0l3 3a2 2 0 0 1 0 2.8L12.5 18H8z"/><path d="M9 9.5l5.8 5.8"/>',
  pencil: '<path d="M4 20l4.4-1L19 8.4a2.1 2.1 0 0 0-3-3L5.4 15.6z"/><path d="M14.5 7l2.5 2.5"/>',
  fill: '<rect x="4" y="4" width="16" height="16" rx="2.5"/><rect x="8.5" y="8.5" width="7" height="7" rx="1" fill="currentColor"/>',
  mirror: '<path d="M12 3v18" stroke-dasharray="2 2.5"/><path d="M8.5 7L3.5 12l5 5zM15.5 7l5 5-5 5z"/>',
  overdrive: '<path d="M3.5 6.5l8 5.5-8 5.5zM12.5 6.5l8 5.5-8 5.5z"/>',
  wormhole: '<path d="M21 12a9 9 0 1 1-9-9"/><path d="M17 12a5 5 0 1 1-5-5"/><circle cx="12" cy="12" r="1.5"/>',
  land: '<path d="M12 3v11M7.5 9.5L12 14l4.5-4.5M4 19.5h16"/>',
  flame: '<path d="M12 2.8c3.4 3.6 5.5 6.6 5.5 10a5.5 5.5 0 0 1-11 0c0-2.2 1-3.9 2.3-5 .3 1.6 1 2.6 2.1 3.2-.1-3 .4-5.6 1.1-8.2z"/>',
  satellite: '<path d="M9.2 12L12 9.2l2.8 2.8L12 14.8z"/><path d="M8 8L4.5 4.5M3 8.5L8.5 3M16 16l3.5 3.5M15.5 21l5.5-5.5M14 14l1.5 1.5M8.5 8.5L10 10"/>',
  lamp: '<path d="M7.5 3h9l-1.5 6h-6z"/><path d="M9 9v10.5a1.5 1.5 0 0 0 1.5 1.5h3a1.5 1.5 0 0 0 1.5-1.5V9M12 13v3"/>',
  map: '<path d="M3 6.5l6-3 6 3 6-3v14l-6 3-6-3-6 3z"/><path d="M9 3.5v14M15 6.5v14"/>',
  camera: '<rect x="2.5" y="6.5" width="13" height="11" rx="2"/><path d="M15.5 10.5l6-3v9l-6-3"/>',
  walk: '<circle cx="13.5" cy="4.5" r="2"/><path d="M10.5 21l1.8-5.5-2.8-3 1.2-4.5 3.8 2.6 2.8.9M8.5 13l-2 3"/>',
  tap: '<path d="M6 3.5l13 6.7-5.8 1.9-1.9 5.8z"/>',
  scan: '<circle cx="12" cy="12" r="9"/><path d="M12 12l6.4-6.4"/><path d="M12 7a5 5 0 1 0 5 5"/>',
  wheel: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M12 3v6.5M12 14.5V21M3 12h6.5M14.5 12H21"/>',
  rocket: '<path d="M12 2.5c3 2 5 5.5 5 10L15.2 16H8.8L7 12.5c0-4.5 2-8 5-10z"/><circle cx="12" cy="10" r="2"/><path d="M9.5 16l-1.8 4.5M14.5 16l1.8 4.5M12 17v4"/>',
  flask: '<path d="M9 3h6M10 3v6.2l-5.1 8.9A2 2 0 0 0 6.6 21h10.8a2 2 0 0 0 1.7-2.9L14 9.2V3"/><path d="M7.4 15h9.2"/>',
  antenna: '<path d="M12 12v9M8.5 21h7"/><circle cx="12" cy="10" r="2"/><path d="M8.1 6.1a5.5 5.5 0 0 0 0 7.8M15.9 6.1a5.5 5.5 0 0 1 0 7.8M5.3 3.3a9.5 9.5 0 0 0 0 13.4M18.7 3.3a9.5 9.5 0 0 1 0 13.4"/>',
  monitor: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M9 20.5h6M12 16.5v4"/>',
  cross: '<path d="M7 7l10 10M17 7L7 17"/>',
  save: '<path d="M5 3.5h11l3.5 3.5v11.5a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z"/><path d="M8 3.5v5h7v-5M7.5 20.5v-6h9v6"/>',
  landmark: '<path d="M3 20.5h18M5 20.5V10M9.7 20.5V10M14.3 20.5V10M19 20.5V10M3 10L12 3.5 21 10z"/>',
} as const;

export type IconName = keyof typeof P;

/** an icon's SVG, hidden from screen readers (it sits beside a label), or named by `label` when it stands alone */
export function icon(name: IconName, label?: string) {
  const a = label ? `role="img" aria-label="${label.replace(/"/g, '&quot;')}"` : 'aria-hidden="true" focusable="false"';
  return `<svg class="ic" viewBox="0 0 24 24" ${a}>${P[name]}</svg>`;
}

/** draw the icon each element names in its data-icon, inside it */
export function hydrateIcons(root: ParentNode = document) {
  for (const el of root.querySelectorAll<HTMLElement>('[data-icon]')) {
    const n = el.dataset.icon as IconName;
    if (n in P && el.dataset.iconDrawn !== n) { el.insertAdjacentHTML('afterbegin', icon(n)); el.dataset.iconDrawn = n; }
  }
}
