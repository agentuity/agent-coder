import type { AgentContext, AgentRequest, AgentResponse } from '@agentuity/sdk';
import { anthropic } from '@ai-sdk/anthropic';
import { streamText, tool } from 'ai';
import { 
  readFileSchema, 
  writeFileSchema, 
  listDirectorySchema, 
  createDirectorySchema, 
  executeCodeSchema,
  runCommandSchema,
  readFileTool,
  writeFileTool,
  listDirectoryTool,
  createDirectoryTool,
  executeCodeTool,
  runCommandTool
} from './tools';

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

const SYSTEM_PROMPT = `You are an expert coding agent that helps developers write, analyze, and improve code. You have access to powerful tools for file operations, code execution, and shell commands.

Key capabilities:
- Read and write files in any codebase
- Execute code safely in sandboxed environments (Python, JavaScript, TypeScript)
- Run shell commands safely (git, npm, build tools, Unix commands)
- Analyze code structure and suggest improvements
- Help with debugging and testing
- Work with Python, JavaScript, TypeScript, and Go codebases

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
- Check command output and explain any issues or results`;

export default async function Agent(
	req: AgentRequest,
	resp: AgentResponse,
	ctx: AgentContext
) {
	try {
		const userMessage = (await req.data.text()) ?? 'Hello! I need help with coding.';
		
		// Get or create conversation context from KV store
		const sessionId = req.get('x-session-id', 'default') as string;
		const contextKey = 'conversation';
		
		let conversationContext: ConversationContext;
		try {
			const stored = await ctx.kv.get('default', contextKey);
			conversationContext = stored.exists ? JSON.parse(await stored.data.text()) : { messages: [] };
		} catch {
			conversationContext = { messages: [] };
		}

		// Add user message to context
		conversationContext.messages.push({
			role: 'user',
			content: userMessage,
			timestamp: Date.now()
		});

		// Prepare messages for AI
		const messages = conversationContext.messages.map(msg => ({
			role: msg.role,
			content: msg.content
		}));

		// Create tools for AI SDK
		const aiTools = {
			read_file: tool({
				description: 'Read the contents of a file. Use this to examine existing code or configuration files.',
				parameters: readFileSchema,
				execute: async (params) => await readFileTool.execute(params, ctx)
			}),
			write_file: tool({
				description: 'Write content to a file. Use this to create new files or modify existing ones.',
				parameters: writeFileSchema,
				execute: async (params) => await writeFileTool.execute(params, ctx)
			}),
			list_directory: tool({
				description: 'List the contents of a directory. Use this to explore project structure.',
				parameters: listDirectorySchema,
				execute: async (params) => await listDirectoryTool.execute(params, ctx)
			}),
			create_directory: tool({
				description: 'Create a new directory. Use this to organize code into proper structure.',
				parameters: createDirectorySchema,
				execute: async (params) => await createDirectoryTool.execute(params, ctx)
			}),
			execute_code: tool({
				description: 'Execute code safely in a sandboxed environment. Use this to run and test code.',
				parameters: executeCodeSchema,
				execute: async (params) => await executeCodeTool.execute(params, ctx)
			}),
			run_command: tool({
				description: 'Execute shell commands safely. Supports git, npm, build tools, and common Unix commands.',
				parameters: runCommandSchema,
				execute: async (params) => await runCommandTool.execute(params, ctx)
			})
		};

		// Stream response with tool support and multi-step reasoning
		const result = await streamText({
			model: anthropic("claude-4-sonnet-20250514"),
			system: SYSTEM_PROMPT,
			messages,
			tools: aiTools,
			maxTokens: 4000,
			maxSteps: 5, // Allow up to 5 tool calls to complete complex tasks
		});

		// Create response stream that handles both text and tool execution
		const responseStream = new ReadableStream({
			async start(controller) {
				let assistantMessage = '';

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
								const params = JSON.stringify(chunk.args, null, 2);
								const toolCallMessage = `\n🔧 Using tool: ${chunk.toolName}\n📋 Parameters: ${params}\n`;
								controller.enqueue(toolCallMessage);
								break;
							}
								
							case 'tool-result': {
								const toolResultMessage = `\n✅ Tool completed\n\n${chunk.result}\n\n`;
								controller.enqueue(toolResultMessage);
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

					// Get the final text content
					const finalText = await result.text;
					assistantMessage = finalText;

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

					ctx.logger.info(`Processed request for session ${sessionId}, message count: ${conversationContext.messages.length}`);
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
		ctx.logger.error('Error running agent:', error);
		return await resp.text('Sorry, there was an error processing your request. Please try again.');
	}
}
