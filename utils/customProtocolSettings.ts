/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const CUSTOM_PROTOCOL_KEY = 'customProtocolsEnabled';

export function isCustomProtocolEnabled(): boolean {
    try {
        const value = localStorage.getItem(CUSTOM_PROTOCOL_KEY);
        return value === 'true';
    } catch {
        return false;
    }
}

export function setCustomProtocolEnabled(enabled: boolean): void {
    try {
        localStorage.setItem(CUSTOM_PROTOCOL_KEY, enabled ? 'true' : 'false');
    } catch {
        // Ignore localStorage errors
    }
}
