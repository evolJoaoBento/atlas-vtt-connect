/** DOM operations supplied by the application that owns the map. */
export interface DomHost {
    createCanvas(doc?: Document, size?: {
        width: number;
        height: number;
    }): HTMLCanvasElement;
    createDiv(parent: HTMLElement, cls: string): HTMLDivElement;
    ownerWindow(node: Node): Window;
    activeDocument(): Document;
}
/** Install before loading modules that create DOM resources. Returns a function that restores the previous binding. */
export declare function installDomHost(host: DomHost): () => void;
export declare function getDomHost(): DomHost;
