import type { ContinuationHandler } from './continuation-handler.js';

export type AgentMode = 'auto' | 'local' | 'cloud';

export interface AgentStatusEvent {
  type: 'start' | 'stream' | 'complete' | 'error';
  message?: string;
  error?: Error;
}

export interface TokenEvent {
  chunk: string;
  source: 'primary' | 'continuation';
}

export interface SendMessageCallbacks {
  onStatus?: (event: AgentStatusEvent) => void;
  onToken?: (event: TokenEvent) => void;
  onError?: (error: Error) => void;
}

export interface AgentClientOptions {
  apiKey: string;
  continuationHandler: ContinuationHandler;
  getAgentUrl: (mode?: AgentMode) => Promise<string>;
}

export interface SendMessageParams extends SendMessageCallbacks {
  message: string;
  agentMode: AgentMode;
  sessionId: string;
  timeoutMs?: number;
}

export interface AgentMessageResult {
  fullResponse: string;
  cleanedResponse: string;
}

const PRIMARY_TIMEOUT = 60000;
const CONTINUATION_TIMEOUT = 30000;

export class AgentClient {
  private apiKey: string;
  private continuationHandler: ContinuationHandler;
  private getAgentUrl: (mode?: AgentMode) => Promise<string>;

  constructor(options: AgentClientOptions) {
    this.apiKey = options.apiKey;
    this.continuationHandler = options.continuationHandler;
    this.getAgentUrl = options.getAgentUrl;
  }

  async sendMessage(params: SendMessageParams): Promise<AgentMessageResult> {
    const { message, agentMode, sessionId, onStatus, onToken, onError } =
      params;

    const targetUrl = await this.getAgentUrl(agentMode);
    onStatus?.({ type: 'start', message: 'Connecting to agent...' });

    try {
      const primaryResponse = await this.fetchWithTimeout(
        targetUrl,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain',
            Authorization: `Bearer ${this.apiKey}`,
            'x-session-id': sessionId,
          },
          body: message,
        },
        PRIMARY_TIMEOUT
      );

      onStatus?.({ type: 'stream', message: 'Streaming response...' });

      const primaryText = await this.streamResponse(
        primaryResponse,
        'primary',
        onToken
      );

      let cleanedResponse = primaryText.trim();
      let combinedResponse = cleanedResponse;

      const toolCallResult = await this.continuationHandler.handleToolCallFlow(
        primaryText,
        targetUrl,
        this.apiKey,
        sessionId,
        message
      );

      if (toolCallResult.cleanedResponse) {
        cleanedResponse = toolCallResult.cleanedResponse;
        combinedResponse = cleanedResponse;
      }

      if (
        toolCallResult.needsContinuation &&
        toolCallResult.continuationResponse
      ) {
        onStatus?.({
          type: 'stream',
          message: 'Streaming continuation...',
        });

        const continuationText = await this.streamResponse(
          toolCallResult.continuationResponse,
          'continuation',
          onToken,
          CONTINUATION_TIMEOUT
        );

        combinedResponse = [cleanedResponse, continuationText]
          .filter(Boolean)
          .join('\n')
          .trim();
      }

      onStatus?.({ type: 'complete', message: 'Done' });

      const finalResponse = combinedResponse.trim();

      return {
        fullResponse: finalResponse,
        cleanedResponse: finalResponse,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      onStatus?.({ type: 'error', message: err.message, error: err });
      onError?.(err);
      throw err;
    }
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response
          .text()
          .catch(() => 'Could not read error response');
        throw new Error(
          `HTTP ${response.status}: ${response.statusText}\n${errorText}`
        );
      }

      return response;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timed out');
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async streamResponse(
    response: Response,
    source: TokenEvent['source'],
    onToken?: SendMessageCallbacks['onToken'],
    timeoutMs?: number
  ): Promise<string> {
    if (!response.body) {
      return '';
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    const timeoutHandle =
      timeoutMs !== undefined
        ? setTimeout(() => {
            reader.cancel().catch(() => {
              // Ignore cancellation errors
            });
          }, timeoutMs)
        : null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        fullText += chunk;
        onToken?.({ chunk, source });
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Streaming timed out');
      }
      throw error;
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      reader.releaseLock();
    }

    return fullText;
  }
}
