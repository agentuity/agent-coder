#!/usr/bin/env bun

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import figlet from 'figlet';
import boxen from 'boxen';
import dotenv from 'dotenv';
import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { ContinuationHandler } from './cli/continuation-handler.js';
import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';
// We'll use dynamic imports to avoid build system issues
// import { SetupManager } from './src/lib/setup-manager.ts';
// import { SessionManager } from './src/lib/session-manager.ts';

// Load environment variables
dotenv.config();

// Capture the actual terminal working directory before anything else happens
// This is needed because the shell script changes to its own directory
const ACTUAL_TERMINAL_CWD =
  process.env.ORIGINAL_TERMINAL_CWD || process.env.PWD || process.cwd();

// Configure markdown rendering for terminal
marked.setOptions({
  renderer: new TerminalRenderer({
    code: chalk.yellow,
    blockquote: chalk.gray.italic,
    heading: chalk.bold.blue,
    link: chalk.cyan.underline,
    strong: chalk.bold,
    em: chalk.italic,
    codespan: chalk.bgBlack.white,
  }),
});

// Enhanced text processing function
function processResponseText(text) {
  // Check if text contains markdown-like content
  const hasMarkdown =
    /^#{1,6}\s|```|\*\*|\*[^*]|\[.*\]\(.*\)|^\s*[\*\-\+]\s/m.test(text);

  if (hasMarkdown) {
    try {
      return marked(text);
    } catch (error) {
      // Fallback to plain text if markdown parsing fails
      return text;
    }
  }

  return text;
}

