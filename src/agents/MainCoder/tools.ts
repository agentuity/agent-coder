import { z } from 'zod';
import { readFile, writeFile, readdir, mkdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import Riza from '@riza-io/api';
import type { AgentContext } from '@agentuity/sdk';

// Riza client for code execution
const riza = new Riza({
	apiKey: process.env.RIZA_API_KEY
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

export const allTools: Tool[] = [
	readFileTool,
	writeFileTool,
	listDirectoryTool,
	createDirectoryTool,
	executeCodeTool,
];
