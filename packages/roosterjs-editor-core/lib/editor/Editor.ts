import EditorCore from './EditorCore';
import EditorOptions from './EditorOptions';
import browserData from '../utils/BrowserData';
import createEditorCore from './createEditorCore';
import {
    ChangeSource,
    ContentPosition,
    ContentScope,
    DefaultFormat,
    DocumentCommand,
    ExtractContentEvent,
    InlineElement,
    InsertOption,
    NodeBoundary,
    NodeType,
    PluginEvent,
    PluginEventType,
    Rect,
} from 'roosterjs-editor-types';
import {
    ContentTraverser,
    NodeBlockElement,
    applyFormat,
    contains,
    fromHtml,
    getBlockElementAtNode,
    getFirstBlockElement,
    getInlineElementAtNode,
    getTagOfNode,
    isNodeEmpty,
    normalizeEditorPoint,
    wrap,
} from 'roosterjs-editor-dom';

const IS_IE_OR_EDGE = browserData.isIE || browserData.isEdge;

export default class Editor {
    private omitContentEditable: boolean;
    private disableRestoreSelectionOnFocus: boolean;
    private inIME: boolean;
    private core: EditorCore;
    private eventDisposers: (() => void)[];

    //#region Lifecycle

    /**
     * Creates an instance of Editor
     * @param contentDiv The DIV HTML element which will be the container element of editor
     * @param options An optional options object to customize the editor
     */
    constructor(contentDiv: HTMLDivElement, options: EditorOptions = {}) {
        // 1. Make sure all parameters are valid
        if (getTagOfNode(contentDiv) != 'DIV') {
            throw new Error('contentDiv must be an HTML DIV element');
        }

        // 2. Store options values to local variables
        this.core = createEditorCore(contentDiv, options);
        this.disableRestoreSelectionOnFocus = options.disableRestoreSelectionOnFocus;
        this.omitContentEditable = options.omitContentEditableAttributeChanges;

        // 3. Initialize plugins
        this.core.plugins.forEach(plugin => {
            if (!plugin.name) {
                plugin.name = (<Object>plugin).constructor.name;
            }
            plugin.initialize(this);
        });

        // 4. Ensure initial content and its format
        if (options.initialContent) {
            this.setContent(options.initialContent);
        } else if (contentDiv.innerHTML != '') {
            this.triggerContentChangedEvent();
        }
        this.ensureInitialContent();

        // 5. Initialize undo service
        // This need to be after step 4 so that undo service can pickup initial content
        this.core.undo.initialize(this);
        this.core.plugins.push(this.core.undo);

        // 6. Create event handler to bind DOM events
        this.createEventHandlers();

        // 7. Finally make the container editable and set its selection styles
        if (!this.omitContentEditable) {
            contentDiv.setAttribute('contenteditable', 'true');
            let styles = contentDiv.style;
            styles.userSelect = styles.msUserSelect = styles.webkitUserSelect = 'text';
        }

        // 8. Disable these operations for firefox since its behavior is usually wrong
        // Catch any possible exception since this should not block the initialization of editor
        try {
            this.core.document.execCommand(DocumentCommand.EnableObjectResizing, false, false);
            this.core.document.execCommand(DocumentCommand.EnableInlineTableEditing, false, false);
        } catch (e) {}

        // 9. Start a timer loop if required
        if (options.idleEventTimeSpanInSecond > 0) {
            this.startIdleLoop(options.idleEventTimeSpanInSecond * 1000);
        }

        // 10. Finally, let plugins know that we are ready
        this.triggerEvent(
            {
                eventType: PluginEventType.EditorReady,
            },
            true /*broadcast*/
        );
    }

