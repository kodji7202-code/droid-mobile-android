import type { SlashCommand } from '@droidmobile/daemon-client';

/** Text after the leading slash while the draft is still one slash token, otherwise null. */
export function slashQuery(draft: string): string | null {
  const match = /^\/(\S*)$/.exec(draft);
  return match ? match[1]! : null;
}

/** Commands whose name contains the query; names that start with it come first. */
export function filterCommands(
  commands: readonly SlashCommand[],
  query: string,
): readonly SlashCommand[] {
  const needle = query.toLowerCase();
  const starts: SlashCommand[] = [];
  const contains: SlashCommand[] = [];
  for (const command of commands) {
    const name = command.name.toLowerCase();
    if (name.startsWith(needle)) starts.push(command);
    else if (name.includes(needle)) contains.push(command);
  }
  return [...starts, ...contains];
}

export function insertCommand(name: string): string {
  return `/${name} `;
}
