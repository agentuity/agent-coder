import type { AgentContext, AgentRequest, AgentResponse } from '@agentuity/sdk';
import { anthropic } from '@ai-sdk/anthropic';
import { streamText, tool } from 'ai';
import { z } from 'zod';

interface ConversationMessage {
	role: 'user' | 'assistant';
	content: string;
	timestamp: number;
}

interface ConversationContext {
	messages: ConversationMessage[];
	projectPath?: string;
	workingDirectory?: string;
}

interface ToolCall {
	id: string;
	type: 'tool_call';
	toolName: string;
	parameters: Record<string, unknown>;
}

interface ToolResult {
	id: string;
	success: boolean;
	result?: string;
	error?: string;
}

interface ContinuationRequest {
	type: 'continuation';
	sessionId: string;
	toolResults: ToolResult[];
	originalMessage?: string;
}

const toolSchemas = {
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
		confirm: z.boolean().optional().default(true).describe('Confirm deletion (default: true)'),
	}),
	grep_search: z.object({
		pattern: z.string().describe('Regex pattern to search for'),
		path: z.string().optional().describe('Directory to search in (default: current directory)'),
		filePattern: z.string().optional().describe('File pattern to match (e.g., *.ts, *.py)'),
		caseSensitive: z.boolean().optional().default(false).describe('Case sensitive search (default: false)'),
	}),
	find_files: z.object({
		pattern: z.string().describe('File name pattern to find (supports wildcards)'),
		path: z.string().optional().describe('Starting directory (default: current directory)'),
		type: z.enum(['file', 'directory', 'both']).optional().default('file').describe('Type to search for'),
	}),
	execute_code: z.object({
		language: z.enum(['python', 'javascript', 'typescript']).describe('The programming language'),
		code: z.string().describe('The code to execute'),
		input: z.string().optional().describe('Optional input data for the code'),
	}),
	run_command: z.object({
		command: z.string().describe('The shell command to execute'),
		workingDir: z.string().optional().describe('The working directory to run the command in (default: current directory)'),
		timeout: z.number().optional().describe('Timeout in milliseconds (default: 30000)'),
	}),
	diff_files: z.object({
		file1: z.string().describe('Path to the first file (or "original" content)'),
		file2: z.string().describe('Path to the second file (or "modified" content)'),
		useDelta: z.boolean().optional().describe('Whether to use delta for enhanced diff display (default: true)'),
		context: z.number().optional().describe('Number of context lines to show (default: 3)'),
	}),
	git_diff: z.object({
		files: z.array(z.string()).optional().describe('Specific files to diff (default: all changed files)'),
		staged: z.boolean().optional().describe('Show staged changes (default: false)'),
		useDelta: z.boolean().optional().describe('Whether to use delta for enhanced diff display (default: true)'),
		saveToFile: z.string().optional().describe('Save full diff to this file instead of displaying (useful for large diffs)'),
	}),
	set_work_context: z.object({
		goal: z.string().describe('The main goal or objective of the current work session'),
		description: z.string().optional().describe('Detailed description of what we are working on'),
		files: z.array(z.string()).optional().describe('Key files involved in this work'),
		status: z.enum(['starting', 'in-progress', 'testing', 'complete']).optional().describe('Current status of the work'),
	}),
	get_work_context: z.object({
		includeHistory: z.boolean().optional().describe('Whether to include previous work sessions (default: false)'),
	}),
};

const SYSTEM_PROMPT = `You are CloudCoder, an expert AI coding assistant by Agentuity. You execute tools on the user's local machine via CLI.

## CORE PRINCIPLES

1. **BE EFFICIENT**: Only use tools when absolutely necessary. Tools are expensive.
   - If you know the answer, respond without tools
   - Plan all tool calls upfront and execute in parallel when possible
   - Never make redundant calls (e.g., reading the same file twice)

2. **BE COMPLETE**: You're an agent. Finish the ENTIRE task.
   - "What does X do?" → Find it → Read it → Explain it
   - "Create Y" → Write code → Test it → Verify it works
   - "Fix bug Z" → Investigate → Fix → Test → Verify
   - Don't stop after first tool call - chain operations until task is complete

3. **BE CONCISE**: Action-oriented responses only.
   - No lengthy explanations unless requested
   - Show results, not process descriptions
   - Get straight to the point

4. **BE PROACTIVE**: Don't ask permission. Just do it.
   - Chain operations to complete tasks
   - Retry up to 3 times on failure
   - Only ask when truly stuck

## TOOL EXECUTION MODEL
- You run in cloud, tools execute on user's local machine
- Tool calls are sent to CLI → executed locally → results returned
- Use multiple tools in sequence as needed
- Plan tool usage upfront for efficiency

## CODE QUALITY
- Fix root causes, not symptoms  
- Match existing code style exactly
- Remove ALL debug comments before finishing
- Test changes when possible
- Use appropriate file organization

## TECHNICAL GUIDELINES

### File Operations
- Use relative paths from current working directory
- Create directories as needed when writing files
- Always check file contents before modifying them
- Use move_file for reorganization, delete_file for cleanup

### Code Execution (Python/JS/TS)
- Include proper error handling in all code
- Test with sample data when applicable
- Always run code after writing to verify it works
- Commands are safety-checked and sandboxed

### Shell Commands
- Git operations: status, add, commit, push, build tools
- Package managers: npm, yarn, bun supported
- All commands are safety-checked and sandboxed

### Diffs & Changes
- Use git_diff for repository changes (has delta syntax highlighting)
- Use diff_files for specific file comparisons
- Always show diffs when files are modified
- Delta integration provides enhanced readability

### Work Context
- Use set_work_context when user mentions specific work
- Progress status: starting → in-progress → testing → complete
- Use get_work_context when user asks "what are we working on"

Remember: Complete the task. Use tools wisely. Be brief.`;

