import type { Plugin as Plugin_2 } from 'obsidian';

export declare type AnyWidget = CounterWidget | ClockWidget | TimerWidget;

/**
 * Semver of the extension API, independent of Atlas's own version (docs/extension-api.md).
 * Minor: something added. Major: something removed, renamed or tightened. The API report
 * check fails when `api-report/` changes and this does not.
 */
export declare const API_VERSION = "1.18.0";

/** 1.18.0 (`asset-tabs`): what an asset manager tab is told: the collection the asset manager shows. */
export declare interface AssetTabContext {
    collectionId: string;
}

/** 1.18.0 (`asset-tabs`): a tab of an extension's own beside the asset manager's Scenes, Maps, Encounters and Tokens. */
export declare interface AssetTabSpec {
    /** Unique among this extension's asset tabs. */
    id: string;
    /** The tab's name, as given. */
    title: string;
    /** Lucide name, shown before the title. */
    icon: string;
    /**
     * Runs when the tab is shown, with the collection the asset manager shows; the returned disposer runs when the tab is
     * left, the asset manager closes, the tab is removed, or the GM picks another collection, which mounts it again with
     * that collection. Render inside `container`: keys pressed there (all but Escape) stay with it, and a press outside
     * the asset manager closes it. A mount or disposer that throws is logged.
     */
    mount(container: HTMLElement, ctx: AssetTabContext): Disposer;
}

/**
 * `app.plugins.plugins['atlas-vtt'].api`, set (and `atlas-vtt:api-ready` triggered) once Atlas's storage and asset index
 * have settled: loaded, or failed to load. After a failed load the API is still published; `scenes.*` calls then reject.
 */
export declare interface AtlasApi {
    /** Semver of this API, e.g. "1.0.0"; independent of Atlas's own version. */
    readonly version: string;
    /** Whether the running Atlas has `capability`'s namespace; false for a name it does not know. Check it before using a namespace. */
    has(capability: AtlasCapability): boolean;
    /** Scopes everything to `plugin.manifest.id`; registrations are disposed when either plugin unloads. */
    connect(plugin: ConnectingPlugin): AtlasExtension;
}

export declare type AtlasCapability = 'views' | 'presentation' | 'rules' | 'lighting' | 'tokens' | 'dice' | 'lasers' | 'ui' | 'scenes' | 'bundles' | 'settings' | 'storage' | 'remote-view' | 'dice-looks' | 'scene-tabs' | 'asset-tabs' | 'collections' | 'dice-colours' | 'dice-look-choice';

export declare interface AtlasEvents {
    /** Atlas is unloading; everything is disposed after this. */
    unload: () => void;
    /** A view's store holds a map, loaded and drawn; fires once per map load. */
    'map-loaded': (view: ViewInfo) => void;
    /** The view closed; its id is never reused. */
    'map-closed': (viewId: ViewId) => void;
    /** A collection's rules changed (its id), or the asset index finished loading (null: any may have). Read `rules.forMap` again. */
    'rules-changed': (collectionId: string | null) => void;
    /** A setting's value changed; read it again with `settings.get`. */
    'settings-changed': (key: AtlasSettingKey) => void;
    /** Scene records were added, removed, renamed, moved to another collection or pointed at another map. Read `scenes.list` again. */
    'scenes-changed': () => void;
    /**
     * 1.17.0 (`scene-tabs`): a GM map view's tabs (added, closed, moved, renamed) or its active tab changed. Fires once per
     * view per microtask with the view as it is then; never for a remote view. `map-loaded` and `map-closed` are unchanged.
     */
    'tabs-changed': (view: ViewInfo) => void;
    /**
     * 1.18.0 (`collections`): collections were added, removed or renamed, or an extension's data on one changed
     * (`collections.setData`, by any extension). Read `collections.list` or `getData` again.
     */
    'collections-changed': () => void;
}

export declare interface AtlasExtension {
    /** The calling plugin's manifest id. */
    readonly id: string;
    readonly views: ViewsApi;
    readonly presentation: PresentationApi;
    readonly dice: DiceApi;
    readonly lasers: LasersApi;
    readonly lighting: LightingApi;
    readonly tokens: TokensApi;
    readonly rules: RulesApi;
    readonly settings: SettingsApi;
    readonly storage: StorageApi;
    readonly ui: UiApi;
    readonly scenes: ScenesApi;
    readonly bundles: BundlesApi;
    /** Only when `has('remote-view')`. */
    readonly remoteViews?: RemoteViewsApi;
    /** 1.18.0: only when `has('collections')`. */
    readonly collections?: CollectionsApi;
    /**
     * Hears an Atlas event. The listener runs guarded (a throw is logged and the other listeners still run) and is dropped
     * when this extension or Atlas unloads. A listener that is not a function, or an event Atlas does not have, registers
     * nothing and is logged.
     */
    on<E extends keyof AtlasEvents>(event: E, listener: AtlasEvents[E]): Disposer;
}

export declare type AtlasSettingKey = 'laserPointer' | 'diceLook' | 'diceDisplay' | 'playerView';

export declare interface AtlasSettingsView {
    laserPointer: {
        color: string;
        size: number;
    };
    diceLook: {
        colour: string;
        font: string;
    };
    /** Atlas's own `DiceDisplay`. */
    diceDisplay: 'card' | 'fast' | 'full';
    /** The four `localPlayerView` rules a view an extension shows to players follows, as the player window does (`PLAYER_VIEW_RULE_KEYS`). */
    playerView: {
        showGrid: boolean;
        showTokenNameplates: boolean;
        showWidgets: boolean;
        showInitiative: boolean;
    };
}

/** The vault path of the scene's background image; null without one. */
export declare type BackgroundState = string | null;

/** Base interface for any token entity. */
export declare interface BaseToken {
    /** False preserves the whole artwork without an Atlas frame. Defaults to true. */
    showRing?: boolean;
    /** Expendable resources by definition key; see `src/app/resources/`. */
    resources?: Record<string, TokenResourceValue>;
    /** Resource keys whose maximum was set by hand and no longer follows the statblock. */
    overriddenMax?: string[];
    id: string;
    x: number;
    y: number;
    imagePath: string;
    tags?: string[];
    /** Hex colour for the Atlas ring; undefined uses white. */
    ringColor?: string;
    /** Active condition IDs referencing ConditionDefinition.id from collection settings */
    conditions?: string[];
    /** Numbers of active valued conditions, by condition id; a valued condition without one has 1. */
    conditionValues?: Record<string, number>;
    /** Whether the token is hidden (visible to DM but not players) */
    isHidden?: boolean;
    /** The side the token fights on where initiative runs by sides. Read with `sideOf`: unset, a token that sees is the players'. */
    side?: InitiativeSide;
    /** How the token sees when the scene has dynamic lighting. */
    vision?: TokenVision;
    /** Light the token carries; it moves with the token. */
    light?: LightEmission;
    /** Whether to show the nameplate (defaults to false) */
    showNameplate?: boolean;
    /** Rotation in degrees (0-360) */
    rotation?: number;
    /** Token size in logical cells (default 1: 1=1x1, 1.5=2x2, 2=3x3, 2.5=4x4, 3=5x5, etc.) */
    size?: number;
    /** Layer for z-ordering (higher values appear on top) */
    layer?: number;
    /** Instance number for distinguishing multiple tokens of the same type (same imagePath) */
    instanceNumber?: number;
}

export declare interface BundlesApi {
    /**
     * Frontmatter keys removed from notes when a collection is exported and when a bundle is installed (e.g. 'my-plugin-id'):
     * at most 100 non-empty names of at most 200 characters, copied when called; anything else throws.
     * Atlas remembers them per extension id, so they stay stripped when the extension is not loaded (switched off, or
     * Atlas starting first). Unloading the extension does not forget them; calling the returned disposer does, and that
     * is the only thing that does. Handing the disposer to Obsidian's `this.register()` therefore forgets the keys on
     * every unload, which is usually not wanted: keep it for an extension that really stops stripping.
     * The keys of an extension that crashed or was uninstalled stay until something calls the disposer, or
     * `forgetNoteProperties`. Calling the disposer again does nothing.
     */
    stripNoteProperties(keys: readonly string[]): Disposer;
    /** Forgets every note property this extension asked Atlas to strip, also those remembered from earlier sessions. Keys it registered in this session keep stripping until it unloads. */
    forgetNoteProperties(): void;
}

/**
 * How cells are numbered. `column-row` is the hexcrawl convention ("0304" is
 * column 3, row 4); `sequential` counts 1, 2, 3 in reading order; `letter-number`
 * spells the column as a letter and the row as a number (A1, B1, ... AA1).
 */
declare type CellNumberFormat = 'column-row' | 'sequential' | 'letter-number';

/**
 * Character with a name and optional note and statblock links
 */
export declare interface Character extends BaseToken {
    kind: 'character';
    name: string;
    difficulty?: string;
    notePath?: string;
    statblockPath?: string;
    /** Name read from the linked statblock; the nameplate falls back to it when `name` is empty. */
    statblockName?: string | null;
    playerLinked?: boolean;
    playerId?: string;
    playerCharacterId?: string;
}

/** A progress clock (Blades in the Dark): a circle of `segments` wedges the GM fills one by one. */
export declare interface ClockWidget extends Widget {
    type: 'clock';
    segments: number;
    /** Draws the clock as a ring with "filled/segments" in its centre. */
    showCount?: boolean;
}

export declare interface CollectionGridDefaults {
    unitType: GridUnitType;
    unitDistance: number;
    measurementMode: MeasurementMode;
    abstractRangeBands?: RangeBand[];
    /** Unset means `equidistant`. */
    diagonalRule?: DiagonalRule;
    /** Full opening of the cone measurement in degrees. Unset means 90. */
    coneAngle?: number;
}

/** 1.18.0 (`collections`): a collection of the asset index; its id is its folder's name, and so is its name. */
export declare interface CollectionRecord {
    id: string;
    name: string;
}

/**
 * 1.18.0 (`collections`): the collections of the asset index, and an extension's own data on each. The data lives in
 * the asset index alone, as `scenes.setData`'s does: never in the collection's `collection.json`, an export, an
 * install or a copied folder, and it stays on the device that wrote it. A renamed collection keeps it; a deleted one
 * takes it along. Changes: `collections-changed`. Every call rejects when the asset index could not load.
 */
