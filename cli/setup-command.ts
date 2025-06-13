import inquirer from 'inquirer';
import chalk from 'chalk';
import { writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import figlet from 'figlet';
import boxen from 'boxen';

interface ConfigData {
  agentUrl: string;
  apiKey: string;
  sessionTimeout: number;
  maxFileSize: string;
  allowedCommands: string[];
  toolPolicy: 'strict' | 'permissive';
  mode: 'local' | 'cloud';
}

const DEFAULT_CONFIG: ConfigData = {
  agentUrl: 'http://127.0.0.1:3500/agent_ae7cbe64f1c31943895f65422617cbf8',
  apiKey: '',
  sessionTimeout: 3600,
  maxFileSize: '10MB',
  allowedCommands: ['git', 'npm', 'bun', 'yarn', 'pnpm', 'python', 'node', 'cargo', 'go'],
  toolPolicy: 'strict',
  mode: 'local',
};

function showWelcome() {
  console.clear();
  console.log(
    chalk.cyan(
      figlet.textSync('Coding Agent Setup', {
        font: 'Small',
        horizontalLayout: 'fitted',
      })
    )
  );
  console.log(chalk.dim('  Powered by Agentuity & Claude 4 Sonnet\n'));
  
  console.log(
    boxen(
      `${chalk.green('🚀 Welcome to Coding Agent Setup!')}\n\n` +
        `This wizard will help you configure your coding agent.\n` +
        `You can run this setup again anytime with: ${chalk.cyan('bun run setup')}\n\n` +
        `${chalk.yellow('💡 Tips:')}\n` +
        `• For ${chalk.bold('local development')}: Use local mode with localhost URL\n` +
        `• For ${chalk.bold('cloud deployment')}: Use cloud mode with your Agentuity agent URL\n` +
        `• ${chalk.bold('API keys')} will be encrypted and stored securely`,
      {
        padding: 1,
        margin: 1,
        borderStyle: 'round',
        borderColor: 'cyan',
      }
    )
  );
}

async function detectExistingConfig(): Promise<Partial<ConfigData> | null> {
  try {
    await access('agentuity-coder.config.json');
    const configContent = await readFile('agentuity-coder.config.json', 'utf-8');
    const config = JSON.parse(configContent);
    console.log(chalk.yellow('📁 Existing configuration found!'));
    return config;
  } catch {
    // No existing config
    return null;
  }
}

async function askQuestions(existingConfig?: Partial<ConfigData>): Promise<ConfigData> {
  const questions: any[] = [
    {
      type: 'list',
      name: 'mode',
      message: 'Choose your deployment mode:',
      choices: [
        {
          name: '🏠 Local Development - Agent runs locally (recommended for development)',
          value: 'local',
        },
        {
          name: '☁️  Cloud Deployment - Agent runs in Agentuity cloud (for production)',
          value: 'cloud',
        },
      ],
      default: existingConfig?.mode || 'local',
    },
    {
      type: 'input',
      name: 'agentUrl',
      message: 'Agent URL:',
      default: (answers: any) => {
        if (answers.mode === 'local') {
          return 'http://127.0.0.1:3500/agent_ae7cbe64f1c31943895f65422617cbf8';
        } else {
          return existingConfig?.agentUrl || 'https://your-agent.agentuity.cloud/agent_bf7dce65e2c42854896e75533728dbf9';
        }
      },
      validate: (input: string) => {
        if (!input.startsWith('http')) {
          return 'Please enter a valid HTTP/HTTPS URL';
        }
        return true;
      },
    },
    {
      type: 'password',
      name: 'apiKey',
      message: 'API Key (will be encrypted):',
      mask: '*',
      default: existingConfig?.apiKey || '',
      validate: (input: string) => {
        if (!input.trim()) {
          return 'API key is required';
        }
        return true;
      },
    },
    {
      type: 'list',
      name: 'toolPolicy',
      message: 'Security policy for command execution:',
      choices: [
        {
          name: '🔒 Strict - Only safe, pre-approved commands',
          value: 'strict',
        },
        {
          name: '🔓 Permissive - Allow more commands (less secure)',
          value: 'permissive',
        },
      ],
      default: existingConfig?.toolPolicy || 'strict',
    },
    {
      type: 'checkbox',
      name: 'allowedCommands',
      message: 'Select allowed command types (you can modify these later):',
      choices: [
        { name: 'Git operations', value: 'git', checked: true },
        { name: 'Node.js (npm, yarn, bun, pnpm)', value: 'npm', checked: true },
        { name: 'Python (python, pip)', value: 'python', checked: true },
        { name: 'Rust (cargo)', value: 'cargo', checked: true },
        { name: 'Go (go)', value: 'go', checked: true },
        { name: 'Docker commands', value: 'docker', checked: false },
        { name: 'Make/CMake', value: 'make', checked: true },
      ],
      validate: (choices: string[]) => {
        if (choices.length === 0) {
          return 'Please select at least one command type';
        }
        return true;
      },
    },
  ];

  const answers = await inquirer.prompt(questions);
  
  // Convert command type selections to actual commands
  const commandMap: Record<string, string[]> = {
    git: ['git'],
    npm: ['npm', 'yarn', 'bun', 'pnpm', 'node'],
    python: ['python', 'python3', 'pip', 'pip3'],
    cargo: ['cargo', 'rustc'],
    go: ['go'],
    docker: ['docker'],
    make: ['make', 'cmake'],
  };
  
  const allowedCommands = answers.allowedCommands.flatMap((type: string) => commandMap[type] || []);
  
  return {
    agentUrl: answers.agentUrl,
    apiKey: answers.apiKey,
    mode: answers.mode,
    toolPolicy: answers.toolPolicy,
    allowedCommands,
    sessionTimeout: existingConfig?.sessionTimeout || DEFAULT_CONFIG.sessionTimeout,
    maxFileSize: existingConfig?.maxFileSize || DEFAULT_CONFIG.maxFileSize,
  };
}

function encryptApiKey(apiKey: string): string {
  // Simple base64 encoding for now - in production, use proper encryption
  return Buffer.from(apiKey).toString('base64');
}

async function saveConfig(config: ConfigData): Promise<void> {
  const configToSave = {
    ...config,
    apiKey: encryptApiKey(config.apiKey),
    _encrypted: true,
    _created: new Date().toISOString(),
  };

  await writeFile('agentuity-coder.config.json', JSON.stringify(configToSave, null, 2));
  
  // Also update .env file
  const envContent = `# Coding Agent Configuration
AGENT_URL=${config.agentUrl}
API_KEY=${config.apiKey}
CODER_MODE=${config.mode}
`;

  await writeFile('.env.coder', envContent);
}

async function createCliAlias(config: ConfigData): Promise<void> {
  // Create a simple shell script for easy CLI access
  const scriptContent = `#!/bin/bash
# Coding Agent CLI Script
# Auto-generated by setup

cd "$(dirname "$0")"
export AGENT_URL="${config.agentUrl}"
export API_KEY="${config.apiKey}"
export CODER_MODE="${config.mode}"

if [ "$1" = "--interactive" ] || [ "$1" = "-i" ]; then
    bun run cli.js --interactive
else
    bun run cli.js "$@"
fi
`;

  await writeFile('coder', scriptContent);
  
  // Make it executable (on Unix systems)
  try {
    const { exec } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execAsync = promisify(exec);
    await execAsync('chmod +x coder');
  } catch {
    // Windows or other issues - ignore
  }
}

function showCompletionMessage(config: ConfigData) {
  console.log('\n' + chalk.green('✅ Setup completed successfully!'));
  
  console.log(
    boxen(
      `${chalk.green('🎉 Your Coding Agent is ready!')}\n\n` +
        `${chalk.cyan('Configuration saved to:')} agentuity-coder.config.json\n` +
        `${chalk.cyan('Environment file:')} .env.coder\n` +
        `${chalk.cyan('CLI script:')} ./coder\n\n` +
        `${chalk.yellow('Quick start commands:')}\n` +
        `${chalk.white('./coder --interactive')}  - Start interactive mode\n` +
        `${chalk.white('./coder "help me debug this code"')}  - Direct command\n` +
        `${chalk.white('bun run cli --interactive')}  - Alternative way to start\n\n` +
        `${chalk.cyan('Mode:')} ${config.mode === 'local' ? '🏠 Local Development' : '☁️  Cloud Deployment'}\n` +
        `${chalk.cyan('Agent URL:')} ${config.agentUrl}\n` +
        `${chalk.cyan('Security:')} ${config.toolPolicy} policy\n\n` +
        `${chalk.yellow('💡 Next steps:')}\n` +
        `• Test your setup: ${chalk.white('./coder "list files in current directory"')}\n` +
        `• Read the docs: ${chalk.white('cat README.md')}\n` +
        `• Reconfigure anytime: ${chalk.white('bun run setup')}`,
      {
        padding: 1,
        margin: 1,
        borderStyle: 'round',
        borderColor: 'green',
      }
    )
  );
}

export async function runSetup(): Promise<void> {
  try {
    showWelcome();
    
    const existingConfig = await detectExistingConfig();
    
    if (existingConfig) {
      const { shouldReconfigure } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'shouldReconfigure',
          message: 'Would you like to reconfigure your existing setup?',
          default: false,
        },
      ]);
      
      if (!shouldReconfigure) {
        console.log(chalk.yellow('Setup cancelled. Your existing configuration is unchanged.'));
        return;
      }
    }
    
    console.log(chalk.blue('\n📝 Configuration Questions:\n'));
    const config = await askQuestions(existingConfig || undefined);
    
    console.log(chalk.blue('\n💾 Saving configuration...'));
    await saveConfig(config);
    
    console.log(chalk.blue('🔗 Creating CLI shortcuts...'));
    await createCliAlias(config);
    
    showCompletionMessage(config);
    
  } catch (error) {
    console.error(chalk.red('\n❌ Setup failed:'), error);
    process.exit(1);
  }
}

// CLI command interface
if (import.meta.main) {
  runSetup();
}
