#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import figlet from 'figlet';
import boxen from 'boxen';
import dotenv from 'dotenv';
import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { ContinuationHandler } from './cli/continuation-handler.js';

// Load environment variables
dotenv.config();

// Dynamic agent URL configuration - works for any developer's agent IDs
async function getAgentUrl(mode = 'auto') {
  // If explicitly set via environment, use that
  if (process.env.AGENT_URL) {
    return process.env.AGENT_URL;
  }

  // Use dynamic config detection to work for any developer
  try {
    const { generateAgentUrl } = await import('./cli/config-utils.js');
    const url = await generateAgentUrl(mode === 'auto' ? 'local' : mode);
    // Uncomment for debugging: console.log(`Using dynamically detected URL: ${url}`);
    return url;
  } catch (error) {
    console.warn('Could not detect agent configuration. Using fallback.');
    // Fallback for development - this will only work in this specific project
    const fallbackId = 'agent_3918f7879297cf4159ea3d23b54f835b';
    switch (mode) {
      case 'local':
        return `http://127.0.0.1:3500/${fallbackId}`;
      case 'cloud':
        return `https://your-deployment.agentuity.cloud/${fallbackId}`;
      default:
        return `http://127.0.0.1:3500/${fallbackId}`;
    }
  }
}

const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  console.error(
    chalk.red('❌ Error: API_KEY environment variable is not set.')
  );
  console.error(
    chalk.yellow('💡 Please create a .env file with API_KEY=your_key')
  );
  process.exit(1);
}

// Session management
let sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// Continuation handler for tool calls
const continuationHandler = new ContinuationHandler();

// Available slash commands
const slashCommands = [
  { name: '/help', description: 'Show available commands' },
  { name: '/clear', description: 'Clear screen and show header' },
  { name: '/session', description: 'Start a new session' },
  { name: '/context', description: 'Show current work context' },
  { name: '/diff', description: 'Show git diff with beautiful formatting' },
  { name: '/diff-save', description: 'Save full diff to file for large changes' },
  { name: '/quit', description: 'Exit the CLI' },
];

// Smart input handler with command hints
async function getInput() {
  // Show available slash commands hint
  const commandHint = chalk.dim('\n💡 Type "/" for commands: /help /clear /session /context /diff /diff-save /quit\n');
  
  const { message } = await inquirer.prompt([
    {
      type: 'input',
      name: 'message',
      message: chalk.blue('You:'),
      prefix: '💬',
      transformer: (input) => {
        // Show helpful hints for slash commands
        if (input === '/') {
          return chalk.cyan('/') + chalk.dim(' (type command name: help, clear, session, context, diff, diff-save, quit)');
        }
        if (input.startsWith('/h')) {
          return chalk.cyan(input) + chalk.dim('elp');
        }
        if (input.startsWith('/c') && input.length === 2) {
          return chalk.cyan(input) + chalk.dim('lear, context');
        }
        if (input.startsWith('/s')) {
          return chalk.cyan(input) + chalk.dim('ession');
        }
        if (input.startsWith('/d')) {
          return chalk.cyan(input) + chalk.dim('iff, diff-save');
        }
        if (input.startsWith('/q')) {
          return chalk.cyan(input) + chalk.dim('uit');
        }
        return input;
      }
    }
  ]);
  
  return message;
}

// Display beautiful header
function showHeader() {
  console.clear();
  console.log(
    chalk.cyan(
      figlet.textSync('Coding Agent', {
        font: 'Small',
        horizontalLayout: 'fitted',
      })
    )
  );
  console.log(chalk.dim('  Powered by Agentuity & Claude 4 Sonnet\n'));
}