export declare interface CollectionsApi {
    /** Every collection, as frozen copies. */
    list(): Promise<CollectionRecord[]>;
    /** This extension's data on collection `collectionId`: a frozen copy, undefined when unset or there is no such collection. */
    getData(collectionId: string): Promise<Json | undefined>;
    /**
     * Sets or (null) clears it; `value` must be plain JSON and is copied. No edit of the collection: its record, its file
     * and `modifiedAt` stay as they were. Rejects for a collection that does not exist.
     */
    setData(collectionId: string, value: Json | null): Promise<void>;
}

/** 1.18.0 (`collections`): what a collection settings tab is told: the collection whose settings are open. */
export declare interface CollectionSettingsTabContext {
    collectionId: string;
}

/** 1.18.0 (`collections`): a tab of an extension's own in a collection's settings dialog. */
export declare interface CollectionSettingsTabSpec {
    /** Unique among this extension's collection settings tabs. */
    id: string;
    /** The tab's name, as given. */
    title: string;
    /** Lucide name, shown before the title; default `puzzle`. */
    icon?: string;
    /**
     * Runs when the tab is shown; the returned disposer runs when another tab is chosen, the dialog closes or the tab is
     * removed. What it changes is the extension's to save, at once (`collections.setData`): the dialog's Save button saves
     * Atlas's own settings only. Keys pressed inside the container (all but Escape) stay with it. A throw is logged.
     */
    mount(container: HTMLElement, ctx: CollectionSettingsTabContext): Disposer;
}

/** A user-defined token condition, shown as a coloured badge on the token */
export declare interface ConditionDefinition {
    id: string;
    name: string;
    color: string;
    /** Glyph on the badge; the badge shows the name's initial without one */
    icon?: WidgetIcon;
    /** The condition carries a number on each token, like Frightened 2 or Exhaustion 3. */
    valued?: boolean;
    /**
     * What the condition does to sight. `none` says it does nothing, which a built-in condition
     * that changes sight stores when the GM switches its effect off. Read with `conditionEffect`,
     * which also knows the built-in conditions that collections copied before effects existed.
     */
    effect?: ConditionEffect | 'none';
}

/**
 * How a condition changes what is seen:
 * - `blinded`: a token with vision keeps only its senses that work while blinded.
 * - `invisible`: only senses that see invisible tokens perceive the token.
 * - `airborne`: senses that ignore airborne tokens (tremorsense) do not perceive it.
 * - `undetected`: no sense perceives the token.
 *
 * A token with vision is shown to the players whatever its conditions.
 */
declare type ConditionEffect = 'blinded' | 'invisible' | 'airborne' | 'undetected';

/** What `connect` needs of the calling plugin: its id, and where to register its own teardown. */
export declare type ConnectingPlugin = Pick<Plugin_2, 'manifest' | 'register'>;

export declare interface CounterWidget extends Widget {
    type: 'counter';
    min?: number;
    max?: number;
}

/**
 * How a collection rolls dice: the roll a bare bonus is added to, how critical
 * results are recognised and which dice explode.
 */
/**
 * - `natural`: the highest face of a default die is a critical success, a 1 a failure (d20 systems).
 * - `roll-under`: a 1 is a critical success, the highest face a failure (Call of Cthulhu, Cairn).
 * - `doubles`: matching default dice are a critical success (Daggerheart's duality dice).
 * - `high-total`: default dice that add up to their highest total or one below it are a critical success (19 or 20 on Draw Steel's 2d10).
 * - `none`: no critical results.
 */
declare type CritRule = 'natural' | 'roll-under' | 'doubles' | 'high-total' | 'none';

/**
 * The look of what is perceived without light and without colour: `system` as each sense of the
 * game system says (grey, black and white, heat tones), `grey` the grey of darkvision for all of
 * them, `colour` the map's own colours.
 */
declare type DarkSightLook = 'system' | 'grey' | 'colour';

export declare interface DashboardTile {
    /** Unique among this extension's tiles. */
    id: string;
    /** Lucide name */
    icon: string;
    title: string;
    description: string;
    onClick(): void;
}

/**
 * How diagonal steps count on square grids: `equidistant` counts each as 1 (D&D 5e),
 * `alternating` counts them 1, 2, 1, 2 (5-10-5), `euclidean` measures the straight line.
 */
declare type DiagonalRule = 'equidistant' | 'alternating' | 'euclidean';

/** The dice of Atlas's dice tray, in tray order. */
declare const DICE_TYPES: readonly ["d4", "d6", "d8", "d10", "d12", "d20", "d100"];

export declare interface DiceApi {
    /** Rolls and logs the roll; returns a frozen copy of the result. */
    roll(request: DiceRollRequest): DiceRollResult;
    /** Every roll Atlas logs: the dice tray, statblocks, `roll`, `publish`. Listeners receive frozen copies and run guarded. */
    onRolled(listener: (result: DiceRollResult) => void): Disposer;
    /**
     * Adds a roll made elsewhere (another Atlas, physical dice) to the log, toasts and sounds, and to the player window.
     * A roll without `rolledBy` is also thrown with Atlas's 3D dice in every open GM map view, unless `options.throw` is
     * false (1.16.0): then it shows as a result card there, for dice already shown elsewhere (a physical dice plugin's own
     * throw). Throws when `result` is not a roll of plain data with at most 1,000 dice, or `options` is not `{ throw?: boolean }`.
     */
    publish(result: DiceRollResult, options?: DicePublishOptions): void;
    /**
     * Throws `roll`, a result decided elsewhere, with Atlas's 3D dice in the map view `viewId` (a GM map view or a remote
     * view), seeded by the roll's id as Atlas's own throws are, in the user's dice look and speed. Each roll id is thrown
     * once per view: handing it again throws nothing and answers true. False when nothing is thrown: the view is not open
     * or its map not loaded, its dice display is not showing, the user shows dice as result cards, or `roll` is not a roll
     * (not plain data, more than 1,000 dice, or a die whose value is not a whole number from 1 to its `max` included); show
     * the roll your own way then.
     * Where the view cannot draw 3D dice (no WebGL), or the roll does not list all its dice, Atlas shows its result card.
     * It only throws: nothing is logged, `onRolled` hears nothing and the player window shows nothing (`publish` does those).
     * `publish` already throws a roll without `rolledBy` in every open GM map view; use `throw` for a roll you do not
     * publish, or one published with `rolledBy`.
     */
    throw?(viewId: ViewId, roll: DiceRollResult): boolean;
    /**
     * Adds a dice look the GM can choose in Atlas's dice settings, after Atlas's own; only when `has('dice-looks')`. It
     * paints Atlas's 3D dice everywhere they are thrown (the dice tray, the player window, remote views, `throw`). The
     * spec is read once. Throws for an `id` or `name` that is not a non-empty string, an `id` this extension already
     * registered, a `faces` that is not a function, a `body` colour that is not `#rrggbb`, or a `fill` other than `'numeral'` or `'face'`. The GM's choice is kept by
     * full id: while this extension is not loaded, or after the disposer ran, Atlas paints its own look and keeps the choice,
     * so the look returns when it is registered again.
     */
    registerLook?(spec: DiceLookSpec): Disposer;
    /**
     * 1.18.0 (`dice-colours`): colours the GM can roll dice in from Atlas's dice tray, by collection. `provider` is asked
     * with the collection of the map whose tray opens (never for a map outside a collection), guarded, and again after
     * `ui.invalidate()`. When any provider answers colours, the tray shows a colour picker (Atlas's "No colour" first,
     * chosen at first); dice added while a colour is picked carry it as their tag (`color`, `colorName`), in the log,
     * the toasts and Atlas's 3D dice. An entry whose `color` is not `#rrggbb` or whose `name` is not plain text of 1 to
     * 32 characters is left out, so is one equal to an earlier one; the tray shows at most 12. Throws for a provider
     * that is not a function.
     */
    registerColours?(provider: (collectionId: string) => readonly DiceColour[]): Disposer;
    /**
     * 1.18.0 (`dice-look-choice`): chooses the dice look. `lookId` is one of this extension's look ids (as given to
     * `registerLook`), `''` for Atlas's own dice, or null. With `options.collectionId` it is that collection's choice:
     * Atlas throws the rolls of its maps in it, wherever they are shown (the GM's map views, the player window,
     * `dice.throw`), and null clears it, so the collection follows the GM's default again. Without a collection it sets
     * the GM's default, the dice look in Atlas's settings (null: Atlas's own dice). The choice is kept by full id while
     * the look is not registered, and the default's look shows meanwhile. A collection's choice lives in the asset index
     * alone, as `collections.setData` does, and `collections-changed` tells it; the default's, `settings-changed`.
     * Rejects for a collection that does not exist; throws for a malformed `lookId` or options.
     */
    useLook?(lookId: string | null, options?: {
        collectionId?: string;
    }): Promise<void>;
    /** 1.18.0 (`dice-look-choice`): the dice look a collection's maps throw in (its own choice, else the default), or (no collection) the default; frozen. */
    lookFor?(collectionId?: string | null): Promise<DiceLookInEffect>;
}

/** 1.18.0 (`dice-colours`): a colour dice can be rolled in, as the dice tray offers it: the shape of a die's tag. */
export declare interface DiceColour {
    /** Plain text (no markup), trimmed, at most 32 characters, e.g. "Fire". */
    name: string;
    /** `#rrggbb` */
    color: string;
}

declare type DiceCrit = 'high' | 'low' | null;

/**
 * One face's art: an image (an `ImageBitmap` or a canvas is always readable), or a URL Atlas loads: `data:`, `blob:`, or
 * `https:` from a server that allows CORS. For a vault file, read it yourself (`app.vault.adapter.readBinary`, then
 * `createImageBitmap(new Blob([data]))` or `URL.createObjectURL`): an `app://` resource URL may not be readable back, and
 * then that face shows Atlas's numeral.
 */
export declare type DiceFaceArt = CanvasImageSource | string;

/**
 * A die type a dice look paints: the six dice bodies, and 100 for the tens die of a d100 (a d10 of its own; its units
 * die is a d10). A d2 and a d3 are thrown as a d6 and wear its faces.
 */
export declare type DiceLookDie = 4 | 6 | 8 | 10 | 12 | 20 | 100;

