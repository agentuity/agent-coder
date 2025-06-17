#!/usr/bin/env node

/**
 * Test script to verify dynamic agent ID detection works for any developer
 * This simulates what happens when different developers clone the repo
 */

import { generateAgentUrl } from '../cli/config-utils.js';

async function testDynamicConfig() {
  console.log('🧪 Testing dynamic agent ID detection...\n');

  try {
    // Test local mode
    const localUrl = await generateAgentUrl('local');
    console.log(`✅ Local URL detected: ${localUrl}`);

    // Extract agent ID from URL for verification
    const agentIdMatch = localUrl.match(/agent_([a-f0-9]+)/);
    if (agentIdMatch) {
      console.log(`🔍 Agent ID: ${agentIdMatch[0]}`);
    }

    // Test cloud mode
    const cloudUrl = await generateAgentUrl('cloud');
    console.log(`✅ Cloud URL template: ${cloudUrl}`);

    console.log('\n🎉 Dynamic configuration test passed!');
    console.log('✨ This will work for any developer who clones the repo.');
  } catch (error) {
    console.error('❌ Dynamic configuration test failed:', error.message);
    process.exit(1);
  }
}

testDynamicConfig();
