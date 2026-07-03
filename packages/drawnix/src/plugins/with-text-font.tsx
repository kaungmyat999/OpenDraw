import { getElementById, PlaitBoard } from '@plait/core';
import type { PlaitTextBoard, TextProps } from '@plait/common';
import { PlaitDrawElement } from '@plait/draw';

export const TEXT_TOOL_FONT_CLASS_NAME = 'text-tool-font';

// The "Text" tool creates a standalone PlaitDrawElement (shape: text) that
// shares the same generic text renderer/CSS class as mind topics and shape
// labels. There is no per-element font-family in the data model, so the only
// element-specific styling hook is the DOM: mark the rendered container once
// we can confirm which element it belongs to.
export const withTextFont = (board: PlaitBoard & PlaitTextBoard) => {
  const newBoard = board as PlaitBoard & PlaitTextBoard;
  const { renderText } = newBoard;

  newBoard.renderText = (
    container: Element | DocumentFragment,
    props: TextProps
  ) => {
    const ref = renderText(container, props);
    if (container instanceof Element) {
      // The foreignObject isn't attached to the board's DOM tree yet at this
      // point (the caller appends it right after renderText returns), so the
      // ancestor lookup has to happen after the current synchronous work
      // finishes.
      queueMicrotask(() => markIfTextToolElement(board, container));
    }
    return ref;
  };

  return newBoard;
};

const markIfTextToolElement = (board: PlaitBoard, container: Element) => {
  let node: Element | null = container;
  const host = PlaitBoard.getHost(board);
  while (node && node !== host) {
    const id = node.getAttribute('plait-data-id');
    if (id) {
      const element = getElementById(board, id);
      if (element && PlaitDrawElement.isText(element)) {
        container.classList.add(TEXT_TOOL_FONT_CLASS_NAME);
      }
      return;
    }
    node = node.parentElement;
  }
};
