import { readFile, writeFile, readdir, mkdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { diffLines } from 'diff';
import Riza from '@riza-io/api';
import type {
  ToolCall,
  ToolResult,
  ToolName,
  ToolParameters,
} from '../tools/interface.js';

const execAsync = promisify(exec);

// Riza client for code execution - requires RIZA_API_KEY environment variable
function createRizaClient() {
  const apiKey = process.env.RIZA_API_KEY;
  if (!apiKey) {
    throw new Error(
      'RIZA_API_KEY environment variable is required for code execution'
    );
  }
  return new Riza({ apiKey });
}

// Logger interface
interface Logger {
  info: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
}

// Mock KV store for local execution
class MockKV {
  private store = new Map<string, { data: string; expires?: number }>();

  async get(namespace: string, key: string) {
    const fullKey = `${namespace}:${key}`;
    const item = this.store.get(fullKey);

    if (!item) {
      return { exists: false };
    }

    if (item.expires && Date.now() > item.expires) {
      this.store.delete(fullKey);
      return { exists: false };
    }

    return {
      exists: true,
      data: {
        text: () => Promise.resolve(item.data),
      },
    };
  }

  async set(
    namespace: string,
    key: string,
    value: string,
    options?: { ttl?: number }
  ) {
    const fullKey = `${namespace}:${key}`;
    const expires = options?.ttl ? Date.now() + options.ttl * 1000 : undefined;
    this.store.set(fullKey, { data: value, expires });
  }
}

// Mock context for tool execution
interface MockContext {
  logger: Logger;
  kv: MockKV;
  workingDirectory: string;
}

// Safety configuration for shell commands
const ALLOWED_COMMANDS = [
  'git',
  'npm',
  'yarn',
  'bun',
  'pnpm',
  'node',
  'python',
  'python3',
  'pip',
  'pip3',
  'cargo',
  'rustc',
  'go',
  'tsc',
  'deno',
  'docker',
  'make',
  'cmake',
  'ls',
  'pwd',
  'cat',
  'echo',
  'grep',
  'find',
  'wc',
  'head',
  'tail',
  'mkdir',
  'touch',
  'cp',
  'mv',
  'chmod',
  'chown',
  'ps',
  'kill',
  'killall',
  'jobs',
  'bg',
  'fg',
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
      return {
        safe: false,
        reason: `Command contains blocked pattern: ${pattern}`,
      };
    }
  }

  // Extract the base command (first word)
  const baseCommand = command.trim().split(/\s+/)[0];

  // Check if base command exists and is in allowed list
  if (!baseCommand || !ALLOWED_COMMANDS.includes(baseCommand)) {
    return {
      safe: false,
      reason: `Command '${baseCommand || 'empty'}' is not in the allowed list`,
    };
  }

  return { safe: true };
}

