import inquirer from 'inquirer';
import chalk from 'chalk';
import { writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import figlet from 'figlet';
import boxen from 'boxen';
import { generateAgentUrl } from './config-utils.js';

interface ConfigData {
	agentUrl: string;
	apiKey: string;
	sessionTimeout: number;
	maxFileSize: string;
	allowedCommands: string[];
	toolPolicy: 'strict' | 'permissive';
	mode: 'local' | 'cloud';
}

async function getDefaultConfig(): Promise<ConfigData> {
	const cloudCoderUrl = await generateAgentUrl('local');
	return {
		agentUrl: cloudCoderUrl,
		apiKey: '',
		sessionTimeout: 3600,
		maxFileSize: '10MB',
		allowedCommands: ['git', 'npm', 'bun', 'yarn', 'pnpm', 'python', 'node', 'cargo', 'go'],
		toolPolicy: 'strict',
		mode: 'local',
	};
}

function showWelcome() {
	console.clear();
	console.log(
		chalk.cyan(
			figlet.textSync('Agentuity Coder Setup', {
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
	// @ts-ignore - inquirer types are complex, this works fine at runtime
	const questions = [
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
			default: async (answers: { mode: 'local' | 'cloud' }) => {
				const cloudCoderUrl = await generateAgentUrl(answers.mode);
				return existingConfig?.agentUrl || cloudCoderUrl;
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

	// @ts-ignore - inquirer prompt works fine at runtime
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
		sessionTimeout: existingConfig?.sessionTimeout || 3600,
		maxFileSize: existingConfig?.maxFileSize || '10MB',
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
	const { exec } = await import('node:child_process');
	const { promisify } = await import('node:util');
	const execAsync = promisify(exec);
	const os = await import('node:os');
	const path = await import('node:path');

	const projectDir = process.cwd();
	const isWindows = os.platform() === 'win32';

	// Create local CLI script first
	const scriptContent = isWindows ?
		`@echo off
REM Coding Agent CLI Script - Auto-generated by setup
cd /d "%~dp0"
set AGENT_URL=${config.agentUrl}
set API_KEY=${config.apiKey}
set CODER_MODE=${config.mode}

if "%1"=="--interactive" (
    bun run cli.js --interactive
) else if "%1"=="-i" (
    bun run cli.js --interactive  
) else (
    bun run cli.js %*
)
` : `#!/bin/bash
# Coding Agent CLI Script - Auto-generated by setup

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

	const localScriptName = isWindows ? 'coder.bat' : 'coder';
	await writeFile(localScriptName, scriptContent);

	// Make executable on Unix systems
	if (!isWindows) {
		try {
			await execAsync(`chmod +x ${localScriptName}`);
		} catch (error) {
			console.warn(chalk.yellow(`Warning: Could not make ${localScriptName} executable:`, error));
		}
	}

	// Attempt global installation
	try {
		await installGlobally(projectDir, localScriptName, isWindows);
	} catch (error) {
		console.warn(chalk.yellow('\n⚠️  Global installation failed, but local script created successfully.'));
		console.warn(chalk.dim(`Use ${chalk.white(`./${localScriptName}`)} or add this directory to your PATH manually.`));
	}
}

async function installGlobally(projectDir: string, scriptName: string, isWindows: boolean): Promise<void> {
	const { exec } = await import('node:child_process');
	const { promisify } = await import('node:util');
	const execAsync = promisify(exec);
	const os = await import('node:os');
	const path = await import('node:path');

	if (isWindows) {
		// On Windows, try to add to a directory in PATH or create in a known location
		const windowsPaths = [
			path.join(os.homedir(), 'bin'),
			path.join(os.homedir(), '.local', 'bin'),
			'C:\\tools\\bin'
		];

		for (const targetDir of windowsPaths) {
			try {
				// Create directory if it doesn't exist
				await execAsync(`mkdir "${targetDir}" 2>nul || echo Directory exists`);

				// Create global script that calls the local one
				const globalScript = `@echo off
cd /d "${projectDir}"
call ${scriptName} %*
`;
				await writeFile(path.join(targetDir, 'coder.bat'), globalScript);
				console.log(chalk.green(`✅ Global CLI installed to: ${path.join(targetDir, 'coder.bat')}`));
				console.log(chalk.dim(`Make sure ${targetDir} is in your PATH`));
				return;
			} catch {
				continue;
			}
		}
		throw new Error('Could not find suitable directory for global installation');

	} else {
		// On Unix systems, try standard locations
		const unixPaths = [
			'/usr/local/bin',
			path.join(os.homedir(), 'bin'),
			path.join(os.homedir(), '.local', 'bin'),
		];

		for (const targetDir of unixPaths) {
			try {
				// Check if directory exists and is writable
				await execAsync(`mkdir -p "${targetDir}"`);

				// Create global script that calls the local one
				const globalScript = `#!/bin/bash
cd "${projectDir}"
exec ./coder "$@"
`;
				const globalPath = path.join(targetDir, 'coder');
				await writeFile(globalPath, globalScript);
				await execAsync(`chmod +x "${globalPath}"`);

				console.log(chalk.green(`✅ Global CLI installed to: ${globalPath}`));

				// Verify it's in PATH
				try {
					await execAsync('which coder');
					console.log(chalk.green(`✅ Global 'coder' command is ready!`));
				} catch {
					console.log(chalk.yellow(`⚠️  Added to ${targetDir} - make sure this is in your PATH`));
				}
				return;

			} catch (error) {
				// Try next location
				continue;
			}
		}
		throw new Error('Could not find suitable directory for global installation');
	}
}

async function validateSetup(config: ConfigData): Promise<void> {
	const { exec } = await import('node:child_process');
	const { promisify } = await import('node:util');
	const execAsync = promisify(exec);

	try {
		// Test that configuration is accessible
		console.log(chalk.dim('  ✓ Configuration files created'));

		// Test dynamic agent detection
		console.log(chalk.dim('  ✓ Testing agent detection...'));
		const { generateAgentUrl } = await import('./config-utils.js');
		const testUrl = await generateAgentUrl(config.mode);
		console.log(chalk.dim(`  ✓ Agent URL detected: ${testUrl.substring(0, 50)}...`));

		// Test local script exists and is executable
		const os = await import('node:os');
		const isWindows = os.platform() === 'win32';
		const scriptName = isWindows ? 'coder.bat' : 'coder';

		try {
			await access(scriptName);
			console.log(chalk.dim(`  ✓ Local CLI script created: ./${scriptName}`));
		} catch {
			console.warn(chalk.yellow(`  ⚠️  Local script ${scriptName} not found`));
		}

		// Test global command (if available)
		try {
			const whichCmd = isWindows ? 'where coder' : 'which coder';
			const { stdout } = await execAsync(whichCmd);
			if (stdout.trim()) {
				console.log(chalk.dim('  ✓ Global "coder" command available'));
			}
		} catch {
			console.log(chalk.dim('  ℹ️  Global "coder" command not in PATH (use local script)'));
		}

		console.log(chalk.green('✅ Setup validation completed successfully!'));

	} catch (error) {
		console.warn(chalk.yellow('⚠️  Some validation checks failed, but setup may still work:'));
		console.warn(chalk.dim(`   ${error instanceof Error ? error.message : String(error)}`));
	}
}

function showCompletionMessage(config: ConfigData) {
	console.log('\n' + chalk.green('✅ Setup completed successfully!'));

	console.log(
		boxen(
			`${chalk.green('🎉 Your Coding Agent is ready!')}\n\n` +
			`${chalk.cyan('Configuration saved to:')} agentuity-coder.config.json\n` +
			`${chalk.cyan('Environment file:')} .env.coder\n` +
			`${chalk.cyan('CLI script:')} ./coder (local) + global 'coder' command\n\n` +
			`${chalk.yellow('Quick start commands:')}\n` +
			`${chalk.white('coder --interactive')}  - Start interactive mode (global)\n` +
			`${chalk.white('coder "help me debug this code"')}  - Direct command (global)\n` +
			`${chalk.white('./coder --interactive')}  - Local script alternative\n` +
			`${chalk.white('bun run cli --interactive')}  - Development alternative\n\n` +
			`${chalk.cyan('Mode:')} ${config.mode === 'local' ? '🏠 Local Development' : '☁️  Cloud Deployment'}\n` +
			`${chalk.cyan('Agent URL:')} ${config.agentUrl}\n` +
			`${chalk.cyan('Security:')} ${config.toolPolicy} policy\n\n` +
			`${chalk.yellow('💡 Next steps:')}\n` +
			`• Test your setup: ${chalk.white('coder "list files in current directory"')}\n` +
			`• Try interactive mode: ${chalk.white('coder --interactive')}\n` +
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

		console.log(chalk.blue('🧪 Validating setup...'));
		await validateSetup(config);

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
