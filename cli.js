#!/usr/bin/env bun

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import boxen from 'boxen';
import dotenv from 'dotenv';
import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { ContinuationHandler } from './cli/continuation-handler.js';
import { AgentClient } from './cli/agent-client.ts';
import { slashCommands } from './cli/slash-commands.ts';
import { runLocalCommand } from './cli/local-command.ts';
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
    code: chalk.cyan,
    blockquote: chalk.gray.italic,
    heading: chalk.bold.green,
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
      chalk.cyan('🔧 Requesting tool execution:')
    )
    .replace(/✅ Tool completed/g, chalk.cyan('✅ Tool completed'))
    // Format diff and git messages
    .replace(
      /💡 \*\*Large diff detected!\*\*/g,
      chalk.cyan('💡 **Large diff detected!**')
    )
    .replace(
      /📊 \*\*Diff Statistics:\*\*/g,
      chalk.cyan('📊 **Diff Statistics:**')
    )
    .replace(/🎨 \*\*Git Diff\*\*/g, chalk.magenta('🎨 **Git Diff**'))
    .replace(/📄 \*\*Git Diff\*\*/g, chalk.cyan('📄 **Git Diff**'));

  return processedLine;
}

async function executeLocalCommand(command) {
  const trimmed = command.trim();
  if (!trimmed) {
    console.log(chalk.cyan('⚠️ Command is empty.'));
    return;
  }

  console.log(chalk.gray(`$ ${trimmed}`));
  try {
    const result = await runLocalCommand(trimmed, ACTUAL_TERMINAL_CWD);
    if (result.stdout) {
      process.stdout.write(result.stdout);
      if (!result.stdout.endsWith('\n')) {
        process.stdout.write('\n');
      }
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
      if (!result.stderr.endsWith('\n')) {
        process.stderr.write('\n');
      }
    }
    if (result.code !== 0) {
      console.log(chalk.red(`Command exited with code ${result.code}`));
    }
  } catch (error) {
    console.error(
      chalk.red(
        `Failed to run command: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    );
  }
}

let cachedGlobalConfig = null;
let attemptedGlobalConfig = false;

async function loadGlobalConfig() {
  if (attemptedGlobalConfig) {
    return cachedGlobalConfig;
  }
  attemptedGlobalConfig = true;
  try {
    const globalConfigPath = join(
      homedir(),
      '.config',
      'agentuity-coder',
      'agentuity-coder.config.json'
    );
    const configContent = await readFile(globalConfigPath, 'utf-8');
    cachedGlobalConfig = JSON.parse(configContent);
  } catch {
    cachedGlobalConfig = null;
  }
  return cachedGlobalConfig;
}

// Dynamic agent URL configuration - works for any developer's agent IDs
async function getAgentUrl(mode = 'auto') {
  if (process.env.AGENT_URL) {
    return process.env.AGENT_URL;
  }

  const globalConfig = await loadGlobalConfig();

  if (globalConfig?.apiKey && !process.env.API_KEY) {
    process.env.GLOBAL_API_KEY = globalConfig.apiKey;
  }

  if (mode === 'cloud') {
    if (globalConfig?.agentUrl) {
      return globalConfig.agentUrl;
    }
    const { generateAgentUrl } = await import('./cli/config-utils.js');
    return generateAgentUrl('cloud');
  }

  if (
    mode !== 'local' &&
    globalConfig?.mode === 'cloud' &&
    globalConfig.agentUrl
  ) {
    return globalConfig.agentUrl;
  }

  try {
    const { generateAgentUrl } = await import('./cli/config-utils.js');
    return generateAgentUrl('local');
  } catch (error) {
    console.warn('Could not detect agent configuration. Using fallback.');
    const fallbackId = 'agent_3918f7879297cf4159ea3d23b54f835b';
    switch (mode) {
      case 'local':
      case 'auto':
        return `http://127.0.0.1:3500/${fallbackId}`;
      case 'cloud': {
        const cloudId = fallbackId.replace('agent_', '');
        return `https://agentuity.ai/api/${cloudId}`;
      }
      default:
        return `http://127.0.0.1:3500/${fallbackId}`;
    }
  }
}

const API_KEY =
  process.env.API_KEY ||
  process.env.AGENTUITY_PROJECT_KEY ||
  process.env.GLOBAL_API_KEY;

if (!API_KEY) {
  console.error(
    chalk.red('❌ Error: API_KEY environment variable is not set.')
  );
  console.error(
    chalk.cyan('💡 Please create a .env file with API_KEY=your_key')
  );
  process.exit(1);
}

// Session management
let sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// Continuation handler for tool calls (pass actual terminal directory)
const continuationHandler = new ContinuationHandler(ACTUAL_TERMINAL_CWD);
const agentClient = new AgentClient({
  apiKey: API_KEY,
  continuationHandler,
  getAgentUrl,
});

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
      message: chalk.cyan('You:'),
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
  const banner = `
    ___                    __        _ __           ______          __
   /   | ____ ____  ____  / /___  __(_) /___  __   / ____/___  ____/ /__  _____
  / /| |/ __ \`/ _ \\/ __ \\/ __/ / / / / __/ / / /  / /   / __ \\/ __  / _ \\/ ___/
 / ___ / /_/ /  __/ / / / /_/ /_/ / / /_/ /_/ /  / /___/ /_/ / /_/ /  __/ /
/_/  |_\\__, /\\___/_/ /_/\\__/\\__,_/_/\\__/\\__, /   \\____/\\____/\\__,_/\\___/_/
      /____/                           /____/
`;
  console.log(chalk.cyan(banner));
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
  let headerShown = false;
  const lineBuffers = {
    primary: '',
    continuation: '',
  };

  const stopIndicators = () => {
    if (progressManager) {
      progressManager.stop();
    } else if (spinner) {
      spinner.stop();
    }
  };

  const ensureHeader = () => {
    if (!headerShown) {
      stopIndicators();
      console.log(chalk.cyan('\n🤖 Agent:'));
      console.log(chalk.dim('─'.repeat(60)));
      headerShown = true;
    }
  };

  const flushBuffer = (source) => {
    const buffer = lineBuffers[source];
    if (!buffer) return;
    const processedLine = processStreamingLine(buffer);
    if (processedLine) {
      process.stdout.write(processedLine);
    }
    lineBuffers[source] = '';
  };

  if (showSpinner) {
    if (progressManager) {
      progressManager.start({
        type: 'spinner',
        message: chalk.cyan('🤖 Agent is thinking...'),
      });
    } else {
      spinner = ora({
        text: chalk.cyan('🤖 Agent is thinking...'),
        spinner: 'dots',
      }).start();
    }
  }

  try {
    const result = await agentClient.sendMessage({
      message,
      agentMode,
      sessionId,
      onStatus: (event) => {
        if (!showSpinner) return;
        if (event.type === 'error') {
          if (progressManager) {
            progressManager.fail(chalk.red(event.message || 'Agent error'));
          } else if (spinner) {
            spinner.fail(chalk.red(event.message || 'Agent error'));
          }
          return;
        }
        if (event.type === 'complete') {
          if (!headerShown) {
            stopIndicators();
          }
          return;
        }
        const text =
          event.message ||
          (event.type === 'stream'
            ? 'Streaming response...'
            : 'Connecting to agent...');
        if (progressManager) {
          progressManager.update(text);
        } else if (spinner) {
          spinner.text = chalk.cyan(text);
        }
      },
      onToken: ({ chunk, source }) => {
        ensureHeader();

        lineBuffers[source] += chunk;
        const lines = lineBuffers[source].split('\n');
        lineBuffers[source] = lines.pop() || '';

        for (const line of lines) {
          const processedLine = processStreamingLine(`${line}\n`);
          if (processedLine) {
            process.stdout.write(processedLine);
          }
        }
      },
    });

    ensureHeader();
    flushBuffer('primary');
    flushBuffer('continuation');
    console.log('\n' + chalk.dim('─'.repeat(60)));

    if (sessionManager && result.cleanedResponse) {
      await sessionManager.addMessage('assistant', result.cleanedResponse);
    }
  } catch (error) {
    stopIndicators();

    if (error instanceof Error && error.name === 'AbortError') {
      console.error(
        chalk.red('❌ Request timed out. The agent may be overloaded.')
      );
      console.error(
        chalk.cyan('💡 Try again with a shorter request or wait a moment.')
      );
    } else if (error instanceof Error) {
      console.error(chalk.red(`❌ Error: ${error.message}`));
    } else {
      console.error(chalk.red(`❌ Error: ${String(error)}`));
    }
  }
}

