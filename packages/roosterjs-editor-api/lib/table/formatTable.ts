import getNodeAtCursor from '../cursor/getNodeAtCursor';
import { Editor } from 'roosterjs-editor-core';
import { VTable } from 'roosterjs-editor-dom';
import { TableFormat } from 'roosterjs-editor-types';
import keepSelection from '../format/keepSelection';

/**
 * Format table
 * @param table The table to format
 * @param formatName Name of the format to use
 */
export default function formatTable(editor: Editor, format: TableFormat, table?: HTMLTableElement) {
    let td = table
        ? table.rows[0].cells[0]
        : (getNodeAtCursor(editor, ['TD', 'TH']) as HTMLTableCellElement);
    if (td) {
        editor.runWithUndo(() => {
            keepSelection(editor, () => {
                let vtable = new VTable(td);
                vtable.applyFormat(format);
                vtable.writeBack();
                td = editor.contains(td) ? td : vtable.getCurrentTd();
                editor.focus();
                return td;
            });
        });
    }
}
