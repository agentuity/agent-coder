import type {
  ToolCallsMessage,
  ContinuationRequest,
  ToolCall,
  ToolResult,
} from '../tools/interface.js';
import { ToolProxy } from './tool-proxy.js';
import chalk from 'chalk';

export interface ToolStartEvent {
  index: number;
  total: number;
  toolName: string;
  keyParameters?: string | null;
}

export interface ToolCompleteEvent {
  toolName: string;
  success: boolean;
  preview?: string | null;
  error?: string | null;
}

export interface ContinuationEvents {
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
  toolStart?: (event: ToolStartEvent) => void;
  toolComplete?: (event: ToolCompleteEvent) => void;
}

const defaultEvents: Required<ContinuationEvents> = {
  info: (message: string) => console.log(chalk.dim(message)),
  warn: (message: string) => console.warn(chalk.yellow(message)),
  error: (message: string) => console.error(chalk.red(message)),
  toolStart: ({ index, total, toolName, keyParameters }: ToolStartEvent) => {
    console.log(chalk.cyan(`[${index}/${total}] Executing: ${toolName}`));
    if (keyParameters) {
      console.log(chalk.dim(keyParameters));
    }
  },
  toolComplete: ({ toolName, success, preview, error }: ToolCompleteEvent) => {
    if (success) {
      console.log(chalk.green(`✅ ${toolName} completed`));
      if (preview) {
        console.log(chalk.dim(preview));
      }
    } else {
      console.log(
        chalk.red(`❌ ${toolName} failed: ${error || 'Unknown error'}`)
      );
    }
    console.log();
  },
};

export class ContinuationHandler {
  private toolProxy: ToolProxy;
  private events: Required<ContinuationEvents>;

  constructor(workingDirectory?: string, events?: ContinuationEvents) {
    this.events = {
      ...defaultEvents,
      ...(events || {}),
    } as Required<ContinuationEvents>;
    this.toolProxy = new ToolProxy(
      {
        info: (msg: string) => this.emitInfo(`[TOOL] ${msg}`),
        error: (msg: string) => this.emitError(`[TOOL ERROR] ${msg}`),
        warn: (msg: string) => this.emitWarn(`[TOOL WARN] ${msg}`),
      },
      workingDirectory
    );
  }

  private emitInfo(message: string): void {
    this.events.info(message);
  }

  private emitWarn(message: string): void {
    this.events.warn(message);
  }

  private emitError(message: string): void {
    this.events.error(message);
  }

  private emitToolStart(event: ToolStartEvent): void {
    this.events.toolStart(event);
  }

  private emitToolComplete(event: ToolCompleteEvent): void {
    this.events.toolComplete(event);
  }

  // Parse tool calls from agent response
  parseToolCalls(responseText: string): {
    hasToolCalls: boolean;
    toolCallsMessage?: ToolCallsMessage;
    cleanedResponse: string;
  } {
    // Try new invisible format first, then fall back to old formats
    let toolCallsMatch = responseText.match(
      /__TOOL_CALLS_HIDDEN__(.*?)__END_CALLS_HIDDEN__/s
    );
    if (!toolCallsMatch) {
      toolCallsMatch = responseText.match(
        /<!--TOOL_CALLS_START-->\n(.*?)\n<!--TOOL_CALLS_END-->/s
      );
    }
    if (!toolCallsMatch) {
      toolCallsMatch = responseText.match(
        /---TOOL_CALLS---\n(.*?)\n---END_TOOL_CALLS---/s
      );
    }

    if (!toolCallsMatch) {
      return { hasToolCalls: false, cleanedResponse: responseText };
    }

    try {
      const toolCallsMessage = JSON.parse(
        toolCallsMatch[1] || '{}'
      ) as ToolCallsMessage;

      // Remove tool calls section from response (all formats)
      const cleanedResponse =
        responseText
          .replace(/__TOOL_CALLS_HIDDEN__.*?__END_CALLS_HIDDEN__/s, '')
          .replace(/<!--TOOL_CALLS_START-->\n.*?\n<!--TOOL_CALLS_END-->/s, '')
          .replace(/---TOOL_CALLS---\n.*?\n---END_TOOL_CALLS---/s, '')
          .replace(/\n⏳ Waiting for local tool execution\.\.\.\n/g, '')
          .replace(/\n⏳ Executing \d+ tool\(s\) locally\.\.\.\n/g, '') || '';

      return {
        hasToolCalls: true,
        toolCallsMessage,
        cleanedResponse: cleanedResponse.trim(),
      };
    } catch (error) {
      this.emitError(`Failed to parse tool calls: ${error}`);
      return { hasToolCalls: false, cleanedResponse: responseText };
    }
  }

