import { PlaitBoard, PlaitOperation } from '@plait/core';
import { PlaitMind } from '@plait/mind';
import { MindLayoutType } from '@plait/layouts';

type LooseNode = { layout?: string; rightNodeCount?: number; type?: string };

/**
 * Makes newly created mind maps two-sided: a fresh root is created by the mind
 * plugin with a single-sided `right` layout, which only shows the built-in
 * add ("+") button on the right. Switching a brand-new, empty root to the
 * `standard` layout makes the root grow children on both sides, so the built-in
 * add button appears on both the left and right of the root. Only the root is
 * affected; child nodes keep branching to a single side as usual.
 *
 * Existing maps are left alone: we only rewrite the insert of an empty root
 * (no children yet), so loading/pasting content with its own layout is
 * untouched.
 *
 * Also handles root-to-child conversion when a root node is dragged and dropped
 * inside another mind map's subtree (path.length > 1). Plait's drag-drop handler
 * inserts the dragged root as-is (still type 'mind'), so we convert it here.
 */
export const withStandardRoot = (board: PlaitBoard) => {
  const { apply } = board;

  board.apply = (operation: PlaitOperation) => {
    if (operation.type === 'insert_node' && PlaitMind.isMind(operation.node)) {
      const node = operation.node as LooseNode;

      if (
        operation.path.length === 1 &&
        node.layout === MindLayoutType.right &&
        (!('children' in operation.node) ||
          !(operation.node as { children?: unknown[] }).children?.length)
      ) {
        // Mutate in-place to preserve the object identity that insertMind holds
        // and passes to addSelectionWithTemporaryElements after apply returns.
        // Cloning the node here would orphan that reference and break insertion.
        node.layout = MindLayoutType.standard;
        // rightNodeCount must start at 0 so the first right-side child correctly
        // lands on the right. Without it, rightNodeCount is undefined,
        // undefined+1 is NaN, NaN is falsy in comparisons, and all children
        // render on the left.
        node.rightNodeCount = 0;
      } else if (operation.path.length > 1) {
        // Root dropped into another mind map's subtree via drag-and-drop.
        // Plait inserts it as type 'mind' without converting — do it now.
        node.type = 'mind_child';
        delete node.rightNodeCount;
        if (node.layout === MindLayoutType.standard) {
          delete node.layout;
        }
      }
    }
    apply(operation);
  };

  return board;
};
