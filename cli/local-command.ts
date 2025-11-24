import { exec } from 'node:child_process';
import type { ExecOptions } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync: (
  command: string,
  options?: ExecOptions
) => Promise<{ stdout: string; stderr: string }> = promisify(exec);

export type CommandExecutor = (
  command: string,
  options: ExecOptions
) => Promise<{ stdout: string; stderr: string }>;

const defaultExecutor: CommandExecutor = (command, options) =>
  execAsync(command, options);

export interface LocalCommandResult {
  stdout: string;
  stderr: string;
  code: number;
  command: string;
}

export async function runLocalCommand(
  command: string,
  cwd: string,
  executor: CommandExecutor = defaultExecutor
): Promise<LocalCommandResult> {
  if (!command.trim()) {
    return {
      stdout: '',
      stderr: 'Empty command',
      code: 1,
      command,
    };
  }

  try {
    const execOptions: ExecOptions = {
      cwd,
      env: process.env,
      maxBuffer: 5 * 1024 * 1024,
    };

    if (process.env.SHELL) {
      execOptions.shell = process.env.SHELL;
    }

    const { stdout, stderr } = await executor(command, execOptions);

    return {
      stdout: stdout || '',
      stderr: stderr || '',
      code: 0,
      command,
    };
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'stdout' in error &&
      'stderr' in error
    ) {
      const execError = error as {
        stdout?: string;
        stderr?: string;
        code?: number;
        message: string;
      };
      return {
        stdout: execError.stdout || '',
        stderr: execError.stderr || execError.message,
        code: execError.code ?? 1,
        command,
      };
    }

    throw error;
  }
}

export function formatCommandResult(result: LocalCommandResult): string {
  const lines: string[] = [`$ ${result.command}`];
  if (result.stdout.trim()) {
    lines.push(result.stdout.trimEnd());
  }
  if (result.stderr.trim()) {
    lines.push(result.stderr.trimEnd());
  }
  lines.push(
    result.code === 0
      ? '✅ Command completed successfully.'
      : `⚠️ Command exited with code ${result.code}.`
  );
  return lines.join('\n');
}
