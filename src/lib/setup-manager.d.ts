import { type ProjectInfo } from './project-analyzer';
export interface Goal {
    goal: string;
    createdAt: string;
    status: 'active' | 'completed' | 'paused';
}
interface CoderConfig {
    version: string;
    projectInfo: ProjectInfo;
    preferences: {
        confirmBeforeExecute?: boolean;
        showProgressIndicators?: boolean;
        autoSuggestCommands?: boolean;
    };
    history: {
        lastSession?: string;
        recentCommands?: string[];
        goals?: Goal[];
    };
}
export declare class SetupManager {
    private projectPath;
    private configDir;
    private globalConfigPath;
    private projectConfigPath;
    private projectAnalyzer;
    constructor(projectPath?: string);
    private hashProjectPath;
    initialize(): Promise<void>;
    private projectConfigExists;
    private ensureConfigDirs;
    private runFirstTimeSetup;
    private saveProjectConfig;
    private saveConfig;
    private displayProjectInfo;
    private updateGitignore;
    private loadExistingConfig;
    getConfig(): Promise<CoderConfig | null>;
    updateConfig(updates: Partial<CoderConfig>): Promise<void>;
    addRecentCommand(command: string): Promise<void>;
    getSuggestedCommands(): Promise<string[]>;
}
export {};