    /**
     * Dispose this editor, dispose all plugins and custom data
     */
    public dispose(): void {
        this.triggerEvent(
            {
                eventType: PluginEventType.BeforeDispose,
            },
            true /*broadcast*/
        );

        if (this.core.idleLoopHandle > 0) {
            let win = this.core.contentDiv.ownerDocument.defaultView || window;
            win.clearInterval(this.core.idleLoopHandle);
            this.core.idleLoopHandle = 0;
        }

        this.core.plugins.forEach(plugin => {
            plugin.dispose();
        });

        this.eventDisposers.forEach(disposer => disposer());
        this.eventDisposers = null;

        for (let key of Object.keys(this.core.customData)) {
            let data = this.core.customData[key];
            if (data && data.disposer) {
                data.disposer(data.value);
            }
            delete this.core.customData[key];
        }

        if (!this.omitContentEditable) {
            let styles = this.core.contentDiv.style;
            styles.userSelect = styles.msUserSelect = styles.webkitUserSelect = '';
            this.core.contentDiv.removeAttribute('contenteditable');
        }

        this.core = null;
    }

    /**
     * Get whether this editor is disposed
     * @returns True if editor is disposed, otherwise false
     */
    public isDisposed(): boolean {
        return !this.core;
    }

    //#endregion

    //#region Node API

    /**
     * Insert node into editor
     * @param node The node to insert
     * @param option Insert options. Default value is:
     *  position: ContentPosition.SelectionStart
     *  updateCursor: true
     *  replaceSelection: true
     *  insertOnNewLine: false
     * @returns true if node is inserted. Otherwise false
     */
    public insertNode(node: Node, option?: InsertOption): boolean {
        return node ? this.core.api.insertNode(this.core, node, option) : false;
    }

    /**
     * Delete a node from editor content
     * @param node The node to delete
     * @returns true if node is deleted. Otherwise false
     */
    public deleteNode(node: Node): boolean {
        // Only remove the node when it falls within editor
        if (node && this.contains(node)) {
            node.parentNode.removeChild(node);
            return true;
        }

        return false;
    }

    /**
     * Replace a node in editor content with another node
     * @param existingNode The existing node to be replaced
     * @param new node to replace to
     * @returns true if node is replaced. Otherwise false
     */
    public replaceNode(existingNode: Node, toNode: Node): boolean {
        // Only replace the node when it falls within editor
        if (existingNode && toNode && this.contains(existingNode)) {
            existingNode.parentNode.replaceChild(toNode, existingNode);
            return true;
        }

        return false;
    }

    /**
     * Get InlineElement at given node
     * @param node The node to create InlineElement
     * @requires The InlineElement result
     */
    public getInlineElementAtNode(node: Node): InlineElement {
        return getInlineElementAtNode(this.core.contentDiv, node);
    }

    /**
     * Check if the node falls in the editor content
     * @param node The node to check
     * @returns True if the given node is in editor content, otherwise false
     */
    public contains(node: Node): boolean {
        return contains(this.core.contentDiv, node);
    }

    /**
     * Query HTML elements in editor using querySelectorAll() method
     * @param selector Selector string to query
     * @param forEachCallback An optional callback to be invoked on each node in query result
     * @returns HTML Element list of the query result
     */
    public queryElements<T extends HTMLElement = HTMLElement>(
        selector: string,
        forEachCallback?: (node: T) => void
    ): T[] {
        let nodes = [].slice.call(this.core.contentDiv.querySelectorAll(selector)) as T[];
        if (forEachCallback) {
            nodes.forEach(forEachCallback);
        }
        return nodes;
    }

    //#endregion

    //#region Content API

    /**
     * Check whether the editor contains any visible content
     * @param trim Whether trime the content string before check. Default is false
     * @returns True if there's no visible content, otherwise false
     */
    public isEmpty(trim?: boolean): boolean {
        return isNodeEmpty(this.core.contentDiv, trim);
    }

    /**
     * Get current editor content as HTML string
     * @param triggerExtractContentEvent Whether trigger ExtractContent event to all plugins
     * before return. Use this parameter to remove any temporary content added by plugins.
     * @returns HTML string representing current editor content
     */
    public getContent(triggerExtractContentEvent: boolean = true): string {
        let content = this.core.contentDiv.innerHTML;

        if (triggerExtractContentEvent) {
            let extractContentEvent: ExtractContentEvent = {
                eventType: PluginEventType.ExtractContent,
                content: content,
            };
            this.triggerEvent(extractContentEvent, true /*broadcast*/);
            content = extractContentEvent.content;
        }

        return content;
    }

