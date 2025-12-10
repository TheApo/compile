/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { getEffectSummary } from '../../../logic/customProtocols/cardFactory';

interface DeleteAllInLaneEffectParams {
    action: 'delete_all_in_lane';
    laneCondition?: {
        type: 'min_cards';
        count: number;
    };
    excludeCurrentLane?: boolean;
}

interface DeleteAllInLaneEffectEditorProps {
    params: DeleteAllInLaneEffectParams;
    onChange: (params: DeleteAllInLaneEffectParams) => void;
}

export const DeleteAllInLaneEffectEditor: React.FC<DeleteAllInLaneEffectEditorProps> = ({ params, onChange }) => {
    const minCards = params.laneCondition?.count || 8;

    return (
        <div className="param-editor delete-all-in-lane-effect-editor">
            <h4>Delete All In Lane Effect Parameters</h4>

            <label>
                Minimum cards in lane
                <select
                    value={minCards}
                    onChange={e => onChange({
                        ...params,
                        laneCondition: { type: 'min_cards', count: parseInt(e.target.value) }
                    })}
                >
                    <option value={0}>No minimum (any lane)</option>
                    <option value={4}>4 or more cards</option>
                    <option value={6}>6 or more cards</option>
                    <option value={8}>8 or more cards (Metal-3)</option>
                    <option value={10}>10 or more cards</option>
                </select>
            </label>

            <label>
                <input
                    type="checkbox"
                    checked={params.excludeCurrentLane !== false}
                    onChange={e => onChange({ ...params, excludeCurrentLane: e.target.checked })}
                />
                Exclude current lane (other lanes only)
            </label>

        </div>
    );
};
