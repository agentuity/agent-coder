import type { AgentContext, AgentRequest, AgentResponse } from '@agentuity/sdk';
import { anthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';

export const welcome = () => {
  return {
    welcome:
      "Welcome to the Vercel AI SDK with Anthropic Agent! I can help you build AI-powered applications using Vercel's AI SDK with Claude models.",
    prompts: [
      {
        data: 'How do I implement streaming responses with Claude models?',
        contentType: 'text/plain',
      },
      {
        data: 'What are the best practices for prompt engineering with Claude?',
        contentType: 'text/plain',
      },
    ],
  };
};

export default async function Agent(
  req: AgentRequest,
  resp: AgentResponse,
  ctx: AgentContext
) {
  try {
    const result = await generateText({
      model: anthropic('claude-3-7-sonnet-latest'),
      system:
        'You are a helpful assistant that provides concise and accurate information.',
      prompt: (await req.data.text()) ?? 'Hello, Claude',
    });

    return resp.text(result.text);
  } catch (error) {
    ctx.logger.error('Error running agent:', error);

    return resp.text('Sorry, there was an error processing your request.');
  }
}
