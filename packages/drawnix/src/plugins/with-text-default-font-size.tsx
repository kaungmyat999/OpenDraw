import { PlaitBoard } from '@plait/core';
import { MemorizeKey } from '@plait/draw';
import { getMemorizedLatest, memorizeLatest } from '@plait/common';

export const TEXT_TOOL_DEFAULT_FONT_SIZE = '20';

// @plait/draw creates standalone "Text" tool elements using whatever font
// size was last memorized for MemorizeKey.text, falling back to the
// library's own default (14px) the first time it's used in a session. Seed
// that memory once so a fresh session starts at 20px instead, without
// touching the size a user has already picked (which overwrites this same
// slot and should stick for the rest of the session).
export const withTextDefaultFontSize = (board: PlaitBoard) => {
  const memorized = getMemorizedLatest<any>(MemorizeKey.text);
  if (!memorized?.text?.['font-size']) {
    memorizeLatest<any>(MemorizeKey.text, 'text', {
      ...memorized?.text,
      'font-size': TEXT_TOOL_DEFAULT_FONT_SIZE,
    });
  }
  return board;
};
