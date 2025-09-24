/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Player } from '../types';

interface ControlDisplayProps {
  holder: Player | null;
}

export const ControlDisplay: React.FC<ControlDisplayProps> = ({ holder }) => {
  const getHolderClass = () => {
    if (holder === 'player') return 'player-controlled';
    if (holder === 'opponent') return 'opponent-controlled';
    return 'neutral';
  };

  const getHolderText = () => {
    if (holder === 'player') return 'PLAYER CONTROL';
    if (holder === 'opponent') return 'OPPONENT CONTROL';
    return 'CONTROL NEUTRAL';
  };

  return (
    <div className="control-component-container">
      <div className={`control-component ${getHolderClass()}`}>
        {getHolderText()}
      </div>
    </div>
  );
};