import { createEditor, Editor, Transforms } from 'slate';
import { CustomEditor } from '../custom-types';
import { withMarkdown } from './with-markdown';

const createTestEditor = () => {
  const editor = withMarkdown(createEditor() as unknown as CustomEditor);
  editor.children = [{ children: [{ text: '' }] }];
  Transforms.select(editor, Editor.end(editor, [0]));
  return editor;
};

const type = (editor: CustomEditor, text: string) => {
  for (const char of text) {
    editor.insertText(char);
  }
};

const leaves = (editor: CustomEditor) =>
  (editor.children[0] as { children: unknown[] }).children;

describe('withMarkdown', () => {
  it('turns **text** into a bold leaf and drops the delimiters', () => {
    const editor = createTestEditor();
    type(editor, '**bold**');
    expect(leaves(editor)).toEqual([{ text: 'bold', bold: true }]);
  });

  it('turns *text* into an italic leaf', () => {
    const editor = createTestEditor();
    type(editor, '*hi*');
    expect(leaves(editor)).toEqual([{ text: 'hi', italic: true }]);
  });

  it('supports ~~ and ` spans', () => {
    const strike = createTestEditor();
    type(strike, '~~gone~~');
    expect(leaves(strike)).toEqual([{ text: 'gone', strike: true }]);

    const code = createTestEditor();
    type(code, '`npm`');
    expect(leaves(code)).toEqual([{ text: 'npm', code: true }]);
  });

  it('keeps surrounding text unmarked and stops marking after the span', () => {
    const editor = createTestEditor();
    type(editor, 'a **b** c');
    expect(leaves(editor)).toEqual([
      { text: 'a ' },
      { text: 'b', bold: true },
      { text: ' c' },
    ]);
  });

  it('leaves unmatched and empty delimiters alone', () => {
    const editor = createTestEditor();
    type(editor, '2 * 3 * 4');
    expect(leaves(editor)).toEqual([{ text: '2 * 3 * 4' }]);

    const empty = createTestEditor();
    type(empty, '****');
    expect(leaves(empty)).toEqual([{ text: '****' }]);
  });

  it('does not treat underscores inside a word as emphasis', () => {
    const editor = createTestEditor();
    type(editor, 'snake_case_name');
    expect(leaves(editor)).toEqual([{ text: 'snake_case_name' }]);
  });

  it('treats underscores at a word boundary as emphasis', () => {
    const editor = createTestEditor();
    type(editor, '_em_');
    expect(leaves(editor)).toEqual([{ text: 'em', italic: true }]);
  });

  it('gives typed text the font size the box is already using', () => {
    const editor = createTestEditor();
    editor.children = [
      { children: [{ text: 'big', 'font-size': '32' }] },
    ] as never;
    Transforms.select(editor, Editor.end(editor, [0]));

    type(editor, 'ger');

    expect(leaves(editor)).toEqual([{ text: 'bigger', 'font-size': '32' }]);
  });

  it('gives pasted markdown the box font size', () => {
    const editor = createTestEditor();
    editor.children = [
      { children: [{ text: 'a', 'font-size': '32' }] },
    ] as never;
    Transforms.select(editor, Editor.end(editor, [0]));

    editor.insertData({
      getData: (format: string) =>
        format === 'text/plain' ? 'and **b**' : '',
    } as unknown as DataTransfer);

    expect(leaves(editor)).toEqual([
      { text: 'aand ', 'font-size': '32' },
      { text: 'b', bold: true, 'font-size': '32' },
    ]);
  });

  it('leaves text without an explicit size unpinned', () => {
    const editor = createTestEditor();
    type(editor, 'hi');
    expect(leaves(editor)).toEqual([{ text: 'hi' }]);
  });

  it('parses markdown in pasted plain text', () => {
    const editor = createTestEditor();
    editor.insertData({
      getData: (format: string) =>
        format === 'text/plain' ? 'see **this** and ~~that~~' : '',
    } as unknown as DataTransfer);
    expect(leaves(editor)).toEqual([
      { text: 'see ' },
      { text: 'this', bold: true },
      { text: ' and ' },
      { text: 'that', strike: true },
    ]);
  });
});
