import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import chalk from 'chalk';
import { ProjectAnalyzer, type ProjectInfo } from './project-analyzer';

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

export class SetupManager {
  private projectPath: string;
  private configDir: string;
  private globalConfigPath: string;
  private projectConfigPath: string;
  private projectAnalyzer: ProjectAnalyzer;

  constructor(projectPath: string = process.cwd()) {
    this.projectPath = projectPath;
    // Use global config directory for CLI data
    this.configDir = path.join(os.homedir(), '.agentuity-coder');
    this.globalConfigPath = path.join(this.configDir, 'config.json');
    // Store project-specific config with a hash of the project path
    const projectHash = this.hashProjectPath(projectPath);
    this.projectConfigPath = path.join(this.configDir, 'projects', `${projectHash}.json`);
    this.projectAnalyzer = new ProjectAnalyzer(projectPath);
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

  async initialize(): Promise<void> {
    // Ensure global config directories exist
    await this.ensureConfigDirs();
    
    // Check if this is first time setup for this project
    const isFirstTime = !(await this.projectConfigExists());

    if (isFirstTime) {
      await this.runFirstTimeSetup();
    } else {
      await this.loadExistingConfig();
    }
  }

  private async projectConfigExists(): Promise<boolean> {
    try {
      await fs.access(this.projectConfigPath);
      return true;
    } catch {
      return false;
    }
  }

  private async ensureConfigDirs(): Promise<void> {
    await fs.mkdir(path.join(this.configDir, 'projects'), { recursive: true });
    await fs.mkdir(path.join(this.configDir, 'sessions'), { recursive: true });
  }

  private async runFirstTimeSetup(): Promise<void> {
    console.log(
      chalk.cyan('\n🚀 Welcome to Coding Agent! Setting up your project...\n')
    );

    // Analyze project
    const projectInfo = await this.projectAnalyzer.analyze();

    // Generate config
    const config: CoderConfig = {
      version: '1.0.0',
      projectInfo,
      preferences: {
        confirmBeforeExecute: true,
        showProgressIndicators: true,
        autoSuggestCommands: true,
      },
      history: {
        lastSession: new Date().toISOString(),
        recentCommands: [],
        goals: [],
      },
    };

    // Save project config
    await this.saveProjectConfig(config);

    // Display project info
    this.displayProjectInfo(projectInfo);

    console.log(chalk.green('\n✅ Setup complete! Your project is ready.\n'));
    console.log(chalk.gray('Tip: Use /help to see available commands\n'));
  }

  private async saveProjectConfig(config: CoderConfig): Promise<void> {
    await fs.writeFile(this.projectConfigPath, JSON.stringify(config, null, 2));
  }

  private async saveConfig(config: CoderConfig): Promise<void> {
    await this.saveProjectConfig(config);
  }

  private displayProjectInfo(info: ProjectInfo): void {
    console.log(chalk.bold('📊 Project Analysis:'));
    console.log(`  Type: ${chalk.yellow(info.type)}`);

    if (info.framework) {
      console.log(`  Framework: ${chalk.yellow(info.framework)}`);
    }

    if (info.packageManager) {
      console.log(`  Package Manager: ${chalk.yellow(info.packageManager)}`);
    }

    if (info.hasTypescript) {
      console.log(`  TypeScript: ${chalk.green('✓')}`);
    }

    if (info.testRunner) {
      console.log(`  Test Runner: ${chalk.yellow(info.testRunner)}`);
    }

    if (
      info.suggestedCommands &&
      Object.keys(info.suggestedCommands).length > 0
    ) {
      console.log(chalk.bold('\n📝 Detected Commands:'));
      for (const [key, cmd] of Object.entries(info.suggestedCommands)) {
        if (cmd) {
          console.log(`  ${key}: ${chalk.cyan(cmd)}`);
        }
      }
    }
  }

  private async updateGitignore(): Promise<void> {
    // No longer needed since we're using global config directory
    // Nothing to add to .gitignore
  }

  private async loadExistingConfig(): Promise<CoderConfig | null> {
    try {
      const content = await fs.readFile(this.projectConfigPath, 'utf8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  async getConfig(): Promise<CoderConfig | null> {
    return await this.loadExistingConfig();
  }

  async updateConfig(updates: Partial<CoderConfig>): Promise<void> {
    const current = (await this.getConfig()) || {
      version: '1.0.0',
      projectInfo: { type: 'unknown' },
      preferences: {},
      history: {},
    };

    const updated = {
      ...current,
      ...updates,
      preferences: { ...current.preferences, ...updates.preferences },
      history: { ...current.history, ...updates.history },
    };

    await this.saveConfig(updated);
  }

  async addRecentCommand(command: string): Promise<void> {
    const config = await this.getConfig();
    if (!config) return;

    const recentCommands = config.history.recentCommands || [];
    recentCommands.unshift(command);

    // Keep only last 50 commands
    config.history.recentCommands = recentCommands.slice(0, 50);

    await this.saveConfig(config);
  }

  async getSuggestedCommands(): Promise<string[]> {
    const config = await this.getConfig();
    if (!config || !config.projectInfo.suggestedCommands) return [];

    return Object.values(config.projectInfo.suggestedCommands).filter(
      Boolean
    ) as string[];
  }
}
