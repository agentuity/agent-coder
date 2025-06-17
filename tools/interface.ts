import { z } from 'zod';

// Shared tool interface for both local and cloud execution
export interface ToolCall {
  id: string;
  type: 'tool_call';
  toolName: string;
  parameters: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  success: boolean;
  result?: string;
  error?: string;
}

export interface ContinuationRequest {
  type: 'continuation';
  sessionId: string;
  toolResults: ToolResult[];
  originalMessage?: string;
}

export interface ToolCallsMessage {
  type: 'tool_calls_required';
  toolCalls: ToolCall[];
  sessionId: string;
}

// Tool schemas - shared between local and cloud agents
export const toolSchemas = {
  read_file: z.object({
    path: z.string().describe('The file path to read'),
  }),

  write_file: z.object({
    path: z.string().describe('The file path to write to'),
    content: z.string().describe('The content to write to the file'),
  }),

  list_directory: z.object({
    path: z.string().describe('The directory path to list'),
  }),

  create_directory: z.object({
    path: z.string().describe('The directory path to create'),
  }),

  move_file: z.object({
    source: z.string().describe('Source file path'),
    destination: z.string().describe('Destination file path'),
  }),

  delete_file: z.object({
    path: z.string().describe('File path to delete'),
    confirm: z
      .boolean()
      .optional()
      .default(true)
      .describe('Confirm deletion (default: true)'),
  }),

  grep_search: z.object({
    pattern: z.string().describe('Regex pattern to search for'),
    path: z
      .string()
      .optional()
      .describe('Directory to search in (default: current directory)'),
    filePattern: z
      .string()
      .optional()
      .describe('File pattern to match (e.g., *.ts, *.py)'),
    caseSensitive: z
      .boolean()
      .optional()
      .default(false)
      .describe('Case sensitive search (default: false)'),
  }),

  find_files: z.object({
    pattern: z
      .string()
      .describe('File name pattern to find (supports wildcards)'),
    path: z
      .string()
      .optional()
      .describe('Starting directory (default: current directory)'),
    type: z
      .enum(['file', 'directory', 'both'])
      .optional()
      .default('file')
      .describe('Type to search for'),
  }),

  execute_code: z.object({
    language: z
      .enum(['python', 'javascript', 'typescript'])
      .describe('The programming language'),
    code: z.string().describe('The code to execute'),
    input: z.string().optional().describe('Optional input data for the code'),
  }),

  run_command: z.object({
    command: z.string().describe('The shell command to execute'),
    workingDir: z
      .string()
      .optional()
      .describe(
        'The working directory to run the command in (default: current directory)'
      ),
    timeout: z
      .number()
      .optional()
      .describe('Timeout in milliseconds (default: 30000)'),
  }),

  diff_files: z.object({
    file1: z
      .string()
      .describe('Path to the first file (or "original" content)'),
    file2: z
      .string()
      .describe('Path to the second file (or "modified" content)'),
    useDelta: z
      .boolean()
      .optional()
      .describe(
        'Whether to use delta for enhanced diff display (default: true)'
      ),
    context: z
      .number()
      .optional()
      .describe('Number of context lines to show (default: 3)'),
  }),

  git_diff: z.object({
    files: z
      .array(z.string())
      .optional()
      .describe('Specific files to diff (default: all changed files)'),
    staged: z
      .boolean()
      .optional()
      .describe('Show staged changes (default: false)'),
    useDelta: z
      .boolean()
      .optional()
      .describe(
        'Whether to use delta for enhanced diff display (default: true)'
      ),
    saveToFile: z
      .string()
      .optional()
      .describe(
        'Save full diff to this file instead of displaying (useful for large diffs)'
      ),
  }),

  set_work_context: z.object({
    goal: z
      .string()
      .describe('The main goal or objective of the current work session'),
    description: z
      .string()
      .optional()
      .describe('Detailed description of what we are working on'),
    files: z
      .array(z.string())
      .optional()
      .describe('Key files involved in this work'),
    status: z
      .enum(['starting', 'in-progress', 'testing', 'complete'])
      .optional()
      .describe('Current status of the work'),
  }),

  get_work_context: z.object({
    includeHistory: z
      .boolean()
      .optional()
      .describe('Whether to include previous work sessions (default: false)'),
  }),

  project_context: z.object({
    action: z
      .enum(['analyze', 'get-commands', 'get-config', 'update-goal'])
      .describe('The action to perform'),
    goal: z
      .string()
      .optional()
      .describe(
        'Goal to add to the project context (only for update-goal action)'
      ),
  }),
};

// Tool descriptions for display
export const toolDescriptions = {
  read_file:
    'Read the contents of a file. Use this to examine existing code or configuration files.',
  write_file:
    'Write content to a file. Use this to create new files or modify existing ones.',
  list_directory:
    'List the contents of a directory. Use this to explore project structure.',
  create_directory:
    'Create a new directory. Use this to organize code into proper structure.',
  move_file:
    'Move or rename a file. Use this to reorganize files or change file names.',
  delete_file:
    'Delete a file. Use this to remove unwanted files (requires confirmation by default).',
  grep_search:
    'Search for patterns in files using regex. Use this to find code, functions, or text across multiple files.',
  find_files:
    'Find files by name pattern. Use this to locate specific files or file types in the project.',
  execute_code:
    'Execute code safely in a sandboxed environment. Use this to run and test code.',
  run_command:
    'Execute shell commands safely. Supports git, npm, build tools, and common Unix commands.',
  diff_files:
    'Compare two files and show a beautiful diff. Use this to see changes between file versions.',
  git_diff:
    'Show git diff for changed files with beautiful formatting. Use this to see what has changed in the repository.',
  set_work_context:
    'Set the current work context and goals for the session. Use this to remember what we are working on.',
  get_work_context:
    'Get the current work context and goals. Use this when user asks "what are we working on" or to continue previous work.',
  project_context:
    'Analyze project structure, get suggested commands, manage configuration and goals. Use this to understand the project better.',
};

export type ToolName = keyof typeof toolSchemas;
export type ToolSchema<T extends ToolName> = (typeof toolSchemas)[T];
export type ToolParameters<T extends ToolName> = z.infer<ToolSchema<T>>;