/** 1.18.0 (`dice-look-choice`): the dice look a collection's maps throw in, or the GM's default. */
export declare interface DiceLookInEffect {
    /** A full look id (`<extension id>:<look id>`), or `''` for Atlas's own dice. */
    lookId: string;
    /** `collection`: the collection chose it (`useLook` with `collectionId`); `default`: it follows the GM's choice. */
    from: 'collection' | 'default';
    /** False while the look's extension has not registered it: Atlas's dice in the GM's colour show meanwhile, and the choice stays. */
    loaded: boolean;
}

/**
 * A dice look an extension adds (`dice.registerLook`). Atlas keeps its own dice, throw, sounds and result: only the
 * faces and the body's colour change. Each face's art goes where Atlas prints the numeral, upright, centred and as large
 * as the face lets it be within Atlas's margin; it is copied at most 256 px on its longer side.
 */
export declare interface DiceLookSpec {
    /** Unique among this extension's looks; Atlas stores the GM's choice as `<extension id>:<id>`. */
    id: string;
    /** Shown in Atlas's dice look settings, as given (at most 64 characters). */
    name: string;
    /**
     * The art of one die type, keyed by face value: 1 to `sides` for d4, d6, d8, d10, d12 and d20 (the d10's 10 is the face
     * Atlas prints "10", read as 0 on a d100's units die), and 0, 10, 20, … 90 for 100, the d100's tens die (0 is "00").
     * A d4 face carries three numbers, at its corners: each value's art is painted at the three corners showing it, turned
     * to point at the corner, and the value at the top tip is the roll. Called once per die type for each registration, all
     * types together, before the look first shows; until every type answered (at most 10 s each), Atlas keeps the look it
     * had. A value left out, an image that fails to load, an image over 8,192 px on a side, an image that cannot be read
     * back (a cross-origin URL without CORS), an answer after 10 s or a call that throws or rejects gets Atlas's own numeral
     * for that face: a look never breaks a die. Runs guarded; failures are logged once per registration.
     */
    faces(sides: DiceLookDie): Promise<Readonly<Record<number, DiceFaceArt>>>;
    /** The relief of each face, by the same keys, grey (dark is pressed in); without it, a face's art is pressed in as its silhouette. */
    bump?(sides: DiceLookDie): Promise<Readonly<Record<number, DiceFaceArt>>>;
    /** `colour` paints the card (`#rrggbb`; left out keeps Atlas's card stock); `ink` colours the numerals Atlas paints where the look has no art. */
    body?: {
        colour?: string;
        ink?: string;
    };
    /** An image of the look for the dice settings: a URL as in `DiceFaceArt`. */
    preview?: string;
    /**
     * 1.18.0: how a face's art is drawn. `'numeral'` (the default, as before 1.18.0): where Atlas prints the numeral, on
     * Atlas's card with its grain and worn rim. `'face'`: the art covers the whole face cell, scaled to fill it and turned
     * as the numeral reads, with no card, numeral or wear of Atlas's, so a pack's own face design shows as it is; its
     * relief is the look's `bump` art, else flat. The chamfers and corners, and faces without art, keep `body.colour`
     * (faces without art also keep Atlas's numeral). Anything else throws.
     */
    fill?: 'numeral' | 'face';
}

/** How `dice.publish` shows a roll (1.16.0). */
export declare interface DicePublishOptions {
    /** False: logged, toasted and shown in the player window as before, but never thrown in 3D (a result card instead). Default true. */
    throw?: boolean;
}

export declare interface DiceRollRequest {
    /** e.g. "2d6+1d20-1"; the tray's selection is turned into this with `diceFormula` from @atlas-vtt/shared/rules. A formula without dice, such as "+3", is added to the rules' default roll. */
    formula: string;
    /** Rolls by the rules of this map's collection (exploding dice, critical rule); Atlas's defaults otherwise. Rules only: the roll shows in every open map's log. */
    mapPath?: string | null;
    /** Someone other than the GM: shown in the log and toasts, shown as a result card rather than thrown on the GM's map, never saved in the map file. */
    rolledBy?: string;
}

export declare interface DiceRollResult {
    id: string;
    timestamp: number;
    formula: string;
    rolls: RolledDie[];
    modifiers: number;
    total: number;
    /** Decided by the collection's critical rule when rolled; missing on rolls logged before rules existed. */
    crit?: DiceCrit;
    /** Dice the roll had beyond those in `rolls`: a log may list only the first of a roll's dice (for example a long roll made by someone other than the GM). */
    unlistedDice?: number;
    /** Atlas's own label for the GM's roller ("Player" in English), stamped on every roll; not who rolled it. */
    player?: string;
    /** Who rolled it when it was someone other than the GM: their name. Atlas shows it in the log and toasts. */
    rolledBy?: string;
    source?: {
        type: 'toolbar' | 'statblock';
        /** Let the roll follow its token's or statblock's current artwork. */
        tokenId?: string;
        statblockPath?: string;
        tokenName?: string;
        tokenImagePath?: string;
        abilityName?: string;
    };
}

export declare interface DiceRules {
    /** One dice group, `NdS`, e.g. `1d20` or `2d12`. A bare `+3` rolls `1d20+3`. */
    defaultRoll: string;
    /** Applies to the default dice of a roll only. */
    crit: CritRule;
    /** Unset: no die explodes. */
    explode?: ExplodeRule;
}

/** How many of each die are picked; a die left out counts 0. */
export declare type DiceSelection = Partial<Record<DieType, number>>;

declare type DieType = typeof DICE_TYPES[number];

/** Removes a registration; calling it again does nothing. */
export declare type Disposer = () => void;

export declare interface DrawingStroke {
    id: string;
    kind: 'drawing';
    timestamp: number;
    type: 'pen' | 'eraser' | 'line' | 'rectangle' | 'circle' | 'icon';
    points: Array<{
        x: number;
        y: number;
    }>;
    color: string;
    /** Line width for strokes, footprint size for `icon` stamps */
    width: number;
    opacity: number;
    /** Key into `MAP_ICON_SVG`; only set when `type` is `'icon'` */
    icon?: string;
}

/**
 * Exploding dice: a die that shows one of its highest faces is rolled again and
 * the new die adds to the roll. Named after no game, so that every system can
 * be set: Savage Worlds is all dice, repeating; Cyberpunk RED the default die,
 * once, with one low face.
 */
declare interface ExplodeRule {
    dice: ExplodeScope;
    /** Whether a die rolled for an explosion can explode in turn. */
    repeats: boolean;
    /** How many of a die's highest faces explode; 1 is the highest face alone. */
    highFaces: number;
    /** How many of its lowest faces roll again and subtract; 0 for none. */
    lowFaces: number;
}

/** Which dice of a roll explode: its default dice, as for criticals, or every die. */
declare type ExplodeScope = 'default' | 'all';

export declare interface FogBrushStroke extends FogOperationBase {
    type: 'brush';
    points: Array<{
        x: number;
        y: number;
    }>;
    brushRadius: number;
}

export declare interface FogLassoFill extends FogOperationBase {
    type: 'lasso';
    points: Array<{
        x: number;
        y: number;
    }>;
}

/** Discriminated union of all fog operation types */
export declare type FogOperation = FogBrushStroke | FogLassoFill | FogRectangleFill;

/**
 * Operation-based fog of war data model.
 *
 * Each user action (brush stroke, lasso fill, rectangle) is stored as an
 * individual record in `state.objects.fog`. Their ordered paint/erase geometry
 * forms shared coverage, drawn by `FogCanvasCompositor` onto a half-resolution
 * HTML Canvas 2D and displayed as a PIXI Sprite.
 */
declare interface FogOperationBase {
    id: string;
    kind: 'fog';
    timestamp: number;
    /** `true` ⇢ erase (destination-out), `false` ⇢ paint (source-over) */
    isErasing: boolean;
    /** Drag offset from original position (default 0) */
    offsetX?: number;
    offsetY?: number;
}

export declare interface FogRectangleFill extends FogOperationBase {
    type: 'rectangle';
    x: number;
    y: number;
    width: number;
    height: number;
}

/** A scene's grid settings as saved in the map file (pure types, shared with extensions via `@atlas-vtt/shared`). */
export declare interface GridState {
    enabled: boolean;
    visible?: boolean;
    snapToGrid?: boolean;
    type?: 'square' | 'hex-horizontal' | 'hex-vertical';
    size: number;
    offsetX: number;
    offsetY: number;
    /** Hex colour of the grid lines. Unset lets the grid pick black or white from the map's brightness. */
    color?: string;
    opacity: number;
    scale?: number;
    mapScale?: number;
    unitType?: 'feet' | 'yards' | 'meters' | 'units';
    unitDistance?: number;
    /**
     * Game units one cell of this scene spans, in place of its collection's (a map drawn at
     * another scale than the rest). Unset follows the collection. `unitDistance` is no override:
     * new scenes are written with a copy of the collection's distance, which then goes stale.
     */
    unitDistanceOverride?: number;
    lineType?: 'solid' | 'dashed' | 'dotted';
    lineWidth?: number;
    measurementType?: 'units' | 'abstract';
    /** Set on new scenes: align the grid to the map image on the first load, then cleared. */
    autoDetect?: boolean;
    /** Numbers every cell of the grid in this format; unset shows no numbers. */
    cellNumbers?: CellNumberFormat;
    /** Opacity of the cell numbers (0 to 1), separate from the grid lines; unset is `DEFAULT_CELL_NUMBER_OPACITY`. */
    cellNumberOpacity?: number;
}

declare type GridUnitType = 'feet' | 'yards' | 'meters' | 'units' | 'custom';

/**
 * Configuration for the initiative tracker
 */
declare interface InitiativeConfig {
    /** Whether to auto-sort entries by initiative value after rolling */
    autoSort: boolean;
}

/**
 * A single entry in the initiative tracker
 */
export declare interface InitiativeEntry {
    /** Unique identifier for this entry */
    id: string;
    /** Reference to the token on the map */
    tokenId: string;
    /** Display name */
    name: string;
    /** Rolled initiative value (after modifiers) */
    initiative: number;
    /** Initiative modifier from statblock/character */
    initiativeModifier: number;
    /** Path to token image for avatar display */
    imagePath: string;
    /** Path to linked statblock note (for CMD+hover preview); `undefined` clears it when patched */
    statblockPath?: string | undefined;
    /** Whether this entry has the current turn */
    isActive: boolean;
    /** Whether this is an NPC (vs player character) */
    isNPC: boolean;
    /** Order in the initiative list (for manual reordering) */
    order: number;
    /** Does not act in the running round (Cairn: a failed DEX save in round 1); cleared when the round ends. */
    sitsOut?: boolean;
}

