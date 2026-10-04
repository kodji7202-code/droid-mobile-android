import type { PermissionRequest } from '@droidmobile/daemon-client';

export interface PermissionDetailView {
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  /** What the dialog shows: a command, a file with a diff, a patch, or the raw input. */
  body:
    | { kind: 'command'; command: string }
    | { kind: 'diff'; fileName: string; diff: string }
    | { kind: 'patch'; fileName: string; patch: string }
    | { kind: 'input'; text: string };
}

const prefixed = (text: string, mark: '+' | '-') =>
  text === ''
    ? ''
    : text
        .split('\n')
        .map((line) => `${mark}${line}`)
        .join('\n');

function bodyOf(
  details: PermissionRequest['toolUses'][number]['details'],
  input: Record<string, unknown>,
): PermissionDetailView['body'] {
  // Compare on the wire values: the SDK enum is a runtime export we do not import.
  switch (details.type as string) {
    case 'exec': {
      const exec = details as { command: string; fullCommand: string };
      return { kind: 'command', command: exec.fullCommand || exec.command };
    }
    case 'create': {
      const create = details as { fileName: string; content: string };
      return { kind: 'diff', fileName: create.fileName, diff: prefixed(create.content, '+') };
    }
    case 'edit': {
      const edit = details as { fileName: string; oldContent?: string; newContent?: string };
      const removed = prefixed(edit.oldContent ?? '', '-');
      const added = prefixed(edit.newContent ?? '', '+');
      return {
        kind: 'diff',
        fileName: edit.fileName,
        diff: [removed, added].filter((part) => part !== '').join('\n'),
      };
    }
    case 'apply_patch': {
      const patch = details as { fileName: string; patchContent: string };
      return { kind: 'patch', fileName: patch.fileName, patch: patch.patchContent };
    }
    default:
      return { kind: 'input', text: JSON.stringify(input, null, 2) };
  }
}

/** One entry per tool use the daemon asks about, ready to render. */
export function describePermission(request: PermissionRequest): PermissionDetailView[] {
  return request.toolUses.map(({ toolUse, details }) => ({
    toolUseId: toolUse.id,
    toolName: toolUse.name,
    input: toolUse.input,
    body: bodyOf(details, toolUse.input),
  }));
}
