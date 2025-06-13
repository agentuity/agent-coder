#!/usr/bin/env node

import readline from 'node:readline';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Configuration
const AGENT_URL =
  'http://127.0.0.1:3500/agent_ae7cbe64f1c31943895f65422617cbf8';
const API_KEY = process.env.API_KEY;
const SESSION_ID = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// Check if API_KEY is set
if (!API_KEY) {
  console.error('Error: API_KEY environment variable is not set.');
  console.error('Please create a .env file with API_KEY=your_api_key_here');
  process.exit(1);
}

// Colors for output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

function colorize(color, text) {
  return `${colors[color]}${text}${colors.reset}`;
}

async function sendMessage(message) {
  try {
    console.log(colorize('dim', `\nSending to: ${AGENT_URL}`));
    console.log(colorize('dim', `Session ID: ${SESSION_ID}\n`));

    const response = await fetch(AGENT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        Authorization: `Bearer ${API_KEY}`,
        'x-session-id': SESSION_ID,
      },
      body: message,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    console.log(colorize('green', 'Agent: '), { newline: false });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      process.stdout.write(chunk);
    }

    console.log(); // New line after response
  } catch (error) {
    console.error(colorize('red', `Error: ${error.message}`));
    if (error.cause) {
      console.error(colorize('red', `Cause: ${error.cause.message}`));
    }
  }
}

async function main() {
  console.log(colorize('cyan', '🤖 Coding Agent Test Client'));
  console.log(colorize('dim', '==============================='));
  console.log('Type your messages and press Enter. Type "exit" to quit.\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: colorize('blue', 'You: '),
  });

  // Welcome message
  console.log(colorize('yellow', 'Connecting to coding agent...'));
  await sendMessage(
    "Hello! I'd like to work on some code. Can you help me understand what tools you have available?"
  );

  rl.prompt();

  rl.on('line', async (input) => {
    const message = input.trim();

    if (message.toLowerCase() === 'exit' || message.toLowerCase() === 'quit') {
      console.log(colorize('yellow', 'Goodbye!'));
      rl.close();
      return;
    }

    if (message === '') {
      rl.prompt();
      return;
    }

    await sendMessage(message);
    rl.prompt();
  });

  rl.on('close', () => {
    console.log(colorize('dim', '\nSession ended.'));
    process.exit(0);
  });

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    console.log(colorize('yellow', '\nGoodbye!'));
    rl.close();
  });
}

// Check if fetch is available (Node.js 18+)
if (typeof fetch === 'undefined') {
  console.error(
    colorize(
      'red',
      'Error: This script requires Node.js 18+ for fetch support.'
    )
  );
  console.error(
    colorize('yellow', 'Please upgrade Node.js or install a fetch polyfill.')
  );
  process.exit(1);
}

main().catch((error) => {
  console.error(colorize('red', `Fatal error: ${error.message}`));
  process.exit(1);
});