async function startTuiInterface(agentMode = 'auto') {
  try {
    const { runTui } = await import('./cli/tui/index.tsx');
    await runTui({
      agentMode,
      apiKey: API_KEY,
      initialSessionId: sessionId,
      workingDirectory: ACTUAL_TERMINAL_CWD,
      getAgentUrl,
    });
  } catch (error) {
    console.error(chalk.red('❌ Failed to launch TUI interface:'), error);
    console.log(chalk.cyan('Falling back to classic interactive mode.\n'));
    await classicInteractiveMode(agentMode);
  }
}

// Classic interactive mode (legacy prompt-based)
async function classicInteractiveMode(agentMode = 'auto') {
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
    const { progressManager: pm } = await import(
      './src/lib/progress-manager.ts'
    );
    const { UndoManager } = await import('./src/lib/undo-manager.ts');

    progressManager = pm;

    // Show progress for initialization
    progressManager.createSteps([
      'Initializing setup manager',
      'Loading project configuration',
      'Setting up session manager',
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
    console.warn(
      chalk.cyan('⚠️  Enhanced features unavailable:', error.message)
    );
    // Continue without enhanced features
  }

  console.log(
    boxen(
      `${chalk.cyan('🚀 Interactive Mode')}\n\n` +
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
        `${chalk.cyan('💡 Tip:')} Just type your coding questions naturally!`,
      {
        padding: 1,
        margin: 1,
        borderStyle: 'round',
        borderColor: 'green',
      }
    )
  );

  // Welcome message
  // await sendMessage("Hello! I'm your coding agent. What would you like to work on today?");

  while (true) {
    console.log(); // Empty line for spacing

    const message = await getInput(setupManager);

    const rawInput = message.trim();
    if (!rawInput) continue;

    const normalizedCommand = rawInput.toLowerCase();

    if (rawInput.startsWith('!')) {
      await executeLocalCommand(rawInput.slice(1));
      continue;
    }

    // Show available commands when user types just "/"
    if (normalizedCommand === '/') {
      console.log(chalk.cyan('💡 Available commands:'));
      for (const command of slashCommands) {
        console.log(
          `  ${chalk.cyan(command.name)} - ${chalk.dim(command.description)}`
        );
      }
      continue;
    }

    switch (normalizedCommand) {
      case '/help':
        console.log(
          boxen(
            // biome-ignore lint/style/useTemplate: <explanation>
            `${chalk.cyan('Available Commands:')}\n\n` +
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
        console.log(chalk.cyan('✨ New session started!'));
        continue;

      case '/continue':
        if (sessionManager) {
          const continueMsg = await sessionManager.continueLastSession();
          console.log(processResponseText(continueMsg));
        } else {
          console.log(chalk.cyan('Session features not available'));
        }
        continue;

      case '/context':
        if (sessionManager) {
          const summary = await sessionManager.getSummary();
          console.log(processResponseText(summary));
        } else {
          console.log(chalk.cyan('Session features not available'));
        }
        continue;

      case '/goal':
        const { goal } = await inquirer.prompt([
          {
            type: 'input',
            name: 'goal',
            message: chalk.cyan('What are you working on?'),
            prefix: '🎯',
          },
        ]);
        if (goal && goal.trim()) {
          if (sessionManager) {
            await sessionManager.updateGoal(goal.trim());
          }
          console.log(chalk.cyan(`✅ Goal set: ${goal.trim()}`));
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
          console.log(chalk.cyan('Undo feature not available'));
        }
        continue;

      case '/changes':
        if (undoManager) {
          await undoManager.showRecentChanges();
        } else {
          console.log(chalk.cyan('Change tracking not available'));
        }
        continue;

      case '/quit':
      case '/exit':
        console.log(chalk.cyan('👋 Goodbye! Happy coding!'));
        process.exit(0);
    }

    // Now safe to track sessions in global config directory
    if (sessionManager) {
      await sessionManager.addMessage('user', message);
    }

    await sendMessage(
      message,
      true,
      agentMode,
      sessionManager,
      progressManager
    );
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
    console.log(chalk.cyan('🔍 Project detected:'));
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
  .option('--classic', 'Use the legacy prompt interface instead of the TUI')
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
      console.log(chalk.cyan('🏠 Using local agent mode'));
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
        console.log(chalk.cyan(`📁 Working in: ${process.cwd()}`));
      } catch (error) {
        console.error(
          chalk.red(`❌ Cannot access directory: ${options.project}`)
        );
        process.exit(1);
      }
    }

    await detectProject();

    const shouldRunInteractive =
      options.interactive || messageArray.length === 0;
    const useClassic = Boolean(options.classic);

    if (shouldRunInteractive) {
      if (useClassic) {
        await classicInteractiveMode(agentMode);
      } else {
        await startTuiInterface(agentMode);
      }
      return;
    }

    const message = messageArray.join(' ');
    const trimmedMessage = message.trim();
    if (trimmedMessage.startsWith('!')) {
      await executeLocalCommand(trimmedMessage.slice(1));
      return;
    }
    showHeader();
    console.log(chalk.cyan(`💬 You: ${message}\n`));
    await sendMessage(message, true, agentMode);
    console.log(); // Final newline
  });

// Handle errors gracefully
process.on('SIGINT', () => {
  console.log(chalk.cyan('\n👋 Goodbye! Happy coding!'));
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error(chalk.red('❌ Unexpected error:'), error.message);
  process.exit(1);
});

program.parse();