/**
 * How a collection runs a fight in the initiative tracker.
 *
 * - `turn-order`: every combatant has a number, rolled or typed, and they act from the highest down (D&D, Pathfinder).
 * - `sides`: the players and their opponents act as two blocks, in any order within one; nothing is rolled (Cairn).
 */
declare type InitiativeMode = 'turn-order' | 'sides';

export declare interface InitiativeRules {
    mode: InitiativeMode;
    /** Turn order: the dice a combatant rolls, one group `NdS` such as `1d20`. */
    roll: string;
    /** Sides: the side that acts first in every round. */
    firstSide: InitiativeSide;
}

declare type InitiativeSide = 'players' | 'opponents';

/**
 * Full state for the initiative tracker
 */
export declare interface InitiativeState {
    /** All entries in the initiative order */
    entries: InitiativeEntry[];
    /** Index of the currently active entry */
    currentIndex: number;
    /** Current combat round number */
    round: number;
    /** Whether combat is currently active */
    isActive: boolean;
    /** Configuration for initiative calculation */
    config: InitiativeConfig;
    /**
     * Set while a fight runs by sides: the side that acts first in a round and the one whose
     * turn it is. A fight keeps the mode it was started in, whatever the collection's rules say since.
     */
    sides?: {
        first: InitiativeSide;
        active: InitiativeSide;
    };
}

/** Plain JSON: all an extension may keep on Atlas's records. */
export declare type Json = null | boolean | number | string | Json[] | {
    [key: string]: Json;
};

export declare interface LasersApi {
    /**
     * Hears the GM's own laser in a view: each point of it as it is drawn (world units), and when it is let go.
     * Listeners receive frozen events and run guarded; they end when the view closes. An unknown view, or one
     * without a laser, gives a disposer that does nothing.
     */
    onLocal(viewId: ViewId, listener: (event: LocalLaserEvent) => void): Disposer;
    /**
     * Draws someone else's laser in a view, fading like Atlas's own. Send the newest points as they come:
     * a laser that is not heard from for a second is let go, and lasers are never saved. A message counts
     * its newest 64 points, a gap in time at most 2 seconds, and 32 lasers show at once; the rest is ignored.
     * Does nothing for an unknown view; throws when `laser` is malformed.
     */
    show(viewId: ViewId, laser: RemoteLaser): void;
}

declare type LightAnimation = 'none' | 'torch' | 'candle' | 'pulse' | 'magic';

/** What a light gives off. Distances are game units (feet, metres…), converted at render time. */
declare interface LightEmission {
    /** Radius of full light. */
    bright: number;
    /** Radius where the light ends; at least `bright`. */
    dim: number;
    color: string;
    /** Brightness multiplier, 1 is nominal. */
    intensity: number;
    animation: LightAnimation;
    /** Size of the flame; larger sources cast softer shadows. */
    sourceRadius?: number;
    /** The kind the GM gave the light; lights without one are read by `lightKindOf`. */
    kind?: LightKind;
    /**
     * A source of magical darkness: within its `dim` radius, as far as walls let it, nothing is
     * lit, by the scene's ambient light or by a light of its priority or lower. `bright`, colour,
     * intensity and flicker say nothing for it.
     */
    darkness?: boolean;
    /**
     * Which wins where a light and a darkness meet: the one with the higher priority, the darkness
     * when they are equal. Unset is 0.
     */
    priority?: number;
    /**
     * Width of the beam in degrees (1–359) of a light that shines one way, like a bullseye
     * lantern; unset or 360 shines all around. It faces the `rotation` of the placed light, or of
     * the token that carries it. Read with `coneAngle`.
     */
    angle?: number;
    /**
     * Id of the collection's light preset the light was made from (`LightPresetDefinition.id`); it
     * stays while the light's values are edited. Read with `lightPresetOf`, which also reads lights
     * without one.
     */
    preset?: string;
}

export declare interface LightingApi {
    /**
     * What the GM's player window shows of the view's lit scene, and nothing more. Never throws: an unknown view,
     * or anything Atlas cannot tell yet, is `pending`. Never includes walls, lights, polygons or sight.
     */
    playerVisibility(viewId: ViewId, options?: PlayerVisibilityOptions): PlayerVisibility;
    /**
     * Called when what `playerVisibility` returns may have changed outside the store (sight recomputed, lighting switched,
     * a deferred darkness due, explored memory decoded) and when the scene's lighting or explored memory changes. Runs
     * guarded; ends when the view closes. An unknown view gives a disposer that does nothing.
     */
    watch(viewId: ViewId, listener: () => void): Disposer;
}

/** What a placed light is: it picks the light's marker. `custom` is any other light. */
declare type LightKind = 'candle' | 'torch' | 'lantern' | 'magical' | 'darkness' | 'custom';

/**
 * Senses: the ways a token perceives beyond normal sight, as data a game system defines.
 * Sight rules read these fields and nothing else, so each field says exactly what it decides.
 */
/**
 * How well a point is lit. `magical-dark` is inside a source of magical darkness that no light
 * there outranks (`lightLevelAt`): no ambient light and no such light counts in it.
 */
export declare type LightLevel = 'bright' | 'dim' | 'dark' | 'magical-dark';

/** A light placed on the map. */
export declare interface LightSource {
    id: string;
    kind: 'light';
    x: number;
    y: number;
    emission: LightEmission;
    /** Switched off by the GM. */
    hidden?: boolean;
    /** Where a light with an `angle` shines, in degrees like a token's rotation: 0 faces up on the map, 90 right. Unset is 0. */
    rotation?: number;
    /**
     * A light that follows the ambient light, like a street lamp: it shines only while the scene's
     * ambient light (0–1) is at or below this level. Unset, or 1, it always shines. Read with
     * `ambientGate` and `isLightOn`.
     */
    activeBelowAmbient?: number;
}

/**
 * An area of the map with ambient light of its own: a cave mouth that is dark by day, a lit hall
 * in a dark dungeon. Map geometry the GM draws like walls (undo-tracked, in `objects.lightZones`);
 * later zones lie over earlier ones. Read them with `lightZoneList`.
 */
export declare interface LightZone {
    id: string;
    kind: 'light-zone';
    name?: string;
    /** The zone's corners in world pixels, at least three. Inside them the zone's light counts. */
    polygon: {
        x: number;
        y: number;
    }[];
    /** The ambient light inside, as the scene's: 0 is pitch black, 1 is daylight. */
    ambient: number;
    /** Tint of that light; unset is the scene's. */
    ambientColor?: string;
}

/** The GM's laser reached a point (world units), or was let go. */
export declare type LocalLaserEvent = {
    kind: 'point';
    x: number;
    y: number;
} | {
    kind: 'lift';
};

export declare interface MapRules {
    /** The collection holding the map; null outside a collection. */
    readonly collectionId: string | null;
    readonly gridDefaults: CollectionGridDefaults | null;
    /**
     * The measure tool's settings, with the cone angle the GM measures with in this collection.
     * Outside a collection these are the defaults; the map's own grid units then decide.
     * Combine with `resolveMeasurementSettings(null, snapshot.grid)` from `@atlas-vtt/shared/grid` and this `coneAngle`.
     * These are the collection's: a scene that sets its own distance per cell (`GridState.unitDistanceOverride`) measures
     * with `resolveMeasurementSettings(gridDefaults, snapshot.grid)`, which keeps the collection's as `ruleDistance`.
     */
    readonly measurement: MeasurementSettings;
    readonly resources: readonly ResourceDefinition[];
    readonly conditions: readonly ConditionDefinition[];
    readonly initiative: InitiativeRules;
    readonly dice: DiceRules;
}

declare type MeasurementMode = 'metric' | 'abstract';

export declare interface MeasurementSettings {
    mode: MeasurementMode;
    unitType: GridUnitType;
    /** Game units one cell of this map spans: the scene's own distance per cell where it sets one. */
    unitDistance: number;
    /**
     * Game units one rules square spans: the collection's distance per cell, whatever the scene
     * sets. Distances written in squares (presets, statblocks) are converted with this one.
     */
    ruleDistance: number;
    diagonalRule: DiagonalRule;
    rangeBands: readonly RangeBand[];
    /** Full opening of the cone measurement in degrees. */
    coneAngle: number;
}

export declare interface MenuItem {
    label: string;
    /** Lucide name */
    icon?: string;
    onClick?(): void;
    /** A submenu finds itself again by its label when it is read anew: give the submenus among one menu's items distinct labels. */
    submenu?: MenuItem[];
    checked?: boolean;
    disabled?: boolean;
    /**
     * A plain item that leaves its menu open when chosen, for toggles picked several in a row. An open submenu reads its
     * provider again after `ui.invalidate()`, so its checkmarks follow. An item in the menu itself also leaves it open, but
     * its checkmark stays as it was when the menu opened; put toggles picked several in a row in a submenu. From 1.17.0
     * the scene tab menu's own items (`addSceneTabMenuSection`) follow `ui.invalidate()` too.
     */
    keepOpen?: boolean;
}

/**
 * Note pin object that links to an Obsidian note
 */
export declare interface NotePin {
    id: string;
    kind: 'pin';
    x: number;
    y: number;
    notePath: string;
    icon?: string;
    label?: string;
    gmOnly?: boolean;
    /** Links the note to the grid cell containing (x, y) instead of marking a point; hex grids show that hex, other grids a pin. */
    hex?: boolean;
}

export declare interface PaletteCommand {
    /** Unique within its section. */
    id: string;
    /** Lucide name */
    icon: string;
    label: string;
    keywords?: string[];
    run(): void;
}

export declare interface PaletteSection {
    /** Unique among this extension's sections. */
    id: string;
    title: string;
    /** Read again each time the palette draws and after `invalidate()`. */
    commands(ctx: ViewContext): PaletteCommand[];
}

export declare interface PanelHandle {
    /** Opens the panel in `viewId`, default the active map view; does nothing when there is none. */
    open(viewId?: ViewId): void;
    /** Closes the panel in `viewId`, or in every view when none is given. */
    close(viewId?: ViewId): void;
    /** Opens the panel in `viewId` (default the active map view) when it is closed there, else closes it; does nothing for no view. */
    toggle(viewId?: ViewId): void;
    /** Whether the panel is open in `viewId` (default the active map view); false for no view or once disposed. */
    isOpen(viewId?: ViewId): boolean;
    /** Closes the panel in every view and removes it; calling it again does nothing. */
    dispose(): void;
}

