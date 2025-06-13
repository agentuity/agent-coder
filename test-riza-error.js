#!/usr/bin/env node

import { ToolProxy } from './cli/tool-proxy.js';

// Test RIZA API key error handling
async function testRizaErrorHandling() {
  console.log('🧪 Testing RIZA API Key Error Handling...\n');
  
  // Temporarily remove RIZA_API_KEY
  const originalKey = process.env.RIZA_API_KEY;
  delete process.env.RIZA_API_KEY;
  
  try {
    const toolProxy = new ToolProxy();
    
    const toolCall = {
      id: 'test-123',
      type: 'tool_call',
      toolName: 'execute_code',
      parameters: {
        language: 'python',
        code: 'print("hello world")'
      }
    };
    
    console.log('📤 Executing code without RIZA_API_KEY...');
    const result = await toolProxy.executeToolCall(toolCall);
    
    console.log('📥 Result:');
    console.log(`Success: ${result.success}`);
    if (result.success) {
      console.log(`Output: ${result.result}`);
    } else {
      console.log(`Error: ${result.error}`);
    }
    
  } finally {
    // Restore original key
    if (originalKey) {
      process.env.RIZA_API_KEY = originalKey;
    }
  }
}

testRizaErrorHandling();
