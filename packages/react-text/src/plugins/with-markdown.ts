import {
  Editor,
  Element as SlateElement,
  Path,
  Point,
  Range,
  Text as SlateText,
  Transforms,
} from 'slate';
import { CustomText } from '@plait/common';
import { CustomEditor } from '../custom-types';

type MarkdownMark = 'bold' | 'italic' | 'strike' | 'code';

interface InlineRule {
  delimiter: string;
  mark: MarkdownMark;
}

// Longer delimiters come first so `**bold**` is matched before `*italic*`.
const INLINE_RULES: InlineRule[] = [
  { delimiter: '**', mark: 'bold' },
  { delimiter: '__', mark: 'bold' },
  { delimiter: '~~', mark: 'strike' },
  { delimiter: '`', mark: 'code' },
  { delimiter: '*', mark: 'italic' },
  { delimiter: '_', mark: 'italic' },
];

const CLOSING_CHARS = new Set(
  INLINE_RULES.map((rule) => rule.delimiter[rule.delimiter.length - 1])
);

const DELIMITER_MARKS = INLINE_RULES.reduce<Record<string, MarkdownMark>>(
  (marks, rule) => {
    marks[rule.delimiter] = rule.mark;
    return marks;
  },
  {}
);

// Same rules as INLINE_RULES, applied to a whole string at once. The
// backreference forces the closing delimiter to match the opening one, and the
// lookahead/trailing `\S` reject empty and whitespace-padded spans so
// `2 * 3 * 4` is not read as italics.
const PASTE_PATTERN = /(\*\*|__|~~|\*|_|`)(?=\S)([\s\S]*?\S)\1/g;

// `_` shows up inside identifiers far more often than as emphasis
// (`snake_case`, `__init__`), so underscore spans only count when the opening
// delimiter starts at a word boundary.
const isValidOpening = (delimiter: string, charBefore: string | undefined) =>
  !delimiter.startsWith('_') || !/\w/.test(charBefore ?? '');

/**
 * Resolves an offset measured in characters from the start of `blockPath` into
 * a Slate point. Walking the text nodes keeps this correct when the block
 * contains inline elements such as links.
 */
const pointAtOffset = (
  editor: Editor,
  blockPath: Path,
  offset: number
): Point | null => {
  let remaining = offset;
  for (const [node, path] of Editor.nodes(editor, {
    at: blockPath,
    match: SlateText.isText,
  })) {
    if (remaining <= node.text.length) {
      return { path, offset: remaining };
    }
    remaining -= node.text.length;
  }
  return null;
};

const deleteRange = (
  editor: Editor,
  blockPath: Path,
  start: number,
  end: number
) => {
  const anchor = pointAtOffset(editor, blockPath, start);
  const focus = pointAtOffset(editor, blockPath, end);
  if (!anchor || !focus) {
    return;
  }
  Transforms.delete(editor, { at: { anchor, focus } });
};

const matchInlineRule = (rule: InlineRule, line: string) => {
  const { delimiter } = rule;
  if (!line.endsWith(delimiter)) {
    return null;
  }
  const contentEnd = line.length - delimiter.length;
  const openIndex = line.lastIndexOf(delimiter, contentEnd - delimiter.length);
  if (openIndex < 0) {
    return null;
  }
  // A single `*` sitting next to another one belongs to a `**` the user is
  // still typing, so `**bold*` must not be read as an italic `*bold*`.
  const char = delimiter[0];
  if (
    delimiter.length === 1 &&
    (line[openIndex - 1] === char || line[openIndex + 1] === char)
  ) {
    return null;
  }
  const content = line.slice(openIndex + delimiter.length, contentEnd);
  // Whitespace-padded spans are arithmetic or prose, not emphasis — this is
  // what keeps `2 * 3 * 4` intact.
  if (
    content.length === 0 ||
    /^\s/.test(content) ||
    /\s$/.test(content) ||
    !isValidOpening(delimiter, line[openIndex - 1])
  ) {
    return null;
  }
  return { openIndex, contentEnd, content };
};

/**
 * Called with the character the user is about to type. If that character
 * completes a markdown span, the delimiters are stripped, the mark is applied
 * to the text between them, and the character itself is swallowed.
 */
const applyInlineRule = (editor: CustomEditor, char: string): boolean => {
  const { selection } = editor;
  if (!selection || !Range.isCollapsed(selection)) {
    return false;
  }

  const blockEntry = Editor.above(editor, {
    match: (node) =>
      SlateElement.isElement(node) && Editor.isBlock(editor, node),
  });
  if (!blockEntry) {
    return false;
  }
  const [, blockPath] = blockEntry;

  // The typed character is not in the document yet, so build the line the user
  // is about to end up with and match against that.
  const typed = Editor.string(editor, {
    anchor: Editor.start(editor, blockPath),
    focus: selection.anchor,
  });
  const line = typed + char;

  for (const rule of INLINE_RULES) {
    const match = matchInlineRule(rule, line);
    if (!match) {
      continue;
    }
    const { delimiter, mark } = rule;
    const { openIndex, contentEnd, content } = match;
    // Everything except the character being typed is already in the document,
    // so the closing delimiter is one character short of `delimiter`.
    const typedClosingLength = delimiter.length - 1;

    Editor.withoutNormalizing(editor, () => {
      // Delete back to front so the earlier offsets stay valid.
      if (typedClosingLength > 0) {
        deleteRange(
          editor,
          blockPath,
          contentEnd,
          contentEnd + typedClosingLength
        );
      }
      deleteRange(editor, blockPath, openIndex, openIndex + delimiter.length);

      const anchor = pointAtOffset(editor, blockPath, openIndex);
      const focus = pointAtOffset(editor, blockPath, openIndex + content.length);
      if (!anchor || !focus) {
        return;
      }
      Transforms.setNodes(
        editor,
        { [mark]: true } as Partial<CustomText>,
        { at: { anchor, focus }, match: SlateText.isText, split: true }
      );
    });

    // Deleting both delimiters leaves the cursor right after the marked span;
    // clear the mark so what the user types next is unformatted.
    Editor.removeMark(editor, mark);
    return true;
  }

  return false;
};

const parseInlineMarkdown = (text: string): CustomText[] => {
  const nodes: CustomText[] = [];
  const pattern = new RegExp(PASTE_PATTERN.source, PASTE_PATTERN.flags);
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const [full, delimiter, content] = match;
    const mark = DELIMITER_MARKS[delimiter];
    if (!mark || !isValidOpening(delimiter, text[match.index - 1])) {
      continue;
    }
    if (match.index > lastIndex) {
      nodes.push({ text: text.slice(lastIndex, match.index) });
    }
    nodes.push({ text: content, [mark]: true });
    lastIndex = match.index + full.length;
  }

  if (lastIndex < text.length) {
    nodes.push({ text: text.slice(lastIndex) });
  }
  return nodes;
};

const hasInlineMarkdown = (nodes: CustomText[]) =>
  nodes.some((node) => Object.keys(node).length > 1);

/**
 * The font size new text should take: the pending/cursor marks if they carry
 * one, otherwise the first explicit size found in the current block. Keeps a
 * text box's size uniform — typed or pasted text follows whatever size the box
 * is already using instead of falling back to the CSS default (14px), which is
 * how a box ends up with two sizes. Returns undefined when the block has no
 * explicit size anywhere (e.g. mind topics, whose size comes from the mind
 * defaults and must not be pinned).
 */
const getInheritedFontSize = (editor: CustomEditor): string | undefined => {
  const marks = Editor.marks(editor) as Omit<CustomText, 'text'> | null;
  if (marks?.['font-size']) {
    return undefined; // already sized; nothing to inherit
  }
  const { selection } = editor;
  if (!selection) {
    return undefined;
  }
  const blockEntry = Editor.above(editor, {
    match: (node) =>
      SlateElement.isElement(node) && Editor.isBlock(editor, node),
  });
  if (!blockEntry) {
    return undefined;
  }
  for (const [text] of Editor.nodes(editor, {
    at: blockEntry[1],
    match: SlateText.isText,
  })) {
    const size = (text as CustomText)['font-size'];
    if (size) {
      return size;
    }
  }
  return undefined;
};

/**
 * Renders inline markdown as formatting instead of leaving the syntax in the
 * text: `**bold**`, `*italic*`, `~~strike~~` and `` `code` `` are converted as
 * the user types the closing delimiter, and the same spans are converted when
 * plain text containing them is pasted.
 *
 * Only inline marks are handled — block syntax (headings, lists) is out of
 * scope because a canvas text element is a single paragraph.
 */
export const withMarkdown = <T extends CustomEditor>(editor: T) => {
  const e = editor;
  const { insertText, insertData } = e;

  e.insertText = (text) => {
    // Typed text follows the box's existing size, so a box never ends up with
    // mixed sizes just because the cursor sat somewhere without a pending mark
    // (start of the text, an empty box after select-all-delete, …).
    const inheritedSize = getInheritedFontSize(e);
    if (inheritedSize) {
      Editor.addMark(e, 'font-size', inheritedSize);
    }
    if (
      text.length === 1 &&
      CLOSING_CHARS.has(text) &&
      applyInlineRule(e, text)
    ) {
      return;
    }
    insertText(text);
  };

  e.insertData = (data: DataTransfer) => {
    const slateFragment = data.getData('application/x-slate-fragment');
    const text = data.getData('text/plain');
    if (!slateFragment && text) {
      // Match the normalization withText applies to pasted plain text so both
      // paths produce the same single-paragraph result.
      const normalized = text.trim().replace(/\t+/g, ' ');
      const nodes = parseInlineMarkdown(normalized);
      if (hasInlineMarkdown(nodes)) {
        // insertFragment bypasses insertText, so the size the box is already
        // using has to be stamped onto the nodes here — otherwise pasted
        // markdown renders at the CSS default and the box ends up with two
        // sizes.
        const marks = (Editor.marks(e) ?? {}) as Omit<CustomText, 'text'>;
        const inheritedSize = getInheritedFontSize(e);
        const baseMarks: Omit<CustomText, 'text'> = {
          ...marks,
          ...(inheritedSize ? { ['font-size']: inheritedSize } : {}),
        };
        Transforms.insertFragment(
          e,
          nodes.map((node) => ({ ...baseMarks, ...node }))
        );
        return;
      }
    }
    // Everything else (plain text, URLs, slate fragments) stays with the rest
    // of the chain. Plain text ends up back in our insertText, which applies
    // the inherited font size, so paste stays size-consistent without this
    // plugin having to know about links.
    insertData(data);
  };

  return e;
};
