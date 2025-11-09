/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CardPattern } from '../../types/customProtocol';

/**
 * Generate CSS background-image style for a given pattern and color
 */
export const getPatternStyle = (pattern: CardPattern, color: string): React.CSSProperties => {
    // Convert hex to HSL for pattern variations
    const hsl = hexToHSL(color);
    const { h, s, l } = hsl;

    switch (pattern) {
        case 'solid':
            return {
                borderColor: color,
            };

        case 'radial':
            return {
                borderColor: color,
                backgroundImage: `radial-gradient(circle at 50% 50%, ${addAlpha(color, 0.25)} 0%, transparent 60%)`,
            };

        case 'dual-radial':
            return {
                borderColor: color,
                backgroundImage: `
                    radial-gradient(at 0% 0%, ${addAlpha(color, 0.2)}, transparent 50%),
                    radial-gradient(at 100% 100%, ${addAlpha(color, 0.2)}, transparent 50%)
                `,
            };

        case 'multi-radial':
            return {
                borderColor: color,
                backgroundImage: `
                    radial-gradient(at 50% 0%, ${addAlpha(color, 0.2)}, transparent 70%),
                    radial-gradient(circle at 20% 30%, ${addAlpha(color, 0.15)}, transparent 40%),
                    radial-gradient(circle at 80% 70%, ${addAlpha(color, 0.2)}, transparent 50%)
                `,
            };

        case 'chaos':
            return {
                borderColor: color,
                backgroundImage: `
                    radial-gradient(at 10% 10%, hsla(${(h + 180) % 360}, 100%, 50%, 0.15), transparent 30%),
                    radial-gradient(at 90% 20%, hsla(${(h + 90) % 360}, 100%, 50%, 0.15), transparent 35%),
                    radial-gradient(at 30% 80%, hsla(${h}, 100%, 50%, 0.15), transparent 40%),
                    radial-gradient(at 70% 60%, hsla(${(h + 270) % 360}, 100%, 50%, 0.1), transparent 25%)
                `,
            };

        case 'grid':
            return {
                borderColor: color,
                backgroundImage: `
                    radial-gradient(circle at 50% 50%, ${addAlpha(color, 0.2)} 0%, transparent 40%),
                    linear-gradient(hsla(0,0%,100%,0.03) 1px, transparent 1px),
                    linear-gradient(90deg, hsla(0,0%,100%,0.03) 1px, transparent 1px)
                `,
                backgroundSize: '100% 100%, 20px 20px, 20px 20px',
            };

        case 'diagonal-lines':
            return {
                borderColor: color,
                backgroundImage: `
                    radial-gradient(at 0% 100%, ${addAlpha(color, 0.25)}, transparent 70%),
                    repeating-linear-gradient(120deg, transparent, transparent 15px, ${addAlpha(color, 0.05)} 15px, ${addAlpha(color, 0.05)} 30px)
                `,
            };

        case 'cross-diagonal':
            return {
                borderColor: color,
                backgroundImage: `
                    radial-gradient(at 50% 50%, ${addAlpha(color, 0.25)} 0%, transparent 50%),
                    repeating-linear-gradient(45deg, transparent, transparent 8px, ${addAlpha(color, 0.08)} 8px, ${addAlpha(color, 0.08)} 16px),
                    repeating-linear-gradient(-45deg, transparent, transparent 8px, ${addAlpha(color, 0.06)} 8px, ${addAlpha(color, 0.06)} 16px)
                `,
            };

        case 'horizontal-lines':
            return {
                borderColor: color,
                backgroundImage: `
                    radial-gradient(at 80% 80%, ${addAlpha(color, 0.1)}, transparent 50%),
                    repeating-linear-gradient(0deg, hsla(0,0%,100%,0.02), hsla(0,0%,100%,0.02) 1px, transparent 1px, transparent 3px)
                `,
            };

        case 'vertical-lines':
            return {
                borderColor: color,
                backgroundImage: `
                    radial-gradient(at 10% 10%, ${addAlpha(color, 0.2)}, transparent 50%),
                    repeating-linear-gradient(175deg, transparent, transparent 1px, ${addAlpha(color, 0.05)} 1px, ${addAlpha(color, 0.05)} 2px)
                `,
            };

        case 'cross':
            return {
                borderColor: color,
                backgroundImage: `
                    linear-gradient(0deg, transparent 40%, ${addAlpha(color, 0.1)} 50%, transparent 60%),
                    linear-gradient(90deg, transparent 48%, ${addAlpha(color, 0.2)} 50%, transparent 52%)
                `,
            };

        case 'hexagons':
            return {
                borderColor: color,
                backgroundImage: `
                    radial-gradient(at 50% 0%, ${addAlpha(color, 0.2)}, transparent 70%),
                    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='49' viewBox='0 0 28 49'%3E%3Cg fill-rule='evenodd'%3E%3Cg id='hexagons' fill='${encodeURIComponent(color)}' fill-opacity='0.05' fill-rule='nonzero'%3E%3Cpath d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.99-7.5L26 15v18.5l-13 7.5L0 33.5V15z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")
                `,
            };

        case 'stripes':
            return {
                borderColor: color,
                backgroundImage: `
                    radial-gradient(at 50% 100%, ${addAlpha(color, 0.25)}, transparent 60%),
                    linear-gradient(135deg, hsla(0,0%,0%,0.1) 23%, transparent 23%, transparent 25%, hsla(0,0%,0%,0.1) 25%, hsla(0,0%,0%,0.1) 27%, transparent 27%, transparent 73%, hsla(0,0%,0%,0.1) 73%, hsla(0,0%,0%,0.1) 75%, transparent 75%, transparent 77%, hsla(0,0%,0%,0.1) 77%)
                `,
            };

        default:
            return { borderColor: color };
    }
};

/**
 * Add alpha channel to hex color
 */
const addAlpha = (hex: string, alpha: number): string => {
    // Remove # if present
    hex = hex.replace('#', '');

    // Convert to RGB
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/**
 * Convert hex to HSL
 */
const hexToHSL = (hex: string): { h: number; s: number; l: number } => {
    hex = hex.replace('#', '');

    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

        switch (max) {
            case r:
                h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
                break;
            case g:
                h = ((b - r) / d + 2) / 6;
                break;
            case b:
                h = ((r - g) / d + 4) / 6;
                break;
        }
    }

    return {
        h: Math.round(h * 360),
        s: Math.round(s * 100),
        l: Math.round(l * 100),
    };
};
