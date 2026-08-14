import {
  ClipboardData,
  PlaitBoard,
  PlaitNode,
  PlaitOperation,
  Point,
  WritableClipboardOperationType,
  getElementById,
  getSelectedElements,
} from '@plait/core';
import {
  buildText,
  getFirstTextManage,
  measureElement,
} from '@plait/common';
import {
  BasicShapes,
  createTextElement,
  DrawTransforms,
  GeometryThreshold,
  getMemorizedLatestByPointer,
  insertElement,
  PlaitDrawElement,
  ShapeDefaultSpace,
} from '@plait/draw';
import { DEFAULT_FONT_SIZE } from '@plait/text-plugins';
import { TEXT_TOOL_FONT_FAMILY } from './with-text-font';

export const PADDED_PASTE_TEXT_PROPERTY = 'paddedPasteTextFrame';
const EXTRA_HORIZONTAL_FRAME_SPACE = ShapeDefaultSpace.rectangleAndText * 2;
const EXTRA_VERTICAL_FRAME_SPACE = ShapeDefaultSpace.rectangleAndText * 4;

type PaddedPasteTextElement = {
  [PADDED_PASTE_TEXT_PROPERTY]?: boolean;
};

// Same cleanup the in-editor paste path applies (react-text's withText /
// withMarkdown), plus bare carriage returns: the DOM renders `\r` like
// whitespace but the canvas measurer only splits lines on `\n`, so without
// this a PDF-copied string is measured as one very long line.
const normalizePastedText = (text: string) =>
  text.replace(/\r\n?/g, '\n').trim().replace(/\t+/g, ' ');

/**
 * Pasting plain text onto the canvas goes through @plait/draw's
 * insertFragment, which sizes the new text element by measuring the raw
 * clipboard string with the library's default (system) font family. This app
 * renders standalone text elements in the handwriting font instead (see
 * with-text-font.tsx), whose glyph metrics differ, so the element's stored
 * bounds — and therefore the selection box — never match what's on screen.
 * The raw string also skips the normalization the in-editor paste path
 * applies (bare carriage returns, tabs), which skews measurement further.
 *
 * Take over the free-text paste case: normalize the text the same way the
 * editor does and measure it with the font it will actually render in.
 */
export const withPasteTextFit = (board: PlaitBoard) => {
  const { apply, insertFragment } = board;

  board.apply = (operation: PlaitOperation) => {
    if (operation.type === 'set_node' && operation.newProperties.points) {
      const element = PlaitNode.get(board, operation.path);
      if (
        PlaitDrawElement.isText(element) &&
        (element as PaddedPasteTextElement)[PADDED_PASTE_TEXT_PROPERTY] &&
        operation.newProperties.autoSize !== false
      ) {
        operation.newProperties.points = addPasteFrameSpace(
          operation.newProperties.points as [Point, Point]
        );
      }
    }
    apply(operation);
  };

  board.insertFragment = (
    clipboardData: ClipboardData | null,
    targetPoint: Point,
    operationType?: WritableClipboardOperationType
  ) => {
    if (isFreeTextPaste(board, clipboardData)) {
      insertPastedText(board, targetPoint, clipboardData!.text!);
      return;
    }
    insertFragment(clipboardData, targetPoint, operationType);
  };

  return board;
};

// Mirrors the conditions under which @plait/draw's insertFragment would call
// DrawTransforms.insertText: text-only clipboard data (no files, no copied
// elements) while nothing that accepts children is solely selected.
const isFreeTextPaste = (
  board: PlaitBoard,
  clipboardData: ClipboardData | null
): boolean => {
  if (
    !clipboardData?.text ||
    clipboardData.files?.length ||
    clipboardData.elements?.length
  ) {
    return false;
  }
  const selectedElements = getSelectedElements(board);
  const insertAsChildren =
    selectedElements.length === 1 && selectedElements[0].children;
  return !insertAsChildren;
};

const insertPastedText = (
  board: PlaitBoard,
  targetPoint: Point,
  rawText: string
) => {
  const text = normalizePastedText(rawText);
  if (!text) {
    return;
  }
  // Same font size the element will be created with (createTextElement stamps
  // the memorized text properties onto the new element).
  const memorized = getMemorizedLatestByPointer(BasicShapes.text);
  const fontSize =
    Number(memorized.textProperties?.['font-size']) || DEFAULT_FONT_SIZE;
  const textSize = measureElement(
    board,
    buildText(text),
    {
      fontSize,
      fontFamily: TEXT_TOOL_FONT_FAMILY,
    },
    GeometryThreshold.defaultTextMaxWidth
  );
  const points: [Point, Point] = [
    targetPoint,
    [
      targetPoint[0] + textSize.width + ShapeDefaultSpace.rectangleAndText * 2,
      targetPoint[1] + textSize.height,
    ],
  ];
  const element = createTextElement(board, addPasteFrameSpace(points), text);
  (element as typeof element & PaddedPasteTextElement)[
    PADDED_PASTE_TEXT_PROPERTY
  ] = true;
  insertElement(board, element);
  remeasureAfterFontLoad(board, element.id, fontSize);
};

const addPasteFrameSpace = (points: [Point, Point]): [Point, Point] => [
  points[0],
  [
    points[1][0] + EXTRA_HORIZONTAL_FRAME_SPACE,
    points[1][1] + EXTRA_VERTICAL_FRAME_SPACE,
  ],
];

const remeasureAfterFontLoad = (
  board: PlaitBoard,
  elementId: string,
  fontSize: number
) => {
  const fontReady =
    typeof document !== 'undefined' && document.fonts
      ? document.fonts.load(`${fontSize}px ${TEXT_TOOL_FONT_FAMILY}`)
      : Promise.resolve([]);

  void fontReady
    .catch(() => [])
    .then(() => {
      // withTextFont applies its element-specific class in a microtask after
      // render. React 19 may commit createRoot.render asynchronously, so the
      // font promise alone is not late enough; measure on the next painted
      // frame when the real DOM line wrapping is established.
      const measureRenderedText = () => {
        const element = getElementById(board, elementId);
        if (!element || !PlaitDrawElement.isText(element)) {
          return;
        }
        const textManage = getFirstTextManage(element);
        if (!textManage?.editor || !textManage.foreignObject?.isConnected) {
          return;
        }
        const { width, height } = textManage.getSize(
          undefined,
          GeometryThreshold.defaultTextMaxWidth
        );
        DrawTransforms.setTextSize(board, element, width, height);
      };

      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(measureRenderedText);
      } else {
        setTimeout(measureRenderedText, 0);
      }
    });
};