export declare interface PanelSpec {
    /** Unique among this extension's panels. */
    id: string;
    title: string;
    /** Runs when the panel opens in a view; the returned disposer runs when it closes, its view closes, or the panel is disposed. */
    mount(container: HTMLElement, ctx: ViewContext): Disposer;
}

/** How the player window shows a token: seen, outlined only (sensed), or not at all. */
export declare type Perception = 'seen' | 'sensed' | 'unseen';

export declare type PlayerVisibility = 
/** Lighting hides nothing: dynamic lighting off, or the scene unlit. */
    {
    readonly status: 'unlit';
}
/**
* Sight is not worked out for the scene the store holds (loading, a tab switch, no bounds yet, graphics context lost),
* the explored memory the window shows is still being decoded, or the window forgot explored areas its saved mask
* still holds. Fail closed: show players nothing. `watch` fires when it is ready.
*/
| {
    readonly status: 'pending';
} | {
    readonly status: 'ready';
    /**
     * How the window's lighting perceives each token; a token absent here is 'unseen'. By lighting only: a token the
     * GM hid can read 'seen' here, so apply `hidden` and fog yourself, as you do when the answer is `unlit`.
     */
    readonly tokens: Readonly<Record<string, Perception>>;
    /**
     * Where the player window shows the map, cell by cell (1 = shown), explored memory included. Cells are
     * `cellSize` world pixels square from the map's top-left corner, row by row; `shown` is a fresh copy on every call.
     * Conservative: a cell is shown only when the whole cell is, as sampled every 8 px (16 px on maps over 4096 px,
     * doubling past 8192 px), so coarse cells hide more of the edge, never show more.
     */
    readonly darkness: {
        readonly cellSize: number;
        readonly cols: number;
        readonly rows: number;
        readonly shown: Uint8Array;
    };
    /** The window shows explored memory where no token sees. */
    readonly showsExplored: boolean;
};

export declare interface PlayerVisibilityOptions {
    /**
     * The map's long side holds at most this many cells (16–1024, default 384); cells double in size from 8 px until it
     * does. A cell is shown only when all of it is, so fewer, larger cells show less near every edge of sight.
     */
    maxCellsPerSide?: number;
}

export declare interface Point {
    x: number;
    y: number;
}

export declare interface PresentationApi {
    /** The presented scene, also while it is held; null when nothing is presented. A frozen copy. */
    current(): PresentedSceneInfo | null;
    /**
     * Switches `viewId` to `tabId` (default: its active tab), waits for the load, presents. Never throws.
     * False for a closed view, a remote view, or when nothing new is on screen. After a failed load the scene stays registered
     * as presented but held (`current().held === true`), and `presented(scene, true)` follows if its map later loads.
     */
    present(viewId: ViewId, tabId?: string): Promise<boolean>;
    /** Stops presenting, as the GM's Stop presenting does; nothing happens when nothing is presented. */
    stop(): void;
    /** Hears every change of the presented scene; each callback runs guarded, and the listener is dropped when this extension unloads. */
    subscribe(listener: PresentationListener): Disposer;
    /**
     * Adds an audience besides the player window. Its `id`, `label`, `isActive` and `tabBadge` are read once; `isActive`
     * and `tabBadge` are then called on `target` itself, guarded. Adding the same object again changes nothing; another target with an `id`
     * this extension already added, or a malformed one, throws. Removed by the returned disposer or when this extension unloads.
     */
    addTarget(target: PresentationTarget): Disposer;
}

export declare interface PresentationListener {
    /** `resumed`: a held scene is shown again after its tab came back and loaded. */
    presented?(scene: PresentedSceneInfo, resumed: boolean): void;
    /** The GM switched the presented view to another tab; players keep the last scene they saw. */
    held?(scene: PresentedSceneInfo): void;
    /** Nothing is presented: stopped, the view closed, or its tab was closed. `previous.held` is true when the scene was held as it was cleared. */
    cleared?(previous: PresentedSceneInfo): void;
}

/** An audience besides the player window, such as a second screen an extension drives. */
export declare interface PresentationTarget {
    /** Non-empty; unique among this extension's targets. */
    id: string;
    /** Names the audience in the eye's tooltip, e.g. "the second screen". */
    label: string;
    /** While any target is active, the scene tab's eye presents without opening the player window, its tooltip names the target, a presented scene's eye stops presenting, and right-click offers "Open player window". */
    isActive(): boolean;
    /**
     * 1.17.0 (`scene-tabs`): a short mark after a tab's eye ("2 players"), or null for none. At most 24 characters,
     * plain text (trimmed; longer is cut with "…"). A tab with a mark draws its eye as shown, and the mark joins the eye's
     * accessible name; what clicking the eye does is unchanged. Asked only while the target is active (the first active
     * target's non-null mark wins), on render and after `ui.invalidate()`. A throw or a value that is not a string or null
     * shows no mark and is logged once.
     */
    tabBadge?(tab: {
        viewId: ViewId;
        tabId: string;
    }): string | null;
}

export declare interface PresentedSceneInfo {
    /**
     * Names one presentation: the same while it is held and resumed, new for every `present` (and every
     * presentation the GM starts), even of the same tab, and never repeated after Atlas reloads. Compare it to tell a new presentation from the one you know.
     */
    presentationId: string;
    viewId: ViewId;
    tabId: string;
    mapPath: string;
    held: boolean;
}

/** A user-defined abstract distance band for the measurement tool */
declare interface RangeBand {
    name: string;
    maxSquares: number;
}

/** New points of someone else's laser, in their colour. */
export declare interface RemoteLaser {
    from: string;
    color: string;
    points: ReadonlyArray<{
        x: number;
        y: number;
    }>;
    lifted: boolean;
    /** Milliseconds from each point to the one before it in the stroke, when the sender timed them. */
    dt?: ReadonlyArray<number>;
}

/**
 * `MeasurementSettings` as a remote view takes them. `ruleDistance` came with 1.14.0: left out, it is `unitDistance`
 * (they differ only on a scene that sets its own distance per cell).
 */
export declare type RemoteMeasurementInput = Omit<MeasurementSettings, 'ruleDistance'> & {
    ruleDistance?: number;
};

export declare interface RemotePlayerState {
    movableTokenIds: readonly string[];
    measurement: RemoteMeasurementInput;
    /**
     * Stand-ins the GM's projection decided on; players never receive the GM's definitions. Decided per token: a resource
     * definition with `visibleToPlayers: false` draws no bar on that token; it still counts for its downed look (`defeatedWhenSpent`).
     */
    tokenUi: {
        conditions: readonly ConditionDefinition[];
        resources: Readonly<Record<string, readonly ResourceDefinition[]>>;
    };
    initiative: {
        rules: InitiativeRules | null;
        health: Readonly<Record<string, {
            value: number;
            max: number;
        }>>;
    };
}

export declare interface RemoteSceneInput {
    /** Records in Atlas's own types; images by `blob:`, `data:` or `https:` URL, never a path (object URLs are released by the caller after replacing them). */
    background: {
        url: string | null;
        width: number;
        height: number;
    };
    /**
     * Finite numbers, a `size` of at least 4 px and at most 2,000 cells along a side of `background`, offsets within
     * 100,000 px, and a known `type` and `lineType`; anything else throws, so a grid Atlas could never finish drawing is never shown.
     */
    grid: GridState | null;
    objects: SceneSnapshot['objects'];
    /** Token image URL by token id. A token's `notePath` and `statblockPath` are dropped: they name another vault's notes. */
    tokenImages: Readonly<Record<string, string | null>>;
    widgets: SceneSnapshot['widgets'];
    /** The initiative list shows whenever `entries` is non-empty. An entry's `statblockPath` is dropped, and an `imagePath` that is not an image URL shows no avatar. */
    initiative: InitiativeState;
}

export declare interface RemoteStatus {
    title: string;
    /** A short state of the connection, shown after the title, e.g. "Connected"; empty shows none. */
    connection: string;
    /** The colour of the dot before the title: connected, pending (connecting or waiting) or ended. */
    tone: 'connected' | 'pending' | 'ended';
    message: string | null;
    /** A button that runs `run`, guarded; it comes first when `actions` are given too. */
    action?: {
        label: string;
        run(): void;
    };
    /** More buttons after `action`, at most 3 buttons in all with it; a choice is told to `onStatusAction` by its id. */
    actions?: readonly RemoteStatusAction[];
}

/** A button of the status bar that tells `RemoteView.onStatusAction` its `id`. */
export declare interface RemoteStatusAction {
    /** Distinct among the status's actions. */
    id: string;
    label: string;
    /** Lucide name, drawn before the label. */
    icon?: string;
}

/**
 * A remote view: read-only, never saved, with no undo history. Every method does nothing once the view closed, and every
 * listener runs guarded and is dropped when the view closes. `views.*`, `lasers.*`, `lighting.*`, `tokens.snapPoint` and `dice.throw` take its `viewId`;
 * `views.active()` never returns it, and `tokens.move` and `presentation.present` refuse it.
 */
