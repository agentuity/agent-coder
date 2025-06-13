#!/usr/bin/env node

import { ContinuationHandler } from './cli/continuation-handler.js';
import { generateAgentUrls } from './cli/config-utils.js';

// Test cloud agent tool call flow
async function testCloudAgentFlow() {
  console.log('🧪 Testing Cloud Agent Tool Call Flow...\n');

  // Get dynamic cloud agent URL
  const { cloudCoderUrl } = await generateAgentUrls('local');
  const CLOUD_AGENT_URL = cloudCoderUrl;
  const API_KEY = process.env.API_KEY || 'test-key-for-demo';
  const sessionId = `test_${Date.now()}`;

  try {
    // Step 1: Send message to cloud agent
    console.log('📤 Step 1: Sending message to cloud agent...');
    const response = await fetch(CLOUD_AGENT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        Authorization: `Bearer ${API_KEY}`,
        'x-session-id': sessionId,
      },
      body: 'Please list the files in the current directory',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Step 2: Read the streaming response
    console.log('📥 Step 2: Reading streaming response...');
    let fullResponse = '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      fullResponse += chunk;
      process.stdout.write(chunk);
    }

    console.log('\n\n🔍 Step 3: Checking for tool calls...');

    // Step 3: Handle tool calls with continuation handler
    const continuationHandler = new ContinuationHandler();
    const result = await continuationHandler.handleToolCallFlow(
      fullResponse,
      CLOUD_AGENT_URL,
      API_KEY,
      sessionId
    );

    if (result.needsContinuation && result.continuationResponse) {
      console.log('\n📤 Step 4: Streaming continuation response...');

      const contReader = result.continuationResponse.body.getReader();

      while (true) {
        const { done, value } = await contReader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        process.stdout.write(chunk);
      }

      console.log('\n\n✅ Cloud agent tool call flow completed successfully!');
    } else {
      console.log('\n⚠️  No tool calls detected in response');
    }
  } catch (error) {
    console.error('\n❌ Test failed:', error);
  }
}

testCloudAgentFlow();
