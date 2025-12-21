/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { RevealEffectParams } from '../../../types/customProtocol';
import { CollapsibleSection } from './shared';

export const RevealEffectEditor: React.FC<{ params: RevealEffectParams; onChange: (params: RevealEffectParams) => void }> = ({
    params,
    onChange,
}) => {
    const showCount = params.source === 'own_hand' || params.source === 'opponent_hand' ||
                      params.source === 'board' || params.source === 'own_trash';
    const showFollowUp = params.source === 'board';
    const showProtocolFilter = params.source === 'own_hand' && params.action === 'reveal';
    const hasProtocolFilter = (params as any).protocolFilter?.type === 'same_as_source';

    return (
        <div className="param-editor reveal-effect-editor">
            <h4>Reveal/Give Effect</h4>

            {/* Basic Options */}
            <div className="effect-editor-basic">
                <label>
                    Action
                    <select
                        value={params.action}
                        onChange={e => onChange({ ...params, action: e.target.value as any })}
                    >
                        <option value="reveal">Reveal</option>
                        <option value="give">Give</option>
                    </select>
                </label>

                <label>
                    Source
                    <select
                        value={params.source}
                        onChange={e => onChange({ ...params, source: e.target.value as any })}
                    >
                        <option value="own_hand">Your hand</option>
                        <option value="opponent_hand">Opponent's hand</option>
                        <option value="own_deck_top">Top of your deck</option>
                        <option value="own_deck">Your entire deck</option>
                        <option value="own_trash">Your trash</option>
                        <option value="board">Board card</option>
                    </select>
                </label>

                {showCount && (
                    <label>
                        Count
                        <select
                            value={params.count || 1}
                            onChange={e => onChange({ ...params, count: parseInt(e.target.value) })}
                        >
                            {[1, 2, 3, 4, 5, 6].map(n => (
                                <option key={n} value={n}>{n}</option>
                            ))}
                        </select>
                    </label>
                )}

                {showFollowUp && (
                    <label>
                        Follow-up
                        <select
                            value={params.followUpAction || 'none'}
                            onChange={e => {
                                if (e.target.value === 'none') {
                                    const { followUpAction, ...rest } = params;
                                    onChange(rest as RevealEffectParams);
                                } else {
                                    onChange({ ...params, followUpAction: e.target.value as any });
                                }
                            }}
                        >
                            <option value="none">None</option>
                            <option value="flip">Then flip</option>
                            <option value="shift">Then shift</option>
                        </select>
                    </label>
                )}
            </div>

            {/* Special Options */}
            {showProtocolFilter && (
                <CollapsibleSection title="Special Options" forceOpen={hasProtocolFilter}>
                    <label className="checkbox-label">
                        <input
                            type="checkbox"
                            checked={hasProtocolFilter}
                            onChange={e => {
                                if (e.target.checked) {
                                    onChange({ ...params, protocolFilter: { type: 'same_as_source' } } as any);
                                } else {
                                    const { protocolFilter, ...rest } = params as any;
                                    onChange(rest as RevealEffectParams);
                                }
                            }}
                        />
                        Reveal all same-protocol cards (Unity-0)
                    </label>
                    <small className="hint-text">
                        Reveals all cards in hand that match this card's protocol.
                    </small>
                </CollapsibleSection>
            )}
        </div>
    );
};
