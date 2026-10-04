import { DiceRenderer } from './DiceRenderer';
/**
 * **The pool of stages: why the app survives many throws.**
 *
 * One WebGL context per throw sounds clean and was the most expensive line of
 * the whole application: the browser keeps only a handful at once, and a
 * returned one keeps counting until garbage collection collects it (the
 * measurement is noted at `DiceRenderer.reset`). On a phone the system reloads
 * the page under memory pressure instead of warning.
 *
 * So a document has **one** context (`DiceGpu`), made with its first stage,
 * and stages are borrowed, not built. A stage that leaves clears itself and
 * goes back into the pool; the next one takes it, canvas and all. The pool
 * therefore never grows beyond the number of stages that were ever on screen
 * at the same time (plus those fading out).
 *
 * **And it lives in its own module, not with the stage component**, so a hot
 * reload of the component does not drop it and pile up exactly the contexts
 * this is about. What the module holds is given back when Atlas unloads
 * (`releaseStagePools`) and when a window closes (`releaseStagePool`): a
 * context nobody gives back outlives the plugin that made it.
 *
 * Atlas can show dice in the main window and in a pop-out window. A canvas and
 * its context belong to one document, so there is one pool per document.
 */
/** A stage's canvas and what draws on it. `renderer` is null where there is no WebGL. */
export interface StageLease {
    canvas: HTMLCanvasElement;
    renderer: DiceRenderer | null;
}
/**
 * Whether `doc` can show 3D dice: not where its context could not be made or is
 * lost. Its rolls then show as result cards. The context is made here if no
 * stage made it yet, so a roll before the warm-up finds out too.
 */
export declare function canShowDice(doc: Document): boolean;
export declare function borrowStage(doc: Document): StageLease;
export declare function returnStage(lease: StageLease): void;
/** Gives back the context of `doc`, whose window closed. */
export declare function releaseStagePool(doc: Document): void;
/** Gives back every document's context: Atlas unloads. */
export declare function releaseStagePools(): void;
/**
 * Builds the stages of `doc` ahead, one per quiet moment and none while dice
 * are rolling. `artwork` is what the warm-up frame draws: without the numerals
 * and the card it would put blank faces on the graphics card.
 */
export declare function warmStages(doc: Document, artwork?: Promise<void>): void;
