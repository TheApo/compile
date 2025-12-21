/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { DiscardEffectParams } from '../../../types/customProtocol';
import { CollapsibleSection } from './shared';

export const DiscardEffectEditor: React.FC<{ params: DiscardEffectParams; onChange: (params: DiscardEffectParams) => void }> = ({
    params,
    onChange,
}) => {
    const source = params.source || 'hand';
    const countType = params.countType || 'fixed';
    const isVariable = (params as any).variableCount;
    const isHandSource = source === 'hand';
    const hasAdvancedConfig = params.random || params.discardTo === 'opponent_trash' || countType !== 'fixed';

    return (
        <div className="param-editor discard-effect-editor">
            <h4>Discard Effect</h4>

            {/* Basic Options */}
            <div className="effect-editor-basic">
                <label>
                    Source
                    <select
                        value={source}
                        onChange={e => onChange({ ...params, source: e.target.value as any })}
                    >
                        <option value="hand">From Hand</option>
                        <option value="top_deck_own">Top of Own Deck</option>
                        <option value="top_deck_opponent">Top of Opponent's Deck</option>
                        <option value="entire_deck">Entire Deck</option>
                    </select>
                </label>

                {isHandSource && (
                    <>
                        <label>
                            Actor
                            <select
                                value={params.actor}
                                onChange={e => onChange({ ...params, actor: e.target.value as any })}
                            >
                                <option value="self">Self</option>
                                <option value="opponent">Opponent</option>
                                <option value="both">Both</option>
                            </select>
                        </label>

                        <label>
                            Count
                            <select
                                value={isVariable ? 'variable' : (params.count === 'all' ? 'all' : params.count.toString())}
                                onChange={e => {
                                    const val = e.target.value;
                                    if (val === 'variable') {
                                        onChange({ ...params, variableCount: true, count: 1 } as any);
                                    } else if (val === 'all') {
                                        const { variableCount, ...rest } = params as any;
                                        onChange({ ...rest, count: 'all' as any });
                                    } else {
                                        const { variableCount, ...rest } = params as any;
                                        onChange({ ...rest, count: parseInt(val) });
                                    }
                                }}
                            >
                                <option value="1">1</option>
                                <option value="2">2</option>
                                <option value="3">3</option>
                                <option value="all">All (entire hand)</option>
                                <option value="variable">1 or more (variable)</option>
                            </select>
                        </label>
                    </>
                )}
            </div>

            {/* Source Info */}
            {!isHandSource && (
                <small className="hint-text">
                    {source === 'entire_deck'
                        ? 'Discards all cards from deck to trash automatically.'
                        : 'Deck discard is automatic - no player choice needed. The discarded card\'s value is saved for follow-up effects.'}
                </small>
            )}

            {/* Advanced Options - only for hand discard */}
            {isHandSource && (
                <CollapsibleSection title="Advanced Options" forceOpen={hasAdvancedConfig}>
                    <div className="filter-row">
                        <label>
                            Count Type
                            <select
                                value={countType}
                                onChange={e => onChange({ ...params, countType: e.target.value as any })}
                            >
                                <option value="fixed">Fixed Count</option>
                                <option value="equal_to_discarded">Equal to Previously Discarded (Plague-2)</option>
                            </select>
                        </label>

                        {countType === 'equal_to_discarded' && (
                            <label>
                                Offset
                                <input
                                    type="number"
                                    value={params.countOffset || 0}
                                    onChange={e => onChange({ ...params, countOffset: parseInt(e.target.value) })}
                                    min="-5"
                                    max="5"
                                />
                            </label>
                        )}
                    </div>

                    <div className="filter-row">
                        {params.actor === 'opponent' && (
                            <label className="checkbox-label">
                                <input
                                    type="checkbox"
                                    checked={params.random || false}
                                    onChange={e => onChange({ ...params, random: e.target.checked })}
                                />
                                Random selection
                                <small className="hint-text">Opponent can't choose which card</small>
                            </label>
                        )}

                        <label>
                            Discard to
                            <select
                                value={params.discardTo || 'own_trash'}
                                onChange={e => onChange({ ...params, discardTo: e.target.value as 'own_trash' | 'opponent_trash' })}
                            >
                                <option value="own_trash">Own trash</option>
                                <option value="opponent_trash">Opponent's trash</option>
                            </select>
                        </label>
                    </div>
                </CollapsibleSection>
            )}
        </div>
    );
};
