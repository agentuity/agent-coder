import { z } from 'zod';
import { readFile, writeFile, readdir, mkdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import Riza from '@riza-io/api';
import type { AgentContext } from '@agentuity/sdk';

const execAsync = promisify(exec);

// Riza client for code execution
const riza = new Riza({
	apiKey: process.env.RIZA_API_KEY || 'riza_01JXMK7QHNYYJWN38R66270DSR_01JXMK83XX761VMCMP7E0FKHJ0'
});

export interface Tool {
	name: string;
	description: string;
	parameters: z.ZodSchema;
	execute: (params: Record<string, unknown>, ctx: AgentContext) => Promise<string>;
}

// File Operations Tools
export const readFileSchema = z.object({
	path: z.string().describe('The file path to read'),
});

export const writeFileSchema = z.object({
	path: z.string().describe('The file path to write to'),
	content: z.string().describe('The content to write to the file'),
});

export const listDirectorySchema = z.object({
	path: z.string().describe('The directory path to list'),
});

export const createDirectorySchema = z.object({
	path: z.string().describe('The directory path to create'),
});

// Code Execution Tools
export const executeCodeSchema = z.object({
	language: z.enum(['python', 'javascript', 'typescript']).describe('The programming language'),
	code: z.string().describe('The code to execute'),
	input: z.string().optional().describe('Optional input data for the code'),
});

// Shell Command Tools
export const runCommandSchema = z.object({
	command: z.string().describe('The shell command to execute'),
	workingDir: z.string().optional().describe('The working directory to run the command in (default: current directory)'),
	timeout: z.number().optional().describe('Timeout in milliseconds (default: 30000)'),
});

export const readFileTool: Tool = {
	name: 'read_file',
	description: 'Read the contents of a file. Use this to examine existing code or configuration files.',
	parameters: readFileSchema,
	execute: async (params, ctx) => {
		try {
			const { path } = params as { path: string };
			const content = await readFile(path, 'utf-8');
			ctx.logger.info(`Read file: ${path}`);
			return `File content of ${path}:\n\`\`\`\n${content}\n\`\`\``;
		} catch (error) {
			const { path } = params as { path: string };
			ctx.logger.error(`Error reading file ${path}:`, error);
			return `Error reading file ${path}: ${error instanceof Error ? error.message : 'Unknown error'}`;
		}
	}
};

export const writeFileTool: Tool = {
	name: 'write_file',
	description: 'Write content to a file. Use this to create new files or modify existing ones.',
	parameters: writeFileSchema,
	execute: async (params, ctx) => {
		try {
			const { path, content } = params as { path: string; content: string };
			// Ensure directory exists
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, content, 'utf-8');
			ctx.logger.info(`Wrote file: ${path}`);
			return `Successfully wrote content to ${path}`;
		} catch (error) {
			const { path } = params as { path: string };
			ctx.logger.error(`Error writing file ${path}:`, error);
			return `Error writing file ${path}: ${error instanceof Error ? error.message : 'Unknown error'}`;
		}
	}
};

export const listDirectoryTool: Tool = {
	name: 'list_directory',
	description: 'List the contents of a directory. Use this to explore project structure.',
	parameters: listDirectorySchema,
	execute: async (params, ctx) => {
		try {
			const { path } = params as { path: string };
			const files = await readdir(path, { withFileTypes: true });
			const fileList = files.map(file => ({
				name: file.name,
				type: file.isDirectory() ? 'directory' : 'file'
			}));

			ctx.logger.info(`Listed directory: ${path}`);
			return `Contents of ${path}:\n${fileList.map(f => `${f.type === 'directory' ? '📁' : '📄'} ${f.name}`).join('\n')}`;
		} catch (error) {
			const { path } = params as { path: string };
			ctx.logger.error(`Error listing directory ${path}:`, error);
			return `Error listing directory ${path}: ${error instanceof Error ? error.message : 'Unknown error'}`;
		}
	}
};

export const createDirectoryTool: Tool = {
	name: 'create_directory',
	description: 'Create a new directory. Use this to organize code into proper structure.',
	parameters: createDirectorySchema,
	execute: async (params, ctx) => {
		try {
			const { path } = params as { path: string };
			await mkdir(path, { recursive: true });
			ctx.logger.info(`Created directory: ${path}`);
			return `Successfully created directory ${path}`;
		} catch (error) {
			const { path } = params as { path: string };
			ctx.logger.error(`Error creating directory ${path}:`, error);
			return `Error creating directory ${path}: ${error instanceof Error ? error.message : 'Unknown error'}`;
		}
	}
};