// Process individual lines during streaming for better formatting
function processStreamingLine(line) {
  // Filter out technical noise first
  let processedLine = line
    // Remove tool IDs and technical messages from agent responses
    .replace(/📨 Received tool results:\s*\n?/g, '')
    .replace(/✅ toolu_[a-zA-Z0-9]+: Success\s*\n?/g, '')
    .replace(/❌ toolu_[a-zA-Z0-9]+: Error\s*\n?/g, '')
    // Remove "Tool execution completed" messages since we show our own
    .replace(/Tool execution completed\. Based on the results.*?\n?/g, '')
    // Remove hidden tool call markers completely
    .replace(/__TOOL_CALLS_HIDDEN__.*?__END_CALLS_HIDDEN__/gs, '');

  // Filter out hidden tool call lines completely
  if (
    /__TOOL_CALLS_HIDDEN__/.test(processedLine) ||
    /__END_CALLS_HIDDEN__/.test(processedLine)
  ) {
    return '';
  }

  // Simple parameter line filtering - only filter obvious parameter lines
  // This is more conservative to avoid hiding legitimate content
  if (/^📋 Parameters:\s*\{/.test(processedLine.trim())) {
    return ''; // Filter out parameter start lines
  }

  // Filter out lines that look like JSON parameter content (conservative approach)
  if (/^\s*["'][a-zA-Z_]+["']:\s*["\{]/.test(processedLine.trim())) {
    return ''; // Filter out obvious JSON parameter lines
  }

  // Filter out closing parameter braces
  if (/^\s*\}\s*$/.test(processedLine.trim())) {
    return ''; // Filter out standalone closing braces
  }

  // If line was filtered out completely, return empty
  if (!processedLine.trim()) {
    return '';
  }

  // Apply simple formatting instead of full markdown processing to avoid breaking numbered lists
  // Only process headers with markdown, handle other formatting manually
  if (/^#{1,6}\s/.test(processedLine)) {
    try {
      processedLine = marked(processedLine);
    } catch (error) {
      // Fallback to manual header formatting
      processedLine = processedLine.replace(
        /^(#{1,6})\s+(.+)$/g,
        (match, hashes, text) => {
          const level = hashes.length;
          if (level === 1) return `${chalk.bold.blue(text)}\n`;
          if (level === 2) return `${chalk.bold.cyan(text)}\n`;
          if (level === 3) return `${chalk.bold.yellow(text)}\n`;
          return `${chalk.bold(text)}\n`;
        }
      );
    }
  } else {
    // Manual formatting for other elements to preserve list numbering
    processedLine = processedLine
      // Bold text
      .replace(/\*\*(.*?)\*\*/g, chalk.bold('$1'))
      .replace(/__(.*?)__/g, chalk.bold('$1'))
      // Italic text
      .replace(/\*(.*?)\*/g, chalk.italic('$1'))
      .replace(/_(.*?)_/g, chalk.italic('$1'))
      // Inline code
      .replace(/`(.*?)`/g, chalk.bgBlack.white(' $1 '))
      // Links (basic formatting)
      .replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        `${chalk.cyan.underline('$1')}${chalk.dim(' ($2)')}`
      );
  }

  // Apply enhanced formatting for tool execution messages
  processedLine = processedLine
    .replace(
      /🔧 Requesting tool execution:/g,
      chalk.blue('🔧 Requesting tool execution:')
    )
    .replace(/✅ Tool completed/g, chalk.green('✅ Tool completed'))
    // Format diff and git messages
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

  return processedLine;
}

// Dynamic agent URL configuration - works for any developer's agent IDs
async function getAgentUrl(mode = 'auto') {
  // If explicitly set via environment, use that
  if (process.env.AGENT_URL) {
    return process.env.AGENT_URL;
  }

  // Try to read from global config file for cloud mode or auto mode
  if (mode === 'cloud' || mode === 'auto') {
    try {
      const globalConfigPath = join(homedir(), '.config', 'agentuity-coder', 'agentuity-coder.config.json');
      const configContent = await readFile(
        globalConfigPath,
        'utf-8'
      );
      const config = JSON.parse(configContent);
      
      // Store the API key globally for this session if found
      if (config.apiKey && !process.env.API_KEY) {
        process.env.GLOBAL_API_KEY = config.apiKey;
      }
      
      if (config.agentUrl) {
        return config.agentUrl;
      }
    } catch (error) {
      // Global config file doesn't exist or invalid, continue to dynamic detection
    }
  }

  // Use dynamic config detection to work for any developer
  try {
    const { generateAgentUrl } = await import('./cli/config-utils.js');
    const url = await generateAgentUrl(mode === 'auto' ? 'local' : mode);
    return url;
  } catch (error) {
    console.warn('Could not detect agent configuration. Using fallback.');
    // Fallback for development - this will only work in this specific project
    const fallbackId = 'agent_3918f7879297cf4159ea3d23b54f835b';
    switch (mode) {
      case 'local':
        return `http://127.0.0.1:3500/${fallbackId}`;
      case 'cloud':
        // Remove 'agent_' prefix for cloud endpoints
        const cloudId = fallbackId.replace('agent_', '');
        return `https://agentuity.ai/api/${cloudId}`;
      default:
        return `http://127.0.0.1:3500/${fallbackId}`;
    }
  }
}

const API_KEY = process.env.API_KEY || process.env.AGENTUITY_PROJECT_KEY || process.env.GLOBAL_API_KEY;

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

// Continuation handler for tool calls (pass actual terminal directory)
const continuationHandler = new ContinuationHandler(ACTUAL_TERMINAL_CWD);

// Available slash commands
const slashCommands = [
  { name: '/help', description: 'Show available commands' },
  { name: '/clear', description: 'Clear screen and show header' },
  { name: '/session', description: 'Start a new session' },
  { name: '/continue', description: 'Continue from last session' },
  { name: '/context', description: 'Show current work context' },
  { name: '/goal', description: 'Set or update current goal' },
  { name: '/diff', description: 'Show git diff with beautiful formatting' },
  {
    name: '/diff-save',
    description: 'Save full diff to file for large changes',
  },
  { name: '/undo', description: 'Undo recent changes made by the agent' },
  { name: '/changes', description: 'Show recent changes made by the agent' },
  { name: '/quit', description: 'Exit the CLI' },
];

// Smart input handler with command hints
async function getInput(setupManager) {
  // Get suggested commands from project config
  const suggestedCommands = setupManager
    ? await setupManager.getSuggestedCommands()
    : [];

  // Show available slash commands hint
  const commandHint = chalk.dim(
    '\n💡 Type "/" for commands: /help /clear /session /context /diff /diff-save /quit\n'
  );

  const { message } = await inquirer.prompt([
    {
      type: 'input',
      name: 'message',
      message: chalk.blue('You:'),
      prefix: '💬',
      transformer: (input) => {
        // Show available commands only when user types just "/"
        if (input === '/') {
          return (
            chalk.cyan('/') +
            chalk.dim(
              ' (type command name: help, clear, session, context, diff, diff-save, quit)'
            )
          );
        }
        return input;
      },
      // Add autocomplete suggestions
      suggest: async (input) => {
        const suggestions = [];

        // Add slash commands
        if (input.startsWith('/')) {
          const slashSuggestions = slashCommands
            .filter((cmd) => cmd.name.startsWith(input))
            .map((cmd) => ({ name: cmd.name, value: cmd.name }));
          suggestions.push(...slashSuggestions);
        }

        // Add project commands
        if (suggestedCommands.length > 0 && !input.startsWith('/')) {
          const projectSuggestions = suggestedCommands
            .filter((cmd) => cmd.includes(input))
            .map((cmd) => ({ name: cmd, value: cmd }));
          suggestions.push(...projectSuggestions);
        }

        return suggestions;
      },
    },
  ]);

  // Now safe to track command history in global config directory
  if (setupManager && message && !message.startsWith('/')) {
    await setupManager.addRecentCommand(message);
  }

  return message;
}

// Display beautiful header
function showHeader() {
  console.clear();
  console.log(
    chalk.cyan(
      figlet.textSync('Agentuity Coder', {
        font: 'Small',
        horizontalLayout: 'fitted',
      })
    )
  );
  console.log(chalk.dim('  Powered by Agentuity & Claude 4 Sonnet\n'));
}

// Send message to agent with beautiful streaming and tool call handling
async function sendMessage(
  message,
  showSpinner = true,
  agentMode = 'auto',
  sessionManager = null,
  progressManager = null
) {
  let spinner;

  if (showSpinner) {
    if (progressManager) {
      progressManager.start({
        type: 'spinner',
        message: chalk.blue('🤖 Agent is thinking...')
      });
    } else {
      spinner = ora({
        text: chalk.blue('🤖 Agent is thinking...'),
        spinner: 'dots',
      }).start();
    }
  }

  try {
    const targetUrl = await getAgentUrl(agentMode);

    // Add timeout to prevent hanging
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout for initial request

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        Authorization: `Bearer ${API_KEY}`,
        'x-session-id': sessionId,
      },
      body: message,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response
        .text()
        .catch(() => 'Could not read error response');
      if (response.status === 429) {
        console.error(
          chalk.yellow(
            '⚠️  Rate limit exceeded. Please wait before trying again.'
          )
        );
        console.error(
          chalk.yellow(
            '💡 Try shorter requests or wait for rate limits to reset.'
          )
        );
      }
      throw new Error(
        `HTTP ${response.status}: ${response.statusText}\n${errorText}`
      );
    }

    if (progressManager) {
      progressManager.stop();
    } else if (spinner) {
      spinner.stop();
    }

    console.log(chalk.green('\n🤖 Agent:'));
    console.log(chalk.dim('─'.repeat(60)));

    // Collect the full response to check for tool calls
    let fullResponse = '';
    let lineBuffer = '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      fullResponse += chunk;
      lineBuffer += chunk;

      // Process complete lines for better markdown rendering
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        const processedLine = processStreamingLine(`${line}\n`);
        if (processedLine) {
          process.stdout.write(processedLine);
        }
      }
    }

    // Process any remaining content in buffer
    if (lineBuffer) {
      const processedLine = processStreamingLine(lineBuffer);
      if (processedLine) {
        process.stdout.write(processedLine);
      }
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

    if (
      toolCallResult.needsContinuation &&
      toolCallResult.continuationResponse
    ) {
      // Stream the continuation response
      console.log(chalk.green('\n🤖 Agent (continued):'));
      console.log(chalk.dim('─'.repeat(60)));

      const contReader = toolCallResult.continuationResponse.body.getReader();
      let contLineBuffer = '';

      while (true) {
        const { done, value } = await contReader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        contLineBuffer += chunk;

        // Process complete lines for continuation response
        const lines = contLineBuffer.split('\n');
        contLineBuffer = lines.pop() || '';

        for (const line of lines) {
          const processedLine = processStreamingLine(`${line}\n`);
          if (processedLine) {
            process.stdout.write(processedLine);
          }
        }
      }

      // Process any remaining content in continuation buffer
      if (contLineBuffer) {
        const processedLine = processStreamingLine(contLineBuffer);
        if (processedLine) {
          process.stdout.write(processedLine);
        }
      }
    }

    // biome-ignore lint/style/useTemplate: <explanation>
    console.log('\n' + chalk.dim('─'.repeat(60)));

    // Now safe to track sessions in global config directory
    if (sessionManager && fullResponse) {
      // Clean the response to remove tool call markers
      const cleanResponse = fullResponse
        .replace(/__TOOL_CALLS_HIDDEN__.*?__END_CALLS_HIDDEN__/gs, '')
        .trim();
      if (cleanResponse) {
        await sessionManager.addMessage('assistant', cleanResponse);
      }
    }
  } catch (error) {
    if (progressManager) {
      progressManager.fail(chalk.red('Failed to communicate with agent'));
    } else if (spinner) {
      spinner.fail(chalk.red('Failed to communicate with agent'));
    }

    if (error instanceof Error && error.name === 'AbortError') {
      console.error(
        chalk.red('❌ Request timed out. The agent may be overloaded.')
      );
      console.error(
        chalk.yellow('💡 Try again with a shorter request or wait a moment.')
      );
    } else if (error instanceof Error) {
      console.error(chalk.red(`❌ Error: ${error.message}`));
    } else {
      console.error(chalk.red(`❌ Error: ${String(error)}`));
    }
  }
}

