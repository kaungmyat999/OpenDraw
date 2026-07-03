import { DEFAULT_COLOR, PlaitBoard } from '@plait/core';
import { TRANSPARENT, NO_COLOR, WHITE } from '../constants/color';

// Convert 0-100 transparency to 0-255 alpha integer
function transparencyToAlpha255(transparency: number) {
  return Math.round(((100 - transparency) / 100) * 255);
}

// Convert 0-255 alpha to 0-100 transparency
function alpha255ToTransparency(alpha255: number) {
  return Math.round((1 - alpha255 / 255) * 100);
}

export function applyOpacityToHex(hexColor: string, opacity: number) {
  const alpha = transparencyToAlpha255(100 - opacity);
  const alphaHex = alpha.toString(16).padStart(2, '0');
  return `${hexColor}${alphaHex}`;
}

export function hexAlphaToOpacity(hexColor: string) {
  // Strip optional # prefix
  hexColor = hexColor.replace(/^#/, '');

  let alpha;
  if (hexColor.length === 8) {
    // 8-char hex: last two digits are alpha
    alpha = parseInt(hexColor.slice(6, 8), 16);
  } else if (hexColor.length === 4) {
    // 4-char shorthand: last digit repeated
    alpha = parseInt(hexColor.slice(3, 4).repeat(2), 16);
  } else {
    // No alpha channel — fully opaque
    return 100;
  }

  return 100 - alpha255ToTransparency(alpha);
}

export function isValidColor(color: string) {
  if (color === 'none') {
    return false;
  }
  return true;
}

export function removeHexAlpha(hexColor: string) {
  // Strip optional # prefix and normalise to uppercase
  const hexColorClone = hexColor.replace(/^#/, '').toUpperCase();

  if (hexColorClone.length === 8) {
    // 8-char hex: drop last two (alpha) digits
    return '#' + hexColorClone.slice(0, 6);
  } else if (hexColorClone.length === 4) {
    // 4-char shorthand: drop last digit
    return '#' + hexColorClone.slice(0, 3);
  } else if (hexColorClone.length === 6 || hexColorClone.length === 3) {
    // Already standard 6- or 3-char form
    return '#' + hexColorClone;
  } else {
    return hexColor;
  }
}

export function isTransparent(color?: string) {
  return color === TRANSPARENT;
}

export function isWhite(color?: string) {
  return color === WHITE || color === WHITE.toLocaleLowerCase();
}

export function isFullyTransparent(opacity: number) {
  return opacity === 0;
}

export function isFullyOpaque(opacity: number) {
  return opacity === 100;
}

export function isNoColor(value: string) {
  return value === NO_COLOR || value === 'none';
}

export function isDefaultStroke(color?: string) {
  return !color || color === DEFAULT_COLOR;
}

export function getBackgroundColor(board: PlaitBoard) {
  const themeColors = PlaitBoard.getThemeColors(board);
  const themeColor = themeColors.find(
    (val) => val.mode === board.theme.themeColorMode
  );
  return themeColor?.boardBackground;
}