export declare interface RemoteView {
    readonly viewId: ViewId;
    /**
     * Shows the scene: read once and copied, so the caller keeps no reference into Atlas and nothing it changes later gets
     * past the checks, and the snapshot is loaded with the map path `remote:<viewId>`. Null shows an empty, unloaded scene.
     * A record handed again as the same object is not copied again, and one equal by value to the record shown keeps it, so
     * nothing redraws. Fog over a remote view's limits fails closed: more than 2,000 operations, more than 200,000 points
     * in all or 10,000 in one operation, or a brush radius above the map's longer side (100,000 px while its size is 0 × 0).
     * The view then covers the whole map with fog and hides every token, and its status bar says the scene has too much fog
     * to show; nothing throws. A malformed scene, or a record that is not plain data, throws and the scene shown stays.
     */
    setScene(scene: RemoteSceneInput | null): void;
    /** Says what the player may do and how their tokens show; a part equal by value to the one shown is kept, so nothing it draws redraws. */
    setPlayer(state: RemotePlayerState): void;
    /**
     * The status bar at the start of the view's top row; its action runs guarded. Throws when `status` is not a RemoteStatus,
     * also for more than 3 buttons in all (`action` and `actions`), and for an entry of `actions` with an empty id, label or icon,
     * or an id given twice.
     */
    setStatus(status: RemoteStatus): void;
    /** The player chose one of the status's `actions`: its id. Not called for `action`, which runs its own `run`. */
    onStatusAction?(listener: (id: string) => void): Disposer;
    /** The shared log shown in this view's dice log (the first 100 entries, copied); Clear is hidden, Roll again calls `onRoll`. */
    setDiceLog(entries: readonly DiceRollResult[]): void;
    /** Throws one of the player's own rolls with their Atlas dice look; a result card where WebGL is unavailable. Once per result id. */
    throwRoll(result: DiceRollResult): void;
    /**
     * 1.18.0: the dice look the view's rolls are thrown in, for a scene whose collection chose one on the owner's side (its
     * `dice.lookFor(collectionId).lookId`): a full look id, `''` for Atlas's own dice, or null (the default) for the
     * player's own look. A look the player's Atlas has not registered shows the player's own meanwhile. Throws for anything
     * but a string of at most 300 characters or null.
     */
    setDiceLook?(lookId: string | null): void;
    /**
     * Shows `camera`'s world area as large as fits the view, gliding with `animate`, else at once; it keeps showing it through
     * resizes until the player moves the camera. `padded` leaves the margin the remote view's Fit map (Shift+1) leaves around the map (16 screen
     * pixels), for a Fit button of your own. Throws when `camera` is not finite numbers with a size above 0.
     */
    setCamera(camera: ViewCamera, options?: {
        animate?: boolean;
        padded?: boolean;
    }): void;
    /** Ends a drag in progress; the token goes back. */
    cancelDrag(): void;
    /** The player let go of a token they may move, at the snapped drop point. The token goes back until the scene moves it. */
    onTokenDrop(listener: (move: TokenMove) => void): Disposer;
    /** The player moved the camera (`byUser`), or Fit map ran; lets the extension stop following the GM. */
    onCameraMoved(listener: (byUser: boolean) => void): Disposer;
    /**
     * The dice tray, at most the view's `maxDice` (100 by default), or Roll again; return null once sent, or why not (shown in the tray, or as a notice for
     * Roll again). Listeners are asked in the order they were added until one returns null; a roll is sent by one listener at
     * most. With no listener, or when none sent it, the first reason given shows ("The roll could not be sent." for a listener
     * that throws or for none). The tray never rolls locally in a remote view.
     */
    onRoll(listener: (dice: Readonly<Record<string, number>>, modifier: number) => string | null): Disposer;
    /** Called once when the view closes: `close()`, the user closing the tab, the extension or Atlas unloading. */
    onClose(listener: () => void): Disposer;
    /** Closes the view's tab and drops every listener; `onClose` listeners run once. Calling it again does nothing. */
    close(): void;
}

export declare interface RemoteViewsApi {
    /**
     * Opens (or reveals, with `reuse`) a tab of type `atlas-vtt-remote`, owned by the calling extension. `maxDice` is the most
     * dice its tray offers for one roll, a whole number from 1 to 100 (default 100); a revealed view keeps its own title, icon
     * and `maxDice`. The promise rejects on a malformed option and when the view could not open; the call itself never throws.
     */
    open(options: {
        title: string;
        icon?: string;
        reuse?: boolean;
        maxDice?: number;
    }): Promise<RemoteView>;
}

export declare interface ResourceDefinition {
    /** Stable id derived from the name at creation; tokens key their values by it. Never renamed. */
    key: string;
    name: string;
    /** Statblock field (dotted path) that supplies the maximum, e.g. `hp`, `stats.0`, `resources.mana`. */
    field: string;
    direction: ResourceDirection;
    /** `#rrggbb`. */
    color: string;
    /** Spent (0 when draining, max when filling) marks the token defeated. */
    defeatedWhenSpent?: boolean;
    visibleToPlayers: boolean;
    /**
     * The socket it takes on a token, 0 to `MAX_RESOURCES - 1`: two bars, two wheels on the right, two on the left.
     * Without one it takes the first free socket in list order. Read sockets through `slottedResources`.
     */
    slot?: number;
}

/**
 * Expendable token resources (HP, STR, Stress, ammunition…) defined per
 * collection. A token stores one value per definition key.
 */
/**
 * How a resource counts: `drains` starts full and goes down, `fills` starts at 0 and goes up. `static` does not
 * count at all: a value that stays as its statblock gives it, such as an armour class, shown as that one number.
 */
declare type ResourceDirection = 'drains' | 'fills' | 'static';

/** The part of a token that holds resources. */
export declare interface ResourceHolder {
    resources?: Record<string, ResourceValue> | undefined;
    /** Keys whose maximum was set by hand and no longer follows the statblock. */
    overriddenMax?: string[] | undefined;
}

/** `current` counts in the resource's direction: remaining when draining, used when filling. A static value is its `max`. */
export declare interface ResourceValue {
    current: number;
    max: number;
}

declare interface RolledDie {
    /** e.g. `d20`. */
    die: string;
    value: number;
    max: number;
    /** The die subtracts: it belongs to a subtracted term, e.g. the d4 of `2d6-1d4`, or to an explosion downwards. */
    negative?: true;
    /** The die was rolled because the die before it exploded. */
    exploded?: true;
    /** The colour the die was thrown in (`#rrggbb`), e.g. a physical die's, a dice plugin's, or one picked in Atlas's dice tray (`dice.registerColours`); shown with its die, never counted. */
    color?: string;
    /** That colour's name, e.g. "Fire": plain text (no markup) of at most 32 characters, trimmed. A tag that is not well-formed is dropped where a roll enters Atlas, never the roll. */
    colorName?: string;
}

export declare interface RulesApi {
    /** The rules of the collection holding `mapPath`; Atlas's defaults outside a collection. Changes: 'rules-changed'. */
    forMap(mapPath: string | null): MapRules;
}

/**
 * A saved map as `readMap` reads it: its `SavedMapInput` and the background's size, ready to hand to `addToCollection`.
 * Atlas 1.13.0 and later always set the optional fields, normalised as Atlas loads the map, also for a file that lacks
 * them (empty records, the camera at the origin, Atlas's token settings, the tracker closed); an older Atlas leaves
 * them out.
 */
export declare type SavedMap = SavedMapInput & {
    mapSize: {
        width: number;
        height: number;
    };
    tokenSettings?: TokenSettings;
};

/**
 * The parts of a saved map an extension may read and write; everything else in the file (the GM's note, the dice log,
 * explored memory, pinned note previews, the loot roller) stays Atlas's. A field left out is written as Atlas writes a
 * new map: no pins, walls, lights or light zones, the camera at the origin, Atlas's token settings, the tracker closed.
 */
export declare interface SavedMapInput {
    /** As in `SceneSnapshot`. Written with `addToCollection`, image paths are relative to its `images` and become vault paths; `readMap` returns vault paths. */
    background: BackgroundState;
    grid: GridState | null;
    objects: SceneSnapshot['objects'];
    widgets: SceneSnapshot['widgets'];
    initiative: InitiativeState;
    lighting?: SceneLighting;
    /**
     * The note pins, with their note links. A pin's `notePath` is a vault path, never rewritten as an image path; Atlas
     * does not check that the note exists (its loader keeps a pin whose note is missing), so write the notes first.
     * Entries are handed out as saved, also ones Atlas cannot read and skips.
     */
    pins?: Readonly<Record<string, NotePin>>;
    /** The walls, lights and light zones of dynamic lighting. Walls and lights are handed out as saved, also ones Atlas cannot read and skips. */
    walls?: Readonly<Record<string, WallSegment>>;
    lights?: Readonly<Record<string, LightSource>>;
    lightZones?: Readonly<Record<string, LightZone>>;
    /** Where the GM's camera was when the map was saved: finite x and y, a scale above 0. */
    camera?: {
        x: number;
        y: number;
        scale: number;
    };
    /** How the map shows its tokens; Atlas's defaults fill what is not given. */
    tokenSettings?: Partial<TokenSettings>;
    /** Whether the initiative tracker was open; only `true` opens it. */
    initiativeTrackerOpen?: boolean;
}

/** Dynamic lighting of one scene. Saved in the map file, never undo-tracked. */
export declare interface SceneLighting {
    enabled: boolean;
    /** Light everywhere without a source: 0 is pitch black, 1 is daylight. */
    ambient: number;
    /** Tint of the ambient light; unset is neutral white. */
    ambientColor?: string;
    /** Vision tokens limit what players see; unset is on. Off, players see everything the light shows. */
    tokenVision?: boolean;
    /** What tokens saw stays shown as explored; unset is on. Off records nothing and shows no memory, but keeps the saved memory. */
    exploredMemory?: boolean;
    /** Tint of remembered areas in the players' view; unset is neutral. */
    exploredColor?: string;
    /** Fill of never-seen areas in the players' view; unset is black. */
    unexploredColor?: string;
    /** Ambient light (0–1) from which everything in sight counts as lit, dimly at least; below it the scene is dark. Unset is 0.25. */
    litThreshold?: number;
    /** A dragged token sees and shines from where its drag began until it is dropped; unset is off: sight and light follow the drag. */
    sightOnDrop?: boolean;
    /** Ambient light (0–1) from which the scene is brightly lit; unset is 0.75, and it never lies below the lit threshold. */
    brightThreshold?: number;
    /**
     * How the scene draws what a sense with a look without colour (darkvision, infravision) shows in
     * the dark; unset is `system`. Only the picture: what is perceived stays the sense's. Read with `darkSightLookOf`.
     */
    darkSightLook?: DarkSightLook;
    /** Tint of that picture, `#rrggbb`; unset is none. Read with `darkSightTintOf`. */
    darkSightTint?: string;
}

export declare interface SceneRecord {
    id: string;
    name: string;
    collectionId: string;
    mapPath: string | null;
}

