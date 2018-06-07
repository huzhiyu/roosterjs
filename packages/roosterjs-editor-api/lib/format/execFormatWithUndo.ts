import { Editor } from 'roosterjs-editor-core';
import { EditorPoint } from 'roosterjs-editor-types';
import keepSelection from './keepSelection';

/**
 * @deprecated
 * Formatter function type
 * @param startPoint Current selection start point
 * @param endPoint Current selection end point
 * @returns A fallback node for selection. When original selection range is not valid after format,
 * will try to select this element instead
 */
export type Formatter = (startPoint?: EditorPoint, endPoint?: EditorPoint) => Node | void | any;

/**
 * @deprecated Use Editor.runWithUndo() and keepSelection instead
 */
export default function execFormatWithUndo(
    editor: Editor,
    formatter: Formatter,
    preserveSelection?: boolean
) {
    editor.runWithUndo(() => {
        if (preserveSelection) {
            keepSelection(editor, formatter);
        } else {
            formatter();
        }
    });
}

