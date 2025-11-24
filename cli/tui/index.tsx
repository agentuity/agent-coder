import React from 'react';
import { render } from 'ink';
import type { AgentMode } from '../agent-client.ts';
import type { SetupManager } from '../../src/lib/setup-manager.ts';
import type { SessionManager } from '../../src/lib/session-manager.ts';
import { TuiApp } from './app.js';

interface RunTuiOptions {
  agentMode: AgentMode;
  apiKey: string;
  initialSessionId: string;
  workingDirectory: string;
  getAgentUrl: (mode?: AgentMode) => Promise<string>;
}

export async function runTui({
  agentMode,
  apiKey,
  initialSessionId,
  workingDirectory,
  getAgentUrl,
}: RunTuiOptions): Promise<void> {
  let setupManager: SetupManager | null = null;
  let sessionManager: SessionManager | null = null;

  try {
    const { SetupManager } = await import('../../src/lib/setup-manager.ts');
    setupManager = new SetupManager(workingDirectory);
    await setupManager.initialize();
  } catch (error) {
    console.warn('⚠️  Setup manager unavailable:', error);
    setupManager = null;
  }

  try {
    const { SessionManager } = await import('../../src/lib/session-manager.ts');
    sessionManager = new SessionManager(workingDirectory);
    await sessionManager.initialize();
  } catch (error) {
    console.warn('⚠️  Session manager unavailable:', error);
    sessionManager = null;
  }

  const inkApp = render(
    <TuiApp
      agentMode={agentMode}
      apiKey={apiKey}
      getAgentUrl={getAgentUrl}
      setupManager={setupManager}
      sessionManager={sessionManager}
      initialSessionId={initialSessionId}
      workingDirectory={workingDirectory}
    />
  );

  await inkApp.waitUntilExit();
}
