/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { addCustomProtocol, loadCustomProtocols } from './storage';
import anarchyCustomData from '../../custom_protocols/anarchy_custom_protocol.json';
import apathyCustomData from '../../custom_protocols/apathy_custom_protocol.json';
import darkCustData from '../../custom_protocols/dark_cust_protocol.json';
import deathCustomData from '../../custom_protocols/death_custom_protocol.json';
import fireCustomData from '../../custom_protocols/fire_custom_protocol.json';

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
    } catch (error) {
        console.error('[Default Protocols] Error loading default protocols:', error);
    }
};
