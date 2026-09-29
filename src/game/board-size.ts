/** Board geometry shared by the game screen and its tests. */
export const BOARD_PADDING = 10;
export const CELL_GAP = 4;

/** Fitted cells smaller than this (dp) are hard to tap, so a zoom toggle is offered. */
export const ZOOM_BELOW = 30;
/** Cell size while zoomed in; the board then scrolls inside its frame. */
export const ZOOMED_CELL = 40;

/** A phone held sideways: wide but short, laid out in two columns (see the `land:` variant). */
export function isLandscapePhone(width: number, height: number) {
  return width > height && width >= 560 && width < 1024;
}

/**
 * Cell size (px) that lets the whole board fit. Pure so it can be tested for any screen.
 * Portrait and desktop keep their original sizing; landscape phones use the real free space
 * (board column beside the panels) instead of stacking under a 220px-tall header.
 */
export function computeCellSize(rows: number, cols: number, width: number, height: number) {
  const isDesktop = width >= 1024;
  const landscape = isLandscapePhone(width, height);
  const sideCols = isDesktop ? 540 : landscape ? 320 : 24; // room beside the board
  const maxW = Math.min(width - sideCols, 1100);
  const maxH = landscape ? height - 110 : height - 220; // header + padding above the board
  const byW = Math.floor((maxW - cols * CELL_GAP - BOARD_PADDING * 2) / cols);
  const byH = Math.floor((maxH - rows * CELL_GAP - BOARD_PADDING * 2) / rows);
  // The floor is small on purpose: a 15-column board must still fit a phone's width, otherwise
  // the whole page grows wider than the screen and clips the board and player cards.
  return Math.max(16, Math.min(72, Math.min(byW, byH)));
}