// Send message to agent with beautiful streaming and tool call handling
async function sendMessage(message, showSpinner = true, agentMode = 'auto') {
  let spinner;

  if (showSpinner) {
    spinner = ora({
      text: chalk.blue('🤖 Agent is thinking...'),
      spinner: 'dots',
    }).start();
  }

  try {
    const targetUrl = await getAgentUrl(agentMode);
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        Authorization: `Bearer ${API_KEY}`,
        'x-session-id': sessionId,
      },
      body: message,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    if (spinner) spinner.stop();

    console.log(chalk.green('\n🤖 Agent:'));
    console.log(chalk.dim('─'.repeat(60)));

    // Collect the full response to check for tool calls
    let fullResponse = '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      fullResponse += chunk;

      // Add enhanced formatting for diff content and tool calls
      const formattedChunk = chunk
        .replace(/🔧 Requesting tool execution:/g, chalk.blue('🔧 Requesting tool execution:'))
        .replace(/📋 Parameters:/g, chalk.cyan('📋 Parameters:'))
        .replace(/✅ Tool completed/g, chalk.green('✅ Tool completed'))
        .replace(
          /💡 \*\*Large diff detected!\*\*/g,
          chalk.yellow('💡 **Large diff detected!**')
        )
        .replace(
          /📊 \*\*Diff Statistics:\*\*/g,
          chalk.cyan('📊 **Diff Statistics:**')
        )
        .replace(/🎨 \*\*Git Diff\*\*/g, chalk.magenta('🎨 **Git Diff**'))
        .replace(/📄 \*\*Git Diff\*\*/g, chalk.blue('📄 **Git Diff**'));

      process.stdout.write(formattedChunk);
    }

    // Check if response contains tool calls
    const continuationUrl = await getAgentUrl(agentMode);
    const toolCallResult = await continuationHandler.handleToolCallFlow(
      fullResponse,
      continuationUrl,
      API_KEY,
      sessionId,
      message
    );

    if (toolCallResult.needsContinuation && toolCallResult.continuationResponse) {
      // Stream the continuation response
      console.log(chalk.green('\n🤖 Agent (continued):'));
      console.log(chalk.dim('─'.repeat(60)));

      const contReader = toolCallResult.continuationResponse.body.getReader();
      
      while (true) {
        const { done, value } = await contReader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        
        // Format continuation response
        const formattedChunk = chunk
          .replace(/📨 Received tool results:/g, chalk.green('📨 Received tool results:'))
          .replace(/✅ (.*?): Success/g, chalk.green('✅ $1: Success'))
          .replace(/❌ (.*?): Error/g, chalk.red('❌ $1: Error'));

        process.stdout.write(formattedChunk);
      }
    }

    // biome-ignore lint/style/useTemplate: <explanation>
    console.log('\n' + chalk.dim('─'.repeat(60)));
  } catch (error) {
    if (spinner) spinner.fail(chalk.red('Failed to communicate with agent'));
    console.error(chalk.red(`❌ Error: ${error.message}`));
  }
}

// Interactive mode
async function interactiveMode(agentMode = 'auto') {
  showHeader();

  console.log(
    boxen(
      `${chalk.green('🚀 Interactive Mode')}\n\n` +
        `${chalk.cyan('Commands:')}\n` +
        `  ${chalk.white('/help')}     - Show this help\n` +
        `  ${chalk.white('/clear')}    - Clear screen\n` +
        `  ${chalk.white('/session')}  - New session\n` +
        `  ${chalk.white('/context')}   - Show work context\n` +
        `  ${chalk.white('/diff')}     - Show git diff\n` +
        `  ${chalk.white('/diff-save')} - Save full diff to file\n` +
        `  ${chalk.white('/quit')}     - Exit\n\n` +
        `${chalk.yellow('💡 Tip:')} Just type your coding questions naturally!`,
      {
        padding: 1,
        margin: 1,
        borderStyle: 'round',
        borderColor: 'cyan',
      }
    )
  );

  // Welcome message
  // await sendMessage("Hello! I'm your coding agent. What would you like to work on today?");

  while (true) {
    console.log(); // Empty line for spacing

    const message = await getInput();

    if (!message.trim()) continue;

    // Handle special commands and suggestions
    const trimmedMessage = message.toLowerCase().trim();
    
    // Show available commands when user types just "/"
    if (trimmedMessage === '/') {
      console.log(chalk.yellow('💡 Available commands:'));
      for (const command of slashCommands) {
        console.log(`  ${chalk.cyan(command.name)} - ${chalk.dim(command.description)}`);
      }
      continue;
    }
    
    switch (trimmedMessage) {
      case '/help':
        console.log(
          boxen(
            // biome-ignore lint/style/useTemplate: <explanation>
            `${chalk.green('Available Commands:')}\n\n` +
              `${chalk.white('/help')}     - Show this help\n` +
              `${chalk.white('/clear')}    - Clear screen and show header\n` +
              `${chalk.white('/session')}  - Start a new session\n` +
              `${chalk.white('/context')}   - Show current work context and goals\n` +
              `${chalk.white('/diff')}     - Show git diff with beautiful formatting\n` +
              `${chalk.white('/diff-save')} - Save full diff to file for large changes\n` +
              `${chalk.white('/quit')}     - Exit the CLI\n\n` +
              `${chalk.cyan('Examples:')}\n` +
              `• "What does package.json contain?"\n` +
              `• "Create a FastAPI server with authentication"\n` +
              `• "Fix the bug in src/main.py"\n` +
              `• "Run the tests and show me the results"`,
            { padding: 1, borderStyle: 'round', borderColor: 'green' }
          )
        );
        continue;

      case '/clear':
        showHeader();
        continue;

      case '/session':
        sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        console.log(chalk.green('✨ New session started!'));
        continue;

      case '/context':
        await sendMessage('What are we currently working on? Show me the work context.', true, agentMode);
        continue;

      case '/diff':
        await sendMessage(
          'Show me the git diff of all changed files with beautiful formatting.',
          true,
          agentMode
        );
        continue;

      case '/diff-save': {
        const filename = `changes_${new Date().toISOString().slice(0, 10)}_${Date.now()}.patch`;
        await sendMessage(`Save the full git diff to file: ${filename}`, true, agentMode);
        continue;
      }

      case '/quit':
      case '/exit':
        console.log(chalk.yellow('👋 Goodbye! Happy coding!'));
        process.exit(0);
    }

    await sendMessage(message, true, agentMode);
  }
}

