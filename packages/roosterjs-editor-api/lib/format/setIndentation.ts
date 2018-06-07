import getFormatState from '../format/getFormatState';
import queryNodesWithSelection from '../cursor/queryNodesWithSelection';
import { Editor } from 'roosterjs-editor-core';
import { Indentation } from 'roosterjs-editor-types';
import { workaroundForList } from './execCommand';

/**
 * Set indentation at selection
 * If selection contains bullet/numbering list, increase/decrease indentation will
 * increase/decrease the list level by one.
 * @param editor The editor instance
 * @param indentation The indentation option:
 * Indentation.Increase to increase indentation or Indentation.Decrease to decrease indentation
 */
export default function setIndentation(editor: Editor, indentation: Indentation) {
    editor.focus();
    let command = indentation == Indentation.Increase ? 'indent' : 'outdent';
    editor.runWithUndo(() => {
        workaroundForList(editor, () => {
            let format = getFormatState(editor);
            editor.getDocument().execCommand(command, false, null);
            if (!format.isBullet && !format.isNumbering) {
                queryNodesWithSelection(editor, 'blockquote', false, node => {
                    node.style.marginTop = '0px';
                    node.style.marginBottom = '0px';
                });
            }
        });
    });
}
