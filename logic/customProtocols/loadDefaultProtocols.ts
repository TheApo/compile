/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { addCustomProtocol, loadCustomProtocols } from './storage';
import anarchyCustomData from '../../custom_protocols/anarchy_custom_protocol.json';
import apathyCustomData from '../../custom_protocols/apathy_custom_protocol.json';
import chaosCustomData from '../../custom_protocols/chaos_custom_protocol.json';
import darkCustData from '../../custom_protocols/dark_cust_protocol.json';
import deathCustomData from '../../custom_protocols/death_custom_protocol.json';
import fireCustomData from '../../custom_protocols/fire_custom_protocol.json';
import waterCustomData from '../../custom_protocols/water_custom_protocol.json';
import spiritCustomData from '../../custom_protocols/spirit_custom_protocol.json';
import gravityCustomData from '../../custom_protocols/gravity_custom_protocol.json';

/**
 * Load default custom protocols (like Anarchy_custom and Apathy_custom for testing)
 * This runs once when the app starts
 */
export const loadDefaultCustomProtocols = (): void => {
    try {
        const existingProtocols = loadCustomProtocols();

        // ALWAYS update Anarchy_custom to latest version (for testing/development)
        console.log('[Default Protocols] Loading/Updating Anarchy_custom protocol...');
        addCustomProtocol(anarchyCustomData as any);
        console.log('[Default Protocols] Anarchy_custom loaded/updated successfully!');

        // ALWAYS update Apathy_custom to latest version (for testing/development)
        console.log('[Default Protocols] Loading/Updating Apathy_custom protocol...');
        addCustomProtocol(apathyCustomData as any);
        console.log('[Default Protocols] Apathy_custom loaded/updated successfully!');

        // ALWAYS update Dark_cust to latest version (for testing/development)
        console.log('[Default Protocols] Loading/Updating Dark_cust protocol...');
        addCustomProtocol(darkCustData as any);
        console.log('[Default Protocols] Dark_cust loaded/updated successfully!');

        // ALWAYS update Death_cust to latest version (for testing/development)
        console.log('[Default Protocols] Loading/Updating Death_cust protocol...');
        addCustomProtocol(deathCustomData as any);
        console.log('[Default Protocols] Death_cust loaded/updated successfully!');

        // ALWAYS update Fire to latest version (for testing/development)
        console.log('[Default Protocols] Loading/Updating Fire protocol...');
        addCustomProtocol(fireCustomData as any);
        console.log('[Default Protocols] Fire loaded/updated successfully!');

        // ALWAYS update Water_custom to latest version (for testing/development)
        console.log('[Default Protocols] Loading/Updating Water_custom protocol...');
        addCustomProtocol(waterCustomData as any);
        console.log('[Default Protocols] Water_custom loaded/updated successfully!');

        // ALWAYS update Spirit_custom to latest version (for testing/development)
        console.log('[Default Protocols] Loading/Updating Spirit_custom protocol...');
        addCustomProtocol(spiritCustomData as any);
        console.log('[Default Protocols] Spirit_custom loaded/updated successfully!');

        // ALWAYS update Chaos_custom to latest version (for testing/development)
        console.log('[Default Protocols] Loading/Updating Chaos_custom protocol...');
        addCustomProtocol(chaosCustomData as any);
        console.log('[Default Protocols] Chaos_custom loaded/updated successfully!');

        // ALWAYS update Gravity_custom to latest version (for testing/development)
        console.log('[Default Protocols] Loading/Updating Gravity_custom protocol...');
        addCustomProtocol(gravityCustomData as any);
        console.log('[Default Protocols] Gravity_custom loaded/updated successfully!');
    } catch (error) {
        console.error('[Default Protocols] Error loading default protocols:', error);
    }
};
