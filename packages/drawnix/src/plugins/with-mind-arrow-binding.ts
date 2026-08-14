import {
  PlaitBoard,
  PlaitElement,
  PlaitHistoryBoard,
  PlaitNode,
  PlaitOperation,
  PlaitPluginElementContext,
  RectangleClient,
  SELECTION_BORDER_COLOR,
  Transforms,
  depthFirstRecursion,
  drawRoundRectangle,
  distanceBetweenPointAndPoint,
  findElements,
  getElementById,
  getIsRecursionFunc,
} from '@plait/core';
import {
  ArrowLineComponent,
  LINE_HIT_GEOMETRY_BUFFER,
  PlaitDrawElement,
} from '@plait/draw';
import { MindElement } from '@plait/mind';

type BoundHandle = { boundId?: string; connection?: [number, number] };
type ArrowElement = PlaitElement & {
  source?: BoundHandle;
  target?: BoundHandle;
};
type PointsElement = PlaitElement & { points?: [number, number][] };

// Temporary: set window.__DEBUG_MIND_ARROW = true in the console to trace why a
// binding did or did not happen. Read per call, not at module load, so it can be
// switched on after the app has started. Remove once this is confirmed working.
const DEBUG_BINDING = () =>
  typeof window !== 'undefined' &&
  !!(window as { __DEBUG_MIND_ARROW?: boolean }).__DEBUG_MIND_ARROW;

/**
 * Live arrow components, so a bound mind node moving can force just the
 * affected arrows to redraw.
 *
 * ArrowLineComponent keeps its shape generator as a plain field and never
 * registers it on the element ref, so there is no way to reach it through
 * PlaitElement.getElementRef. Subclassing and recording the instance is the
 * only handle we get.
 */
const ARROW_COMPONENTS = new Map<string, MindAwareArrowLineComponent>();

class MindAwareArrowLineComponent extends ArrowLineComponent {
  override initialize() {
    super.initialize();
    ARROW_COMPONENTS.set(this.element.id, this);
  }

  override destroy() {
    if (ARROW_COMPONENTS.get(this.element.id) === this) {
      ARROW_COMPONENTS.delete(this.element.id);
    }
    super.destroy();
  }

  redraw() {
    this.shapeGenerator.processDrawing(this.element, this.getElementG());
  }
}

const getArrows = (board: PlaitBoard): ArrowElement[] =>
  findElements(board, {
    match: (element) => PlaitDrawElement.isArrowLine(element),
    recursion: () => true,
  }) as ArrowElement[];

const boundIdsOf = (arrow: ArrowElement) =>
  [arrow.source?.boundId, arrow.target?.boundId].filter(
    (id): id is string => !!id
  );

/**
 * Mirrors a mind node's laid-out rectangle into its `points`.
 *
 * Every arrow-binding path in @plait/draw — getConnectionPoint,
 * getVectorByConnection, getSourceAndTargetRectangle, getArrowLineHandleRefPair
 * — resolves its bound element through
 * `RectangleClient.getRectangleByPoints(element.points)`. A mind root stores
 * only a single top-left point and a child stores none at all, so a bound arrow
 * would collapse onto a corner. Writing the real rectangle there makes all of
 * those work untouched.
 *
 * Safe against @plait/mind, which reads `points` in exactly six places and every
 * one of them is `points[0][0]` / `points[0][1]` — nothing reads `points[1]`,
 * and for a root, `points[0]` equals the laid-out rectangle's top-left, so the
 * value it does read is unchanged.
 *
 * The write goes through Transforms.setNode because plait deep-freezes its
 * state — assigning `element.points` directly throws (verified in the browser:
 * "Cannot add property points, object is not extensible"). setNode is wrapped
 * in withoutSaving so this derived, recomputable data never lands in the undo
 * stack.
 *
 * Only nodes an arrow actually binds to are synced, to keep the extra point out
 * of the document for every other node.
 */
const syncBoundMindPoints = (board: PlaitBoard, boundIds: Set<string>) => {
  const movedIds = new Set<string>();

  boundIds.forEach((id) => {
    const element = getElementById(board, id) as PointsElement | undefined;
    if (!element || !MindElement.isMindElement(board, element)) {
      return;
    }
    // findPath and getRectangle both need the element mounted and laid out.
    if (!PlaitElement.hasMounted(element)) {
      return;
    }
    const rectangle = board.getRectangle(element);
    if (!rectangle) {
      return;
    }
    const next: [number, number][] = [
      [rectangle.x, rectangle.y],
      [rectangle.x + rectangle.width, rectangle.y + rectangle.height],
    ];
    const current = element.points;
    const isSame =
      current?.length === 2 &&
      current[0][0] === next[0][0] &&
      current[0][1] === next[0][1] &&
      current[1][0] === next[1][0] &&
      current[1][1] === next[1][1];
    if (isSame) {
      return;
    }
    const path = PlaitBoard.findPath(board, element);
    PlaitHistoryBoard.withoutSaving(board, () => {
      Transforms.setNode(board, { points: next } as Partial<PlaitElement>, path);
    });
    movedIds.add(id);
    DEBUG_BINDING() && console.log('[mind-arrow] synced points', { id, next });
  });

  return movedIds;
};