  // Execute tool calls and return results
  async executeToolCalls(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    this.emitInfo(
      `\n🔧 Executing ${toolCalls.length} tool call(s) locally...\n`
    );

    const results: ToolResult[] = [];

    for (let i = 0; i < toolCalls.length; i++) {
      const toolCall = toolCalls[i];
      if (!toolCall) continue;

      // Only show key parameters, not the full JSON dump
      if (toolCall.parameters) {
        const keyParams = this.getKeyParameters(
          toolCall.toolName,
          toolCall.parameters
        );
        this.emitToolStart({
          index: i + 1,
          total: toolCalls.length,
          toolName: toolCall.toolName,
          keyParameters: keyParams,
        });
      } else {
        this.emitToolStart({
          index: i + 1,
          total: toolCalls.length,
          toolName: toolCall.toolName,
        });
      }

      const result = await this.toolProxy.executeToolCall(toolCall);
      results.push(result);

      if (result.success) {
        let preview: string | null = null;
        if (result.result && this.shouldShowPreview(toolCall.toolName)) {
          preview = this.formatPreview(result.result, toolCall.toolName);
        }
        this.emitToolComplete({
          toolName: toolCall.toolName,
          success: true,
          preview: preview || undefined,
        });
      } else {
        this.emitToolComplete({
          toolName: toolCall.toolName,
          success: false,
          error: result.error || 'Unknown error',
        });
      }
    }

    return results;
  }

  // Extract key parameters to show (instead of full JSON dump)
  private getKeyParameters(
    toolName: string,
    parameters: Record<string, unknown>
  ): string | null {
    switch (toolName) {
      case 'write_file':
      case 'read_file':
        return `path: ${parameters.path}`;
      case 'move_file':
        return `${parameters.source} → ${parameters.destination}`;
      case 'delete_file':
        return `path: ${parameters.path}`;
      case 'grep_search':
        return `pattern: ${parameters.pattern}${parameters.path ? ` in ${parameters.path}` : ''}`;
      case 'find_files':
        return `pattern: ${parameters.pattern}${parameters.path ? ` in ${parameters.path}` : ''}`;
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
    return [
      'list_directory',
      'run_command',
      'git_diff',
      'grep_search',
      'find_files',
    ].includes(toolName);
  }

  // Format preview based on tool type
  private formatPreview(result: string, toolName: string): string | null {
    if (!result) return null;

    switch (toolName) {
      case 'list_directory': {
        const files = result.split('\n').filter((line) => line.trim());
        return files.length > 3
          ? `${files.slice(0, 3).join(', ')}... (${files.length} items)`
          : files.join(', ');
      }
      case 'run_command': {
        const lines = result.split('\n').filter((line) => line.trim());
        return lines.length > 2
          ? `${lines.slice(0, 2).join('\n')}...`
          : result.trim();
      }
      default: {
        const preview = result.split('\n').slice(0, 2).join('\n');
        return preview.length > 100
          ? `${preview.substring(0, 100)}...`
          : preview;
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
    this.emitInfo('📨 Sending tool results back to agent...\n');

    try {
      // Add timeout to prevent hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      const response = await fetch(agentUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          Authorization: `Bearer ${apiKey}`,
          'x-session-id': continuationRequest.sessionId,
        },
        body: JSON.stringify(continuationRequest),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        this.emitError(`HTTP Error: ${response.status} ${response.statusText}`);
        const errorText = await response
          .text()
          .catch(() => 'Could not read error response');
        this.emitError(`Response body: ${errorText}`);

        // Handle rate limit errors more gracefully
        if (response.status === 429) {
          this.emitWarn(
            '⚠️  Rate limit exceeded. Please wait a moment before trying again.'
          );
          this.emitWarn(
            '💡 Try making smaller requests or wait for rate limits to reset.'
          );
        }

        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        this.emitError('❌ Request timed out after 30 seconds');
        throw new Error('Request timed out');
      }

      this.emitError(`Fetch error details: ${error}`);
      this.emitError(`URL: ${agentUrl}`);
      this.emitError(
        `Headers: ${JSON.stringify({
          'Content-Type': 'text/plain',
          Authorization: `Bearer ${apiKey.substring(0, 10)}...`,
          'x-session-id': continuationRequest.sessionId,
        })}`
      );
      this.emitError(
        `Body length: ${JSON.stringify(continuationRequest).length} chars`
      );
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
  ): Promise<{
    needsContinuation: boolean;
    continuationResponse?: Response;
    cleanedResponse: string;
  }> {
    const { hasToolCalls, toolCallsMessage, cleanedResponse } =
      this.parseToolCalls(responseText);

    if (!hasToolCalls || !toolCallsMessage) {
      return { needsContinuation: false, cleanedResponse };
    }

    try {
      // Execute tool calls
      const toolResults = await this.executeToolCalls(
        toolCallsMessage.toolCalls
      );

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
      this.emitError(`Error in tool call flow: ${error}`);
      throw error;
    }
  }
}
