import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { progressManager } from './progress-manager';

export interface ChangeRecord {
  id: string;
  timestamp: string;
  type: 'file_create' | 'file_edit' | 'file_delete' | 'file_move' | 'command';
  description: string;
  details: {
    path?: string;
    oldPath?: string;
    newPath?: string;
    command?: string;
    output?: string;
    backupPath?: string;
    originalContent?: string;
  };
  reversible: boolean;
}

export class UndoManager {
  private changesDir: string;
  private backupsDir: string;
  private changesLog: ChangeRecord[] = [];
  private maxChanges: number = 50;
  private sessionId: string;
  
  constructor(sessionId?: string) {
    this.sessionId = sessionId || `session_${Date.now()}`;
    const globalDir = path.join(os.homedir(), '.agentuity-coder');
    this.changesDir = path.join(globalDir, 'changes', this.sessionId);
    this.backupsDir = path.join(globalDir, 'backups', this.sessionId);
  }
  
  async initialize(): Promise<void> {
    await fs.mkdir(this.changesDir, { recursive: true });
    await fs.mkdir(this.backupsDir, { recursive: true });
    await this.loadChangesLog();
  }
  
  /**
   * Record a file creation
   */
  async recordFileCreate(filePath: string): Promise<void> {
    const change: ChangeRecord = {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      type: 'file_create',
      description: `Created file: ${path.basename(filePath)}`,
      details: { path: filePath },
      reversible: true,
    };
    
    await this.addChange(change);
  }
  
  /**
   * Record a file edit with backup
   */
  async recordFileEdit(filePath: string, originalContent: string): Promise<void> {
    const backupPath = await this.createBackup(filePath, originalContent);
    
    const change: ChangeRecord = {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      type: 'file_edit',
      description: `Edited file: ${path.basename(filePath)}`,
      details: { 
        path: filePath,
        backupPath,
        originalContent: originalContent.substring(0, 200) // Store preview
      },
      reversible: true,
    };
    
    await this.addChange(change);
  }
  
  /**
   * Record a file deletion with backup
   */
  async recordFileDelete(filePath: string, content: string): Promise<void> {
    const backupPath = await this.createBackup(filePath, content);
    
    const change: ChangeRecord = {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      type: 'file_delete',
      description: `Deleted file: ${path.basename(filePath)}`,
      details: { 
        path: filePath,
        backupPath,
        originalContent: content
      },
      reversible: true,
    };
    
    await this.addChange(change);
  }
  
  /**
   * Record a file move/rename
   */
  async recordFileMove(oldPath: string, newPath: string): Promise<void> {
    const change: ChangeRecord = {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      type: 'file_move',
      description: `Moved: ${path.basename(oldPath)} → ${path.basename(newPath)}`,
      details: { 
        oldPath,
        newPath
      },
      reversible: true,
    };
    
    await this.addChange(change);
  }
  
  /**
   * Record a command execution
   */
  async recordCommand(command: string, output: string): Promise<void> {
    const change: ChangeRecord = {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      type: 'command',
      description: `Executed: ${command.substring(0, 50)}${command.length > 50 ? '...' : ''}`,
      details: { 
        command,
        output: output.substring(0, 500) // Limit output size
      },
      reversible: false, // Commands generally can't be undone
    };
    
    await this.addChange(change);
  }
  
  /**
   * Show recent changes and allow undo
   */
  async showRecentChanges(limit: number = 10): Promise<void> {
    const recentChanges = this.changesLog.slice(-limit).reverse();
    
    if (recentChanges.length === 0) {
      console.log(chalk.yellow('No recent changes to show.'));
      return;
    }
    
    console.log(chalk.blue('\n📝 Recent Changes:\n'));
    
    recentChanges.forEach((change, index) => {
      const timeAgo = this.getTimeAgo(change.timestamp);
      const reversibleIcon = change.reversible ? '↩️ ' : '  ';
      
      console.log(
        `${reversibleIcon}${index + 1}. ${chalk.bold(change.description)} ${chalk.dim(`(${timeAgo} ago)`)}`
      );
      
      if (change.details.path) {
        console.log(chalk.dim(`     Path: ${change.details.path}`));
      }
      if (change.type === 'command') {
        console.log(chalk.dim(`     Command: ${change.details.command}`));
      }
    });
  }
  