/**
 * Finds the mind node under a point, mirroring the hit buffer plait uses when
 * snapping an arrow to a draw shape.
 */
const getSnappingMindElement = (board: PlaitBoard, point: [number, number]) => {
  let hit: PlaitElement | null = null;
  depthFirstRecursion(
    board as unknown as PlaitElement,
    (node) => {
      if (
        hit ||
        PlaitBoard.isBoard(node) ||
        !MindElement.isMindElement(board, node) ||
        !PlaitElement.hasMounted(node)
      ) {
        return;
      }
      const rectangle = board.getRectangle(node);
      if (
        rectangle &&
        RectangleClient.isPointInRectangle(
          RectangleClient.inflate(rectangle, LINE_HIT_GEOMETRY_BUFFER * 2),
          point
        )
      ) {
        hit = node;
      }
    },
    getIsRecursionFunc(board),
    true
  );
  return hit as PlaitElement | null;
};

const FLASH_DURATION = 1000;
const FLASH_FADE = 300;
const FLASH_OFFSET = 4;

const activeFlashes = new Map<
  string,
  { g: SVGGElement; timer: ReturnType<typeof setTimeout> }
>();

/**
 * Flashes a highlight around a just-connected element's border, fading out
 * after a second. Re-flashing the same element (every frame during an endpoint
 * drag) redraws at the current rectangle and re-arms the timer, so the
 * highlight stays lit while hovering a node and fades once the drag ends.
 *
 * Drawn straight into the element top host and removed on a timer rather than
 * routed through any generator: this is pure feedback, tied to a moment rather
 * than to element state.
 */
const flashBoundElement = (board: PlaitBoard, element: PlaitElement) => {
  const rectangle = board.getRectangle(element);
  if (!rectangle) {
    return;
  }
  const existing = activeFlashes.get(element.id);
  if (existing) {
    clearTimeout(existing.timer);
    existing.g.remove();
  }
  const inflated = RectangleClient.inflate(rectangle, FLASH_OFFSET * 2);
  const g = drawRoundRectangle(
    PlaitBoard.getRoughSVG(board),
    inflated.x,
    inflated.y,
    inflated.x + inflated.width,
    inflated.y + inflated.height,
    { stroke: SELECTION_BORDER_COLOR, strokeWidth: 2.5, fill: 'none' },
    true,
    8
  );
  g.style.pointerEvents = 'none';
  g.style.transition = `opacity ${FLASH_FADE}ms ease-out`;
  PlaitBoard.getElementTopHost(board).append(g);
  const timer = setTimeout(() => {
    g.style.opacity = '0';
    setTimeout(() => {
      g.remove();
      if (activeFlashes.get(element.id)?.g === g) {
        activeFlashes.delete(element.id);
      }
    }, FLASH_FADE);
  }, FLASH_DURATION);
  activeFlashes.set(element.id, { g, timer });
};

// Top / right / bottom / left edge midpoints, as rectangle ratios.
const EDGE_CONNECTIONS: [number, number][] = [
  [0.5, 0],
  [1, 0.5],
  [0.5, 1],
  [0, 0.5],
];

/**
 * Picks the edge midpoint of `rectangle` nearest `point`, as a connection ratio.
 *
 * Deliberately not plait's `getHitConnection`: that resolves a shape engine via
 * `getEngine(getElementShape(element))`, and a mind node's `shape` is a
 * MindElementShape (or undefined), none of which are in ShapeEngineMap — so the
 * lookup yields undefined and `getConnectorPoints` throws.
 *
 * Restricting to edge midpoints also keeps the render path off the engines:
 * `getVectorByConnection` returns early through `getDirectionByPointOfRectangle`
 * whenever a connection component is exactly 0 or 1, and only falls through to
 * `engine.getEdgeByConnectionPoint` for arbitrary ratios. So these four values
 * are the ones that are safe for a shapeless element, and they read as four
 * connection ports on the node.
 */
const getMindConnection = (
  rectangle: RectangleClient,
  point: [number, number]
): [number, number] => {
  let best = EDGE_CONNECTIONS[0];
  let bestDistance = Infinity;
  EDGE_CONNECTIONS.forEach((connection) => {
    const distance = distanceBetweenPointAndPoint(
      rectangle.x + connection[0] * rectangle.width,
      rectangle.y + connection[1] * rectangle.height,
      point[0],
      point[1]
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      best = connection;
    }
  });
  return best;
};

