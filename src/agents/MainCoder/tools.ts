import { z } from 'zod';
import { readFile, writeFile, readdir, mkdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { diffLines, diffWords } from 'diff';
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

// Diff Tools
export const diffFilesSchema = z.object({
	file1: z.string().describe('Path to the first file (or "original" content)'),
	file2: z.string().describe('Path to the second file (or "modified" content)'),
	useDelta: z.boolean().optional().describe('Whether to use delta for enhanced diff display (default: true)'),
	context: z.number().optional().describe('Number of context lines to show (default: 3)'),
});

// Context Management Tools
export const setWorkContextSchema = z.object({
	goal: z.string().describe('The main goal or objective of the current work session'),
	description: z.string().optional().describe('Detailed description of what we are working on'),
	files: z.array(z.string()).optional().describe('Key files involved in this work'),
	status: z.enum(['starting', 'in-progress', 'testing', 'complete']).optional().describe('Current status of the work'),
});

export const getWorkContextSchema = z.object({
	includeHistory: z.boolean().optional().describe('Whether to include previous work sessions (default: false)'),
});

export const gitDiffSchema = z.object({
	files: z.array(z.string()).optional().describe('Specific files to diff (default: all changed files)'),
	staged: z.boolean().optional().describe('Show staged changes (default: false)'),
	useDelta: z.boolean().optional().describe('Whether to use delta for enhanced diff display (default: true)'),
	saveToFile: z.string().optional().describe('Save full diff to this file instead of displaying (useful for large diffs)'),
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

// Diff helper functions
function formatBuiltinDiff(diff: Array<{added?: boolean; removed?: boolean; value: string}>, file1Name: string, file2Name: string): string {
	let result = `--- ${file1Name}\n+++ ${file2Name}\n`;
	
	for (const part of diff) {
		const lines = part.value.split('\n');
		for (const line of lines) {
			if (line === '' && lines.indexOf(line) === lines.length - 1) continue; // Skip final empty line
			
			if (part.added) {
				result += `+${line}\n`;
			} else if (part.removed) {
				result += `-${line}\n`;
			} else {
				result += ` ${line}\n`;
			}
		}
	}
	
	return result;
}

async function checkDeltaAvailable(): Promise<boolean> {
	try {
		await execAsync('which delta');
		return true;
	} catch {
		return false;
	}
}

export const diffFilesTool: Tool = {
	name: 'diff_files',
	description: 'Compare two files and show a beautiful diff. Use this to see changes between file versions.',
	parameters: diffFilesSchema,
	execute: async (params, ctx) => {
		try {
			const { file1, file2, useDelta = true, context = 3 } = params as {
				file1: string;
				file2: string;
				useDelta?: boolean;
				context?: number;
			};

			// Read file contents
			let content1: string;
			let content2: string;
			let file1Name = file1;
			let file2Name = file2;

			try {
				content1 = await readFile(file1, 'utf-8');
			} catch {
				// If file1 doesn't exist, treat it as content
				content1 = file1;
				file1Name = 'original';
			}

			try {
				content2 = await readFile(file2, 'utf-8');
			} catch {
				// If file2 doesn't exist, treat it as content
				content2 = file2;
				file2Name = 'modified';
			}

			ctx.logger.info(`Generating diff between ${file1Name} and ${file2Name}`);

			// Check if contents are the same
			if (content1 === content2) {
				return `✅ Files are identical: ${file1Name} and ${file2Name}`;
			}

			// Try delta first if requested and available
			if (useDelta && await checkDeltaAvailable()) {
				try {
					// Create temporary files for delta
					const tempDir = '/tmp';
					const temp1 = join(tempDir, `diff_${Date.now()}_1.tmp`);
					const temp2 = join(tempDir, `diff_${Date.now()}_2.tmp`);

					await writeFile(temp1, content1);
					await writeFile(temp2, content2);

					const result = await execAsync(`delta --file-style omit --hunk-header-style omit "${temp1}" "${temp2}"`, {
						maxBuffer: 1024 * 1024 * 5 // 5MB buffer
					});

					// Cleanup temp files
					try {
						await execAsync(`rm "${temp1}" "${temp2}"`);
					} catch {
						// Ignore cleanup errors
					}

					return `🎨 Diff (via delta):\n\`\`\`diff\n${result.stdout}\n\`\`\``;
				} catch (deltaError) {
					ctx.logger.warn('Delta failed, falling back to built-in diff:', deltaError);
				}
			}

			// Fallback to built-in diff
			const diff = diffLines(content1, content2);
			const diffOutput = formatBuiltinDiff(diff, file1Name, file2Name);

			return `📄 Diff:\n\`\`\`diff\n${diffOutput}\n\`\`\``;

		} catch (error) {
			ctx.logger.error('Error generating diff:', error);
			return `❌ Error generating diff: ${error instanceof Error ? error.message : 'Unknown error'}`;
		}
	}
};

// Helper function to get diff statistics
async function getDiffStats(): Promise<string> {
	try {
		const result = await execAsync('git diff --stat');
		return result.stdout.trim();
	} catch {
		return '';
	}
}

// Helper function to intelligently truncate diff
function truncateDiff(diffOutput: string, maxLines: number = 100): { truncated: string; wasTruncated: boolean; totalLines: number } {
	const lines = diffOutput.split('\n');
	const totalLines = lines.length;
	
	if (lines.length <= maxLines) {
		return { truncated: diffOutput, wasTruncated: false, totalLines };
	}
	
	// Keep first 70% of lines for context, last 10% for recent changes
	const keepStart = Math.floor(maxLines * 0.7);
	const keepEnd = Math.floor(maxLines * 0.1);
	
	const truncated = [
		...lines.slice(0, keepStart),
		`\n... [${lines.length - keepStart - keepEnd} lines truncated] ...\n`,
		...lines.slice(-keepEnd)
	].join('\n');
	
	return { truncated, wasTruncated: true, totalLines };
}

export const gitDiffTool: Tool = {
	name: 'git_diff',
	description: 'Show git diff for changed files with intelligent handling of large diffs. Use this to see what has changed in the repository.',
	parameters: gitDiffSchema,
	execute: async (params, ctx) => {
		try {
			const { files = [], staged = false, useDelta = true, saveToFile } = params as {
				files?: string[];
				staged?: boolean;
				useDelta?: boolean;
				saveToFile?: string;
			};

			let command = 'git diff';
			if (staged) command += ' --cached';
			if (files.length > 0) command += ` -- ${files.join(' ')}`;

			ctx.logger.info(`Running: ${command}`);

			// First, get diff statistics
			const stats = await getDiffStats();
			
			// If saveToFile is specified, save full diff to file
			if (saveToFile) {
				try {
					const result = await execAsync(command);
					if (!result.stdout.trim()) {
						return staged 
							? '✅ No staged changes to save'
							: '✅ No changes to save (working directory is clean)';
					}
					
					await writeFile(saveToFile, result.stdout);
					return `💾 **Full diff saved to file:** \`${saveToFile}\`\n\n📊 **Statistics:**\n\`\`\`\n${stats}\n\`\`\`\n\n🔍 **View with:** \`less ${saveToFile}\` or open in your editor`;
				} catch (error) {
					ctx.logger.error('Error saving diff to file:', error);
					return `❌ Error saving diff to file: ${error instanceof Error ? error.message : 'Unknown error'}`;
				}
			}
			
			// Try with delta first if available
			if (useDelta && await checkDeltaAvailable()) {
				try {
					const result = await execAsync(`${command} | delta --features decorations --file-style omit`, {
						maxBuffer: 1024 * 1024 * 5 // 5MB buffer
					});

					if (!result.stdout.trim()) {
						return staged 
							? '✅ No staged changes to show'
							: '✅ No changes to show (working directory is clean)';
					}

					// Handle large diffs intelligently
					const { truncated, wasTruncated, totalLines } = truncateDiff(result.stdout, 100);
					
					let output = `📊 **Diff Statistics:**\n\`\`\`\n${stats}\n\`\`\`\n\n`;
					output += `🎨 **Git Diff** (via delta)`;
					
					if (wasTruncated) {
						output += ` - Showing key changes (${totalLines} total lines):\n\n`;
						output += `> 💡 **Large diff detected!** Use \`git diff > changes.patch\` to save full diff to file\n`;
						output += `> 📁 Or ask to see specific files: "Show diff for src/main.py"\n\n`;
					} else {
						output += `:\n\n`;
					}
					
					output += `\`\`\`diff\n${truncated}\n\`\`\``;
					
					if (wasTruncated) {
						output += `\n\n🔍 **To see more:**\n`;
						output += `• Ask for specific files: "Show changes in [filename]"\n`;
						output += `• Use: \`git diff --name-only\` to list changed files\n`;
						output += `• Save full diff: \`git diff > full_changes.patch\``;
					}
					
					return output;
				} catch (deltaError) {
					ctx.logger.warn('Delta failed, falling back to regular git diff:', deltaError);
				}
			}

			// Fallback to regular git diff with same intelligent handling
			const result = await execAsync(command, {
				maxBuffer: 1024 * 1024 * 5 // 5MB buffer
			});

			if (!result.stdout.trim()) {
				return staged 
					? '✅ No staged changes to show'
					: '✅ No changes to show (working directory is clean)';
			}

			const { truncated, wasTruncated, totalLines } = truncateDiff(result.stdout, 100);
			
			let output = `📊 **Diff Statistics:**\n\`\`\`\n${stats}\n\`\`\`\n\n`;
			output += `📄 **Git Diff**`;
			
			if (wasTruncated) {
				output += ` - Showing key changes (${totalLines} total lines):\n\n`;
				output += `> 💡 **Large diff detected!** Use \`git diff > changes.patch\` to save full diff to file\n\n`;
			} else {
				output += `:\n\n`;
			}
			
			output += `\`\`\`diff\n${truncated}\n\`\`\``;
			
			if (wasTruncated) {
				output += `\n\n🔍 **To see more:**\n`;
				output += `• Ask for specific files: "Show changes in [filename]"\n`;
				output += `• Use: \`git diff --name-only\` to list changed files\n`;
				output += `• Save full diff: \`git diff > full_changes.patch\``;
			}
			
			return output;

		} catch (error) {
			ctx.logger.error('Error running git diff:', error);
			
			if (error instanceof Error && 'code' in error) {
				const execError = error as { code: number; stderr?: string };
				if (execError.code === 128) {
					return '❌ Not a git repository or git not available';
				}
			}
			
			return `❌ Error running git diff: ${error instanceof Error ? error.message : 'Unknown error'}`;
		}
	}
};

// Context management interface
interface WorkContext {
	goal: string;
	description?: string;
	files?: string[];
	status?: 'starting' | 'in-progress' | 'testing' | 'complete';
	timestamp: number;
	sessionId: string;
}

export const setWorkContextTool: Tool = {
	name: 'set_work_context',
	description: 'Set the current work context and goals for the session. Use this to remember what we are working on.',
	parameters: setWorkContextSchema,
	execute: async (params, ctx) => {
		try {
			const { goal, description, files = [], status = 'starting' } = params as {
				goal: string;
				description?: string;
				files?: string[];
				status?: 'starting' | 'in-progress' | 'testing' | 'complete';
			};

			const workContext: WorkContext = {
				goal,
				description,
				files,
				status,
				timestamp: Date.now(),
				sessionId: ctx.kv ? 'session_context' : 'default'
			};

			// Save context to KV store
			const contextKey = 'work_context_current';
			await ctx.kv.set('default', contextKey, JSON.stringify(workContext), { ttl: 3600 * 24 * 7 }); // 7 days

			// Also save to history
			const historyKey = `work_context_history_${Date.now()}`;
			await ctx.kv.set('default', historyKey, JSON.stringify(workContext), { ttl: 3600 * 24 * 30 }); // 30 days

			ctx.logger.info(`Set work context: ${goal}`);

			let response = `🎯 **Work Context Set Successfully**\n\n`;
			response += `**Goal:** ${goal}\n`;
			if (description) response += `**Description:** ${description}\n`;
			if (files.length > 0) response += `**Key Files:** ${files.join(', ')}\n`;
			response += `**Status:** ${status}\n`;
			response += `**Session:** ${workContext.sessionId}\n\n`;
			response += `✅ Context saved and will persist across sessions. Use "What are we working on?" to recall this context.`;

			return response;
		} catch (error) {
			ctx.logger.error('Error setting work context:', error);
			return `❌ Error setting work context: ${error instanceof Error ? error.message : 'Unknown error'}`;
		}
	}
};

export const getWorkContextTool: Tool = {
	name: 'get_work_context',
	description: 'Get the current work context and goals. Use this when user asks "what are we working on" or to continue previous work.',
	parameters: getWorkContextSchema,
	execute: async (params, ctx) => {
		try {
			const { includeHistory = false } = params as {
				includeHistory?: boolean;
			};

			// Get current context
			const contextKey = 'work_context_current';
			let currentContext: WorkContext | null = null;

			try {
				const stored = await ctx.kv.get('default', contextKey);
				if (stored.exists) {
					currentContext = JSON.parse(await stored.data.text());
				}
			} catch {
				// No context set
			}

			if (!currentContext) {
				return `📝 **No Active Work Context**\n\nNo current work context is set. Use "Remember that I'm working on [goal]" to set a context for this session.`;
			}

			let response = `🎯 **Current Work Context**\n\n`;
			response += `**Goal:** ${currentContext.goal}\n`;
			if (currentContext.description) response += `**Description:** ${currentContext.description}\n`;
			if (currentContext.files && currentContext.files.length > 0) response += `**Key Files:** ${currentContext.files.join(', ')}\n`;
			response += `**Status:** ${currentContext.status}\n`;
			response += `**Started:** ${new Date(currentContext.timestamp).toLocaleString()}\n`;

			// Include history if requested
			if (includeHistory) {
				response += `\n📚 **Recent Work History:**\n`;
				// This would fetch recent history contexts - simplified for now
				response += `_History feature available - ask to see previous work sessions_\n`;
			}

			response += `\n💡 **Continue working:** You can ask me to continue with this goal or update the context as needed.`;

			return response;
		} catch (error) {
			ctx.logger.error('Error getting work context:', error);
			return `❌ Error getting work context: ${error instanceof Error ? error.message : 'Unknown error'}`;
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
	diffFilesTool,
	gitDiffTool,
	setWorkContextTool,
	getWorkContextTool,
];
