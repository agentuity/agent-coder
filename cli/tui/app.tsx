import React, {
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import {
  AgentClient,
  type AgentMode,
  type TokenEvent,
} from '../agent-client.ts';
import { ContinuationHandler } from '../continuation-handler.js';
import type { SetupManager } from '../../src/lib/setup-manager.ts';
import type { SessionManager } from '../../src/lib/session-manager.ts';
import { slashCommands, type SlashCommand } from '../slash-commands.ts';
import { runLocalCommand, formatCommandResult } from '../local-command.ts';
import { buildFileIndex } from './file-index.ts';
import { CONTEXT_MESSAGE_LIMIT } from '../../src/lib/context-limit.ts';

type MessageRole = 'user' | 'assistant' | 'system';

interface MessageItem {
  id: string;
  role: MessageRole;
  content: string;
  streaming?: boolean;
}

interface ToolEventPayload {
  type: 'info' | 'warn' | 'error' | 'toolStart' | 'toolComplete';
  message?: string;
  toolName?: string;
  index?: number;
  total?: number;
  success?: boolean;
  preview?: string | null;
}

export interface TuiAppProps {
  agentMode: AgentMode;
  apiKey: string;
  getAgentUrl: (mode?: AgentMode) => Promise<string>;
  setupManager: SetupManager | null;
  sessionManager: SessionManager | null;
  initialSessionId: string;
  workingDirectory: string;
}

const roleLabels: Record<MessageRole, string> = {
  user: 'You',
  assistant: 'Agent',
  system: 'System',
};

const roleColors: Record<MessageRole, string> = {
  user: 'cyan',
  assistant: 'green',
  system: 'cyan',
};

const createId = () =>
  `msg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

const headerArt = `
    ___                    __        _ __           ______          __
   /   | ____ ____  ____  / /___  __(_) /___  __   / ____/___  ____/ /__  _____
  / /| |/ __ \`/ _ \\/ __ \\/ __/ / / / / __/ / / /  / /   / __ \\/ __  / _ \\/ ___/
 / ___ / /_/ /  __/ / / / /_/ /_/ / / /_/ /_/ /  / /___/ /_/ / /_/ /  __/ /
/_/  |_\\__, /\\___/_/ /_/\\__/\\__,_/_/\\__/\\__, /   \\____/\\____/\\__,_/\\___/_/
      /____/                           /____/
`;

const clampContextCount = (value: number) =>
  Math.max(0, Math.min(CONTEXT_MESSAGE_LIMIT, value));

export function TuiApp({
  agentMode,
  apiKey,
  getAgentUrl,
  setupManager,
  sessionManager,
  initialSessionId,
  workingDirectory,
}: TuiAppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows ?? 0;
  const [messages, setMessages] = useState<MessageItem[]>([
    {
      id: createId(),
      role: 'system',
      content: 'Welcome to the Agentuity Coder TUI. Type /help to get started.',
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [agentStatus, setAgentStatus] = useState<
    'idle' | 'thinking' | 'streaming' | 'tooling'
  >('idle');
  const [statusMessage, setStatusMessage] = useState('Ready');
  const [isBusy, setIsBusy] = useState(false);
  const [sessionId, setSessionId] = useState(initialSessionId);
  const [currentGoal, setCurrentGoal] = useState<string | null>(null);
  const [suggestedCommands, setSuggestedCommands] = useState<string[]>([]);
  const [projectInfo, setProjectInfo] = useState<string | null>(null);
  const [filePaths, setFilePaths] = useState<string[]>([]);
  const [contextMessageCount, setContextMessageCount] = useState(0);

  const contextPercentLeft = useMemo(() => {
    if (CONTEXT_MESSAGE_LIMIT <= 0) {
      return 100;
    }
    const remaining = Math.max(0, CONTEXT_MESSAGE_LIMIT - contextMessageCount);
    return Math.round((remaining / CONTEXT_MESSAGE_LIMIT) * 100);
  }, [contextMessageCount]);

  const toolEventHandler = useRef<(event: ToolEventPayload) => void>(() => {});

  const continuationHandler = useMemo(
    () =>
      new ContinuationHandler(workingDirectory, {
        info: (message) => toolEventHandler.current({ type: 'info', message }),
        warn: (message) => toolEventHandler.current({ type: 'warn', message }),
        error: (message) =>
          toolEventHandler.current({ type: 'error', message }),
        toolStart: ({ toolName, index, total, keyParameters }) =>
          toolEventHandler.current({
            type: 'toolStart',
            toolName,
            index,
            total,
            message: keyParameters || undefined,
          }),
        toolComplete: ({ toolName, success, preview, error }) =>
          toolEventHandler.current({
            type: 'toolComplete',
            toolName,
            success,
            preview: preview || error || null,
          }),
      }),
    [workingDirectory]
  );

  const agentClient = useMemo(
    () =>
      new AgentClient({
        apiKey,
        continuationHandler,
        getAgentUrl,
      }),
    [apiKey, continuationHandler, getAgentUrl]
  );

  const appendMessage = useCallback((entry: MessageItem) => {
    setMessages((prev) => [...prev, entry]);
  }, []);

  const appendSystemMessage = useCallback(
    (content: string) => {
      appendMessage({
        id: createId(),
        role: 'system',
        content,
      });
    },
    [appendMessage]
  );

  toolEventHandler.current = (event: ToolEventPayload) => {
    switch (event.type) {
      case 'info':
        setStatusMessage(event.message || 'Working...');
        break;
      case 'warn':
        appendSystemMessage(`⚠️ ${event.message}`);
        break;
      case 'error':
        appendSystemMessage(`❌ ${event.message}`);
        setAgentStatus('idle');
        break;
      case 'toolStart': {
        setAgentStatus('tooling');
        const prefix = event.toolName
          ? `🔧 ${event.toolName}`
          : '🔧 Running tool';
        const progress =
          event.index && event.total ? ` (${event.index}/${event.total})` : '';
        const details = event.message ? ` — ${event.message}` : '';
        appendSystemMessage(`${prefix}${progress}${details}`);
        break;
      }
      case 'toolComplete': {
        setAgentStatus('thinking');
        if (!event.toolName) return;
        if (event.success) {
          const suffix = event.preview ? ` — ${event.preview}` : '';
          appendSystemMessage(`✅ ${event.toolName} completed${suffix}`);
        } else {
          appendSystemMessage(
            `❌ ${event.toolName} failed${event.preview ? ` — ${event.preview}` : ''}`
          );
        }
        break;
      }
    }
  };

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        if (setupManager) {
          const commands = await setupManager.getSuggestedCommands();
          if (mounted) {
            setSuggestedCommands(commands);
            const config = await setupManager.getConfig();
            if (config?.projectInfo?.type && mounted) {
              setProjectInfo(config.projectInfo.type);
            }
          }
        }
      } catch {
        // ignore suggestion failures
      }
    })();

    return () => {
      mounted = false;
    };
  }, [setupManager]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const files = await buildFileIndex(workingDirectory);
        if (!cancelled) {
          setFilePaths(files);
        }
      } catch {
        // ignore indexing errors
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workingDirectory]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!sessionManager) return;
      try {
        let session = await sessionManager.getCurrentSession();
        if (!session) {
          session = await sessionManager.startNewSession();
        }
        if (mounted && session?.id) {
          setSessionId(session.id);
        }
        if (mounted && session?.currentGoal) {
          setCurrentGoal(session.currentGoal);
        }
        if (mounted) {
          const messageCount = session?.contextMessages?.length ?? 0;
          setContextMessageCount(clampContextCount(messageCount));
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      mounted = false;
    };
  }, [sessionManager]);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      exit();
    }

    if (key.tab) {
      const completed = attemptTabCompletion();
      if (completed) {
        setInputValue(completed);
      }
      return;
    }

    if (key.upArrow && history.length > 0) {
      const nextIndex =
        historyIndex + 1 >= history.length
          ? history.length - 1
          : historyIndex + 1;
      const nextValue = history[nextIndex];
      if (nextValue !== undefined) {
        setHistoryIndex(nextIndex);
        setInputValue(nextValue);
      }
    } else if (key.downArrow && history.length > 0) {
      const nextIndex = historyIndex - 1;
      if (nextIndex >= 0) {
        setHistoryIndex(nextIndex);
        setInputValue(history[nextIndex] || '');
      } else {
        setHistoryIndex(-1);
        setInputValue('');
      }
    }
  });

  const handleAgentToken = useCallback(
    (messageId: string, { chunk }: TokenEvent) => {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId
            ? {
                ...msg,
                content: msg.content + chunk,
              }
            : msg
        )
      );
    },
    []
  );

  const sendAgentMessage = useCallback(
    async (text: string) => {
      if (isBusy) {
        appendSystemMessage('⚠️ Please wait for the agent to finish.');
        return;
      }

      setIsBusy(true);
      setAgentStatus('thinking');
      setStatusMessage('Connecting to agent...');

      appendMessage({
        id: createId(),
        role: 'user',
        content: text,
      });
      setContextMessageCount((prev) => clampContextCount(prev + 1));

      if (setupManager) {
        setupManager.addRecentCommand(text).catch(() => {});
      }

      if (sessionManager) {
        await sessionManager.addMessage('user', text);
      }

      const assistantId = createId();
      appendMessage({
        id: assistantId,
        role: 'assistant',
        content: '',
        streaming: true,
      });

      try {
        const result = await agentClient.sendMessage({
          message: text,
          agentMode,
          sessionId,
          onStatus: (event) => {
            if (event.type === 'start') {
              setAgentStatus('thinking');
              setStatusMessage(event.message || 'Agent is thinking...');
            } else if (event.type === 'stream') {
              setAgentStatus('streaming');
              setStatusMessage(event.message || 'Streaming response...');
            } else if (event.type === 'complete') {
              setAgentStatus('idle');
              setStatusMessage('Ready');
            }
          },
          onToken: (token) => handleAgentToken(assistantId, token),
        });

        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId
              ? { ...msg, streaming: false, content: result.cleanedResponse }
              : msg
          )
        );
        setContextMessageCount((prev) => clampContextCount(prev + 1));

        if (sessionManager) {
          await sessionManager.addMessage('assistant', result.cleanedResponse);
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error occurred';
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId
              ? {
                  ...msg,
                  streaming: false,
                  role: 'system',
                  content: `❌ ${message}`,
                }
              : msg
          )
        );
        setAgentStatus('idle');
        setStatusMessage('Ready');
      } finally {
        setIsBusy(false);
      }
    },
    [
      agentClient,
      agentMode,
      appendMessage,
      appendSystemMessage,
      handleAgentToken,
      isBusy,
      sessionId,
      sessionManager,
      setupManager,
    ]
  );

  const runLocalCommandFlow = useCallback(
    async (command: string) => {
      if (!command) {
        appendSystemMessage('⚠️ Command is empty.');
        return;
      }

      appendMessage({
        id: createId(),
        role: 'system',
        content: `⨺ Running local command: ${command}`,
      });

      setIsBusy(true);
      setAgentStatus('tooling');
      setStatusMessage(`Running ${command}`);

      try {
        const result = await runLocalCommand(command, workingDirectory);
        appendMessage({
          id: createId(),
          role: 'system',
          content: formatCommandResult(result),
        });
      } catch (error) {
        appendSystemMessage(
          `❌ Failed to run command: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      } finally {
        setIsBusy(false);
        setAgentStatus('idle');
        setStatusMessage('Ready');
      }
    },
    [appendMessage, appendSystemMessage, workingDirectory]
  );

  const handleSlashCommand = useCallback(
    async (rawCommand: string) => {
      const [command, ...rest] = rawCommand.trim().split(/\s+/);
      const payload = rest.join(' ').trim();

      switch (command) {
        case '/help':
          appendSystemMessage(
            'Commands: /help, /clear, /session, /continue, /context, /goal <text>, /diff, /diff-save, /quit'
          );
          return true;
        case '/clear':
          setMessages([
            {
              id: createId(),
              role: 'system',
              content: 'Cleared conversation history.',
            },
          ]);
          return true;
        case '/session': {
          let newSessionId = `session_${Date.now()}_${Math.random()
            .toString(36)
            .substring(2, 9)}`;
          if (sessionManager) {
            const session = await sessionManager.startNewSession();
            if (session?.id) {
              newSessionId = session.id;
            }
            setContextMessageCount(
              clampContextCount(session?.contextMessages?.length ?? 0)
            );
          } else {
            setContextMessageCount(0);
          }
          setSessionId(newSessionId);
          appendSystemMessage(`✨ Started a new session (${newSessionId}).`);
          return true;
        }
        case '/continue':
          if (sessionManager) {
            const summary = await sessionManager.continueLastSession();
            appendSystemMessage(summary);
            const refreshed = await sessionManager.getCurrentSession();
            if (refreshed) {
              setContextMessageCount(
                clampContextCount(refreshed.contextMessages?.length ?? 0)
              );
            }
          } else {
            appendSystemMessage('Session features unavailable.');
          }
          return true;
        case '/context':
          if (sessionManager) {
            const summary = await sessionManager.getSummary();
            appendSystemMessage(summary);
          } else {
            appendSystemMessage('Session features unavailable.');
          }
          return true;
        case '/goal':
          if (!payload) {
            appendSystemMessage('Usage: /goal <your current focus>');
            return true;
          }
          if (sessionManager) {
            await sessionManager.updateGoal(payload);
          }
          setCurrentGoal(payload);
          appendSystemMessage(`🎯 Goal updated: ${payload}`);
          return true;
        case '/diff':
          await sendAgentMessage(
            'Show me the git diff of all changed files with beautiful formatting.'
          );
          return true;
        case '/diff-save': {
          const filename = `changes_${new Date()
            .toISOString()
            .slice(0, 10)}_${Date.now()}.patch`;
          await sendAgentMessage(`Save the full git diff to file: ${filename}`);
          return true;
        }
        case '/undo':
        case '/changes':
          appendSystemMessage(
            'Undo and change review are available in classic mode (`coder --classic --interactive`).'
          );
          return true;
        case '/quit':
        case '/exit':
          appendSystemMessage('👋 Goodbye! Happy coding!');
          exit();
          return true;
        default:
          return false;
      }
    },
    [appendSystemMessage, exit, sendAgentMessage, sessionManager]
  );

  const handleSubmit = useCallback(async () => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;

    if (trimmed.startsWith('/')) {
      const handled = await handleSlashCommand(trimmed);
      if (handled) {
        setInputValue('');
        setHistoryIndex(-1);
        return;
      }
    }

    if (trimmed.startsWith('!')) {
      const commandText = trimmed.slice(1).trim();
      setHistory((prev) => [trimmed, ...prev]);
      setHistoryIndex(-1);
      setInputValue('');
      appendMessage({
        id: createId(),
        role: 'user',
        content: trimmed,
      });
      await runLocalCommandFlow(commandText);
      return;
    }

    setHistory((prev) => [trimmed, ...prev]);
    setHistoryIndex(-1);
    setInputValue('');
    await sendAgentMessage(trimmed);
  }, [
    appendMessage,
    handleSlashCommand,
    inputValue,
    runLocalCommandFlow,
    sendAgentMessage,
  ]);

  const slashNames = useMemo(() => slashCommands.map((cmd) => cmd.name), []);

  const slashSuggestions: SlashCommand[] = inputValue.startsWith('/')
    ? slashCommands.filter((cmd) => cmd.name.startsWith(inputValue)).slice(0, 5)
    : [];

  const projectSuggestions =
    !inputValue.startsWith('/') && inputValue.length > 1
      ? suggestedCommands
          .filter((cmd) => cmd.toLowerCase().includes(inputValue.toLowerCase()))
          .slice(0, 3)
      : [];

  const fileSuggestionInfo = useMemo(() => {
    const atIndex = inputValue.lastIndexOf('@');
    if (atIndex === -1) {
      return { suggestions: [] as string[], atIndex: -1, query: '' };
    }

    const before = inputValue[atIndex - 1];
    if (atIndex > 0 && before && !/\s/.test(before)) {
      return { suggestions: [] as string[], atIndex: -1, query: '' };
    }

    const query = inputValue.slice(atIndex + 1);
    if (query.includes(' ')) {
      return { suggestions: [] as string[], atIndex: -1, query };
    }

    const lowered = query.toLowerCase();
    const matches = filePaths
      .filter((path) => (lowered ? path.toLowerCase().includes(lowered) : true))
      .slice(0, 5);

    return { suggestions: matches, atIndex, query };
  }, [inputValue, filePaths]);

  const fileSuggestions = fileSuggestionInfo.suggestions;

  const attemptTabCompletion = useCallback(() => {
    if (inputValue.startsWith('/')) {
      const matches = slashNames.filter((name) => name.startsWith(inputValue));
      if (matches.length === 1) {
        return `${matches[0]} `;
      }
      if (matches.length > 1) {
        const prefix = longestCommonPrefix(matches);
        if (prefix.length > inputValue.length) {
          return prefix;
        }
      }
    }

    const { atIndex, query, suggestions } = fileSuggestionInfo;
    if (atIndex >= 0 && suggestions.length > 0) {
      const selection = suggestions[0];
      const before = inputValue.slice(0, atIndex + 1);
      const after = inputValue.slice(atIndex + 1 + query.length);
      const appended = `${before}${selection}`;
      return after ? `${appended}${after}` : `${appended} `;
    }

    return null;
  }, [fileSuggestionInfo, inputValue, slashNames]);

  const [statusSeconds, setStatusSeconds] = useState(0);
  const [shimmerPhase, setShimmerPhase] = useState(0);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let shimmerTimer: ReturnType<typeof setInterval> | null = null;

    if (agentStatus === 'idle') {
      setStatusSeconds(0);
      setShimmerPhase(0);
    } else {
      setStatusSeconds(0);
      timer = setInterval(() => {
        setStatusSeconds((prev) => prev + 1);
      }, 1000);
      shimmerTimer = setInterval(() => {
        setShimmerPhase((prev) => (prev + 1) % 3);
      }, 400);
    }

    return () => {
      if (timer) clearInterval(timer);
      if (shimmerTimer) clearInterval(shimmerTimer);
    };
  }, [agentStatus]);

  const statusLabel =
    agentStatus === 'idle'
      ? 'Ready'
      : statusMessage ||
        (agentStatus === 'tooling' ? 'Working with tools' : 'Working');

  return (
    <Box
      flexDirection="column"
      height={terminalHeight || undefined}
      paddingX={1}
      paddingY={1}
    >
      <Box flexDirection="column" marginBottom={1}>
        <Text color="cyan">{headerArt}</Text>
        <Text color="gray">Powered by Agentuity • Mode: {agentMode}</Text>
      </Box>

      <Box flexDirection="row" flexGrow={1} overflow="hidden">
        <Box
          flexDirection="column"
          flexGrow={1}
          paddingRight={2}
          overflow="hidden"
        >
          {messages.map((msg) => (
            <Box key={msg.id} flexDirection="column" marginBottom={1}>
              <Text color={roleColors[msg.role]} bold>
                {roleLabels[msg.role]}:
              </Text>
              <Box>
                <Text wrap="wrap">{msg.content || ' '}</Text>
                {msg.streaming && (
                  <Text color="gray">
                    {' '}
                    <Spinner type="dots" />
                  </Text>
                )}
              </Box>
            </Box>
          ))}
        </Box>

        <Box
          flexDirection="column"
          width={34}
          flexShrink={0}
          paddingLeft={2}
          paddingRight={1}
          height="100%"
        >
          <Text color="cyan" bold>
            Session
          </Text>
          <Text color="gray" wrap="truncate">
            {sessionId}
          </Text>
          {currentGoal && (
            <Box marginTop={1} flexDirection="column">
              <Text color="cyan" bold>
                Goal
              </Text>
              <Text wrap="wrap">{currentGoal}</Text>
            </Box>
          )}
          {projectInfo && (
            <Box marginTop={1} flexDirection="column">
              <Text color="cyan" bold>
                Project
              </Text>
              <Text>{projectInfo}</Text>
            </Box>
          )}
          <Box marginTop={1} flexDirection="column">
            <Text color="cyan" bold>
              Tips
            </Text>
            <Text color="gray">/help • /diff • /goal • /quit</Text>
          </Box>
          {projectSuggestions.length > 0 && (
            <Box marginTop={1} flexDirection="column">
              <Text color="cyan" bold>
                Suggested cmds
              </Text>
              {projectSuggestions.map((cmd) => (
                <Text key={cmd} color="gray">
                  {cmd}
                </Text>
              ))}
            </Box>
          )}
        </Box>
      </Box>

      <Box marginTop={1} paddingX={2} paddingY={0}>
        <Text>
          <Text color="gray">• </Text>
          <Text color="white" bold>
            {statusLabel}
          </Text>
          {agentStatus !== 'idle' ? (
            <Text
              color={shimmerPhase === 1 ? '#999999' : '#666666'}
            >{` (${statusSeconds}s • esc to interrupt)`}</Text>
          ) : (
            <Text color="gray">{' (press enter to send)'}</Text>
          )}
        </Text>
      </Box>

      <Box
        marginTop={1}
        flexDirection="column"
        paddingX={2}
        paddingY={1}
        backgroundColor="#3a3a3a"
        marginX={-1}
      >
        <Box flexDirection="row" alignItems="center">
          <Text color="white">⨺</Text>
          <Text color="white">{'  '}</Text>
          <Box flexGrow={1}>
            <TextInput
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleSubmit}
              placeholder={
                isBusy
                  ? 'Agent is working...'
                  : 'Ask me anything or use /commands'
              }
            />
          </Box>
        </Box>
        {(slashSuggestions.length > 0 ||
          projectSuggestions.length > 0 ||
          fileSuggestions.length > 0) && (
          <Box marginTop={1} flexDirection="column">
            {slashSuggestions.length > 0 && (
              <Box flexDirection="column">
                <Text color="white" bold>
                  Commands:
                </Text>
                {slashSuggestions.map((cmd) => (
                  <Text key={cmd.name} color="white">
                    {cmd.name} — {cmd.description}
                  </Text>
                ))}
              </Box>
            )}
            {projectSuggestions.length > 0 && (
              <Box flexDirection="column" marginTop={1}>
                <Text color="white" bold>
                  Project suggestions:
                </Text>
                {projectSuggestions.map((cmd) => (
                  <Text key={cmd} color="white">
                    {cmd}
                  </Text>
                ))}
              </Box>
            )}
            {fileSuggestions.length > 0 && (
              <Box flexDirection="column" marginTop={1}>
                <Text color="white" bold>
                  Files:
                </Text>
                {fileSuggestions.map((file) => (
                  <Text key={file} color="white">
                    {file}
                  </Text>
                ))}
              </Box>
            )}
          </Box>
        )}
      </Box>
      <Box marginTop={0} paddingX={2} marginX={-1}>
        <Text color="gray">
          {`${contextPercentLeft}% context left · ? for shortcuts`}
        </Text>
      </Box>
    </Box>
  );
}

function longestCommonPrefix(values: string[]): string {
  const filtered = values.filter(
    (val) => typeof val === 'string' && val.length > 0
  );
  if (filtered.length === 0) return '';
  if (filtered.length === 1) return filtered[0] ?? '';

  let prefix: string = filtered[0] ?? '';
  for (const value of filtered.slice(1)) {
    let i = 0;
    while (
      i < prefix.length &&
      i < value.length &&
      prefix.charCodeAt(i) === value.charCodeAt(i)
    ) {
      i++;
    }
    prefix = prefix.slice(0, i);
    if (!prefix) break;
  }
  return prefix;
}
