import { z } from 'zod';
import { SessionManager } from '../lib/session-manager';

// Tool input schema
export const sessionTrackingSchema = z.object({
  action: z
    .enum(['track-files', 'complete-task'])
    .describe('The action to perform'),
  files: z
    .array(z.string())
    .optional()
    .describe('Files to track (for track-files action)'),
  task: z
    .string()
    .optional()
    .describe('Task description (for complete-task action)'),
});

// Tool handler
export async function sessionTrackingHandler(
  input: z.infer<typeof sessionTrackingSchema>
) {
  const sessionManager = new SessionManager(process.cwd());

  switch (input.action) {
    case 'track-files': {
      if (!input.files || input.files.length === 0) {
        return {
          success: false,
          message: 'No files provided to track',
        };
      }

      await sessionManager.updateWorkingFiles(input.files);

      return {
        success: true,
        message: `Tracked ${input.files.length} file(s) in session`,
        files: input.files,
      };
    }

    case 'complete-task': {
      if (!input.task) {
        return {
          success: false,
          message: 'No task description provided',
        };
      }

      await sessionManager.addCompletedTask(input.task);

      return {
        success: true,
        message: `Task marked as completed: ${input.task}`,
      };
    }

    default:
      return {
        success: false,
        message: `Unknown action: ${input.action}`,
      };
  }
}