export declare interface ScenesApi {
    /** Every scene record in the asset index, as frozen copies; rejects when the index could not load. */
    list(): Promise<SceneRecord[]>;
    /** The scene whose map file is `mapPath`, as a frozen copy; null when none is, also for a `remote:` path. */
    findByMap(mapPath: string): Promise<SceneRecord | null>;
    /** This extension's data on the scene record (`data.extensions[<extension id>]`); a frozen copy, undefined when unset. */
    getData(sceneId: string): Promise<Json | undefined>;
    /** Sets or (null) clears it. Atlas drops it from copies, exports and imports, and leaves it out of fingerprints. */
    setData(sceneId: string, value: Json | null): Promise<void>;
    /** A saved `.atlasmap` file, migrated to the current format, without opening a view; a frozen copy. Null when there is no such file. */
    readMap(mapPath: string): Promise<SavedMap | null>;
    /**
     * Writes the images and the map file into `folder` (inside the collection's folder) and adds the scene record,
     * all under the asset index lock; on failure nothing is left behind. Creates the collection by name when
     * none of that name exists. A path in `images` that is absolute or climbs out of `folder` is refused, and so is a
     * malformed optional field of `map` (a pin without a plain vault `notePath`, a camera that is not finite numbers with
     * a scale above 0, token settings of the wrong types, walls, lights or light zones that are not records), and so is a
     * grid that is not finite numbers with a `size` of at least 4 px, at most 2,000 cells along a side of the background
     * image (when Atlas can read its size), offsets within 100,000 px and a known `type` and `lineType`: the promise rejects before anything is written. A `readMap` result can be handed in as it is.
     */
    addToCollection(input: {
        collection: {
            id: string;
        } | {
            name: string;
        };
        name: string;
        folder: string;
        map: SavedMapInput;
        images: ReadonlyArray<{
            path: string;
            data: ArrayBuffer;
        }>;
    }): Promise<{
        sceneId: string;
        mapPath: string;
    }>;
    /**
     * Replaces the map of a scene this extension added with `addToCollection`, keeping its scene id, name, collection and
     * map path. `map` and `images` are as for `addToCollection`, with images relative to the map file's folder; an image
     * whose name is taken there gets a number. The new images are written, then the map file, under the asset index lock;
     * only then are images removed, and only ones Atlas wrote for this scene (`addToCollection`, earlier `replaceMap`
     * calls) that the new map, another asset, another map and resolved note links no longer use. No other file is ever
     * removed. The GM's note link, dice log, pinned note previews and loot roller are kept; explored memory resets.
     * Rejects, writing nothing, for a scene another extension or the GM made (Atlas notes which extension added a scene,
     * in its index only, for the map it added; a record file that points the scene at another map drops the note), for a
     * scene whose map file is not inside its collection's folder, for a scene open in any map view or its scene tabs (close it first, so no open view saves over
     * the new map; checked again just before the map is written), and for malformed input. A failed write removes the images it wrote and puts the old map back.
     */
    replaceMap?(sceneId: string, input: {
        map: SavedMapInput;
        images: ReadonlyArray<{
            path: string;
            data: ArrayBuffer;
        }>;
    }): Promise<{
        sceneId: string;
        mapPath: string;
    }>;
}

/**
 * The scene in a view's store, frozen to its depth: records are the store's frozen data passed by reference, or a
 * frozen copy of data the store has not frozen yet (right after a map loads).
 */
export declare interface SceneSnapshot {
    readonly viewId: ViewId;
    readonly mapPath: string | null;
    readonly loaded: boolean;
    /**
     * 1.17.0 (`scene-tabs`): the tab whose scene this is, set once `loaded`; null while loading and in remote views.
     * Null too while the view's `activeTabId` already names the next tab but the store still holds the previous one's
     * scene, so a snapshot whose `tabId` names a tab always holds that tab's scene. A snapshot with no tab is no tab's.
     */
    readonly tabId?: string | null;
    /**
     * The loaded background's size in world pixels; 0 × 0 without one.
     * Read when the snapshot is taken: the background may finish drawing after `loaded`; take a fresh snapshot when you need the size.
     */
    readonly mapSize: {
        readonly width: number;
        readonly height: number;
    };
    readonly background: BackgroundState;
    readonly grid: GridState | null;
    readonly objects: {
        readonly tokens: Readonly<Record<string, TokenEntity>>;
        readonly texts: Readonly<Record<string, TextElement>>;
        readonly drawings: Readonly<Record<string, DrawingStroke>>;
        readonly fog: Readonly<Record<string, FogOperation>>;
    };
    readonly widgets: {
        readonly settings: WidgetSettings;
        readonly values: WidgetValues;
    };
    readonly initiative: InitiativeState;
    readonly initiativeTrackerOpen: boolean;
    /** The GM's lighting settings: an extension should never send them to players, only decide by them (with `lighting.playerVisibility`). */
    readonly lighting: SceneLighting;
}

/** 1.17.0 (`scene-tabs`): the scene tab whose eye was right-clicked, read anew each time the menu reads its sections. */
export declare interface SceneTabMenuContext {
    viewId: ViewId;
    tabId: string;
    mapPath: string;
    /** The tab's name, as its tab shows it. */
    name: string;
    /** The view's active tab. */
    active: boolean;
    /** Atlas's presented tab, held or not. */
    presented: boolean;
}

/** 1.17.0 (`scene-tabs`): an extension's part of the menu that right-clicking a scene tab's eye opens. */
export declare interface SceneTabMenuSection {
    /** Shown as a label row at the section's top; plain text, trimmed, at most 40 characters (longer is cut). */
    heading: string;
    /**
     * Read when the menu opens and again after `ui.invalidate()` (and when the view's tabs change) while it is open, so
     * the checkmarks of top-level items follow. Return [] to leave the section out. A throw leaves it out and is logged once.
     */
    items(context: SceneTabMenuContext): MenuItem[];
}

export declare interface SettingsApi {
    /** Read-only; changes arrive as 'settings-changed'. */
    get<K extends AtlasSettingKey>(key: K): AtlasSettingsView[K];
}

export declare interface StorageApi {
    /**
     * `atlas-vtt/.atlas-data/extensions/<extension id>/`, created on first call; a dot folder Obsidian does not
     * index, kept with Atlas's own data. Rejects for an extension id that is not kebab-case.
     */
    folder(): Promise<string>;
}

/**
 * Text element object for map annotations
 */
export declare interface TextElement {
    id: string;
    kind: 'text';
    x: number;
    y: number;
    text: string;
    fontSize: number;
    fontFamily: string;
    color: string;
    backgroundColor?: string;
    padding?: number;
    borderRadius?: number;
    opacity?: number;
    width?: number;
    height?: number;
    align?: 'left' | 'center' | 'right';
    bold?: boolean;
    italic?: boolean;
    /** Rotation in degrees (0-360) */
    rotation?: number;
    /** Text scale multiplier (default 1) */
    scale?: number;
}

export declare interface TimerWidget extends Widget {
    type: 'timer';
    value: number;
    duration: number;
    direction: 'down';
}

/**
 * Simple token without character data
 */
export declare interface Token extends BaseToken {
    kind: 'token';
}

/**
 * Union of token entities
 */
export declare type TokenEntity = Token | Character;

/** What a token menu provider is told: the view, the token, and its kind (`tokenKind`, since `kind` is the view's). */
export declare type TokenMenuContext = ViewContext & {
    tokenId: string;
    tokenKind: TokenEntity['kind'];
};

export declare interface TokenMove {
    tokenId: string;
    x: number;
    y: number;
}

export declare interface TokenMoveOptions {
    /** Snap each token the way `snapPoint` does. Default true. */
    snap?: boolean;
    /**
     * Keep each token's final position on the map, `[0, width] x [0, height]`: when its snapped position is off the map,
     * the nearest snapped position inside it is used. Default true; a map without a size is not clamped. The GM's own
     * drag does not clamp, this is the API's extra.
     */
    clampToMap?: boolean;
    /** Move hidden tokens too. Default false: a hidden token is refused. */
    allowHidden?: boolean;
}

export declare type TokenMoveResult = {
    ok: true;
    positions: Readonly<Record<string, Readonly<Point>>>;
} | {
    ok: false;
    reason: 'not-loaded' | 'unknown-token' | 'hidden' | 'invalid-position';
};

/** A bounded resource value saved on an individual map token. */
declare interface TokenResourceValue {
    current: number;
    max: number;
}

export declare interface TokensApi {
    /**
     * Where a token of `tokenSize` cells dropped at `point` lands, as the GM's drag puts it: a cell centre, or where
     * cells meet for an even footprint, also on a grid that is hidden or switched off; unchanged without a grid, with
     * snapping off, or for an unknown view. Returns a frozen point. Throws when `point` is not finite { x, y } numbers
     * or `tokenSize` is not a number above 0.
     */
    snapPoint(viewId: ViewId, point: Point, tokenSize: number): Readonly<Point>;
    /**
     * Moves tokens as one undo step, like a GM drop: the moved tokens rise to the top of the stack and are no longer held. Checked in this order, and nothing is written when any move
     * fails: the map is loaded and the view is not a remote view, which is read-only (`not-loaded`), every token exists (`unknown-token`), none is hidden unless
     * `allowHidden` (`hidden`), every position is a number within 1e9 of the origin (`invalid-position`, also when snapping would
     * not give one). A token named twice moves to its last position. Throws when `moves` is not a list or `options` is malformed.
     */
    move(viewId: ViewId, moves: readonly TokenMove[], options?: TokenMoveOptions): TokenMoveResult;
}

/** One sense of a token, by the id of its definition. */
declare interface TokenSense {
    id: string;
    /** Game units; unset takes the definition's default, or reaches without limit. */
    range?: number;
}

/** How a map shows its tokens (the map's token settings), saved in its file. */
export declare interface TokenSettings {
    showNameplates: boolean;
    /** Keys of the collection's resources this map does not show to the GM; see `resources/sceneVisibility.ts`. */
    hiddenResources: string[];
    showInstanceBadges: boolean;
    tokenRingSize: number;
}

/** How a token sees. Distances are game units. */
declare interface TokenVision {
    enabled: boolean;
    /** Sight range; unset is unlimited. */
    range?: number;
    /**
     * Radius the token sees without light, drawn desaturated. Written before senses existed and
     * read as one while `senses` is unset (`tokenSenses`); `withSenses` drops it.
     */
    darkvision?: number;
    /**
     * Radius within which the token senses other tokens through walls and darkness; the map stays
     * unseen. Read and dropped like `darkvision`.
     */
    tremorsense?: number;
    /** Width of the vision cone in degrees (1–360), facing the token's rotation; unset sees all around. */
    angle?: number;
    /**
     * What the token perceives beyond normal sight, by the senses of its collection. Once set, even
     * empty, it replaces `darkvision` and `tremorsense`. Read with `tokenSenses`, write with `withSenses`.
     */
    senses?: TokenSense[];
}

