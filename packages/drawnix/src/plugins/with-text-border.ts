import {
  createG,
  PlaitBoard,
  PlaitPluginElementContext,
  RectangleClient,
} from '@plait/core';
import { getStrokeLineDash } from '@plait/common';
import {
  BasicShapes,
  DefaultDrawStyle,
  drawGeometry,
  GeometryComponent,
  GeometryShapeGenerator,
  PlaitDrawElement,
  PlaitGeometry,
  getStrokeStyleByElement,
} from '@plait/draw';

/**
 * @plait/draw treats a text element as a geometry with `shape: 'text'` that has
 * no outline at all: GeometryShapeGenerator.draw returns early for that shape,
 * and getStrokeWidthByElement hard-codes 0 for it. So the border has to be
 * drawn here rather than configured.
 *
 * A text element only gets a border once it has an explicit strokeColor, which
 * the popup toolbar's stroke control now sets. Text created before this — and
 * text whose stroke was cleared back to "no color" — has no strokeColor and
 * keeps rendering exactly as it did.
 */
const drawTextBorder = (board: PlaitBoard, element: PlaitGeometry) => {
  const strokeColor = element.strokeColor;
  if (!strokeColor || strokeColor === 'none') {
    // An empty group rather than nothing: Generator.processDrawing only swaps
    // out the previous drawing when draw() returns a node, so returning
    // undefined would leave the old border on screen after clearing the color.
    return createG();
  }
  const strokeWidth = element.strokeWidth || DefaultDrawStyle.strokeWidth;
  const strokeStyle = getStrokeStyleByElement(board, element);
  const rectangle = RectangleClient.getRectangleByPoints(element.points);
  // Inset by the stroke width so the border sits inside the element bounds,
  // matching how GeometryShapeGenerator draws every other shape.
  return drawGeometry(
    board,
    RectangleClient.inflate(rectangle, -strokeWidth),
    BasicShapes.rectangle,
    {
      stroke: strokeColor,
      strokeWidth,
      strokeLineDash: getStrokeLineDash(strokeStyle, strokeWidth),
    }
  );
};

class TextBorderShapeGenerator extends GeometryShapeGenerator {
  override draw(element: PlaitGeometry, data?: unknown) {
    if (element.shape === BasicShapes.text) {
      return drawTextBorder(this.board, element);
    }
    return super.draw(element, data as never);
  }
}

class TextWithBorderComponent extends GeometryComponent {
  override initializeGenerator() {
    super.initializeGenerator();
    // shapeGenerator is a plain field that initialize()/onContextChanged() read
    // back, so swapping it after the base setup is enough to take over drawing.
    this.shapeGenerator = new TextBorderShapeGenerator(this.board);
  }
}

export const withTextBorder = (board: PlaitBoard) => {
  const { drawElement } = board;

  board.drawElement = (context: PlaitPluginElementContext) => {
    if (PlaitDrawElement.isText(context.element)) {
      return TextWithBorderComponent;
    }
    return drawElement(context);
  };

  return board;
};
