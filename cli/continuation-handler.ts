import type { ToolCallsMessage, ContinuationRequest, ToolCall, ToolResult } from '../tools/interface.js';
import { ToolProxy } from './tool-proxy.js';
import chalk from 'chalk';

export class ContinuationHandler {
  private toolProxy: ToolProxy;

  constructor() {
    this.toolProxy = new ToolProxy({
      info: (msg: string) => console.log(chalk.dim(`[TOOL] ${msg}`)),
      error: (msg: string) => console.error(chalk.red(`[TOOL ERROR] ${msg}`)),
      warn: (msg: string) => console.warn(chalk.yellow(`[TOOL WARN] ${msg}`)),
    });
  }

  // Parse tool calls from agent response
  parseToolCalls(responseText: string): { hasToolCalls: boolean; toolCallsMessage?: ToolCallsMessage; cleanedResponse: string } {
    const toolCallsMatch = responseText.match(/---TOOL_CALLS---\n(.*?)\n---END_TOOL_CALLS---/s);
    
    if (!toolCallsMatch) {
      return { hasToolCalls: false, cleanedResponse: responseText };
    }

    try {
      const toolCallsMessage = JSON.parse(toolCallsMatch[1] || '{}') as ToolCallsMessage;
      
      // Remove tool calls section from response
      const cleanedResponse = responseText
        .replace(/---TOOL_CALLS---\n.*?\n---END_TOOL_CALLS---/s, '')
        .replace(/\n⏳ Waiting for local tool execution\.\.\.\n/g, '') || '';
      
      return {
        hasToolCalls: true,
        toolCallsMessage,
        cleanedResponse: cleanedResponse.trim(),
      };
    } catch (error) {
      console.error(chalk.red('Failed to parse tool calls:'), error);
      return { hasToolCalls: false, cleanedResponse: responseText };
    }
  }

  // Execute tool calls and return results
  async executeToolCalls(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    console.log(chalk.blue(`\n🔧 Executing ${toolCalls.length} tool call(s) locally...\n`));
    
    const results: ToolResult[] = [];
    
    for (let i = 0; i < toolCalls.length; i++) {
      const toolCall = toolCalls[i];
      if (!toolCall) continue;
      
      console.log(chalk.cyan(`[${i + 1}/${toolCalls.length}] Executing: ${toolCall.toolName}`));
      console.log(chalk.dim(`Parameters: ${JSON.stringify(toolCall.parameters, null, 2)}`));
      
      const result = await this.toolProxy.executeToolCall(toolCall);
      results.push(result);
      
      if (result.success) {
        console.log(chalk.green(`✅ ${toolCall.toolName} completed successfully`));
        // Show first few lines of result for feedback
        if (result.result) {
          const preview = result.result.split('\n').slice(0, 3).join('\n');
          console.log(chalk.dim(`Preview: ${preview}${result.result.split('\n').length > 3 ? '...' : ''}`));
        }
      } else {
        console.log(chalk.red(`❌ ${toolCall.toolName} failed: ${result.error || 'Unknown error'}`));
      }
      
      console.log(); // Add spacing between tools
    }
    
    return results;
  }

  // Create continuation request
  createContinuationRequest(
    sessionId: string,
    toolResults: ToolResult[],
    originalMessage?: string
  ): ContinuationRequest {
    return {
      type: 'continuation',
      sessionId,
      toolResults,
      originalMessage,
    };
  }

  // Send continuation request to agent
  async sendContinuation(
    agentUrl: string,
    apiKey: string,
    continuationRequest: ContinuationRequest
  ): Promise<Response> {
    console.log(chalk.blue('📨 Sending tool results back to agent...\n'));
    
    const response = await fetch(agentUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'x-session-id': continuationRequest.sessionId,
      },
      body: JSON.stringify(continuationRequest),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response;
  }

  // Handle complete tool call flow
  async handleToolCallFlow(
    responseText: string,
    agentUrl: string,
    apiKey: string,
    sessionId: string,
    originalMessage?: string
  ): Promise<{ needsContinuation: boolean; continuationResponse?: Response; cleanedResponse: string }> {
    const { hasToolCalls, toolCallsMessage, cleanedResponse } = this.parseToolCalls(responseText);
    
    if (!hasToolCalls || !toolCallsMessage) {
      return { needsContinuation: false, cleanedResponse };
    }

    try {
      // Execute tool calls
      const toolResults = await this.executeToolCalls(toolCallsMessage.toolCalls);
      
      // Create and send continuation request
      const continuationRequest = this.createContinuationRequest(
        sessionId,
        toolResults,
        originalMessage
      );
      
      const continuationResponse = await this.sendContinuation(
        agentUrl,
        apiKey,
        continuationRequest
      );
      
      return {
        needsContinuation: true,
        continuationResponse,
        cleanedResponse,
      };
    } catch (error) {
      console.error(chalk.red('Error in tool call flow:'), error);
      throw error;
    }
  }
}