// Helper function to check if request is a continuation
function isContinuationRequest(data: string): { isContinuation: boolean; parsedData?: ContinuationRequest } {
	try {
		const parsed = JSON.parse(data);
		if (parsed.toolResults && Array.isArray(parsed.toolResults) && parsed.sessionId) {
			return { isContinuation: true, parsedData: parsed as ContinuationRequest };
		}
	} catch {
		// Not JSON, regular message
	}
	return { isContinuation: false };
}

export default async function CloudAgent(
	req: AgentRequest,
	resp: AgentResponse,
	ctx: AgentContext
) {
	try {
		const rawData = (await req.data.text()) ?? 'Hello! I need help with coding.';

		// Check if this is a continuation request (tool results)
		const { isContinuation, parsedData } = isContinuationRequest(rawData);

		// Get or create conversation context from KV store
		const sessionId = req.get('x-session-id', 'default') as string;
		const contextKey = `conversation_${sessionId}`;

		let conversationContext: ConversationContext;
		try {
			const stored = await ctx.kv.get('default', contextKey);
			conversationContext = stored.exists ? JSON.parse(await stored.data.text()) : { messages: [] };
		} catch {
			conversationContext = { messages: [] };
		}

		let userMessage: string;
		let toolResults: ToolResult[] = [];

		if (isContinuation && parsedData) {
			// This is a continuation with tool results
			userMessage = parsedData.originalMessage || 'Continue processing';
			toolResults = parsedData.toolResults;
			ctx.logger.info(`Received continuation with ${toolResults.length} tool results`);
		} else {
			// Regular user message
			userMessage = rawData;

			// Add user message to context (only for non-continuation requests)
			if (userMessage?.trim()) {
				conversationContext.messages.push({
					role: 'user',
					content: userMessage.trim(),
					timestamp: Date.now()
				});
			}
		}

		// Handle continuation differently
		if (isContinuation && parsedData) {
			// Intelligently process tool results
			const errors = toolResults.filter(r => !r.success);
			const successes = toolResults.filter(r => r.success);
			
			let responseText = '';
			
			// Only show errors prominently
			if (errors.length > 0) {
				responseText += `❌ ${errors.length} tool(s) failed:\n`;
				for (const err of errors) {
					responseText += `• ${err.id}: ${err.error}\n`;
				}
				responseText += '\n';
			}
			
			// Summarize successful results concisely
			if (successes.length > 0) {
				const fileReads = successes.filter(r => r.id.includes('read_file'));
				const fileWrites = successes.filter(r => r.id.includes('write_file'));
				const commands = successes.filter(r => r.id.includes('run_command'));
				const searches = successes.filter(r => r.id.includes('grep_search') || r.id.includes('find_files'));
				
				if (fileReads.length > 0) responseText += `📄 Read ${fileReads.length} file(s)\n`;
				if (fileWrites.length > 0) responseText += `✏️  Modified ${fileWrites.length} file(s)\n`;
				if (commands.length > 0) responseText += `⚡ Executed ${commands.length} command(s)\n`;
				if (searches.length > 0) {
					const totalMatches = searches.reduce((sum, s) => 
						sum + (s.result?.split('\n').length || 0), 0);
					responseText += `🔍 Found ${totalMatches} search result(s)\n`;
				}
			}
			
			responseText += '\nTask completed.';

			// Add assistant response to context
			conversationContext.messages.push({
				role: 'assistant',
				content: responseText,
				timestamp: Date.now()
			});

			// Save updated context
			await ctx.kv.set('default', contextKey, JSON.stringify(conversationContext), { ttl: 3600 * 24 * 7 });

			return await resp.text(responseText);
		}

		// Prepare messages for AI - filter out empty content
		const messages = conversationContext.messages
			.filter(msg => msg.content?.trim()?.length > 0)
			.map(msg => ({
				role: msg.role,
				content: msg.content.trim()
			}));

		// Ensure we have at least one message
		if (messages.length === 0) {
			messages.push({
				role: 'user',
				content: userMessage || 'Hello'
			});
		}

		// Create mock tools that just capture calls instead of executing
		const cloudTools = {
			read_file: tool({
				description: 'Read file - will be executed on local machine',
				parameters: toolSchemas.read_file,
				execute: async () => 'Tool call captured'
			}),
			write_file: tool({
				description: 'Write file - will be executed on local machine',
				parameters: toolSchemas.write_file,
				execute: async () => 'Tool call captured'
			}),
			list_directory: tool({
				description: 'List directory - will be executed on local machine',
				parameters: toolSchemas.list_directory,
				execute: async () => 'Tool call captured'
			}),
			create_directory: tool({
				description: 'Create directory - will be executed on local machine',
				parameters: toolSchemas.create_directory,
				execute: async () => 'Tool call captured'
			}),
			move_file: tool({
				description: 'Move/rename file - will be executed on local machine',
				parameters: toolSchemas.move_file,
				execute: async () => 'Tool call captured'
			}),
			delete_file: tool({
				description: 'Delete file - will be executed on local machine',
				parameters: toolSchemas.delete_file,
				execute: async () => 'Tool call captured'
			}),
			grep_search: tool({
				description: 'Search for pattern in files - will be executed on local machine',
				parameters: toolSchemas.grep_search,
				execute: async () => 'Tool call captured'
			}),
			find_files: tool({
				description: 'Find files by pattern - will be executed on local machine',
				parameters: toolSchemas.find_files,
				execute: async () => 'Tool call captured'
			}),
			execute_code: tool({
				description: 'Execute code - will be executed on local machine',
				parameters: toolSchemas.execute_code,
				execute: async () => 'Tool call captured'
			}),
			run_command: tool({
				description: 'Run command - will be executed on local machine',
				parameters: toolSchemas.run_command,
				execute: async () => 'Tool call captured'
			}),
			diff_files: tool({
				description: 'Diff files - will be executed on local machine',
				parameters: toolSchemas.diff_files,
				execute: async () => 'Tool call captured'
			}),
			git_diff: tool({
				description: 'Git diff - will be executed on local machine',
				parameters: toolSchemas.git_diff,
				execute: async () => 'Tool call captured'
			}),
			set_work_context: tool({
				description: 'Set work context - will be executed on local machine',
				parameters: toolSchemas.set_work_context,
				execute: async () => 'Tool call captured'
			}),
			get_work_context: tool({
				description: 'Get work context - will be executed on local machine',
				parameters: toolSchemas.get_work_context,
				execute: async () => 'Tool call captured'
			})
		};

		// Stream response with tool support
		const result = await streamText({
			model: anthropic("claude-4-sonnet-20250514"),
			system: SYSTEM_PROMPT,
			messages,
			// @ts-ignore - Type workaround for cloud mode
			tools: cloudTools,
			maxSteps: 10,
		});

		// Create response stream that handles tool calls differently
		const responseStream = new ReadableStream({
			async start(controller) {
				let assistantMessage = '';
				const toolCallsToSend: ToolCall[] = [];
				let waitingForToolResults = false;

				try {
					// Handle the complete stream including tool calls
					for await (const chunk of result.fullStream) {
						switch (chunk.type) {
							case 'text-delta': {
								assistantMessage += chunk.textDelta;
								controller.enqueue(chunk.textDelta);
								break;
							}

							case 'tool-call': {
								// Instead of executing, capture the tool call
								const toolCall: ToolCall = {
									id: chunk.toolCallId,
									type: 'tool_call',
									toolName: chunk.toolName,
									parameters: chunk.args,
								};

								toolCallsToSend.push(toolCall);

								// Show only the clean tool name
								controller.enqueue(`\n🔧 ${chunk.toolName}`);
								waitingForToolResults = true;
								break;
							}

							// tool-result is handled via continuation requests in cloud mode

							case 'finish':
								// Stream is complete
								break;

							default:
								// Handle any other chunk types
								break;
						}
					}

					// If we have tool calls, send them in a completely hidden way for CLI to parse
					if (toolCallsToSend.length > 0) {
						const toolCallsJson = JSON.stringify({
							type: 'tool_calls_required',
							toolCalls: toolCallsToSend,
							sessionId
						});

						// Send tool calls in a way that's completely invisible to user
						controller.enqueue(`\n__TOOL_CALLS_HIDDEN__${toolCallsJson}__END_CALLS_HIDDEN__\n`);
					}

					// Tool results are handled separately for continuation requests

					// Add assistant response to context
					conversationContext.messages.push({
						role: 'assistant',
						content: assistantMessage,
						timestamp: Date.now()
					});

					// Keep only last 20 messages to prevent KV from getting too large
					if (conversationContext.messages.length > 20) {
						conversationContext.messages = conversationContext.messages.slice(-20);
					}

					// Save updated context to KV store
					await ctx.kv.set('default', contextKey, JSON.stringify(conversationContext), { ttl: 3600 * 24 * 7 }); // 7 days TTL

					ctx.logger.info(`Processed request for session ${sessionId}, tool calls: ${toolCallsToSend.length}, tool results: ${toolResults.length}`);
				} catch (error) {
					ctx.logger.error('Error in stream:', error);
					controller.error(error);
				} finally {
					controller.close();
				}
			}
		});

		return await resp.stream(responseStream, 'text/plain');

	} catch (error) {
		ctx.logger.error('Error running cloud agent:', error);
		return await resp.text('Sorry, there was an error processing your request. Please try again.');
	}
}
