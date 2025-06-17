import { z } from 'zod';
import { ProjectAnalyzer } from '../lib/project-analyzer';
import { SetupManager, type Goal } from '../lib/setup-manager';
import { progressManager } from '../lib/progress-manager';

// Tool input schema
export const projectContextSchema = z.object({
  action: z
    .enum(['analyze', 'get-commands', 'get-config', 'update-goal'])
    .describe('The action to perform'),
  goal: z
    .string()
    .optional()
    .describe(
      'Goal to add to the project context (only for update-goal action)'
    ),
});

// Tool handler
export async function projectContextHandler(
  input: z.infer<typeof projectContextSchema>
) {
  const setupManager = new SetupManager(process.cwd());

  switch (input.action) {
    case 'analyze': {
      progressManager.start({
        type: 'spinner',
        message: 'Analyzing project structure...'
      });
      
      const analyzer = new ProjectAnalyzer(process.cwd());
      const projectInfo = await analyzer.analyze();
      
      progressManager.succeed('Project analysis complete');

      return {
        success: true,
        projectInfo,
        message: `Analyzed project: ${projectInfo.type} project${projectInfo.framework ? ` using ${projectInfo.framework}` : ''}`,
      };
    }

    case 'get-commands': {
      progressManager.start({
        type: 'spinner',
        message: 'Loading project commands...'
      });
      
      const commands = await setupManager.getSuggestedCommands();
      const config = await setupManager.getConfig();
      
      progressManager.succeed('Commands loaded');

      return {
        success: true,
        commands,
        projectType: config?.projectInfo.type,
        framework: config?.projectInfo.framework,
        message: `Found ${commands.length} suggested commands for this project`,
      };
    }

    case 'get-config': {
      const config = await setupManager.getConfig();

      return {
        success: true,
        config,
        message: config
          ? 'Retrieved project configuration'
          : 'No project configuration found',
      };
    }

    case 'update-goal': {
      if (!input.goal) {
        return {
          success: false,
          message: 'Goal is required for update-goal action',
        };
      }

      const config = await setupManager.getConfig();
      if (config) {
        const goals: Goal[] = config.history.goals || [];
        goals.push({
          goal: input.goal,
          createdAt: new Date().toISOString(),
          status: 'active',
        });

        await setupManager.updateConfig({
          history: {
            ...config.history,
            goals,
          },
        });

        return {
          success: true,
          message: `Added goal: ${input.goal}`,
          totalGoals: goals.length,
        };
      }

      return {
        success: false,
        message: 'No project configuration found',
      };
    }

    default:
      return {
        success: false,
        message: `Unknown action: ${input.action}`,
      };
  }
}
