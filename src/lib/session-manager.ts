import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SetupManager } from './setup-manager';

export interface SessionState {
  id: string;
  startedAt: string;
  lastActiveAt: string;
  currentGoal?: string;
  contextMessages: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
  }>;
  workingFiles: string[];
  completedTasks: string[];
  pendingTasks: string[];
}

export class SessionManager {
  private sessionDir: string;
  private currentSession: SessionState | null = null;
  private setupManager: SetupManager;
  private projectPath: string;

  constructor(projectPath: string = process.cwd()) {
    this.projectPath = projectPath;
    // Use global config directory for sessions
    const globalConfigDir = path.join(os.homedir(), '.agentuity-coder');
    this.sessionDir = path.join(globalConfigDir, 'sessions');
    this.setupManager = new SetupManager(projectPath);
  }

  async initialize(): Promise<void> {
    // Ensure session directory exists
    await fs.mkdir(this.sessionDir, { recursive: true });
    
    // Create project-specific session subdirectory
    const projectHash = this.hashProjectPath(this.projectPath);
    this.sessionDir = path.join(this.sessionDir, projectHash);
    await fs.mkdir(this.sessionDir, { recursive: true });
  }

  private hashProjectPath(path: string): string {
    // Simple hash to create unique project identifier
    let hash = 0;
    for (let i = 0; i < path.length; i++) {
      const char = path.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }

  async startNewSession(goal?: string): Promise<SessionState> {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    this.currentSession = {
      id: sessionId,
      startedAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      currentGoal: goal,
      contextMessages: [],
      workingFiles: [],
      completedTasks: [],
      pendingTasks: [],
    };

    await this.saveSession();
    return this.currentSession;
  }

  async loadLastSession(): Promise<SessionState | null> {
    try {
      const sessions = await this.listSessions();
      if (sessions.length === 0) return null;

      // Get the most recent session
      const lastSessionFile = sessions[0];
      if (!lastSessionFile) return null;

      const sessionPath = path.join(this.sessionDir, lastSessionFile);
      const content = await fs.readFile(sessionPath, 'utf8');

      this.currentSession = JSON.parse(content);
      return this.currentSession;
    } catch (error) {
      return null;
    }
  }

  async saveSession(): Promise<void> {
    if (!this.currentSession) return;

    const sessionPath = path.join(
      this.sessionDir,
      `${this.currentSession.id}.json`
    );
    this.currentSession.lastActiveAt = new Date().toISOString();

    await fs.writeFile(
      sessionPath,
      JSON.stringify(this.currentSession, null, 2)
    );
  }

  async addMessage(role: 'user' | 'assistant', content: string): Promise<void> {
    if (!this.currentSession) {
      await this.startNewSession();
    }

    this.currentSession!.contextMessages.push({
      role,
      content,
      timestamp: new Date().toISOString(),
    });

    // Keep only last 50 messages to prevent file from getting too large
    if (this.currentSession!.contextMessages.length > 50) {
      this.currentSession!.contextMessages =
        this.currentSession!.contextMessages.slice(-50);
    }

    await this.saveSession();
  }

  async updateWorkingFiles(files: string[]): Promise<void> {
    if (!this.currentSession) return;

    // Add new files to working files list
    const uniqueFiles = new Set([
      ...this.currentSession.workingFiles,
      ...files,
    ]);
    this.currentSession.workingFiles = Array.from(uniqueFiles);

    // Keep only last 20 files
    if (this.currentSession.workingFiles.length > 20) {
      this.currentSession.workingFiles =
        this.currentSession.workingFiles.slice(-20);
    }

    await this.saveSession();
  }

  async updateGoal(goal: string): Promise<void> {
    if (!this.currentSession) {
      await this.startNewSession(goal);
      return;
    }

    this.currentSession.currentGoal = goal;
    await this.saveSession();

    // Also update in project config
    const config = await this.setupManager.getConfig();
    const existingGoals = config?.history?.goals || [];

    await this.setupManager.updateConfig({
      history: {
        ...config?.history,
        goals: [
          ...existingGoals,
          {
            goal,
            createdAt: new Date().toISOString(),
            status: 'active',
          },
        ],
      },
    });
  }

  async addCompletedTask(task: string): Promise<void> {
    if (!this.currentSession) return;

    this.currentSession.completedTasks.push(task);
    await this.saveSession();
  }

  async getCurrentSession(): Promise<SessionState | null> {
    return this.currentSession;
  }

  async getSummary(): Promise<string> {
    if (!this.currentSession) {
      return 'No active session. Start working on something to begin a new session.';
    }

    const timeSinceStart = this.getTimeDiff(this.currentSession.startedAt);
    const timeSinceActive = this.getTimeDiff(this.currentSession.lastActiveAt);

    let summary = `📊 **Current Session**\n\n`;
    summary += `Session ID: ${this.currentSession.id}\n`;
    summary += `Started: ${timeSinceStart} ago\n`;
    summary += `Last active: ${timeSinceActive} ago\n\n`;

    if (this.currentSession.currentGoal) {
      summary += `🎯 **Current Goal:** ${this.currentSession.currentGoal}\n\n`;
    }

    if (this.currentSession.workingFiles.length > 0) {
      summary += `📁 **Working Files:**\n`;
      this.currentSession.workingFiles.slice(-5).forEach((file) => {
        summary += `• ${file}\n`;
      });
      if (this.currentSession.workingFiles.length > 5) {
        summary += `• ... and ${this.currentSession.workingFiles.length - 5} more\n`;
      }
      summary += '\n';
    }

    if (this.currentSession.completedTasks.length > 0) {
      summary += `✅ **Completed Tasks:** ${this.currentSession.completedTasks.length}\n`;
      this.currentSession.completedTasks.slice(-3).forEach((task) => {
        summary += `• ${task}\n`;
      });
      if (this.currentSession.completedTasks.length > 3) {
        summary += `• ... and ${this.currentSession.completedTasks.length - 3} more\n`;
      }
    }

    return summary;
  }

  async continueLastSession(): Promise<string> {
    const lastSession = await this.loadLastSession();

    if (!lastSession) {
      return 'No previous session found. Starting fresh!';
    }

    const timeSinceActive = this.getTimeDiff(lastSession.lastActiveAt);

    let response = `🔄 **Continuing Previous Session**\n\n`;
    response += `Last active: ${timeSinceActive} ago\n`;

    if (lastSession.currentGoal) {
      response += `\n🎯 **Previous Goal:** ${lastSession.currentGoal}\n`;
    }

    if (lastSession.workingFiles.length > 0) {
      response += `\n📁 **You were working on:**\n`;
      lastSession.workingFiles.slice(-5).forEach((file) => {
        response += `• ${file}\n`;
      });
    }

    if (lastSession.completedTasks.length > 0) {
      response += `\n✅ **Previously completed:** ${lastSession.completedTasks.length} tasks\n`;
    }

    // Show last few messages for context
    if (lastSession.contextMessages.length > 0) {
      response += `\n💭 **Last conversation:**\n`;
      const recentMessages = lastSession.contextMessages.slice(-3);
      recentMessages.forEach((msg) => {
        const preview =
          msg.content.length > 100
            ? msg.content.substring(0, 100) + '...'
            : msg.content;
        response += `${msg.role === 'user' ? '👤' : '🤖'} ${preview}\n`;
      });
    }

    response += `\n💡 Continue working or start something new!`;

    return response;
  }

  private async listSessions(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.sessionDir);
      return files
        .filter((f) => f.endsWith('.json'))
        .sort((a, b) => b.localeCompare(a)); // Most recent first
    } catch {
      return [];
    }
  }

  private getTimeDiff(isoDate: string): string {
    const diff = Date.now() - new Date(isoDate).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days} day${days > 1 ? 's' : ''}`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''}`;
    return 'just now';
  }
}