    /**
     * Get plain text content inside editor
     * @returns The text content inside editor
     */
    public getTextContent(): string {
        return this.core.contentDiv.innerText;
    }

    /**
     * Set HTML content to this editor. All existing content will be replaced. A ContentChanged event will be triggered
     * @param content HTML content to set in
     */
    public setContent(content: string) {
        this.core.contentDiv.innerHTML = content || '';
        this.triggerContentChangedEvent();
    }

    /**
     * Insert HTML content into editor
     * @param HTML content to insert
     * @param option Insert options. Default value is:
     *  position: ContentPosition.SelectionStart
     *  updateCursor: true
     *  replaceSelection: true
     *  insertOnNewLine: false
     */
    public insertContent(content: string, option?: InsertOption) {
        if (content) {
            let allNodes = fromHtml(content, this.core.document);
            // If it is to insert on new line, and there are more than one node in the collection, wrap all nodes with
            // a parent DIV before calling insertNode on each top level sub node. Otherwise, every sub node may get wrapped
            // separately to show up on its own line
            if (option && option.insertOnNewLine && allNodes.length > 0) {
                allNodes = [wrap(allNodes)];
            }
            for (let i = 0; i < allNodes.length; i++) {
                this.insertNode(allNodes[i], option);
            }
        }
    }

    /**
     * @deprecated Use queryElements instead
     */
    public queryContent(selector: string): NodeListOf<Element> {
        return this.core.contentDiv.querySelectorAll(selector);
    }

    //#endregion

    //#region Focus and Selection

    /**
     * Get current selection range from Editor.
     * It does a live pull on the selection, if nothing retrieved, return whatever we have in cache.
     * @returns current selection range, or null if editor never got focus before
     */
    public getSelectionRange(): Range {
        return this.core.api.getSelectionRange(this.core, true /*tryGetFromCache*/);
    }

    /**
     * Get current selection
     * @return current selection object
     */
    public getSelection(): Selection {
        return this.core.document.defaultView.getSelection();
    }

    /**
     * Check if focus is in editor now
     * @returns true if focus is in editor, otherwise false
     */
    public hasFocus(): boolean {
        return this.core.api.hasFocus(this.core);
    }

    /**
     * Focus to this editor, the selection was restored to where it was before, no unexpected scroll.
     */
    public focus() {
        this.core.api.focus(this.core);
    }

    /**
     * Update selection in editor
     * @param selectionRange The selection range to update to
     * @returns true if selection range is updated. Otherwise false.
     */
    public updateSelection(selectionRange: Range): boolean {
        return this.core.api.updateSelection(this.core, selectionRange);
    }

    /**
     * Save the current selection in editor so that when focus again, the selection can be restored
     */
    public saveSelectionRange() {
        this.core.cachedSelectionRange = this.core.api.getSelectionRange(
            this.core,
            false /*tryGetFromCache*/
        );
    }

    /**
     * Get a rect representing the location of the cursor.
     * @returns a Rect object representing cursor location
     */
    public getCursorRect(): Rect {
        return this.core.api.getCursorRect(this.core);
    }

    /**
     * Apply inline style to current selection
     * @param styler The callback function to apply style
     */
    public applyInlineStyle(styler: (element: HTMLElement) => void): void {
        this.core.api.applyInlineStyle(this.core, styler);
    }

    //#endregion

    //#region EVENT API

    /**
     * Add a custom DOM event handler to handle events not handled by roosterjs.
     * Caller need to take the responsibility to dispose the handler properly
     * @param eventName DOM event name to handle
     * @param handler Handler callback
     * @returns A dispose function. Call the function to dispose this event handler
     */
    public addDomEventHandler(eventName: string, handler: (event: UIEvent) => void): () => void {
        return this.core.api.attachDomEvent(
            this.core,
            eventName,
            null /*pluginEventType*/,
            handler
        );
    }

