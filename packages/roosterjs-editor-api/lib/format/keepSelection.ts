import { Editor } from 'roosterjs-editor-core';
import { EditorPoint, NodeType } from 'roosterjs-editor-types';
import { normalizeEditorPoint } from 'roosterjs-editor-dom';

/**
 * Keep current selection and run a callback
 * @param editor The editor instance
 * @param callback The callback function to run. It can return a node or a range as a fallback selection when
 * original selection range is not available after the callback is run.
 */
export default function keepSelection(editor: Editor, callback: (startPoint: EditorPoint, endPoint: EditorPoint) => void | Node | Range | any) {
    let range = editor.getSelectionRange();
    let startPoint = range
        ? normalizeEditorPoint(range.startContainer, range.startOffset)
        : null;
    let endPoint = range ? normalizeEditorPoint(range.endContainer, range.endOffset) : null;
    let fallback = callback(startPoint, endPoint);

    if (
        range &&
        validateEditorPoint(editor, startPoint) &&
        validateEditorPoint(editor, endPoint)
    ) {
        range.setStart(startPoint.containerNode, startPoint.offset);
        range.setEnd(endPoint.containerNode, endPoint.offset);
    } else if (fallback instanceof Node) {
        range.selectNode(fallback);
    } else if (fallback instanceof Range) {
        range = fallback;
    }

    editor.updateSelection(range);
}

function validateEditorPoint(editor: Editor, point: EditorPoint): boolean {
    if (point.containerNode && editor.contains(point.containerNode)) {
        if (point.containerNode.nodeType == NodeType.Text) {
            point.offset = Math.min(point.offset, (<Text>point.containerNode).data.length);
        } else if (point.containerNode.nodeType == NodeType.Element) {
            point.offset = Math.min(
                point.offset,
                (<HTMLElement>point.containerNode).childNodes.length
            );
        }
        return point.offset >= 0;
    }
    return false;
}
