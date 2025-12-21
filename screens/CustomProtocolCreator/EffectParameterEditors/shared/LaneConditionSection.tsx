/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { CollapsibleSection } from './CollapsibleSection';

export interface LaneCondition {
    type?: 'none' | 'opponent_higher_value' | 'min_cards';
    count?: number;
}

interface LaneConditionSectionProps {
    condition: LaneCondition | undefined;
    onChange: (condition: LaneCondition | undefined) => void;
    /** Show select lane first option */
    showSelectLane?: boolean;
    /** Select lane first value */
    selectLane?: boolean;
    /** Callback for select lane change */
    onSelectLaneChange?: (value: boolean) => void;
    /** Show min cards in lane option */
    showMinCards?: boolean;
    /** Min cards value */
    minCardsInLane?: number;
    /** Callback for min cards change */
    onMinCardsChange?: (value: number) => void;
}

export const LaneConditionSection: React.FC<LaneConditionSectionProps> = ({
    condition,
    onChange,
    showSelectLane = false,
    selectLane = false,
    onSelectLaneChange,
    showMinCards = false,
    minCardsInLane = 0,
    onMinCardsChange
}) => {
    const currentType = condition?.type || 'none';

    // Check if any condition is configured (for forceOpen)
    const hasConfig = currentType !== 'none' || selectLane || minCardsInLane > 0;

    const handleTypeChange = (type: string) => {
        if (type === 'none') {
            onChange(undefined);
        } else {
            onChange({
                ...condition,
                type: type as LaneCondition['type']
            });
        }
    };

    return (
        <CollapsibleSection title="Lane Restrictions" forceOpen={hasConfig}>
            <div className="filter-row">
                <label>
                    Lane Condition
                    <select
                        value={currentType}
                        onChange={e => handleTypeChange(e.target.value)}
                    >
                        <option value="none">None</option>
                        <option value="opponent_higher_value">Only lanes where opponent has higher value</option>
                        {showMinCards && (
                            <option value="min_cards">Minimum cards in lane</option>
                        )}
                    </select>
                </label>

                {currentType === 'min_cards' && showMinCards && onMinCardsChange && (
                    <label>
                        Min Cards
                        <select
                            value={minCardsInLane}
                            onChange={e => onMinCardsChange(parseInt(e.target.value))}
                        >
                            <option value={0}>0 (any)</option>
                            <option value={4}>4+</option>
                            <option value={6}>6+</option>
                            <option value={8}>8+</option>
                        </select>
                    </label>
                )}

                {showSelectLane && onSelectLaneChange && (
                    <label className="checkbox-label">
                        <input
                            type="checkbox"
                            checked={selectLane}
                            onChange={e => onSelectLaneChange(e.target.checked)}
                        />
                        Select lane first
                        <small className="hint-text">
                            Player chooses lane, then card within that lane
                        </small>
                    </label>
                )}
            </div>
        </CollapsibleSection>
    );
};
