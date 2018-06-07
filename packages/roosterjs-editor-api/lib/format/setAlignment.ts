import execCommand from './execCommand';
import { Alignment, DocumentCommand } from 'roosterjs-editor-types'
import { Editor } from 'roosterjs-editor-core';

/**
 * Set content alignment
 * @param editor The editor instance
 * @param alignment The alignment option:
 * Alignment.Center, Alignment.Left, Alignment.Right
 */
export default function setAlignment(editor: Editor, alignment: Alignment) {
    let command = alignment == Alignment.Left ? DocumentCommand.JustifyLeft :
        alignment == Alignment.Center ? DocumentCommand.JustifyCenter :
        DocumentCommand.JustifyRight;
    execCommand(editor, command, true /*addUndoSnapshotWhenCollapsed*/);
}
