import EditorOptions from './EditorOptions';
import EditorPlugin from '../editor/EditorPlugin';
import Undo from '../undo/Undo';
import UndoService from './UndoService';
import { DefaultFormat } from 'roosterjs-editor-types';
import { getComputedStyles } from 'roosterjs-editor-dom';

interface EditorCore {
    document: Document;
    contentDiv: HTMLDivElement;
    plugins: EditorPlugin[];
    defaultFormat: DefaultFormat;
    cachedRange: Range;
    undo: UndoService;
    suspendAddingUndoSnapshot: boolean;
    customData: {
        [Key: string]: {
            value: any;
            disposer: (value: any) => void;
        };
    };
    idleLoopHandle: number;
    ignoreIdleEvent: boolean;
}

let EditorCore = {
    create: (contentDiv: HTMLDivElement, options: EditorOptions): EditorCore => {
        return {
            contentDiv: contentDiv,
            document: contentDiv.ownerDocument,
            defaultFormat: calcDefaultFormat(contentDiv, options.defaultFormat),
            customData: {},
            cachedRange: null,
            undo: options.undo || new Undo(),
            suspendAddingUndoSnapshot: false,
            plugins: (options.plugins || []).filter(plugin => !!plugin),
            idleLoopHandle: 0,
            ignoreIdleEvent: false,
        };
    },
};

export default EditorCore;

function calcDefaultFormat(node: Node, baseFormat: DefaultFormat): DefaultFormat {
    baseFormat = baseFormat || <DefaultFormat>{};
    let computedStyle = getComputedStyles(node);
    return {
        fontFamily: baseFormat.fontFamily || computedStyle[0],
        fontSize: baseFormat.fontSize || computedStyle[1],
        textColor: baseFormat.textColor || computedStyle[2],
        backgroundColor: baseFormat.backgroundColor || '',
        bold: baseFormat.bold,
        italic: baseFormat.italic,
        underline: baseFormat.underline,
    };
}
