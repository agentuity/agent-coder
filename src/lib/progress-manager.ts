import ora from 'ora';
import type { Ora } from 'ora';
import chalk from 'chalk';
import cliProgress from 'cli-progress';

export interface ProgressOptions {
  type: 'spinner' | 'bar' | 'steps';
  message: string;
  total?: number;
  showPercentage?: boolean;
  showETA?: boolean;
}

export class ProgressManager {
  private activeSpinner: Ora | null = null;
  private activeBar: cliProgress.SingleBar | null = null;
  private currentStep: number = 0;
  private totalSteps: number = 0;
  private stepMessages: string[] = [];
  
  /**
   * Start a progress indicator
   */
  start(options: ProgressOptions): void {
    this.stop(); // Clean up any existing progress
    
    switch (options.type) {
      case 'spinner':
        this.startSpinner(options.message);
        break;
      case 'bar':
        this.startProgressBar(options);
        break;
      case 'steps':
        this.startSteps(options);
        break;
    }
  }
  
  /**
   * Update progress
   */
  update(value: number | string, message?: string): void {
    if (this.activeSpinner && typeof value === 'string') {
      this.activeSpinner.text = value;
    } else if (this.activeBar && typeof value === 'number') {
      this.activeBar.update(value, { message });
    } else if (this.totalSteps > 0 && typeof value === 'number') {
      this.updateStep(value, message);
    }
  }
  
  /**
   * Mark as successful
   */
  succeed(message?: string): void {
    if (this.activeSpinner) {
      this.activeSpinner.succeed(message || this.activeSpinner.text);
      this.activeSpinner = null;
    } else if (this.activeBar) {
      this.activeBar.stop();
      console.log(chalk.green('✓'), message || 'Complete');
      this.activeBar = null;
    } else if (this.totalSteps > 0) {
      console.log(chalk.green('✓'), message || 'All steps complete');
      this.resetSteps();
    }
  }
  
  /**
   * Mark as failed
   */
  fail(message?: string): void {
    if (this.activeSpinner) {
      this.activeSpinner.fail(message || this.activeSpinner.text);
      this.activeSpinner = null;
    } else if (this.activeBar) {
      this.activeBar.stop();
      console.log(chalk.red('✗'), message || 'Failed');
      this.activeBar = null;
    } else if (this.totalSteps > 0) {
      console.log(chalk.red('✗'), message || 'Step failed');
      this.resetSteps();
    }
  }
  
  /**
   * Stop progress indicator
   */
  stop(): void {
    if (this.activeSpinner) {
      this.activeSpinner.stop();
      this.activeSpinner = null;
    }
    if (this.activeBar) {
      this.activeBar.stop();
      this.activeBar = null;
    }
    if (this.totalSteps > 0) {
      this.resetSteps();
    }
  }
  
  /**
   * Create a multi-step progress indicator
   */
  createSteps(steps: string[]): void {
    this.stop();
    this.stepMessages = steps;
    this.totalSteps = steps.length;
    this.currentStep = 0;
    
    console.log(chalk.blue(`\n📋 ${steps.length} steps to complete:\n`));
    steps.forEach((step, index) => {
      console.log(chalk.gray(`   ${index + 1}. ${step}`));
    });
    console.log();
  }
  
  /**
   * Mark current step as complete and move to next
   */
  nextStep(customMessage?: string): void {
    if (this.currentStep < this.totalSteps) {
      const message = customMessage || this.stepMessages[this.currentStep];
      console.log(chalk.green(`✓ Step ${this.currentStep + 1}/${this.totalSteps}:`), message);
      this.currentStep++;
      
      if (this.currentStep < this.totalSteps) {
        const nextMessage = this.stepMessages[this.currentStep];
        console.log(chalk.blue(`→ Step ${this.currentStep + 1}/${this.totalSteps}:`), chalk.dim(nextMessage));
      } else {
        console.log(chalk.green('\n✨ All steps completed!\n'));
        this.resetSteps();
      }
    }
  }
  
  /**
   * Create a progress bar for file operations
   */
  createFileProgress(totalFiles: number, operation: string = 'Processing'): void {
    this.stop();
    
    this.activeBar = new cliProgress.SingleBar({
      format: `${operation} |${chalk.cyan('{bar}')}| {percentage}% | {value}/{total} Files | ETA: {eta}s`,
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true,
    }, cliProgress.Presets.shades_classic);
    
    this.activeBar.start(totalFiles, 0);
  }
  
  /**
   * Update file progress
   */
  updateFileProgress(current: number, currentFile?: string): void {
    if (this.activeBar) {
      const payload: any = {};
      if (currentFile) {
        payload.filename = currentFile.length > 40 
          ? '...' + currentFile.slice(-37) 
          : currentFile;
      }
      this.activeBar.update(current, payload);
    }
  }
  
  private startSpinner(message: string): void {
    this.activeSpinner = ora({
      text: message,
      spinner: 'dots',
      color: 'blue',
    }).start();
  }
  
  private startProgressBar(options: ProgressOptions): void {
    if (!options.total) return;
    
    const format = options.showPercentage 
      ? `${options.message} |${chalk.cyan('{bar}')}| {percentage}%`
      : `${options.message} |${chalk.cyan('{bar}')}| {value}/{total}`;
    
    this.activeBar = new cliProgress.SingleBar({
      format,
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true,
    }, cliProgress.Presets.shades_classic);
    
    this.activeBar.start(options.total, 0);
  }
  
  private startSteps(options: ProgressOptions): void {
    if (!options.total) return;
    
    this.totalSteps = options.total;
    this.currentStep = 0;
    console.log(chalk.blue(`\n${options.message} (${options.total} steps)\n`));
  }
  
  private updateStep(step: number, message?: string): void {
    this.currentStep = step;
    if (message) {
      console.log(chalk.blue(`→ Step ${step}/${this.totalSteps}:`), message);
    }
  }
  
  private resetSteps(): void {
    this.currentStep = 0;
    this.totalSteps = 0;
    this.stepMessages = [];
  }
}

// Singleton instance
export const progressManager = new ProgressManager();