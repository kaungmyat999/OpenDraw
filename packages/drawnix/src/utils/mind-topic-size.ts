import { PlaitBoard, PlaitElement } from '@plait/core';
import { clearElementSizeCache } from '@plait/common';

/**
 * Drops the memoized text measurement for a mind element's topic.
 *
 * @plait/common memoizes measured text sizes in a WeakMap keyed on the topic
 * object itself, and `getElementSize` returns a hit without re-checking the
 * font options it was called with. Root topics are measured at
 * ROOT_TOPIC_FONT_SIZE (18px) and child topics at TOPIC_FONT_SIZE (14px), while
 * `adjustRootToNode`/`adjustNodeToRoot` only shallow-copy the element — so a
 * converted node shares its old topic object and keeps the measurement taken
 * for the other font size. The node box then no longer matches the rendered
 * text, which shows up as the topic sitting off-centre inside its node.
 *
 * Call this whenever a mind element changes between root and child so the next
 * layout pass measures the topic again at the font size it will actually be
 * drawn with.
 */
export const clearMindTopicSizeCache = (
  board: PlaitBoard,
  element: PlaitElement
) => {
  const topic = (element as { data?: { topic?: unknown } }).data?.topic;
  if (topic) {
    clearElementSizeCache(board, topic as Parameters<typeof clearElementSizeCache>[1]);
  }
};