export declare interface ToolbarItem {
    /** Unique among this extension's toolbar items. */
    id: string;
    /** Lucide name */
    icon: string;
    label: string;
    /** Shown beside the label in "More tools" only; Atlas binds no hotkey for it. */
    shortcut?: string;
    /**
     * Its place among extensions' items, which sit together after Atlas's dice button: a higher priority sits further
     * left. The bar moves items into "More tools" from its right end, so lower priorities move there first. Default 50.
     */
    priority?: number;
    /** Default ['map']. */
    views?: ReadonlyArray<'map' | 'remote'>;
    /**
     * Whether the item shows in this view, among the `views` it is for; left out, it always shows. Only `true` shows it: a hidden
     * item takes no room in the bar and is not in "More tools". Read again after `ui.invalidate()`. A predicate that throws
     * hides the item, and the failure is logged once.
     */
    isVisible?(ctx: ToolbarItemContext): boolean;
    /** Draws the button as the one in use, and keeps it in the bar rather than in "More tools". */
    isActive?(ctx: ViewContext): boolean;
    /** A dot (`true`) or a count on the button; `null` shows nothing. */
    badge?(ctx: ViewContext): string | number | true | null;
    onClick(ctx: ViewContext): void;
}

/** What `ToolbarItem.isVisible` is told: the view, and for a remote view whether the asking extension opened it. */
export declare interface ToolbarItemContext extends ViewContext {
    /** True in a remote view this extension opened (`remoteViews.open`); false in any other view. */
    ownRemote: boolean;
}

/**
 * Every `add*` reads the fields it needs once and keeps its own frozen copy; methods are called on the object given, so
 * a class instance works. It throws, naming the call and the field, for a malformed item or an id this extension already
 * registered in that slot. What it adds is removed by the returned disposer or when this extension unloads.
 */
export declare interface UiApi {
    /** A button in the map's toolbar, after Atlas's dice; `id`, `icon` and `label` must be non-empty and `onClick` a function. */
    addToolbarItem(item: ToolbarItem): Disposer;
    /** A section of the command palette, after Atlas's own; `id` and `title` must be non-empty and `commands` a function. */
    addPaletteSection(section: PaletteSection): Disposer;
    /** A tile on the dashboard; `id`, `icon` and `title` must be non-empty, `description` a string and `onClick` a function. */
    addDashboardTile(tile: DashboardTile): Disposer;
    /** The map's "More options" menu. */
    addViewMenuItems(provider: (ctx: ViewContext) => MenuItem[]): Disposer;
    /** A token's context menu (GM views only); `tokenKind` lets a provider act on characters only. */
    addTokenMenuItems(provider: (ctx: TokenMenuContext) => MenuItem[]): Disposer;
    /** A floating panel in Atlas's panel style; the extension renders into `container` with its own React. */
    addPanel(panel: PanelSpec): PanelHandle;
    /**
     * 1.17.0 (`scene-tabs`): a section in the menu that right-clicking a scene tab's eye opens (or the context-menu key or
     * Shift+F10 on the eye), after Atlas's own "Open player window": a separator, the `heading` as a label row, then the
     * items. The menu opens whenever it has something to show. `heading` must be non-empty once trimmed and `items` a function.
     */
    addSceneTabMenuSection?(section: SceneTabMenuSection): Disposer;
    /**
     * 1.18.0 (`asset-tabs`): a tab in the asset manager after Atlas's own, which shows what `mount` renders in place of
     * the asset grid. `id`, `title` and `icon` must be non-empty and `mount` a function.
     */
    addAssetTab?(tab: AssetTabSpec): Disposer;
    /**
     * 1.18.0 (`collections`): a tab in a collection's settings dialog, after Atlas's own. `id` and `title` must be
     * non-empty, `icon` non-empty when given, and `mount` a function.
     */
    addCollectionSettingsTab?(tab: CollectionSettingsTabSpec): Disposer;
    /** Re-reads `isVisible`, `isActive`, `badge`, palette commands, menu providers and scene tab menu sections now. */
    invalidate(): void;
}

/** The visible world area of a view: its centre and size in world units. */
export declare interface ViewCamera {
    centerX: number;
    centerY: number;
    width: number;
    height: number;
}

/** What a slot callback is told about the view it is drawn or run in. */
export declare interface ViewContext {
    viewId: ViewId;
    kind: 'map' | 'remote';
    /** True in a view players look at (a remote view, or the player window); false in the GM's own map views. */
    isPlayerView: boolean;
}

/** Names one open map view or remote view (`ViewInfo.viewId`); never reused once the view closed. */
export declare type ViewId = string;

/** A view as `views.list()`, `views.active()` and the `map-loaded` and `map-closed` events describe it; frozen. */
export declare interface ViewInfo {
    viewId: ViewId;
    kind: 'map' | 'remote';
    activeTabId: string | null;
    tabs: ReadonlyArray<{
        tabId: string;
        mapPath: string;
        name: string;
    }>;
    mapPath: string | null;
    /** The store holds `mapPath`'s scene completely: `mapLoaded && !isMapLoading`. */
    loaded: boolean;
}

export declare interface ViewsApi {
    /** Every open map view and remote view, in no set order; `kind` tells them apart. */
    list(): ViewInfo[];
    /** The active Atlas map view; never a remote view. */
    active(): ViewInfo | null;
    /** The scene in the view's store now; null for a view that is not open. */
    snapshot(viewId: ViewId): SceneSnapshot | null;
    /** Called after each store change that replaced one of the snapshot's fields (by reference); from 1.17.0 also when `tabId` changes. */
    subscribe(viewId: ViewId, listener: (snapshot: SceneSnapshot) => void): Disposer;
    /** The view's visible world area now, frozen; null for a view that is not open, has no viewport yet or has no size. */
    camera(viewId: ViewId): ViewCamera | null;
    /** Called after every viewport frame (pixi-viewport `frame-end`), so gestures, moves and resizes alike. */
    watchCamera(viewId: ViewId, listener: (camera: ViewCamera) => void): Disposer;
    /**
     * 1.17.0 (`scene-tabs`): makes a tab of a GM map view active without presenting it.
     * Answers true once that tab's map is loaded. Answers false for a closed, unknown or remote view,
     * an unknown tab, or when another switch overtook this one; also when the view closes before the tab has loaded, or
     * the switch and load take longer than 60 s. Never throws for these.
     * The presented scene holds while the view shows another tab, as on any switch, and resumes when the GM returns to it.
     */
    showTab?(viewId: ViewId, tabId: string): Promise<boolean>;
}

/** What a wall can stop: the sight of tokens, or light. */
declare type WallChannel = 'sight' | 'light';

export declare interface WallSegment {
    id: string;
    kind: 'wall';
    type: WallType;
    p1: {
        x: number;
        y: number;
    };
    p2: {
        x: number;
        y: number;
    };
    direction?: 'left' | 'right' | undefined;
    closed?: boolean;
    /** A door the GM locked: it is closed and its badge does not open it until it is unlocked. A GM aid; light and sight read only `closed`. */
    locked?: boolean;
    /**
     * The one thing the wall stops: a curtain stops sight and lets light through, glass that glows
     * stops light and lets sight through. Unset, it stops both. A door keeps its kind.
     */
    blocks?: WallChannel | undefined;
    /**
     * A hedge, a low wall, a fence: sight and light pass the first limited wall on their way and
     * stop at the second, so what stands at it or right behind it is seen, and nothing through
     * two. A solid wall stops them as ever. With `blocks`, it is limited for that thing alone.
     */
    limited?: boolean | undefined;
    chainId?: string;
}

declare type WallType = 'solid' | 'door' | 'secret-door';

declare interface Widget {
    id: string;
    type: WidgetType;
    label: string;
    icon: WidgetIcon;
    /** Only older Atlas versions set this to false to hide a widget; scenes now switch widgets off with `offWidgets`. */
    visible: boolean;
    visibleToPlayers: boolean;
    value: number;
    color?: string;
    order: number;
    /** Unset means `scene`. */
    scope?: WidgetScope;
}

/**
 * The names of Atlas's widget and condition icons, written out so the extension API names them without their drawings.
 * The drawings (`widgetIcons.ts`) must hold exactly these names, which the compiler checks; changing a drawing changes nothing here.
 */
declare type WidgetIcon = 'heart' | 'heartbeat' | 'health-potion' | 'skull' | 'terror' | 'brain' | 'strength' | 'crossed-swords' | 'sword' | 'shield' | 'guard' | 'magic' | 'spellbook' | 'lightning' | 'flame' | 'snowflake' | 'drop' | 'potion' | 'poison' | 'star' | 'clover' | 'crown' | 'prayer' | 'wings' | 'eye' | 'coins' | 'gem' | 'key' | 'hourglass' | 'stopwatch' | 'campfire' | 'torch' | 'rations' | 'footprints' | 'moon' | 'sun' | 'dragon' | 'wolf' | 'ghost' | 'd20' | 'd6' | 'scroll' | 'blindfold' | 'hearing-disabled' | 'grab' | 'knockout' | 'knocked-out-stars' | 'invisible' | 'frozen-body' | 'stoned-skull' | 'foot-trip' | 'imprisoned' | 'sleepy' | 'tired-eye' | 'hidden' | 'cracked-shield' | 'surprised' | 'meditation' | 'spider-web' | 'run' | 'falling' | 'fog' | 'spiral-bloom' | 'puppet' | 'grim-reaper' | 'life-tap' | 'weight' | 'arm-sling' | 'vomiting' | 'snail' | 'brain-freeze' | 'hood' | 'bleeding-wound' | 'broken-bone' | 'bleeding-eye' | 'brain-tentacle' | 'psychic-waves' | 'screaming';

/**
 * `scene` widgets belong to one map; `collection` widgets appear with the same value
 * in every scene of the map's collection and are stored in its settings.
 */
declare type WidgetScope = 'scene' | 'collection';

export declare interface WidgetSettings {
    widgets: Record<string, AnyWidget>;
    /**
     * Widgets switched off in this scene: its own widgets keep their value while
     * off, and widgets on in every scene of the collection make an exception here.
     */
    offWidgets?: string[];
    globalVisible: boolean;
    position: 'top' | 'bottom' | 'left' | 'right';
    scale: number;
}

declare type WidgetType = 'counter' | 'clock' | 'timer';

/** Widget values by widget id. */
export declare type WidgetValues = Readonly<Record<string, number>>;

export { }