    /**
     * Trigger an event to be dispatched to all plugins
     * @param pluginEvent The event object to trigger
     * @param broadcast indicates if the event needs to be dispatched to all plugins
     * True means to all, false means to allow exclusive handling from one plugin unless no one wants that
     */
    public triggerEvent(pluginEvent: PluginEvent, broadcast: boolean = true) {
        this.core.api.triggerEvent(this.core, pluginEvent, broadcast);
    }

    /**
     * Trigger a ContentChangedEvent
     * @param source Source of this event, by default is 'SetContent'
     * @param data additional data for this event
     */
    public triggerContentChangedEvent(
        source: ChangeSource | string = ChangeSource.SetContent,
        data?: any
    ) {
        this.triggerEvent({
            eventType: PluginEventType.ContentChanged,
            source: source,
            data: data,
        } as PluginEvent);
    }

    //#endregion

    //#region Undo API

    /**
     * Undo last edit operation
     */
    public undo() {
        this.focus();
        this.core.undo.undo();
    }

    /**
     * Redo next edit operation
     */
    public redo() {
        this.focus();
        this.core.undo.redo();
    }

    /**
     * Add undo snapshot, and execute a format callback function, then add another undo snapshot, then trigger
     * ContentChangedEvent with given change source.
     * If this function is called nested, undo snapshot will only be added in the outside one
     * @param callback The callback function to perform formatting
     * @param changeSource The change source to use when fire ContentChangedEvent. Default value is 'Format'
     * If pass null, the event will not be fired.
     * @param getDataCallback A callback function to retrieve the data for ContentChangedEvent
     */
    public runWithUndo(
        callback?: () => any,
        changeSource: ChangeSource | string = ChangeSource.Format,
        getDataCallback?: () => any
    ) {
        this.core.api.runWithUndo(
            this.core,
            callback,
            changeSource,
            getDataCallback
        );
    }

    /**
     * @deprecated Use runWithUndo() instead
     */
    public runWithoutAddingUndoSnapshot(callback: () => void) {
        try {
            this.core.suspendUndo = true;
            callback();
        } finally {
            this.core.suspendUndo = false;
        }
    }

    /**
     * @deprecated Use runWithUndo() instead
     */
    public addUndoSnapshot() {
        if (!this.core.suspendUndo) {
            this.core.undo.addUndoSnapshot();
        }
    }

    /**
     * Whether there is an available undo snapshot
     */
    public canUndo(): boolean {
        return this.core.undo.canUndo();
    }

    /**
     * Whether there is an available redo snapshot
     */
    public canRedo(): boolean {
        return this.core.undo.canRedo();
    }

    //#endregion

    //#region Misc

    /**
     * Get document which contains this editor
     * @returns The HTML document which contains this editor
     */
    public getDocument(): Document {
        return this.core.document;
    }

    /**
     * Get custom data related to this editor
     * @param key Key of the custom data
     * @param getter Getter function. If custom data for the given key doesn't exist,
     * call this function to get one and store it.
     * @param disposer An optional disposer function to dispose this custom data when
     * dispose editor.
     */
    public getCustomData<T>(key: string, getter: () => T, disposer?: (value: T) => void): T {
        return this.core.api.getCustomData(this.core, key, getter);
    }

    /**
     * Check if editor is in IME input sequence
     * @returns True if editor is in IME input sequence, otherwise false
     */
    public isInIME(): boolean {
        return this.inIME;
    }

    /**
     * Get default format of this editor
     * @returns Default format object of this editor
     */
    public getDefaultFormat(): DefaultFormat {
        return this.core.defaultFormat;
    }

