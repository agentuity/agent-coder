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
export declare class SessionManager {
    private sessionDir;
    private currentSession;
    private setupManager;
    private projectPath;
    constructor(projectPath?: string);
    initialize(): Promise<void>;
    private hashProjectPath;
    startNewSession(goal?: string): Promise<SessionState>;
    loadLastSession(): Promise<SessionState | null>;
    saveSession(): Promise<void>;
    addMessage(role: 'user' | 'assistant', content: string): Promise<void>;
    updateWorkingFiles(files: string[]): Promise<void>;
    updateGoal(goal: string): Promise<void>;
    addCompletedTask(task: string): Promise<void>;
    getCurrentSession(): Promise<SessionState | null>;
    getSummary(): Promise<string>;
    continueLastSession(): Promise<string>;
    private listSessions;
    private getTimeDiff;
}
