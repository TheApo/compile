#!/usr/bin/env node

/**
 * Test all custom protocol JSONs for correctness
 *
 * This script:
 * 1. Loads all custom protocol JSONs
 * 2. Checks if they parse correctly
 * 3. Validates effect structures
 * 4. Reports any issues
 */

const fs = require('fs');
const path = require('path');

const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function checkConditionalChain(effect, depth = 0) {
  const issues = [];
  const indent = '  '.repeat(depth);

  if (effect.conditional) {
    const condType = effect.conditional.type;
    const hasThenEffect = !!effect.conditional.thenEffect;

    if (!hasThenEffect) {
      issues.push(`${indent}❌ Conditional type="${condType}" but no thenEffect!`);
    } else {
      console.log(`${indent}✓ Conditional: type="${condType}"`);

      // Recursively check nested conditionals
      const nestedIssues = checkConditionalChain(effect.conditional.thenEffect, depth + 1);
      issues.push(...nestedIssues);
    }
  }

  return issues;
}

function checkEffectStructure(effect, cardValue, protocolName) {
  const issues = [];

  // Check required fields
  if (!effect.id) issues.push(`  ❌ Missing effect ID`);
  if (!effect.params) issues.push(`  ❌ Missing params`);
  if (!effect.position) issues.push(`  ❌ Missing position`);
  if (!effect.trigger) issues.push(`  ❌ Missing trigger`);

  // Check action
  const action = effect.params?.action;
  if (!action) {
    issues.push(`  ❌ Missing action in params`);
  }

  // Check conditional chains
  if (effect.conditional) {
    const chainIssues = checkConditionalChain(effect);
    issues.push(...chainIssues);
  }

  // Special checks
  if (action === 'shift' && effect.params.count === 1) {
    const hasExcludeSelf = effect.params.targetFilter?.excludeSelf;
    const hasOwner = effect.params.targetFilter?.owner;
    const hasPosition = effect.params.targetFilter?.position;

    // Check if it should be "shift this card"
    if (hasExcludeSelf === false || (hasOwner === 'own' && hasPosition === 'any')) {
      console.log(`  ✓ Shift self detected: ${protocolName}-${cardValue} (position=${hasPosition})`);
    }
  }

  // Check reactiveTriggerActor for reactive triggers
  if (['after_draw', 'after_delete', 'after_shift', 'after_flip'].includes(effect.trigger)) {
    if (!effect.reactiveTriggerActor) {
      issues.push(`  ⚠️  Reactive trigger "${effect.trigger}" without reactiveTriggerActor (defaults to 'self')`);
    } else {
      console.log(`  ✓ Reactive trigger: ${effect.trigger} (actor=${effect.reactiveTriggerActor})`);
    }
  }

  return issues;
}

function testProtocolFile(filePath) {
  const fileName = path.basename(filePath);
  console.log(`\n${COLORS.blue}Testing ${fileName}...${COLORS.reset}`);

  let protocol;
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    protocol = JSON.parse(content);
    console.log(`${COLORS.green}✓ JSON parsed successfully${COLORS.reset}`);
  } catch (err) {
    console.log(`${COLORS.red}❌ JSON parse error: ${err.message}${COLORS.reset}`);
    return { errors: 1, warnings: 0 };
  }

  let errors = 0;
  let warnings = 0;

  // Check protocol structure
  if (!protocol.name) {
    console.log(`${COLORS.red}❌ Missing protocol name${COLORS.reset}`);
    errors++;
  }
  if (!protocol.cards || !Array.isArray(protocol.cards)) {
    console.log(`${COLORS.red}❌ Missing or invalid cards array${COLORS.reset}`);
    errors++;
    return { errors, warnings };
  }

  console.log(`${COLORS.blue}Protocol: ${protocol.name} (${protocol.cards.length} cards)${COLORS.reset}`);

  // Check each card
  for (const card of protocol.cards) {
    console.log(`\n  Card value ${card.value}:`);

    const allEffects = [
      ...(card.topEffects || []),
      ...(card.middleEffects || []),
      ...(card.bottomEffects || [])
    ];

    if (allEffects.length === 0) {
      console.log(`    ${COLORS.yellow}⚠️  No effects${COLORS.reset}`);
      warnings++;
    }

    for (const effect of allEffects) {
      console.log(`    Effect: ${effect.id} (${effect.position}/${effect.trigger}/${effect.params?.action})`);
      const issues = checkEffectStructure(effect, card.value, protocol.name);

      for (const issue of issues) {
        if (issue.includes('❌')) {
          console.log(`${COLORS.red}${issue}${COLORS.reset}`);
          errors++;
        } else if (issue.includes('⚠️')) {
          console.log(`${COLORS.yellow}${issue}${COLORS.reset}`);
          warnings++;
        } else {
          console.log(issue);
        }
      }
    }
  }

  return { errors, warnings };
}

function main() {
  console.log(`${COLORS.blue}🧪 Testing Custom Protocol JSONs...${COLORS.reset}\n`);

  const protocolsDir = path.join(process.cwd(), 'custom_protocols');

  if (!fs.existsSync(protocolsDir)) {
    console.log(`${COLORS.red}❌ custom_protocols directory not found!${COLORS.reset}`);
    process.exit(1);
  }

  const files = fs.readdirSync(protocolsDir)
    .filter(f => f.endsWith('.json'))
    .map(f => path.join(protocolsDir, f));

  console.log(`Found ${files.length} protocol files\n`);

  let totalErrors = 0;
  let totalWarnings = 0;

  for (const file of files) {
    const { errors, warnings } = testProtocolFile(file);
    totalErrors += errors;
    totalWarnings += warnings;
  }

  // Summary
  console.log(`\n\n${COLORS.blue}═══════════════════════════════════════${COLORS.reset}`);
  console.log(`${COLORS.blue}Summary:${COLORS.reset}`);
  console.log(`Files tested: ${files.length}`);
  console.log(`${COLORS.red}❌ Errors${COLORS.reset}: ${totalErrors}`);
  console.log(`${COLORS.yellow}⚠️  Warnings${COLORS.reset}: ${totalWarnings}`);
  console.log(`${COLORS.blue}═══════════════════════════════════════${COLORS.reset}\n`);

  if (totalErrors > 0) {
    console.log(`${COLORS.red}🚨 FAILED: Found ${totalErrors} error(s) in custom protocols!${COLORS.reset}\n`);
    process.exit(1);
  } else if (totalWarnings > 0) {
    console.log(`${COLORS.yellow}⚠️  PASSED with ${totalWarnings} warning(s)${COLORS.reset}\n`);
    process.exit(0);
  } else {
    console.log(`${COLORS.green}🎉 SUCCESS: All custom protocols are valid!${COLORS.reset}\n`);
    process.exit(0);
  }
}

main();