    /**
     * Get a content traverser that can be used to travse content within editor
     * @param scope Content scope type. There are 3 kinds of scoper:
     * 1) SelectionBlockScoper is a block based scoper that restrict traversing within the block where the selection is
     *    it allows traversing from start, end or selection start position
     *    this is commonly used to parse content from cursor as user type up to the begin or end of block
     * 2) SelectionScoper restricts traversing within the selection. It is commonly used for applying style to selection
     * 3) BodyScoper will traverse the entire editor body from the beginning (ignoring the passed in position parameter)
     * @param position Start position of the traverser
     * @returns A content traverser to help travse among InlineElemnt/BlockElement within scope
     */
    public getContentTraverser(
        scope: ContentScope,
        position: ContentPosition = ContentPosition.SelectionStart
    ): ContentTraverser {
        return this.core.api.getContentTraverser(this.core, scope, position);
    }

    /**
     * Run a callback function asynchronously
     * @param callback The callback function to run
     */
    public runAsync(callback: () => void) {
        let win = this.core.contentDiv.ownerDocument.defaultView || window;
        win.requestAnimationFrame(() => {
            if (!this.isDisposed() && callback) {
                callback();
            }
        });
    }

    //#endregion

    //#region Private functions
    private createEventHandlers() {
        this.eventDisposers = [
            this.core.api.attachDomEvent(this.core, 'input', null, this.stopPropagation),
            this.core.api.attachDomEvent(
                this.core,
                'keypress',
                PluginEventType.KeyPress,
                this.onKeyPress
            ),
            this.core.api.attachDomEvent(
                this.core,
                'keydown',
                PluginEventType.KeyDown,
                this.stopPropagation
            ),
            this.core.api.attachDomEvent(
                this.core,
                'keyup',
                PluginEventType.KeyUp,
                this.stopPropagation
            ),
            this.core.api.attachDomEvent(this.core, 'mousedown', PluginEventType.MouseDown),
            this.core.api.attachDomEvent(this.core, 'mouseup', PluginEventType.MouseUp),
            this.core.api.attachDomEvent(
                this.core,
                'compositionstart',
                null,
                () => (this.inIME = true)
            ),
            this.core.api.attachDomEvent(
                this.core,
                'compositionend',
                PluginEventType.CompositionEnd,
                () => (this.inIME = false)
            ),
            this.core.api.attachDomEvent(this.core, 'focus', null, () => {
                // Restore the last saved selection first
                if (this.core.cachedSelectionRange && !this.disableRestoreSelectionOnFocus) {
                    this.updateSelection(this.core.cachedSelectionRange);
                }
                this.core.cachedSelectionRange = null;
            }),
            this.core.api.attachDomEvent(
                this.core,
                IS_IE_OR_EDGE ? 'beforedeactivate' : 'blur',
                null,
                () => {
                    this.saveSelectionRange();
                }
            ),
        ];
    }

    private stopPropagation = (event: KeyboardEvent) => {
        if (
            !event.ctrlKey &&
            !event.altKey &&
            !event.metaKey &&
            (event.which == 32 || // Space
            (event.which >= 65 && event.which <= 90) || // A-Z
            (event.which >= 48 && event.which <= 57) || // 0-9
            (event.which >= 96 && event.which <= 105) || // 0-9 on num pad
            (event.which >= 186 && event.which <= 192) || // ';', '=', ',', '-', '.', '/', '`'
                (event.which >= 219 && event.which <= 222))
        ) {
            // '[', '\', ']', '''
            event.stopPropagation();
        }
    };

