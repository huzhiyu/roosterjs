import EditorCore, { RunWithUndo } from '../editor/EditorCore';
import { ChangeSource, ContentChangedEvent, PluginEventType } from 'roosterjs-editor-types';

const runWithUndo: RunWithUndo = (
    core: EditorCore,
    callback: () => any,
    changeSource: ChangeSource | string,
    getDataCallback: () => any
) => {
    let isNested = core.suspendUndo;

    if (!isNested) {
        core.undo.addUndoSnapshot();
        core.suspendUndo = true;
    }

    try {
        if (callback) {
            callback();
            if (!isNested) {
                core.undo.addUndoSnapshot();
            }

            if (!isNested && changeSource) {
                let event: ContentChangedEvent = {
                    eventType: PluginEventType.ContentChanged,
                    source: changeSource,
                    data: getDataCallback && getDataCallback(),
                };
                core.api.triggerEvent(core, event, true /*broadcast*/);
            }
        }
    } finally {
        if (!isNested) {
            core.suspendUndo = false;
        }
    }
};

export default runWithUndo;
