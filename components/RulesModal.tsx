/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

interface RulesModalProps {
  onClose: () => void;
}

export function RulesModal({ onClose }: RulesModalProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="btn btn-back modal-close-btn" onClick={onClose}>X</button>
        <h2>Game Rules</h2>
        
        <h3>Objective</h3>
        <p>
            You play as an artificial intelligence trying to compile your own 3 protocols. To do this, you play command cards on the protocols over several rounds and execute their effects. If you reach a total value of at least 10 with your own command cards on a protocol and exceed the other person's total value in the same row, you may compile the protocol (turn it over). The first person to compile their 3 protocols wins.
        </p>
        
        <h3>Game Flow</h3>
        <p>The person who chose a protocol first begins. You always play alternately until one person wins. On your turn, handle the following 6 phases in sequence:</p>
        <ol>
            <li>Start</li>
            <li>Check Control</li>
            <li>Check Compile</li>
            <li>Perform Action</li>
            <li>Check Hand Limit</li>
            <li>End</li>
        </ol>

        <h3>Phases in Detail</h3>
        <p><strong>1. Start:</strong> Resolve all visible "Start" effects of your face-up command cards in an order of your choice.</p>
        <p><strong>2. Check Control:</strong> If the total value of your command cards in at least 2 rows is higher than the total value of the other person's command cards in the corresponding rows, take the control card and place it in front of you.</p>
        <p><strong>3. Check Compile:</strong> If you can compile protocols, you must now compile 1 of them. If you can compile multiple protocols, choose 1 of them. If you have compiled, you must skip phase 4 and proceed directly to phase 5.</p>
        <p><strong>Compile Action:</strong> If your cards in a row have a total value of 10 or more AND this is higher than the other person's total value in that row, you must compile your protocol in that row. To do this, both of you remove all cards on your side of that row and place them on your respective discard piles. Then, turn your protocol in that row to the "Compiled" side. If you compile this protocol again later, you draw 1 card from the other person's deck as a reward instead. Use it from now on as if it were your own card.</p>
        <p><strong>4. Perform Action:</strong> Play 1 command card from your hand OR fill your hand. If you have no hand cards, you must perform the "Fill Hand" action. If you have 5 or more hand cards, you may not perform the "Fill Hand" action.</p>
        <p><strong>5. Check Hand Limit:</strong> If you have more than 5 command cards in your hand, you must reduce to your hand limit: discard hand cards until you have only 5.</p>
        <p><strong>6. End:</strong> Resolve all visible "End" effects of your face-up command cards in an order of your choice.</p>
        
        <h3>Glossary</h3>
        <p><strong>Clear Cache:</strong> Discard down to 5 cards in hand.</p>
        <p><strong>Compile:</strong> To delete all cards in a line on both players’ sides and flip a protocol.</p>
        <p><strong>Covered:</strong> A card with another card on top of it is covered.</p>
        <p><strong>Delete:</strong> Move a card from the field to the trash.</p>
        <p><strong>Discard:</strong> Move a card from hand to the owner’s trash.</p>
        <p><strong>Flip:</strong> Change the facing of a card from face-down to face-up, or from face-up to face-down.</p>
        <p><strong>Line:</strong> The area of play through both protocols. The field is made up of 3 lines, each passing through 2 opposing protocols.</p>
        <p><strong>Protocol:</strong> The header that dictates which line you are allowed to play cards into.</p>
        <p><strong>Rearrange:</strong> Change the position of protocols.</p>
        <p><strong>Refresh:</strong> Draw until you have 5 cards in hand.</p>
        <p><strong>Return:</strong> Move a card from the field to its owner’s hand.</p>
        <p><strong>Reveal:</strong> Publicly share information that was hidden or private without effect, then return it to its previous state.</p>
        <p><strong>Shift:</strong> Move a card to another line on the same side of the field.</p>
        <p><strong>Stack:</strong> The cards in a line on one player’s side.</p>
        <p><strong>Trash:</strong> Where discarded and deleted cards go. This is reshuffled to reform your deck when need be.</p>
        <p><strong>Uncovered:</strong> The card at the end of a stack, furthest from the protocol is the uncovered card.</p>
      </div>
    </div>
  );
}