/**
 * Binds either end of a freshly drawn arrow to whatever mind node it landed on.
 *
 * Done at insert time rather than by intercepting the pointer flow. Plait's
 * `getSnappingShape` cannot see mind nodes, so its own creation handler produces
 * an arrow with that end unbound; we fill in the binding just before the insert
 * is applied. Taking over pointerDown/pointerMove instead would mean
 * reimplementing the whole drag interaction and risking a regression in
 * shape-to-shape arrows, which work today.
 *
 * The points sync runs here too — before the insert applies — because the
 * arrow's very first render resolves the bound rectangle, and a child node has
 * no `points` at all until synced (getRectangleByPoints(undefined) would throw).
 * Nesting a setNode inside apply is safe: plait applies operations
 * synchronously, so the set_node completes before the outer insert_node lands.
 *
 * The trade-off is that dragging over a mind node shows no snap highlight —
 * the binding is correct, only the in-drag affordance is missing.
 */
const bindMindEndpoints = (board: PlaitBoard, arrow: ArrowElement) => {
  const points = (arrow as PointsElement).points;
  DEBUG_BINDING() && console.log('[mind-arrow] insert', { points });
  if (!points?.length) {
    return;
  }
  (['source', 'target'] as const).forEach((key) => {
    const handle = arrow[key];
    if (!handle) {
      return;
    }
    if (handle.boundId) {
      // Re-applied insert (redo, paste, remote): the binding already exists,
      // but the mind node's points may never have been synced in this session.
      syncBoundMindPoints(board, new Set([handle.boundId]));
      return;
    }
    const point = key === 'source' ? points[0] : points[points.length - 1];
    const mindElement = getSnappingMindElement(board, point);
    DEBUG_BINDING() &&
      console.log('[mind-arrow] hit test', {
        key,
        point,
        hit: mindElement?.id ?? null,
      });
    if (!mindElement) {
      return;
    }
    const rectangle = board.getRectangle(mindElement);
    if (!rectangle) {
      return;
    }
    // A replayed operation's node can be frozen history state; only a freshly
    // created arrow's handles are writable, and those are the ones that can
    // still be missing a binding.
    if (Object.isFrozen(handle)) {
      return;
    }
    // The rectangle has to be written into points before anything downstream
    // resolves this binding.
    syncBoundMindPoints(board, new Set([mindElement.id]));
    handle.boundId = mindElement.id;
    handle.connection = getMindConnection(rectangle, point);
    flashBoundElement(board, mindElement);
    DEBUG_BINDING() &&
      console.log('[mind-arrow] bound', {
        key,
        boundId: handle.boundId,
        connection: handle.connection,
      });
  });
};

/**
 * Binds an existing arrow's endpoint to a mind node when the user drags the
 * endpoint onto one, and lets it unbind when dragged away.
 *
 * Plait's withArrowLineResize emits a set_node on the arrow every frame of an
 * endpoint drag, with fresh copies of `points`, `source` and `target` — and it
 * explicitly writes `boundId: undefined` whenever getSnappingShape found no
 * draw shape under the cursor (which is always, over a mind node). Filling the
 * binding back in on that operation gives drop-to-connect, live snapping of the
 * endpoint to the node edge during the drag, and automatic unbinding when the
 * endpoint is dragged off (plait's cleared handle just stays cleared).
 *
 * Only operations that carry `points` engage — a set_node that touches other
 * arrow properties (including our own repair writes) has no endpoint change to
 * bind against.
 */
const bindOnArrowEndpointMove = (
  board: PlaitBoard,
  operation: PlaitOperation & { type: 'set_node' }
) => {
  let current: PlaitElement;
  try {
    current = PlaitNode.get(board, operation.path);
  } catch {
    return;
  }
  if (!PlaitDrawElement.isArrowLine(current)) {
    return;
  }
  const newProperties = operation.newProperties as {
    points?: [number, number][];
    source?: BoundHandle;
    target?: BoundHandle;
  };
  const points = newProperties.points;
  if (!points?.length) {
    return;
  }
  (['source', 'target'] as const).forEach((key) => {
    const written = newProperties[key];
    const boundId = written
      ? written.boundId
      : (current as ArrowElement)[key]?.boundId;
    if (boundId) {
      // Already bound (to a shape by plait, or carried over): just make sure a
      // mind target's rectangle is in place.
      syncBoundMindPoints(board, new Set([boundId]));
      return;
    }
    const point = key === 'source' ? points[0] : points[points.length - 1];
    const mindElement = getSnappingMindElement(board, point);
    if (!mindElement) {
      return;
    }
    const rectangle = board.getRectangle(mindElement);
    if (!rectangle) {
      return;
    }
    // Replayed operations from history are frozen; they already carry whatever
    // binding existed and must not be rewritten.
    let handle = written;
    if (!handle) {
      if (Object.isFrozen(newProperties)) {
        return;
      }
      handle = { ...(current as ArrowElement)[key] };
      newProperties[key] = handle;
    }
    if (Object.isFrozen(handle)) {
      return;
    }
    syncBoundMindPoints(board, new Set([mindElement.id]));
    handle.boundId = mindElement.id;
    handle.connection = getMindConnection(rectangle, point);
    flashBoundElement(board, mindElement);
    DEBUG_BINDING() &&
      console.log('[mind-arrow] bound on endpoint move', {
        key,
        boundId: handle.boundId,
      });
  });
};

