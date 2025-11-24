import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { formatCommandResult, runLocalCommand } from './local-command.ts';
import type { CommandExecutor, LocalCommandResult } from './local-command.ts';
import type { ExecOptions } from 'node:child_process';

let originalShell: string | undefined;

beforeEach(() => {
  originalShell = process.env.SHELL;
});

afterEach(() => {
  if (originalShell === undefined) {
    delete process.env.SHELL;
  } else {
    process.env.SHELL = originalShell;
  }
});

describe('runLocalCommand', () => {
  test('rejects empty commands without invoking executor', async () => {
    let called = false;
    const executor: CommandExecutor = async () => {
      called = true;
      return { stdout: '', stderr: '' };
    };

    const result = await runLocalCommand('   ', '/tmp', executor);

    expect(result).toEqual({
      stdout: '',
      stderr: 'Empty command',
      code: 1,
      command: '   ',
    });
    expect(called).toBe(false);
  });

  test('runs commands with provided executor and omits shell when unset', async () => {
    delete process.env.SHELL;
    let capturedOptions: ExecOptions | undefined;

    const executor: CommandExecutor = async (_command, options) => {
      capturedOptions = options;
      return { stdout: 'ok', stderr: '' };
    };

    const result = await runLocalCommand('echo test', '/repo', executor);

    expect(result).toMatchObject({ stdout: 'ok', stderr: '', code: 0 });
    expect(capturedOptions).toBeDefined();
    expect(capturedOptions).toMatchObject({
      cwd: '/repo',
      env: process.env,
      maxBuffer: 5 * 1024 * 1024,
    });
    expect(capturedOptions?.shell).toBeUndefined();
  });

  test('passes SHELL environment variable to executor when available', async () => {
    process.env.SHELL = '/bin/zsh';
    let capturedShell: string | undefined;

    const executor: CommandExecutor = async (_command, options) => {
      capturedShell = options.shell;
      return { stdout: '', stderr: '' };
    };

    await runLocalCommand('echo test', '/repo', executor);

    expect(capturedShell).toBe('/bin/zsh');
  });

  test('returns structured output when executor throws with stdout/stderr', async () => {
    const error = {
      stdout: 'log output',
      stderr: '',
      code: 2,
      message: 'failed',
    };

    const executor: CommandExecutor = async () => {
      throw error;
    };

    const result = await runLocalCommand('failing', '/repo', executor);

    expect(result).toEqual({
      stdout: 'log output',
      stderr: error.message,
      code: 2,
      command: 'failing',
    });
  });

  test('rethrows unknown executor errors', async () => {
    const executor: CommandExecutor = async () => {
      throw new Error('boom');
    };

    await expect(runLocalCommand('oops', '/repo', executor)).rejects.toThrow(
      'boom'
    );
  });
});

describe('formatCommandResult', () => {
  test('formats successful command output', () => {
    const result: LocalCommandResult = {
      stdout: 'hello\n',
      stderr: '',
      code: 0,
      command: 'echo hello',
    };

    const formatted = formatCommandResult(result);

    expect(formatted).toContain('$ echo hello');
    expect(formatted).toContain('hello');
    expect(formatted).toContain('✅ Command completed successfully.');
  });

  test('formats failed commands with stderr', () => {
    const result: LocalCommandResult = {
      stdout: '',
      stderr: 'bad',
      code: 1,
      command: 'exit 1',
    };

    const formatted = formatCommandResult(result);

    expect(formatted).toContain('bad');
    expect(formatted).toContain('⚠️ Command exited with code 1.');
  });
});
