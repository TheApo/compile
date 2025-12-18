/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { addCustomProtocol, loadCustomProtocols, saveCustomProtocols } from './storage';
import anarchyCustomData from '../../custom_protocols/anarchy_custom_protocol.json';
import apathyCustomData from '../../custom_protocols/apathy_custom_protocol.json';
import assimilationCustomData from '../../custom_protocols/assimilation_custom_protocol.json';
import chaosCustomData from '../../custom_protocols/chaos_custom_protocol.json';
import darknessCustomData from '../../custom_protocols/darkness_custom_protocol.json';
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
import loveCustomData from '../../custom_protocols/love_custom_protocol.json';
import psychicCustomData from '../../custom_protocols/psychic_custom_protocol.json';
import smokeCustomData from '../../custom_protocols/smoke_custom_protocol.json';
import clarityCustomData from '../../custom_protocols/clarity_custom_protocol.json';
import corruptionCustomData from '../../custom_protocols/corruption_custom_protocol.json';
import courageCustomData from '../../custom_protocols/courage_custom_protocol.json';
import diversityCustomData from '../../custom_protocols/diversity_custom_protocol.json';
import fearCustomData from '../../custom_protocols/fear_custom_protocol.json';
import iceCustomData from '../../custom_protocols/ice_custom_protocol.json';
import luckCustomData from '../../custom_protocols/luck_custom_protocol.json';
import mirrorCustomData from '../../custom_protocols/mirror_custom_protocol.json';
import peaceCustomData from '../../custom_protocols/peace_custom_protocol.json';
import timeCustomData from '../../custom_protocols/time_custom_protocol.json';
import warCustomData from '../../custom_protocols/war_custom_protocol.json';

/**
 * All default custom protocol data for statistics tracking
 * Each protocol has a 'name' field that represents the protocol name
 */
const allDefaultCustomProtocolData = [
    anarchyCustomData, apathyCustomData, assimilationCustomData, chaosCustomData, darknessCustomData,
    deathCustomData, diversityCustomData, fireCustomData, frostCustomData, hateCustomData,
    waterCustomData, spiritCustomData, gravityCustomData, lifeCustomData,
    lightCustomData, speedCustomData, metalCustomData, plagueCustomData,
    loveCustomData, psychicCustomData, smokeCustomData, clarityCustomData,
    corruptionCustomData, courageCustomData, fearCustomData, iceCustomData,
    luckCustomData, mirrorCustomData, peaceCustomData, timeCustomData, warCustomData
];

/**
 * Export all custom protocol names for statistics tracking
 * Returns the base protocol name (without "_custom" suffix)
 */
export const getCustomProtocolNames = (): string[] => {
    return allDefaultCustomProtocolData.map((data: any) => {
        // Extract base name: "Ice_custom" -> "Ice"
        const name = data.name as string;
        return name.replace(/_custom$/i, '');
    });
};

/**
 * Load default custom protocols (like Anarchy_custom and Apathy_custom for testing)
 * This runs once when the app starts
 */
export const loadDefaultCustomProtocols = (): void => {
    try {
        const existingProtocols = loadCustomProtocols();

        // CLEANUP: Remove old Dark_cust protocol (renamed to Darkness_custom)
        const oldDarkCustIndex = existingProtocols.findIndex(p => p.id === 'dark_cust_v2' || p.name === 'Dark_cust');
        if (oldDarkCustIndex >= 0) {
            existingProtocols.splice(oldDarkCustIndex, 1);
            saveCustomProtocols(existingProtocols);
        }

        addCustomProtocol(anarchyCustomData as any);
        addCustomProtocol(apathyCustomData as any);
        addCustomProtocol(assimilationCustomData as any);
        addCustomProtocol(darknessCustomData as any);
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
        addCustomProtocol(loveCustomData as any);
        addCustomProtocol(psychicCustomData as any);
        addCustomProtocol(smokeCustomData as any);
        addCustomProtocol(clarityCustomData as any);
        addCustomProtocol(corruptionCustomData as any);
        addCustomProtocol(courageCustomData as any);
        addCustomProtocol(diversityCustomData as any);
        addCustomProtocol(fearCustomData as any);
        addCustomProtocol(iceCustomData as any);
        addCustomProtocol(luckCustomData as any);
        addCustomProtocol(mirrorCustomData as any);
        addCustomProtocol(peaceCustomData as any);
        addCustomProtocol(timeCustomData as any);
        addCustomProtocol(warCustomData as any);
    } catch (error) {
        console.error('[Default Protocols] Error loading default protocols:', error);
    }
};