  /**
   * Interactive undo with confirmation
   */
  async interactiveUndo(): Promise<void> {
    const reversibleChanges = this.changesLog
      .filter(c => c.reversible)
      .slice(-10)
      .reverse();
    
    if (reversibleChanges.length === 0) {
      console.log(chalk.yellow('No reversible changes found.'));
      return;
    }
    
    const choices = reversibleChanges.map((change, index) => ({
      name: `${change.description} (${this.getTimeAgo(change.timestamp)} ago)`,
      value: change.id,
      short: change.description,
    }));
    
    choices.push({
      name: chalk.dim('Cancel'),
      value: 'cancel',
      short: 'Cancel',
    });
    
    const { changeId } = await inquirer.prompt([
      {
        type: 'list',
        name: 'changeId',
        message: 'Which change would you like to undo?',
        choices,
      },
    ]);
    
    if (changeId === 'cancel') {
      return;
    }
    
    const change = this.changesLog.find(c => c.id === changeId);
    if (!change) {
      console.log(chalk.red('Change not found.'));
      return;
    }
    
    // Confirm undo
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Are you sure you want to undo: ${change.description}?`,
        default: false,
      },
    ]);
    
    if (!confirm) {
      console.log(chalk.yellow('Undo cancelled.'));
      return;
    }
    
    await this.undoChange(change);
  }
  
  /**
   * Undo a specific change
   */
  private async undoChange(change: ChangeRecord): Promise<void> {
    progressManager.start({
      type: 'spinner',
      message: `Undoing: ${change.description}`,
    });
    
    try {
      switch (change.type) {
        case 'file_create':
          if (change.details.path) {
            await fs.unlink(change.details.path);
            progressManager.succeed(`Deleted created file: ${change.details.path}`);
          }
          break;
          
        case 'file_edit':
          if (change.details.path && change.details.backupPath) {
            const backupContent = await fs.readFile(change.details.backupPath, 'utf8');
            await fs.writeFile(change.details.path, backupContent);
            progressManager.succeed(`Restored file: ${change.details.path}`);
          }
          break;
          
        case 'file_delete':
          if (change.details.path && change.details.originalContent) {
            await fs.writeFile(change.details.path, change.details.originalContent);
            progressManager.succeed(`Restored deleted file: ${change.details.path}`);
          }
          break;
          
        case 'file_move':
          if (change.details.oldPath && change.details.newPath) {
            await fs.rename(change.details.newPath, change.details.oldPath);
            progressManager.succeed(`Moved file back: ${change.details.newPath} → ${change.details.oldPath}`);
          }
          break;
          
        default:
          progressManager.fail('Cannot undo this type of change');
          return;
      }
      
      // Mark change as undone
      change.reversible = false;
      await this.saveChangesLog();
      
    } catch (error) {
      progressManager.fail(`Failed to undo: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  /**
   * Create a backup of file content
   */
  private async createBackup(filePath: string, content: string): Promise<string> {
    const timestamp = Date.now();
    const fileName = path.basename(filePath);
    const backupName = `${timestamp}_${fileName}`;
    const backupPath = path.join(this.backupsDir, backupName);
    
    await fs.writeFile(backupPath, content);
    return backupPath;
  }
  
  /**
   * Add a change to the log
   */
  private async addChange(change: ChangeRecord): Promise<void> {
    this.changesLog.push(change);
    
    // Keep only the most recent changes
    if (this.changesLog.length > this.maxChanges) {
      const removed = this.changesLog.splice(0, this.changesLog.length - this.maxChanges);
      
      // Clean up old backups
      for (const oldChange of removed) {
        if (oldChange.details.backupPath) {
          try {
            await fs.unlink(oldChange.details.backupPath);
          } catch {
            // Ignore errors cleaning up old backups
          }
        }
      }
    }
    
    await this.saveChangesLog();
  }
  
  /**
   * Load changes log from disk
   */
  private async loadChangesLog(): Promise<void> {
    const logPath = path.join(this.changesDir, 'changes.json');
    
    try {
      const content = await fs.readFile(logPath, 'utf8');
      this.changesLog = JSON.parse(content);
    } catch {
      // No existing log, start fresh
      this.changesLog = [];
    }
  }
  
  /**
   * Save changes log to disk
   */
  private async saveChangesLog(): Promise<void> {
    const logPath = path.join(this.changesDir, 'changes.json');
    await fs.writeFile(logPath, JSON.stringify(this.changesLog, null, 2));
  }
  
  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `change_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
  
  /**
   * Get human-readable time ago
   */
  private getTimeAgo(timestamp: string): string {
    const diff = Date.now() - new Date(timestamp).getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''}`;
    return `${seconds} second${seconds > 1 ? 's' : ''}`;
  }
}

// Export singleton instance
export const undoManager = new UndoManager();