    // Check if user is typing right under the content div
    // When typing goes directly under content div, many things can go wrong
    // We fix it by wrapping it with a div and reposition cursor within the div
    // TODO: we only fix the case when selection is collapsed
    // When selection is not collapsed, i.e. users press ctrl+A, and then type
    // We don't have a good way to fix that for the moment
    private onKeyPress = (event: KeyboardEvent) => {
        let selectionRange = this.core.api.getSelectionRange(this.core, true /*tryGetFromCache*/);
        let focusNode: Node;
        if (
            selectionRange &&
            selectionRange.collapsed &&
            (focusNode = selectionRange.startContainer) &&
            (focusNode == this.core.contentDiv ||
                (focusNode.nodeType == NodeType.Text &&
                    focusNode.parentNode == this.core.contentDiv))
        ) {
            let position = normalizeEditorPoint(
                selectionRange.startContainer,
                selectionRange.startOffset
            );
            let blockElement = getBlockElementAtNode(this.core.contentDiv, position.containerNode);

            if (!blockElement) {
                // Only reason we don't get the selection block is that we have an empty content div
                // which can happen when users removes everything (i.e. select all and DEL, or backspace from very end to begin)
                // The fix is to add a DIV wrapping, apply default format and move cursor over
                let nodes = fromHtml('<div><br></div>', this.core.document);
                let element = this.core.contentDiv.appendChild(nodes[0]) as HTMLElement;
                applyFormat(element, this.core.defaultFormat);
                // element points to a wrapping node we added "<div><br></div>". We should move the selection left to <br>
                this.selectEditorPoint(element.firstChild, NodeBoundary.Begin);
            } else if (
                blockElement.getStartNode().parentNode == blockElement.getEndNode().parentNode
            ) {
                // Only fix the balanced start-end block where start and end node is under same parent
                // The focus node could be pointing to the content div, normalize it to have it point to a child first
                let focusOffset = selectionRange.startOffset;
                let editorPoint = normalizeEditorPoint(focusNode, focusOffset);
                let element = wrap(blockElement.getContentNodes());
                if (getTagOfNode(blockElement.getStartNode()) == 'BR') {
                    // if the block is just BR, apply default format
                    // Otherwise, leave it as it is as we don't want to change the style for existing data
                    applyFormat(element, this.core.defaultFormat);
                }
                // Last restore the selection using the normalized editor point
                this.selectEditorPoint(editorPoint.containerNode, editorPoint.offset);
            }
        }
        this.stopPropagation(event);
    };

    private selectEditorPoint(container: Node, offset: number): boolean {
        if (!this.contains(container)) {
            return false;
        }

        let range = this.core.document.createRange();
        if (container.nodeType == NodeType.Text && offset <= container.nodeValue.length) {
            range.setStart(container, offset);
        } else if (offset == NodeBoundary.Begin) {
            range.setStartBefore(container);
        } else {
            range.setStartAfter(container);
        }

        range.collapse(true /* toStart */);

        return this.core.api.updateSelection(this.core, range);
    }

    private ensureInitialContent() {
        let firstBlock = getFirstBlockElement(this.core.contentDiv);
        let defaultFormatBlockElement: HTMLElement;

        if (!firstBlock) {
            // No first block, let's create one
            let nodes = fromHtml('<div><br></div>', this.core.document);
            defaultFormatBlockElement = this.core.contentDiv.appendChild(nodes[0]) as HTMLElement;
        } else if (firstBlock instanceof NodeBlockElement) {
            // There is a first block and it is a Node (P, DIV etc.) block
            // Check if it is empty block and apply default format if so
            // TODO: what about first block contains just an image? testing getTextContent won't tell that
            // Probably it is no harm since apply default format on an image block won't change anything for the image
            if (firstBlock.getTextContent() == '') {
                defaultFormatBlockElement = firstBlock.getStartNode() as HTMLElement;
            }
        }

        if (defaultFormatBlockElement) {
            applyFormat(defaultFormatBlockElement, this.core.defaultFormat);
        }
    }

    private startIdleLoop(interval: number) {
        let win = this.core.contentDiv.ownerDocument.defaultView || window;
        this.core.idleLoopHandle = win.setInterval(() => {
            if (this.core.ignoreIdleEvent) {
                this.core.ignoreIdleEvent = false;
            } else {
                this.core.api.triggerEvent(
                    this.core,
                    {
                        eventType: PluginEventType.Idle,
                    },
                    true /*broadcast*/
                );
            }
        }, interval);
    }

    //#endregion
}
