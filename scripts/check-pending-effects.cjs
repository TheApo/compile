#!/usr/bin/env node

/**
 * Automated check for queuePendingCustomEffects usage
 *
 * This script ensures that queuePendingCustomEffects() is called before
 * setting actionRequired = null in all critical locations.
 *
 * Run with: npm run check:effects
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

// Files that MUST have queuePendingCustomEffects before actionRequired = null
const CRITICAL_FILES = [
  'logic/game/resolvers/laneResolver.ts',
  'logic/game/resolvers/discardResolver.ts',
  'logic/game/resolvers/cardResolver.ts',
  'logic/game/helpers/actionUtils.ts',
];

// Files that are safe (standard card effects only, no custom protocols)
const SAFE_FILES = [
  'logic/game/resolvers/promptResolver.ts',
  'logic/game/resolvers/miscResolver.ts',
  'logic/game/resolvers/handCardResolver.ts',
  'logic/game/resolvers/choiceResolver.ts',
  'logic/game/aiManager.ts',
];

function checkFile(filePath) {
  const fullPath = path.join(process.cwd(), filePath);

  if (!fs.existsSync(fullPath)) {
    console.log(`${COLORS.yellow}⚠️  File not found: ${filePath}${COLORS.reset}`);
    return { warnings: 1, errors: 0 };
  }

  const content = fs.readFileSync(fullPath, 'utf-8');
  const lines = content.split('\n');

  let errors = 0;
  let warnings = 0;

  // Find all locations where actionRequired = null
  const actionRequiredNullPattern = /actionRequired\s*=\s*null/;
  const queuePendingPattern = /queuePendingCustomEffects/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    if (actionRequiredNullPattern.test(line)) {
      // Check previous 10 lines for queuePendingCustomEffects
      let hasQueue = false;
      const startLine = Math.max(0, i - 10);

      for (let j = startLine; j < i; j++) {
        if (queuePendingPattern.test(lines[j])) {
          hasQueue = true;
          break;
        }
      }

      // Check if it's in an animation callback (safe to skip queue there)
      const contextLines = lines.slice(Math.max(0, i - 3), i).join('\n');
      const isInCallback = /onCompleteCallback|animationRequests/.test(contextLines);

      // Check if it's setting a NEW actionRequired right after (chaining)
      const nextLine = lines[i + 1] || '';
      const isChaining = /actionRequired\s*=\s*\{/.test(nextLine);

      if (!hasQueue && !isInCallback && !isChaining) {
        // Check if file is in SAFE_FILES
        const isSafeFile = SAFE_FILES.some(safe => filePath.includes(safe));

        if (isSafeFile) {
          console.log(`${COLORS.yellow}⚠️  ${filePath}:${lineNum} - actionRequired = null without queue (SAFE: standard card effect)${COLORS.reset}`);
          warnings++;
        } else {
          console.log(`${COLORS.red}❌ ${filePath}:${lineNum} - actionRequired = null without queuePendingCustomEffects!${COLORS.reset}`);
          console.log(`   ${COLORS.red}   Line: ${line.trim()}${COLORS.reset}`);
          errors++;
        }
      } else if (hasQueue) {
        console.log(`${COLORS.green}✅ ${filePath}:${lineNum} - Correctly queues pending effects${COLORS.reset}`);
      }
    }
  }

  return { warnings, errors };
}

function main() {
  console.log(`${COLORS.blue}🔍 Checking for proper queuePendingCustomEffects usage...${COLORS.reset}\n`);

  let totalWarnings = 0;
  let totalErrors = 0;

  // Check critical files
  console.log(`${COLORS.blue}📋 Checking critical files (MUST have queue):${COLORS.reset}`);
  for (const file of CRITICAL_FILES) {
    console.log(`\n${COLORS.blue}Checking ${file}...${COLORS.reset}`);
    const { warnings, errors } = checkFile(file);
    totalWarnings += warnings;
    totalErrors += errors;
  }

  // Check safe files
  console.log(`\n\n${COLORS.blue}📋 Checking safe files (standard effects only):${COLORS.reset}`);
  for (const file of SAFE_FILES) {
    console.log(`\n${COLORS.blue}Checking ${file}...${COLORS.reset}`);
    const { warnings, errors } = checkFile(file);
    totalWarnings += warnings;
    totalErrors += errors;
  }

  // Summary
  console.log(`\n\n${COLORS.blue}═══════════════════════════════════════${COLORS.reset}`);
  console.log(`${COLORS.blue}Summary:${COLORS.reset}`);
  console.log(`${COLORS.green}✅ No errors found${COLORS.reset}: ${totalErrors === 0 ? 'YES' : 'NO'}`);
  console.log(`${COLORS.yellow}⚠️  Warnings${COLORS.reset}: ${totalWarnings}`);
  console.log(`${COLORS.red}❌ Errors${COLORS.reset}: ${totalErrors}`);
  console.log(`${COLORS.blue}═══════════════════════════════════════${COLORS.reset}\n`);

  if (totalErrors > 0) {
    console.log(`${COLORS.red}🚨 FAILED: Found ${totalErrors} location(s) where queuePendingCustomEffects is missing!${COLORS.reset}`);
    console.log(`${COLORS.red}   Please add queuePendingCustomEffects() before actionRequired = null${COLORS.reset}`);
    console.log(`${COLORS.red}   See docs/PENDING_EFFECTS_AUDIT.md for guidance${COLORS.reset}\n`);
    process.exit(1);
  } else {
    console.log(`${COLORS.green}🎉 SUCCESS: All critical locations properly queue pending effects!${COLORS.reset}\n`);
    process.exit(0);
  }
}

main();