// Project detection
async function detectProject() {
  const projectFiles = [
    'package.json',
    'pyproject.toml',
    'go.mod',
    'Cargo.toml',
    '.git',
  ];
  const detectedFiles = [];

  for (const file of projectFiles) {
    try {
      await access(file);
      detectedFiles.push(file);
    } catch {
      // File doesn't exist, ignore
    }
  }

  if (detectedFiles.length > 0) {
    console.log(chalk.green('🔍 Project detected:'));
    for (const file of detectedFiles) {
      const icon = file === '.git' ? '📁' : '📄';
      console.log(`  ${icon} ${file}`);
    }
    console.log();
  }
}

// Setup CLI commands
const program = new Command();

program
  .name('coder')
  .description('AI-powered coding assistant')
  .version('1.0.0');

program
  .argument('[message...]', 'Direct message to the coding agent')
  .option('-i, --interactive', 'Start interactive mode')
  .option('-p, --project <path>', 'Set project directory')
  .option('--session <id>', 'Use specific session ID')
  .option('--local', 'Use local agent (localhost:3500)')
  .option('--cloud', 'Use cloud agent (agentuity.cloud)')
  .action(async (messageArray, options) => {
    // Determine agent mode
    let agentMode = 'auto';
    if (options.local && options.cloud) {
      console.error(chalk.red('❌ Cannot specify both --local and --cloud'));
      process.exit(1);
    } else if (options.local) {
      agentMode = 'local';
      console.log(chalk.blue('🏠 Using local agent mode'));
    } else if (options.cloud) {
      agentMode = 'cloud';
      console.log(chalk.cyan('☁️  Using cloud agent mode'));
    }

    // Set custom session if provided
    if (options.session) {
      sessionId = options.session;
    }

    // Change directory if project path specified
    if (options.project) {
      try {
        process.chdir(options.project);
        console.log(chalk.blue(`📁 Working in: ${process.cwd()}`));
      } catch (error) {
        console.error(
          chalk.red(`❌ Cannot access directory: ${options.project}`)
        );
        process.exit(1);
      }
    }

    await detectProject();

    if (options.interactive || messageArray.length === 0) {
      await interactiveMode(agentMode);
    } else {
      showHeader();
      const message = messageArray.join(' ');
      console.log(chalk.blue(`💬 You: ${message}\n`));
      await sendMessage(message, true, agentMode);
      console.log(); // Final newline
    }
  });

// Handle errors gracefully
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n👋 Goodbye! Happy coding!'));
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error(chalk.red('❌ Unexpected error:'), error.message);
  process.exit(1);
});

program.parse();
