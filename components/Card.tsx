/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { GameState, PlayedCard, Player } from '../types';

interface CardProps {
  card: PlayedCard;
  onPointerDown?: (event: React.PointerEvent) => void;
  onPointerEnter?: (event: React.PointerEvent) => void;
  onPointerLeave?: (event: React.PointerEvent) => void;
  isFaceUp: boolean;
  faceDownValue?: number;
  isSelected?: boolean;
  isMultiSelected?: boolean;
  isTargetable?: boolean;
  isSourceOfEffect?: boolean;
  style?: React.CSSProperties;
  additionalClassName?: string;
  animationState?: GameState['animationState'];
}

// FIX: Changed component to React.FC to correctly handle React-specific props like 'key'.
export const CardComponent: React.FC<CardProps> = ({ card, onPointerDown, onPointerEnter, onPointerLeave, isFaceUp, faceDownValue = 2, isSelected, isMultiSelected, isTargetable, isSourceOfEffect, style, additionalClassName, animationState }) => {
  
  const RuleBox = ({ content, className }: { content: string, className?: string }) => {
    return <div className={`card-rule-box ${className || ''}`} dangerouslySetInnerHTML={{ __html: content }} />;
  };

  const isEntering = animationState?.type === 'playCard' && animationState.cardId === card.id;
  const enteringClass = isEntering ? `is-entering-${animationState.owner}` : '';

  const isDeleting = animationState?.type === 'deleteCard' && animationState.cardId === card.id;
  const deletingClass = isDeleting ? `is-deleting-${animationState.owner}` : '';

  const owner: Player | undefined = (animationState?.type === 'drawCard' || animationState?.type === 'discardCard') ? animationState.owner : undefined;
  const isDrawing = owner === 'player' && animationState?.type === 'drawCard' && animationState.cardIds.includes(card.id);
  const isDiscarding = owner === 'player' && animationState?.type === 'discardCard' && animationState.cardIds.includes(card.id);

  const classNames = ['card-component'];
  if (card.protocol) {
    classNames.push(`card-protocol-${card.protocol.toLowerCase()}`);
  }
  if (isSelected) classNames.push('selected');
  if (isMultiSelected) classNames.push('multi-selected');
  if (isDiscarding) classNames.push('is-discarding');
  if (isTargetable) classNames.push('is-targetable');
  if (isSourceOfEffect) classNames.push('is-source-of-effect');
  if (enteringClass) classNames.push(enteringClass);
  if (deletingClass) classNames.push(deletingClass);
  if (isDrawing) classNames.push('is-drawing');
  if (additionalClassName) classNames.push(additionalClassName);

  return (
    <div 
      className={classNames.join(' ')} 
      onPointerDown={onPointerDown} 
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      role="button" 
      tabIndex={onPointerDown ? 0 : -1}
      style={style}
    >
      <div className={`card-inner ${!isFaceUp ? 'is-flipped' : ''}`}>
        <div className="card-face card-front">
          <div className="card-header">
            <span className="card-protocol">{card.protocol}</span>
            <span className="card-value">{card.value}</span>
          </div>
          <div className="card-body">
            <RuleBox content={card.top} className="card-rule-top" />
            <RuleBox content={card.middle} className="card-rule-middle" />
            <RuleBox content={card.bottom} className="card-rule-bottom" />
          </div>
        </div>
        <div className="card-face card-back">
          <div className="card-back-value">{faceDownValue}</div>
        </div>
      </div>
    </div>
  );
}