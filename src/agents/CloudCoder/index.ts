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
	sessionId: string;
	toolResults: ToolResult[];
	originalMessage?: string;
}

// Tool schemas (copied from tools.ts but without execution logic)
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

const SYSTEM_PROMPT = `You are an expert coding agent that helps developers write, analyze, and improve code. You have access to powerful tools for file operations, code execution, and shell commands.

IMPORTANT: You are running in CLOUD MODE. When you call tools, they will be executed on the user's LOCAL machine by the CLI client, not in the cloud. The CLI will execute your tool calls and send back the results.

Key capabilities:
- Read and write files in any codebase (executed locally)
- Execute code safely in sandboxed environments (executed locally)
- Run shell commands safely (executed locally)
- Show beautiful diffs with delta integration for file comparisons
- Display git diffs with syntax highlighting and formatting
- Remember work context and goals across sessions
- Maintain conversation continuity and project awareness
- Analyze code structure and suggest improvements
- Help with debugging and testing
- Work with Python, JavaScript, TypeScript, and Go codebases

TOOL EXECUTION FLOW:
1. When you call a tool, it will be sent to the CLI for local execution
2. The CLI will execute the tool on the user's machine
3. The CLI will send back the results
4. You will then continue with your response based on the results

IMPORTANT: Always complete the full task requested by the user. Use multiple tools in sequence as needed:
- If asked "What does X file do?", first locate the file, then read it, then explain its purpose
- If asked to create something, write the code AND test it if possible
- If asked to analyze a project, explore the structure AND examine key files
- If asked to fix an issue, investigate the problem, implement the fix, AND verify it works

Guidelines:
- Always read existing code before making changes
- Test code changes when possible using the execute_code tool
- Use shell commands for git operations, running tests, building projects
- Provide clear explanations of what you're doing and why
- Ask for clarification when requirements are unclear
- Use appropriate file organization and coding best practices
- Be proactive in suggesting improvements and catching potential issues
- Follow through on multi-step tasks - don't stop after the first tool call

When working with files:
- Use relative paths from the current working directory
- Create directories as needed when writing files
- Always check file contents before modifying them
- If exploring a project, examine multiple relevant files to understand the structure

When executing code:
- Choose the appropriate language (python, javascript, typescript)
- Include proper error handling
- Test with sample data when applicable
- Always run code after writing it to verify it works

When using shell commands:
- Use for git operations (status, add, commit, push)
- Run build scripts, tests, and package managers (npm, yarn, bun)
- Common Unix commands are available for file operations
- Commands are safety-checked and sandboxed
- Check command output and explain any issues or results

When showing changes:
- Use git_diff tool to show repository changes with beautiful formatting
- Use diff_files tool to compare specific file versions
- Delta integration provides syntax highlighting and better readability
- Always show diffs when files are modified or when user asks about changes

When managing work context:
- Use set_work_context when user mentions working on something specific
- Use get_work_context when user asks "what are we working on" or wants to continue
- Always check context at start of sessions to maintain continuity
- Update context status as work progresses (starting → in-progress → testing → complete)`;

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

			// Add user message to context
			conversationContext.messages.push({
				role: 'user',
				content: userMessage,
				timestamp: Date.now()
			});
		}

		// Prepare messages for AI
		const messages = conversationContext.messages.map(msg => ({
			role: msg.role,
			content: msg.content
		}));

		// Create mock tools that just capture calls instead of executing
		const cloudTools = Object.entries(toolSchemas).reduce((acc, [toolName, schema]) => {
			acc[toolName] = tool({
				description: `${toolName.replace('_', ' ')} tool - will be executed on local machine`,
				parameters: schema,
				execute: async (params) => {
					// This will never actually be called in cloud mode
					// The AI SDK will capture the tool call and we'll stream it
					return `Tool call captured: ${toolName}`;
				}
			});
			return acc;
		}, {} as Record<string, ReturnType<typeof tool>>);

		// Stream response with tool support
		const result = await streamText({
			model: anthropic("claude-4-sonnet-20250514"),
			system: SYSTEM_PROMPT,
			messages,
			tools: cloudTools,
			maxTokens: 4000,
			maxSteps: 5, // Allow multiple tool calls
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

								// Send tool call info to CLI
								const toolCallMessage = `\n🔧 Requesting tool execution: ${chunk.toolName}\n📋 Parameters: ${JSON.stringify(chunk.args, null, 2)}\n`;
								controller.enqueue(toolCallMessage);
								waitingForToolResults = true;
								break;
							}

							case 'tool-result': {
								// In cloud mode, we don't get tool results here
								// They come back via continuation request
								break;
							}

							case 'finish':
								// Stream is complete
								break;

							default:
								// Handle any other chunk types
								break;
						}
					}

					// If we have tool calls, send them as JSON for CLI to process
					if (toolCallsToSend.length > 0) {
						const toolCallsJson = JSON.stringify({
							type: 'tool_calls_required',
							toolCalls: toolCallsToSend,
							sessionId
						});

						controller.enqueue(`\n\n---TOOL_CALLS---\n${toolCallsJson}\n---END_TOOL_CALLS---\n`);
						controller.enqueue('\n⏳ Waiting for local tool execution...\n');
					}

					// Handle tool results if this was a continuation
					if (toolResults.length > 0) {
						controller.enqueue('\n📨 Received tool results:\n');
						for (const result of toolResults) {
							if (result.success) {
								controller.enqueue(`✅ ${result.id}: Success\n${result.result}\n\n`);
							} else {
								controller.enqueue(`❌ ${result.id}: Error\n${result.error}\n\n`);
							}
						}

						// Get the final text content after processing tool results
						const finalText = await result.text;
						assistantMessage = finalText;
					}

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