export const executeCodeTool: Tool = {
	name: 'execute_code',
	description: 'Execute code safely in a sandboxed environment. Use this to run and test code.',
	parameters: executeCodeSchema,
	execute: async (params, ctx) => {
		try {
			const { language, code, input } = params as { language: string; code: string; input?: string };
			ctx.logger.info(`Executing ${language} code`);

			const execParams = {
				language: language.toUpperCase() as 'PYTHON' | 'JAVASCRIPT' | 'TYPESCRIPT',
				code: code,
				...(input && { input: input })
			};

			const result = await riza.command.exec(execParams);

			const output = [
				`Code execution completed with exit code: ${result.exit_code}`,
				result.stdout && `stdout:\n${result.stdout}`,
				result.stderr && `stderr:\n${result.stderr}`,
			].filter(Boolean).join('\n\n');

			return output;
		} catch (error) {
			ctx.logger.error('Error executing code:', error);
			return `Error executing code: ${error instanceof Error ? error.message : 'Unknown error'}`;
		}
	}
};

// Safety configuration for shell commands
const ALLOWED_COMMANDS = [
	'git', 'npm', 'yarn', 'bun', 'pnpm', 'node', 'python', 'python3', 'pip', 'pip3',
	'cargo', 'rustc', 'go', 'tsc', 'deno', 'docker', 'make', 'cmake',
	'ls', 'pwd', 'cat', 'echo', 'grep', 'find', 'wc', 'head', 'tail',
	'mkdir', 'touch', 'cp', 'mv', 'chmod', 'chown',
	'ps', 'kill', 'killall', 'jobs', 'bg', 'fg'
];

const BLOCKED_PATTERNS = [
	/rm\s+.*-rf/, // Dangerous rm commands
	/sudo/, // Privilege escalation
	/su\s/, // User switching
	/curl.*\|.*sh/, // Piped curl to shell
	/wget.*\|.*sh/, // Piped wget to shell
	/>\s*\/dev\//, // Writing to device files
	/\/etc\//, // Modifying system files
	/\/bin\//, // Modifying system binaries
	/\/usr\//, // Modifying system directories
	/mkfs/, // Format filesystem
	/fdisk/, // Disk partitioning
	/dd\s/, // Direct disk access
];

function isSafeCommand(command: string): { safe: boolean; reason?: string } {
	// Check for blocked patterns
	for (const pattern of BLOCKED_PATTERNS) {
		if (pattern.test(command)) {
			return { safe: false, reason: `Command contains blocked pattern: ${pattern}` };
		}
	}

	// Extract the base command (first word)
	const baseCommand = command.trim().split(/\s+/)[0];
	
	// Check if base command exists and is in allowed list
	if (!baseCommand || !ALLOWED_COMMANDS.includes(baseCommand)) {
		return { safe: false, reason: `Command '${baseCommand || 'empty'}' is not in the allowed list` };
	}

	return { safe: true };
}

export const runCommandTool: Tool = {
	name: 'run_command',
	description: 'Execute shell commands safely. Supports git, npm, build tools, and common Unix commands. Use this for running tests, building projects, git operations, etc.',
	parameters: runCommandSchema,
	execute: async (params, ctx) => {
		try {
			const { command, workingDir = '.', timeout = 30000 } = params as { 
				command: string; 
				workingDir?: string; 
				timeout?: number; 
			};

			// Safety check
			const safetyCheck = isSafeCommand(command);
			if (!safetyCheck.safe) {
				ctx.logger.warn(`Blocked unsafe command: ${command} - ${safetyCheck.reason}`);
				return `❌ Command blocked for safety: ${safetyCheck.reason}`;
			}

			ctx.logger.info(`Executing command: ${command} in ${workingDir}`);

			const result = await execAsync(command, {
				cwd: workingDir,
				timeout: timeout,
				maxBuffer: 1024 * 1024, // 1MB buffer
			});

			const output = [
				`✅ Command executed successfully: \`${command}\``,
				result.stdout && `📄 stdout:\n\`\`\`\n${result.stdout.trim()}\n\`\`\``,
				result.stderr && `⚠️ stderr:\n\`\`\`\n${result.stderr.trim()}\n\`\`\``,
			].filter(Boolean).join('\n\n');

			return output;
		} catch (error) {
			const { command } = params as { command: string };
			ctx.logger.error(`Error executing command: ${command}`, error);
			
			if (error instanceof Error) {
				// Handle different types of execution errors
				if ('code' in error) {
					const execError = error as { code: number; stdout?: string; stderr?: string };
					const parts = [
						`❌ Command failed with exit code ${execError.code}: \`${command}\``,
						execError.stdout ? `📄 stdout:\n\`\`\`\n${execError.stdout.trim()}\n\`\`\`` : '',
						execError.stderr ? `⚠️ stderr:\n\`\`\`\n${execError.stderr.trim()}\n\`\`\`` : ''
					].filter(Boolean);
					return parts.join('\n\n');
				}
				
				if (error.message.includes('timeout')) {
					return `⏱️ Command timed out: \`${command}\``;
				}
				
				return `❌ Command execution error: ${error.message}`;
			}
			
			return `❌ Unknown error executing command: \`${command}\``;
		}
	}
};

export const allTools: Tool[] = [
	readFileTool,
	writeFileTool,
	listDirectoryTool,
	createDirectoryTool,
	executeCodeTool,
	runCommandTool,
];