/**
 * Drops the binding from any arrow handle whose boundId no longer resolves.
 *
 * Plait unbinds arrows when a bound *shape* is deleted, but nothing does that
 * for mind nodes — deleting a bound node leaves the arrow pointing at a ghost,
 * and every render after that throws inside getConnectionPoint (verified in the
 * browser: a continuous "Cannot read properties of undefined (reading
 * 'points')" burst after the bound node was removed). The arrow falls back to
 * its stored points, i.e. it stays where it was last drawn, just unpinned.
 *
 * Must run before anything renders or measures the arrow, which is why the
 * onChange hook calls it ahead of the wrapped onChange — the app's own save /
 * thumbnail work happens in there and crashes on the dangling reference.
 * withoutSaving keeps the repair out of undo; the cost is that undoing the
 * node's deletion brings the node back but not the binding, which is a far
 * smaller wart than the crash.
 */
const repairDanglingBindings = (board: PlaitBoard) => {
  getArrows(board).forEach((arrow) => {
    (['source', 'target'] as const).forEach((key) => {
      const handle = arrow[key];
      if (!handle?.boundId || getElementById(board, handle.boundId)) {
        return;
      }
      const { boundId, connection, ...rest } = handle;
      DEBUG_BINDING() &&
        console.log('[mind-arrow] repaired dangling binding', {
          arrow: arrow.id,
          key,
          boundId,
        });
      const path = PlaitBoard.findPath(board, arrow);
      PlaitHistoryBoard.withoutSaving(board, () => {
        Transforms.setNode(
          board,
          { [key]: rest } as Partial<PlaitElement>,
          path
        );
      });
    });
  });
};

/**
 * Lets arrows anchor to mind map nodes.
 *
 * @plait/draw only ever considers draw shapes for binding, and resolves bound
 * elements through their `points`. Rather than fork the library, this keeps the
 * bound mind nodes' `points` describing their real rectangle (via history-free
 * setNode — plait freezes its elements, so in-place mutation throws), and
 * redraws the affected arrows when the mind layout moves them.
 */
export const withMindArrowBinding = (board: PlaitBoard) => {
  const { apply, drawElement, onChange } = board;
  let syncing = false;

  board.apply = (operation: PlaitOperation) => {
    if (
      operation.type === 'insert_node' &&
      PlaitDrawElement.isArrowLine(operation.node)
    ) {
      bindMindEndpoints(board, operation.node as ArrowElement);
    }
    if (operation.type === 'set_node') {
      bindOnArrowEndpointMove(
        board,
        operation as PlaitOperation & { type: 'set_node' }
      );
    }
    apply(operation);
  };

  board.drawElement = (context: PlaitPluginElementContext) => {
    if (PlaitDrawElement.isArrowLine(context.element)) {
      return MindAwareArrowLineComponent;
    }
    return drawElement(context);
  };

  board.onChange = () => {
    // Repair before the wrapped onChange: the app's save/thumbnail pass runs in
    // there and throws on a dangling boundId before repair could ever happen.
    if (!syncing) {
      syncing = true;
      try {
        repairDanglingBindings(board);
      } finally {
        syncing = false;
      }
    }

    onChange();

    // The sync below issues set_node operations, which re-enter onChange.
    // The isSame check in syncBoundMindPoints makes that converge, but there
    // is no reason to walk the arrows again for our own writes.
    if (syncing) {
      return;
    }

    const arrows = getArrows(board);
    if (!arrows.length) {
      return;
    }
    const boundIds = new Set(arrows.flatMap(boundIdsOf));
    if (!boundIds.size) {
      return;
    }

    // Runs after the render pass, so PlaitMindComponent has already laid the
    // tree out and MIND_ELEMENT_TO_NODE is current.
    syncing = true;
    let movedIds: Set<string>;
    try {
      movedIds = syncBoundMindPoints(board, boundIds);
    } finally {
      syncing = false;
    }
    if (!movedIds.size) {
      return;
    }
    arrows.forEach((arrow) => {
      if (boundIdsOf(arrow).some((id) => movedIds.has(id))) {
        ARROW_COMPONENTS.get(arrow.id)?.redraw();
      }
    });
  };

  return board;
};
