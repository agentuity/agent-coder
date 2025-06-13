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
      
      // Clean, concise tool execution display
      console.log(chalk.cyan(`[${i + 1}/${toolCalls.length}] Executing: ${toolCall.toolName}`));
      
      // Only show key parameters, not the full JSON dump
      if (toolCall.parameters) {
        const keyParams = this.getKeyParameters(toolCall.toolName, toolCall.parameters);
        if (keyParams) {
          console.log(chalk.dim(`${keyParams}`));
        }
      }
      
      const result = await this.toolProxy.executeToolCall(toolCall);
      results.push(result);
      
      if (result.success) {
        console.log(chalk.green(`✅ ${toolCall.toolName} completed`));
        // Show brief result preview for certain tools
        if (result.result && this.shouldShowPreview(toolCall.toolName)) {
          const preview = this.formatPreview(result.result, toolCall.toolName);
          if (preview) {
            console.log(chalk.dim(`${preview}`));
          }
        }
      } else {
        console.log(chalk.red(`❌ ${toolCall.toolName} failed: ${result.error || 'Unknown error'}`));
      }
      
      console.log(); // Add spacing between tools
    }
    
    return results;
  }

  // Extract key parameters to show (instead of full JSON dump)
  // @ts-ignore - Complex parameter types are handled at runtime
  private getKeyParameters(toolName: string, parameters: Record<string, any>): string | null {
    switch (toolName) {
      case 'write_file':
      case 'read_file':
        return `path: ${parameters.path}`;
      case 'run_command':
        return `command: ${parameters.command}`;
      case 'list_directory':
        return parameters.path ? `path: ${parameters.path}` : 'path: .';
      case 'create_directory':
        return `path: ${parameters.path}`;
      case 'execute_code':
        return `language: ${parameters.language}`;
      case 'diff_files':
        return `${parameters.file1} vs ${parameters.file2}`;
      default:
        return null;
    }
  }

  // Determine if we should show a preview of the result
  private shouldShowPreview(toolName: string): boolean {
    return ['list_directory', 'run_command', 'git_diff'].includes(toolName);
  }

  // Format preview based on tool type
  private formatPreview(result: string, toolName: string): string | null {
    if (!result) return null;
    
    switch (toolName) {
      case 'list_directory': {
        const files = result.split('\n').filter(line => line.trim());
        return files.length > 3 
          ? `${files.slice(0, 3).join(', ')}... (${files.length} items)`
          : files.join(', ');
      }
      case 'run_command': {
        const lines = result.split('\n').filter(line => line.trim());
        return lines.length > 2
          ? `${lines.slice(0, 2).join('\n')}...`
          : result.trim();
      }
      default: {
        const preview = result.split('\n').slice(0, 2).join('\n');
        return preview.length > 100 ? `${preview.substring(0, 100)}...` : preview;
      }
    }
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
    
    try {
      // Add timeout to prevent hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      
      const response = await fetch(agentUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'Authorization': `Bearer ${apiKey}`,
          'x-session-id': continuationRequest.sessionId,
        },
        body: JSON.stringify(continuationRequest),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error(chalk.red(`HTTP Error: ${response.status} ${response.statusText}`));
        const errorText = await response.text().catch(() => 'Could not read error response');
        console.error(chalk.red(`Response body: ${errorText}`));
        
        // Handle rate limit errors more gracefully
        if (response.status === 429) {
          console.error(chalk.yellow('⚠️  Rate limit exceeded. Please wait a moment before trying again.'));
          console.error(chalk.yellow('💡 Try making smaller requests or wait for rate limits to reset.'));
        }
        
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.error(chalk.red('❌ Request timed out after 30 seconds'));
        throw new Error('Request timed out');
      }
      
      console.error(chalk.red('Fetch error details:'), error);
      console.error(chalk.red(`URL: ${agentUrl}`));
      console.error(chalk.red(`Headers: ${JSON.stringify({
        'Content-Type': 'text/plain',
        'Authorization': `Bearer ${apiKey.substring(0, 10)}...`,
        'x-session-id': continuationRequest.sessionId,
      })}`));
      console.error(chalk.red(`Body length: ${JSON.stringify(continuationRequest).length} chars`));
      throw error;
    }
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
