/**
 * Atlas VTT Design Tokens (TypeScript)
 *
 * Mirrors styles/_tokens.scss for use in PIXI components and JavaScript.
 * Keep these values in sync with the SCSS tokens.
 */
export declare const spacing: {
    readonly xs: 4;
    readonly s: 8;
    readonly m: 12;
    readonly l: 16;
    readonly xl: 24;
    readonly '2xl': 32;
};
export declare const radius: {
    readonly xs: 2;
    readonly s: 4;
    readonly m: 6;
    readonly l: 8;
    readonly xl: 12;
    readonly '2xl': 16;
    readonly full: 9999;
};
export declare const borderWidth: {
    readonly s: 1;
    readonly m: 1.5;
    readonly l: 2;
};
export declare const borderOpacity: {
    readonly subtle: 0.1;
    readonly default: 0.18;
    readonly strong: 0.3;
};
export declare const zIndex: {
    readonly base: 1;
    readonly dropdown: 100;
    readonly sticky: 200;
    readonly overlay: 300;
    readonly modal: 400;
    readonly popover: 500;
    readonly tooltip: 600;
    readonly notification: 700;
    readonly atlasDropdown: 9999;
    readonly atlasModal: 10000;
};
export declare const transition: {
    readonly fast: 100;
    readonly normal: 200;
    readonly slow: 300;
};
export declare const iconSize: {
    readonly xs: 12;
    readonly s: 16;
    readonly m: 20;
    readonly l: 24;
    readonly xl: 32;
};
export declare const buttonHeight: {
    readonly s: 24;
    readonly m: 32;
    readonly l: 40;
};
export declare const inputHeight: {
    readonly s: 28;
    readonly m: 36;
    readonly l: 44;
};
export declare const pinSize: {
    readonly badgeRadius: 20;
    readonly iconSize: 22;
};
export declare const colors: {
    readonly health: {
        readonly healthy: 2278750;
        readonly injured: 15381256;
        readonly critical: 15680580;
        readonly background: 1710618;
    };
    readonly status: {
        readonly success: 1096065;
        readonly warning: 16096779;
        readonly error: 15680580;
        readonly info: 3900150;
    };
    readonly ui: {
        readonly accent: 8141549;
        readonly border: {
            readonly light: 4210752;
            readonly dark: 4210752;
        };
        readonly background: {
            readonly light: 16777215;
            readonly dark: 1973790;
        };
    };
};
export declare const barDimensions: {
    readonly token: {
        readonly width: 64;
        readonly height: 10;
        readonly gap: 2;
        readonly radius: 5;
        readonly offsetY: 8;
        readonly borderWidth: 1.5;
        readonly innerPadding: 2;
    };
    readonly initiative: {
        readonly height: 4;
        readonly radius: 2;
    };
};
/**
 * Convert hex string to number for PIXI
 */
export declare function hexToNumber(hex: string): number;
/**
 * Get RGBA alpha from border opacity token
 */
export declare function getBorderAlpha(opacity: keyof typeof borderOpacity): number;
/**
 * Lighten a hex color by a percentage (for highlights)
 * @param color - Hex color as number (0xRRGGBB)
 * @param amount - Amount to lighten (0-1)
 */
export declare function lightenColor(color: number, amount: number): number;
/**
 * Darken a hex color by a percentage (for shadows)
 * @param color - Hex color as number (0xRRGGBB)
 * @param amount - Amount to darken (0-1)
 */
export declare function darkenColor(color: number, amount: number): number;
/**
 * Get 3D ring colors from a base color
 * Returns highlight, shadow, and specular colors for beveled effect
 */
