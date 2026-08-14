import { Path, PlaitBoard, PlaitElement, PlaitNode } from '@plait/core';
import { AbstractNode } from '@plait/layouts';
import {
  getBranchColorByMindElement,
  getDefaultBranchColorByIndex,
  getMindThemeColor,
  MindElement,
} from '@plait/mind';

type StyledMindNode = PlaitElement & {
  strokeColor?: string | null;
  fill?: string | null;
  branchColor?: string | null;
  children?: StyledMindNode[];
};

const stampBranchColor = (node: StyledMindNode, color: string) => {
  // Abstract nodes have their own grey branch styling and read branchColor
  // first, so leave them (and their subtrees) alone.
  if (AbstractNode.isAbstract(node)) {
    return;
  }
  node.branchColor = color;
  (node.children ?? []).forEach((child) => stampBranchColor(child, color));
};

/**
 * Re-colours a root that is being merged into another mind map so it does not
 * arrive wearing the colours it had as a root.
 *
 * `getBranchColorByMindElement` resolves `branchColor || strokeColor ||
 * palette[path[1] % palette.length]`, and `adjustRootToNode` keeps strokeColor
 * and fill. So without this the merged node's branch keeps its old root colour
 * while its whole subtree switches to the new slot colour — mismatched, and
 * liable to clash with a sibling. Clearing the root-only styling lets the merged
 * subtree take the palette colour for its slot under the new parent, which
 * differs from every existing child because the slot index differs.
 *
 * Past ten first-level children the slot colours wrap and can collide anyway, so
 * in that case pick the first unused palette colour and pin it across the merged
 * subtree.
 *
 * Call this after the root has been converted to a child but before it is
 * inserted, with the path it is about to be inserted at.
 */
export const adoptBranchColorOnMerge = (
  board: PlaitBoard,
  node: StyledMindNode,
  path: Path
) => {
  delete node.strokeColor;
  delete node.fill;
  delete node.branchColor;

  // Dropped deeper than the first level: it inherits its first-level ancestor's
  // colour by index, which is already the behaviour we want.
  if (path.length !== 2) {
    return;
  }

  const root = PlaitNode.get(board, path.slice(0, 1)) as StyledMindNode;
  const siblings = (root.children ?? []) as MindElement[];
  const usedColors = new Set(
    siblings.map((sibling) => getBranchColorByMindElement(board, sibling))
  );
  const slotColor = getDefaultBranchColorByIndex(board, path[1]);
  if (!usedColors.has(slotColor)) {
    return;
  }

  const freeColor = getMindThemeColor(board).branchColors.find(
    (color) => !usedColors.has(color)
  );
  if (freeColor) {
    stampBranchColor(node, freeColor);
  }
};