// Interactive mode
async function interactiveMode(agentMode = 'auto') {
  showHeader();

  // Initialize setup manager for first-time experience
  // Use dynamic imports to avoid build system issues
  let setupManager = null;
  let sessionManager = null;
  let progressManager = null;
  let undoManager = null;
  
  try {
    const { SetupManager } = await import('./src/lib/setup-manager.ts');
    const { SessionManager } = await import('./src/lib/session-manager.ts');
    const { progressManager: pm } = await import('./src/lib/progress-manager.ts');
    const { UndoManager } = await import('./src/lib/undo-manager.ts');
    
    progressManager = pm;
    
    // Show progress for initialization
    progressManager.createSteps([
      'Initializing setup manager',
      'Loading project configuration',
      'Setting up session manager'
    ]);
    
    setupManager = new SetupManager(ACTUAL_TERMINAL_CWD);
    progressManager.nextStep();
    
    await setupManager.initialize();
    progressManager.nextStep();
    
    sessionManager = new SessionManager(ACTUAL_TERMINAL_CWD);
    await sessionManager.initialize();
    progressManager.nextStep();
    
    // Initialize undo manager with session ID
    undoManager = new UndoManager(sessionId);
    await undoManager.initialize();
  } catch (error) {
    if (progressManager) progressManager.stop();
    console.warn(chalk.yellow('⚠️  Enhanced features unavailable:', error.message));
    // Continue without enhanced features
  }

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
        `  ${chalk.white('/undo')}     - Undo recent changes\n` +
        `  ${chalk.white('/changes')}  - Show recent changes\n` +
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

    const message = await getInput(setupManager);

    if (!message.trim()) continue;

    // Handle special commands and suggestions
    const trimmedMessage = message.toLowerCase().trim();

    // Show available commands when user types just "/"
    if (trimmedMessage === '/') {
      console.log(chalk.yellow('💡 Available commands:'));
      for (const command of slashCommands) {
        console.log(
          `  ${chalk.cyan(command.name)} - ${chalk.dim(command.description)}`
        );
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
              `${chalk.white('/continue')} - Continue from last session\n` +
              `${chalk.white('/context')}   - Show current work context and goals\n` +
              `${chalk.white('/goal')}     - Set or update current goal\n` +
              `${chalk.white('/diff')}     - Show git diff with beautiful formatting\n` +
              `${chalk.white('/diff-save')} - Save full diff to file for large changes\n` +
              `${chalk.white('/undo')}     - Undo recent changes made by the agent\n` +
              `${chalk.white('/changes')}  - Show recent changes made by the agent\n` +
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
        if (sessionManager) {
          await sessionManager.startNewSession();
        }
        console.log(chalk.green('✨ New session started!'));
        continue;

      case '/continue':
        if (sessionManager) {
          const continueMsg = await sessionManager.continueLastSession();
          console.log(processResponseText(continueMsg));
        } else {
          console.log(chalk.yellow('Session features not available'));
        }
        continue;

      case '/context':
        if (sessionManager) {
          const summary = await sessionManager.getSummary();
          console.log(processResponseText(summary));
        } else {
          console.log(chalk.yellow('Session features not available'));
        }
        continue;

      case '/goal':
        const { goal } = await inquirer.prompt([
          {
            type: 'input',
            name: 'goal',
            message: chalk.blue('What are you working on?'),
            prefix: '🎯',
          },
        ]);
        if (goal && goal.trim()) {
          if (sessionManager) {
            await sessionManager.updateGoal(goal.trim());
          }
          console.log(chalk.green(`✅ Goal set: ${goal.trim()}`));
        }
        continue;

      case '/diff':
        await sendMessage(
          'Show me the git diff of all changed files with beautiful formatting.',
          true,
          agentMode,
          sessionManager,
          progressManager
        );
        continue;

      case '/diff-save': {
        const filename = `changes_${new Date().toISOString().slice(0, 10)}_${Date.now()}.patch`;
        await sendMessage(
          `Save the full git diff to file: ${filename}`,
          true,
          agentMode
        );
        continue;
      }
      
      case '/undo':
        if (undoManager) {
          await undoManager.interactiveUndo();
        } else {
          console.log(chalk.yellow('Undo feature not available'));
        }
        continue;
        
      case '/changes':
        if (undoManager) {
          await undoManager.showRecentChanges();
        } else {
          console.log(chalk.yellow('Change tracking not available'));
        }
        continue;

      case '/quit':
      case '/exit':
        console.log(chalk.yellow('👋 Goodbye! Happy coding!'));
        process.exit(0);
    }

    // Now safe to track sessions in global config directory
    if (sessionManager) {
      await sessionManager.addMessage('user', message);
    }

    await sendMessage(message, true, agentMode, sessionManager, progressManager);
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

  // Use the actual terminal directory for file access
  const { access: accessFile } = await import('node:fs/promises');
  const { join } = await import('node:path');

  for (const file of projectFiles) {
    try {
      await accessFile(join(ACTUAL_TERMINAL_CWD, file));
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
