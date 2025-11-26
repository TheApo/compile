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
import frostCustomData from '../../custom_protocols/frost_custom_protocol.json';
import hateCustomData from '../../custom_protocols/hate_custom_protocol.json';
import waterCustomData from '../../custom_protocols/water_custom_protocol.json';
import spiritCustomData from '../../custom_protocols/spirit_custom_protocol.json';
import gravityCustomData from '../../custom_protocols/gravity_custom_protocol.json';
import lifeCustomData from '../../custom_protocols/life_custom_protocol.json';
import lightCustomData from '../../custom_protocols/light_custom_protocol.json';
import speedCustomData from '../../custom_protocols/speed_custom_protocol.json';
import metalCustomData from '../../custom_protocols/metal_custom_protocol.json';
import plagueCustomData from '../../custom_protocols/plague_custom_protocol.json';

/**
 * Load default custom protocols (like Anarchy_custom and Apathy_custom for testing)
 * This runs once when the app starts
 */
export const loadDefaultCustomProtocols = (): void => {
    try {
        const existingProtocols = loadCustomProtocols();

        addCustomProtocol(anarchyCustomData as any);
        addCustomProtocol(apathyCustomData as any);
        addCustomProtocol(darkCustData as any);
        addCustomProtocol(deathCustomData as any);
        addCustomProtocol(fireCustomData as any);
        addCustomProtocol(waterCustomData as any);
        addCustomProtocol(spiritCustomData as any);
        addCustomProtocol(chaosCustomData as any);
        addCustomProtocol(gravityCustomData as any);
        addCustomProtocol(frostCustomData as any);
        addCustomProtocol(hateCustomData as any);
        addCustomProtocol(lifeCustomData as any);
        addCustomProtocol(lightCustomData as any);
        addCustomProtocol(speedCustomData as any);
        addCustomProtocol(metalCustomData as any);
        addCustomProtocol(plagueCustomData as any);
    } catch (error) {
        console.error('[Default Protocols] Error loading default protocols:', error);
    }
};
