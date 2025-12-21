/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { DrawEffectParams } from '../../../types/customProtocol';
import { CollapsibleSection } from './shared';

interface DrawEffectEditorProps {
    params: DrawEffectParams;
    onChange: (params: DrawEffectParams) => void;
}

export const DrawEffectEditor: React.FC<DrawEffectEditorProps> = ({ params, onChange }) => {
    const countType = params.countType || 'fixed';
    const hasRevealConfig = params.revealFromDrawn !== undefined;
    const hasValueFilter = params.valueFilter !== undefined;
    const hasConditional = params.conditional?.type || params.advancedConditional?.type;
    const hasProtocolFilter = params.protocolFilter?.type === 'same_as_source';

    return (
        <div className="param-editor draw-effect-editor">
            <h4>Draw Effect</h4>

            {/* Basic Options */}
            <div className="effect-editor-basic">
                <label>
                    Count Type
                    <select
                        value={countType}
                        onChange={e => {
                            const ct = e.target.value as any;
                            onChange({
                                ...params,
                                countType: ct,
                                countOffset: ct === 'equal_to_discarded' ? 0 : undefined
                            });
                        }}
                    >
                        <option value="fixed">Fixed</option>
                        <option value="equal_to_card_value">Card Value</option>
                        <option value="equal_to_discarded">Discarded Count</option>
                        <option value="hand_size">Hand Size</option>
                        <option value="count_own_protocol_cards_on_field">Same Protocol (Unity)</option>
                    </select>
                </label>

                {(!countType || countType === 'fixed') && (
                    <label>
                        Count
                        <select
                            value={params.count}
                            onChange={e => onChange({ ...params, count: parseInt(e.target.value) || 1 })}
                        >
                            {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                    </label>
                )}

                {countType === 'equal_to_discarded' && (
                    <label>
                        Offset
                        <input
                            type="number"
                            min={-5}
                            max={5}
                            value={params.countOffset || 0}
                            onChange={e => onChange({ ...params, countOffset: parseInt(e.target.value) || 0 })}
                        />
                    </label>
                )}

                <label>
                    Target
                    <select value={params.target} onChange={e => onChange({ ...params, target: e.target.value as any })}>
                        <option value="self">Self</option>
                        <option value="opponent">Opponent</option>
                    </select>
                </label>

                <label>
                    Source
                    <select value={params.source} onChange={e => onChange({ ...params, source: e.target.value as any })}>
                        <option value="own_deck">Own Deck</option>
                        <option value="opponent_deck">Opponent's Deck</option>
                    </select>
                </label>
            </div>

            {/* Quick Toggles */}
            <div className="effect-editor-basic">
                <label className="checkbox-label">
                    <input
                        type="checkbox"
                        checked={params.preAction === 'refresh'}
                        onChange={e => onChange({ ...params, preAction: e.target.checked ? 'refresh' : undefined })}
                    />
                    Refresh first
                </label>

                <label className="checkbox-label">
                    <input
                        type="checkbox"
                        checked={params.optional || false}
                        onChange={e => onChange({ ...params, optional: e.target.checked })}
                    />
                    Optional
                </label>
            </div>

            {/* Reveal from Drawn Section */}
            <CollapsibleSection title="Reveal from Drawn" forceOpen={hasRevealConfig}>
                <label className="checkbox-label">
                    <input
                        type="checkbox"
                        checked={hasRevealConfig}
                        onChange={e => {
                            if (e.target.checked) {
                                onChange({ ...params, revealFromDrawn: { valueSource: 'stated_number' } });
                            } else {
                                const { revealFromDrawn, ...rest } = params;
                                onChange(rest as DrawEffectParams);
                            }
                        }}
                    />
                    Enable reveal from drawn cards
                </label>

                {hasRevealConfig && (
                    <div className="filter-row">
                        <label>
                            Reveal Count
                            <select
                                value={params.revealFromDrawn?.count === 'all' ? 'all' : (params.revealFromDrawn?.count || 1).toString()}
                                onChange={e => {
                                    const val = e.target.value;
                                    onChange({
                                        ...params,
                                        revealFromDrawn: { ...params.revealFromDrawn, count: val === 'all' ? 'all' : parseInt(val) }
                                    });
                                }}
                            >
                                <option value="1">1</option>
                                <option value="2">2</option>
                                <option value="3">3</option>
                                <option value="all">All</option>
                            </select>
                        </label>

                        <label>
                            Value Filter
                            <select
                                value={params.revealFromDrawn?.valueSource || 'stated_number'}
                                onChange={e => onChange({
                                    ...params,
                                    revealFromDrawn: { ...params.revealFromDrawn, valueSource: e.target.value as any }
                                })}
                            >
                                <option value="stated_number">Stated Number</option>
                                <option value="any">Any</option>
                            </select>
                        </label>

                        <label>
                            After Reveal
                            <select
                                value={params.revealFromDrawn?.thenAction || ''}
                                onChange={e => {
                                    if (e.target.value === '') {
                                        const { thenAction, ...rest } = params.revealFromDrawn!;
                                        onChange({ ...params, revealFromDrawn: rest });
                                    } else {
                                        onChange({ ...params, revealFromDrawn: { ...params.revealFromDrawn, thenAction: e.target.value as any } });
                                    }
                                }}
                            >
                                <option value="">None</option>
                                <option value="may_play">May Play</option>
                            </select>
                        </label>
                    </div>
                )}
            </CollapsibleSection>

            {/* Value Filter Section */}
            <CollapsibleSection title="Draw Specific Value" forceOpen={hasValueFilter}>
                <label className="checkbox-label">
                    <input
                        type="checkbox"
                        checked={hasValueFilter}
                        onChange={e => {
                            if (e.target.checked) {
                                onChange({ ...params, valueFilter: { equals: 1 } });
                            } else {
                                const { valueFilter, ...rest } = params;
                                onChange(rest as DrawEffectParams);
                            }
                        }}
                    />
                    Draw specific value only
                </label>

                {hasValueFilter && (
                    <div className="filter-row">
                        <label>
                            Card Value
                            <select
                                value={params.valueFilter?.equals ?? 1}
                                onChange={e => onChange({ ...params, valueFilter: { equals: parseInt(e.target.value) || 0 } })}
                            >
                                {[0, 1, 2, 3, 4, 5].map(v => <option key={v} value={v}>{v}</option>)}
                            </select>
                        </label>

                        <label className="checkbox-label">
                            <input
                                type="checkbox"
                                checked={params.fromRevealed || false}
                                onChange={e => onChange({ ...params, fromRevealed: e.target.checked })}
                            />
                            From revealed
                        </label>
                    </div>
                )}
            </CollapsibleSection>

            {/* Conditionals Section */}
            <CollapsibleSection title="Conditionals" forceOpen={hasConditional}>
                <div className="filter-row">
                    <label>
                        Basic Conditional
                        <select
                            value={params.conditional?.type || 'none'}
                            onChange={e => {
                                if (e.target.value === 'none') {
                                    const { conditional, ...rest } = params;
                                    onChange(rest as DrawEffectParams);
                                } else {
                                    onChange({ ...params, conditional: { type: e.target.value as any } });
                                }
                            }}
                        >
                            <option value="none">None</option>
                            <option value="count_face_down">1 per face-down</option>
                            <option value="is_covering">If covering</option>
                            <option value="non_matching_protocols">1 per non-matching</option>
                        </select>
                    </label>

                    <label>
                        Advanced
                        <select
                            value={params.advancedConditional?.type || 'none'}
                            onChange={e => {
                                if (e.target.value === 'none') {
                                    const { advancedConditional, ...rest } = params;
                                    onChange(rest as DrawEffectParams);
                                } else if (e.target.value === 'protocol_match') {
                                    onChange({ ...params, advancedConditional: { type: 'protocol_match', protocol: '' } });
                                } else if (e.target.value === 'compile_block') {
                                    onChange({ ...params, advancedConditional: { type: 'compile_block', turnDuration: 1 } });
                                } else {
                                    onChange({ ...params, advancedConditional: { type: e.target.value as any } });
                                }
                            }}
                        >
                            <option value="none">None</option>
                            <option value="protocol_match">Protocol match</option>
                            <option value="compile_block">Block compile</option>
                            <option value="empty_hand">Empty hand</option>
                            <option value="opponent_higher_value_in_lane">Opponent higher</option>
                            <option value="same_protocol_on_field">Same protocol (Unity)</option>
                        </select>
                    </label>
                </div>

                {params.advancedConditional?.type === 'protocol_match' && (
                    <label>
                        Protocol
                        <input
                            type="text"
                            placeholder="e.g., Fire"
                            value={params.advancedConditional.protocol || ''}
                            onChange={e => onChange({
                                ...params,
                                advancedConditional: { ...params.advancedConditional, type: 'protocol_match', protocol: e.target.value }
                            })}
                        />
                    </label>
                )}

                {params.advancedConditional?.type === 'compile_block' && (
                    <label>
                        Block Duration
                        <select
                            value={params.advancedConditional.turnDuration || 1}
                            onChange={e => onChange({
                                ...params,
                                advancedConditional: { ...params.advancedConditional, type: 'compile_block', turnDuration: parseInt(e.target.value) || 1 }
                            })}
                        >
                            <option value={1}>1 turn</option>
                            <option value={2}>2 turns</option>
                            <option value={3}>3 turns</option>
                        </select>
                    </label>
                )}
            </CollapsibleSection>

            {/* Special Options */}
            <CollapsibleSection title="Special Options" forceOpen={hasProtocolFilter}>
                <label className="checkbox-label">
                    <input
                        type="checkbox"
                        checked={hasProtocolFilter}
                        onChange={e => {
                            if (e.target.checked) {
                                onChange({ ...params, protocolFilter: { type: 'same_as_source' } });
                            } else {
                                const { protocolFilter, ...rest } = params;
                                onChange(rest as DrawEffectParams);
                            }
                        }}
                    />
                    Draw all same-protocol cards (Unity-4)
                </label>
            </CollapsibleSection>
        </div>
    );
};