// Tool execution functions
const toolExecutors = {
  async read_file(
    params: ToolParameters<'read_file'>,
    ctx: MockContext
  ): Promise<string> {
    try {
      const { path } = params;
      const fullPath = join(ctx.workingDirectory, path);
      const content = await readFile(fullPath, 'utf-8');
      ctx.logger.info(`Read file: ${path}`);
      return `File content of ${path}:\n\`\`\`\n${content}\n\`\`\``;
    } catch (error) {
      const { path } = params;
      ctx.logger.error(`Error reading file ${path}:`, error);
      return `Error reading file ${path}: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },

  async write_file(
    params: ToolParameters<'write_file'>,
    ctx: MockContext
  ): Promise<string> {
    try {
      const { path, content } = params;
      const fullPath = join(ctx.workingDirectory, path);
      // Ensure directory exists
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content, 'utf-8');
      ctx.logger.info(`Wrote file: ${path}`);
      return `Successfully wrote content to ${path}`;
    } catch (error) {
      const { path } = params;
      ctx.logger.error(`Error writing file ${path}:`, error);
      return `Error writing file ${path}: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },

  async list_directory(
    params: ToolParameters<'list_directory'>,
    ctx: MockContext
  ): Promise<string> {
    try {
      const { path } = params;
      const fullPath = join(ctx.workingDirectory, path);
      const files = await readdir(fullPath, { withFileTypes: true });
      const fileList = files.map((file) => ({
        name: file.name,
        type: file.isDirectory() ? 'directory' : 'file',
      }));

      ctx.logger.info(`Listed directory: ${path}`);
      return `Contents of ${path}:\n${fileList.map((f) => `${f.type === 'directory' ? '📁' : '📄'} ${f.name}`).join('\n')}`;
    } catch (error) {
      const { path } = params;
      ctx.logger.error(`Error listing directory ${path}:`, error);
      return `Error listing directory ${path}: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },

  async create_directory(
    params: ToolParameters<'create_directory'>,
    ctx: MockContext
  ): Promise<string> {
    try {
      const { path } = params;
      const fullPath = join(ctx.workingDirectory, path);
      await mkdir(fullPath, { recursive: true });
      ctx.logger.info(`Created directory: ${path}`);
      return `Successfully created directory ${path}`;
    } catch (error) {
      const { path } = params;
      ctx.logger.error(`Error creating directory ${path}:`, error);
      return `Error creating directory ${path}: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },

  async move_file(
    params: ToolParameters<'move_file'>,
    ctx: MockContext
  ): Promise<string> {
    try {
      const { source, destination } = params;

      // Ensure destination directory exists
      await mkdir(dirname(destination), { recursive: true });

      // Use Node.js fs to move file (rename)
      const { rename } = await import('node:fs/promises');
      await rename(source, destination);

      ctx.logger.info(`Moved file: ${source} → ${destination}`);
      return `Successfully moved ${source} to ${destination}`;
    } catch (error) {
      const { source, destination } = params;
      ctx.logger.error(`Error moving file ${source} to ${destination}:`, error);
      return `Error moving file ${source} to ${destination}: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },

  async delete_file(
    params: ToolParameters<'delete_file'>,
    ctx: MockContext
  ): Promise<string> {
    try {
      const { path, confirm = true } = params;

      // Basic safety check - don't delete system files
      if (
        path.startsWith('/') ||
        path.includes('..') ||
        path.startsWith('C:')
      ) {
        return `❌ Cannot delete system path: ${path}`;
      }

      const { unlink } = await import('node:fs/promises');
      await unlink(path);

      ctx.logger.info(`Deleted file: ${path}`);
      return `Successfully deleted ${path}`;
    } catch (error) {
      const { path } = params;
      ctx.logger.error(`Error deleting file ${path}:`, error);
      return `Error deleting file ${path}: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },

  async grep_search(
    params: ToolParameters<'grep_search'>,
    ctx: MockContext
  ): Promise<string> {
    try {
      const {
        pattern,
        path = '.',
        filePattern,
        caseSensitive = false,
      } = params;

      let command = `grep -r ${caseSensitive ? '' : '-i'} -n "${pattern}"`;
      if (filePattern) {
        command += ` --include="${filePattern}"`;
      }
      command += ` "${path}"`;

      ctx.logger.info(`Searching for pattern: ${pattern}`);

      const result = await execAsync(command, {
        maxBuffer: 1024 * 1024 * 2, // 2MB buffer
      });

      if (!result.stdout.trim()) {
        return `🔍 No matches found for pattern: ${pattern}`;
      }

      return `🔍 Search results for "${pattern}":\n\`\`\`\n${result.stdout}\n\`\`\``;
    } catch (error) {
      const { pattern } = params;
      ctx.logger.error(`Error searching for pattern ${pattern}:`, error);

      if (error instanceof Error && 'code' in error) {
        const execError = error as { code: number };
        if (execError.code === 1) {
          return `🔍 No matches found for pattern: ${pattern}`;
        }
      }

      return `Error searching for pattern ${pattern}: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },

  async find_files(
    params: ToolParameters<'find_files'>,
    ctx: MockContext
  ): Promise<string> {
    try {
      const { pattern, path = '.', type = 'file' } = params;

      let command = `find "${path}"`;
      if (type === 'file') {
        command += ' -type f';
      } else if (type === 'directory') {
        command += ' -type d';
      }
      command += ` -name "${pattern}"`;

      ctx.logger.info(`Finding files with pattern: ${pattern}`);

      const result = await execAsync(command, {
        maxBuffer: 1024 * 1024, // 1MB buffer
      });

      if (!result.stdout.trim()) {
        return `📁 No files found matching pattern: ${pattern}`;
      }

      const files = result.stdout.trim().split('\n');
      return `📁 Found ${files.length} file(s) matching "${pattern}":\n${files.map((f) => `• ${f}`).join('\n')}`;
    } catch (error) {
      const { pattern } = params;
      ctx.logger.error(`Error finding files with pattern ${pattern}:`, error);
      return `Error finding files with pattern ${pattern}: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },

  async execute_code(
    params: ToolParameters<'execute_code'>,
    ctx: MockContext
  ): Promise<string> {
    try {
      const { language, code, input } = params;
      ctx.logger.info(`Executing ${language} code`);

      // Check if RIZA_API_KEY is available
      try {
        const riza = createRizaClient();
        const execParams = {
          language: language.toUpperCase() as
            | 'PYTHON'
            | 'JAVASCRIPT'
            | 'TYPESCRIPT',
          code: code,
          ...(input && { input: input }),
        };

        const result = await riza.command.exec(execParams);

        const output = [
          `Code execution completed with exit code: ${result.exit_code}`,
          result.stdout && `stdout:\n${result.stdout}`,
          result.stderr && `stderr:\n${result.stderr}`,
        ]
          .filter(Boolean)
          .join('\n\n');

        return output;
      } catch (rizaError) {
        if (
          rizaError instanceof Error &&
          rizaError.message.includes('RIZA_API_KEY')
        ) {
          return `❌ Code execution unavailable: RIZA_API_KEY environment variable not set.\n\nTo enable code execution:\n1. Sign up at https://riza.io\n2. Get your API key\n3. Set RIZA_API_KEY environment variable`;
        }
        throw rizaError;
      }
    } catch (error) {
      ctx.logger.error('Error executing code:', error);
      return `Error executing code: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },

  async run_command(
    params: ToolParameters<'run_command'>,
    ctx: MockContext
  ): Promise<string> {
    try {
      const { command, workingDir = '.', timeout = 30000 } = params;

      // Safety check
      const safetyCheck = isSafeCommand(command);
      if (!safetyCheck.safe) {
        ctx.logger.warn(
          `Blocked unsafe command: ${command} - ${safetyCheck.reason}`
        );
        return `❌ Command blocked for safety: ${safetyCheck.reason}`;
      }

      ctx.logger.info(`Executing command: ${command} in ${workingDir}`);

      const result = await execAsync(command, {
        cwd:
          workingDir === '.'
            ? ctx.workingDirectory
            : join(ctx.workingDirectory, workingDir),
        timeout: timeout,
        maxBuffer: 1024 * 1024, // 1MB buffer
      });

      const output = [
        `✅ Command executed successfully: \`${command}\``,
        result.stdout && `📄 stdout:\n\`\`\`\n${result.stdout.trim()}\n\`\`\``,
        result.stderr && `⚠️ stderr:\n\`\`\`\n${result.stderr.trim()}\n\`\`\``,
      ]
        .filter(Boolean)
        .join('\n\n');

      return output;
    } catch (error) {
      const { command } = params;
      ctx.logger.error(`Error executing command: ${command}`, error);

      if (error instanceof Error) {
        // Handle different types of execution errors
        if ('code' in error) {
          const execError = error as {
            code: number;
            stdout?: string;
            stderr?: string;
          };
          const parts = [
            `❌ Command failed with exit code ${execError.code}: \`${command}\``,
            execError.stdout
              ? `📄 stdout:\n\`\`\`\n${execError.stdout.trim()}\n\`\`\``
              : '',
            execError.stderr
              ? `⚠️ stderr:\n\`\`\`\n${execError.stderr.trim()}\n\`\`\``
              : '',
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
  },

  async diff_files(
    params: ToolParameters<'diff_files'>,
    ctx: MockContext
  ): Promise<string> {
    try {
      const { file1, file2, useDelta = true, context = 3 } = params;

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

      // Use built-in diff
      const diff = diffLines(content1, content2);
      let diffOutput = `--- ${file1Name}\n+++ ${file2Name}\n`;

      for (const part of diff) {
        const lines = part.value.split('\n');
        for (const line of lines) {
          if (line === '' && lines.indexOf(line) === lines.length - 1) continue; // Skip final empty line

          if (part.added) {
            diffOutput += `+${line}\n`;
          } else if (part.removed) {
            diffOutput += `-${line}\n`;
          } else {
            diffOutput += ` ${line}\n`;
          }
        }
      }

      return `📄 Diff:\n\`\`\`diff\n${diffOutput}\n\`\`\``;
    } catch (error) {
      ctx.logger.error('Error generating diff:', error);
      return `❌ Error generating diff: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },

  async git_diff(
    params: ToolParameters<'git_diff'>,
    ctx: MockContext
  ): Promise<string> {
    try {
      const {
        files = [],
        staged = false,
        useDelta = true,
        saveToFile,
      } = params;

      let command = 'git diff';
      if (staged) command += ' --cached';
      if (files.length > 0) command += ` -- ${files.join(' ')}`;

      ctx.logger.info(`Running: ${command}`);

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
          return `💾 **Full diff saved to file:** \`${saveToFile}\`\n\n🔍 **View with:** \`less ${saveToFile}\` or open in your editor`;
        } catch (error) {
          ctx.logger.error('Error saving diff to file:', error);
          return `❌ Error saving diff to file: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
      }

      // Regular git diff
      const result = await execAsync(command, {
        maxBuffer: 1024 * 1024 * 5, // 5MB buffer
      });

      if (!result.stdout.trim()) {
        return staged
          ? '✅ No staged changes to show'
          : '✅ No changes to show (working directory is clean)';
      }

      return `📄 **Git Diff**:\n\n\`\`\`diff\n${result.stdout}\n\`\`\``;
    } catch (error) {
      ctx.logger.error('Error running git diff:', error);

      if (error instanceof Error && 'code' in error) {
        const execError = error as { code: number };
        if (execError.code === 128) {
          return '❌ Not a git repository or git not available';
        }
      }

      return `❌ Error running git diff: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },

  async set_work_context(
    params: ToolParameters<'set_work_context'>,
    ctx: MockContext
  ): Promise<string> {
    try {
      const { goal, description, files = [], status = 'starting' } = params;

      const workContext = {
        goal,
        description,
        files,
        status,
        timestamp: Date.now(),
        sessionId: 'local_session',
      };

      // Save context to mock KV store
      const contextKey = 'work_context_current';
      await ctx.kv.set('default', contextKey, JSON.stringify(workContext), {
        ttl: 3600 * 24 * 7,
      }); // 7 days

      // Also save to history
      const historyKey = `work_context_history_${Date.now()}`;
      await ctx.kv.set('default', historyKey, JSON.stringify(workContext), {
        ttl: 3600 * 24 * 30,
      }); // 30 days

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
  },

  async get_work_context(
    params: ToolParameters<'get_work_context'>,
    ctx: MockContext
  ): Promise<string> {
    try {
      const { includeHistory = false } = params;

      // Get current context
      const contextKey = 'work_context_current';
      let currentContext = null;

      try {
        const stored = await ctx.kv.get('default', contextKey);
        if (stored.exists && stored.data) {
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
      if (currentContext.description)
        response += `**Description:** ${currentContext.description}\n`;
      if (currentContext.files && currentContext.files.length > 0)
        response += `**Key Files:** ${currentContext.files.join(', ')}\n`;
      response += `**Status:** ${currentContext.status}\n`;
      response += `**Started:** ${new Date(currentContext.timestamp).toLocaleString()}\n`;

      // Include history if requested
      if (includeHistory) {
        response += `\n📚 **Recent Work History:**\n`;
        response += `_History feature available - ask to see previous work sessions_\n`;
      }

      response += `\n💡 **Continue working:** You can ask me to continue with this goal or update the context as needed.`;

      return response;
    } catch (error) {
      ctx.logger.error('Error getting work context:', error);
      return `❌ Error getting work context: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },

  async project_context(
    params: ToolParameters<'project_context'>,
    ctx: MockContext
  ): Promise<string> {
    try {
      const { action, goal } = params;

      // Import the handler dynamically to avoid circular dependencies
      const { projectContextHandler } = await import(
        '../src/tools/project-context.js'
      );
      const result = await projectContextHandler({ action, goal });

      if (!result.success) {
        return `❌ ${result.message}`;
      }

      switch (action) {
        case 'analyze':
          return `📊 **Project Analysis**\n\n${result.message}\n\nType: ${result.projectInfo?.type}\nFramework: ${result.projectInfo?.framework || 'none'}\nPackage Manager: ${result.projectInfo?.packageManager || 'none'}`;

        case 'get-commands':
          const commands = result.commands || [];
          if (commands.length === 0) {
            return `📝 No suggested commands found for this project.`;
          }
          return `📝 **Suggested Commands**\n\n${commands.map((cmd: string) => `• ${cmd}`).join('\n')}`;

        case 'get-config':
          return `⚙️ **Project Configuration**\n\n${JSON.stringify(result.config, null, 2)}`;

        case 'update-goal':
          return `✅ ${result.message}\n\nTotal goals: ${result.totalGoals}`;

        default:
          return result.message || 'Operation completed';
      }
    } catch (error) {
      ctx.logger.error('Error with project context:', error);
      return `❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },
};

// Main tool proxy class
export class ToolProxy {
  private logger: Logger;
  private kv: MockKV;
  private ctx: MockContext;
  private workingDirectory: string;

  constructor(logger?: Logger, workingDirectory?: string) {
    this.logger = logger || {
      info: (msg: string, ...args: unknown[]) =>
        console.log(`[INFO] ${msg}`, ...args),
      error: (msg: string, ...args: unknown[]) =>
        console.error(`[ERROR] ${msg}`, ...args),
      warn: (msg: string, ...args: unknown[]) =>
        console.warn(`[WARN] ${msg}`, ...args),
    };

    this.workingDirectory = workingDirectory || process.cwd();
    this.kv = new MockKV();
    this.ctx = {
      logger: this.logger,
      kv: this.kv,
      workingDirectory: this.workingDirectory,
    };
  }

  async executeToolCall(toolCall: ToolCall): Promise<ToolResult> {
    try {
      const { id, toolName, parameters } = toolCall;

      this.logger.info(`Executing tool: ${toolName} with ID: ${id}`);

      if (!(toolName in toolExecutors)) {
        throw new Error(`Unknown tool: ${toolName}`);
      }

      const executor = toolExecutors[toolName as keyof typeof toolExecutors];
      const result = await executor(parameters as never, this.ctx);

      return {
        id,
        success: true,
        result,
      };
    } catch (error) {
      this.logger.error(
        `Tool execution failed for ${toolCall.toolName}:`,
        error
      );
      return {
        id: toolCall.id,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async executeMultipleToolCalls(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const toolCall of toolCalls) {
      const result = await this.executeToolCall(toolCall);
      results.push(result);
    }

    return results;
  }
}
