import type { AgentContext, AgentRequest, AgentResponse } from '@agentuity/sdk';
import { anthropic } from '@ai-sdk/anthropic';
import { streamText, tool } from 'ai';
import { 
  readFileSchema, 
  writeFileSchema, 
  listDirectorySchema, 
  createDirectorySchema, 
  executeCodeSchema,
  readFileTool,
  writeFileTool,
  listDirectoryTool,
  createDirectoryTool,
  executeCodeTool
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

const SYSTEM_PROMPT = `You are an expert coding agent that helps developers write, analyze, and improve code. You have access to powerful tools for file operations and code execution.

Key capabilities:
- Read and write files in any codebase
- Execute code safely in sandboxed environments (Python, JavaScript, TypeScript)
- Analyze code structure and suggest improvements
- Help with debugging and testing
- Work with Python, JavaScript, and Go codebases

Guidelines:
- Always read existing code before making changes
- Test code changes when possible using the execute_code tool
- Provide clear explanations of what you're doing
- Ask for clarification when requirements are unclear
- Use appropriate file organization and coding best practices
- Be proactive in suggesting improvements and catching potential issues

When working with files:
- Use relative paths from the current working directory
- Create directories as needed when writing files
- Always check file contents before modifying them

When executing code:
- Choose the appropriate language (python, javascript, typescript)
- Include proper error handling
- Test with sample data when applicable`;

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
			})
		};

		// Stream response with tool support
		const result = await streamText({
			model: anthropic("claude-4-sonnet-20250514"),
			system: SYSTEM_PROMPT,
			messages,
			tools: aiTools,
			maxTokens: 4000,
		});

		// Create response stream
		const responseStream = new ReadableStream({
			async start(controller) {
				let assistantMessage = '';

				try {
					for await (const chunk of result.textStream) {
						assistantMessage += chunk;
						controller.enqueue(chunk);
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
