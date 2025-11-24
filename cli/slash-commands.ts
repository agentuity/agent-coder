export interface SlashCommand {
  name: string;
  description: string;
  hidden?: boolean;
}

export const slashCommands: SlashCommand[] = [
  { name: '/help', description: 'Show available commands' },
  { name: '/clear', description: 'Clear messages' },
  { name: '/session', description: 'Start a new session' },
  { name: '/continue', description: 'Continue from last session' },
  { name: '/context', description: 'Show current work context' },
  { name: '/goal', description: 'Set or update current goal' },
  { name: '/diff', description: 'Show git diff with formatting' },
  { name: '/diff-save', description: 'Save full diff to file' },
  { name: '/undo', description: 'Undo recent changes (classic only)' },
  { name: '/changes', description: 'Show recent changes (classic only)' },
  { name: '/quit', description: 'Exit the CLI' },
];
