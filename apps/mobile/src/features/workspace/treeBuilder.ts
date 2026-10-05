export interface TreeNode {
  name: string;
  path: string; // workspace-relative normalised path (forward slashes)
  isFolder: boolean;
  children: TreeNode[];
}

export interface FlatTreeItem {
  node: TreeNode;
  depth: number;
}

/**
 * Normalises a file path to forward slashes with no leading/trailing slashes.
 */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

/**
 * Builds a hierarchical tree from a flat list of workspace-relative file paths.
 * Folders sort before files; within each group, items sort alphabetically.
 * Empty folders are not represented because listFiles only returns file paths.
 */
export function buildTree(filePaths: readonly string[]): TreeNode[] {
  interface MutableNode {
    name: string;
    path: string;
    isFolder: boolean;
    childrenMap: Map<string, MutableNode>;
  }

  const rootChildren = new Map<string, MutableNode>();

  for (const rawPath of filePaths) {
    const normalised = normalizePath(rawPath);
    if (!normalised) continue;

    const segments = normalised.split('/');
    let currentMap = rootChildren;
    let currentPath = '';

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const isFile = i === segments.length - 1;

      let existing = currentMap.get(segment);
      if (!existing) {
        existing = {
          name: segment,
          path: currentPath,
          isFolder: !isFile,
          childrenMap: new Map(),
        };
        currentMap.set(segment, existing);
      } else if (!isFile && !existing.isFolder) {
        // If it was somehow recorded as file before, upgrade to folder
        existing.isFolder = true;
      }

      currentMap = existing.childrenMap;
    }
  }

  function convertAndSort(map: Map<string, MutableNode>): TreeNode[] {
    const nodes: TreeNode[] = [];
    for (const mutable of map.values()) {
      nodes.push({
        name: mutable.name,
        path: mutable.path,
        isFolder: mutable.isFolder,
        children: mutable.isFolder ? convertAndSort(mutable.childrenMap) : [],
      });
    }

    nodes.sort((a, b) => {
      if (a.isFolder && !b.isFolder) return -1;
      if (!a.isFolder && b.isFolder) return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
    });

    return nodes;
  }

  return convertAndSort(rootChildren);
}

/**
 * Flattens the tree into a list of visible rows based on expanded folder paths.
 */
export function flattenTree(
  nodes: readonly TreeNode[],
  expandedPaths: ReadonlySet<string>,
): FlatTreeItem[] {
  const result: FlatTreeItem[] = [];

  function traverse(list: readonly TreeNode[], depth: number) {
    for (const node of list) {
      result.push({ node, depth });
      if (node.isFolder && expandedPaths.has(node.path)) {
        traverse(node.children, depth + 1);
      }
    }
  }

  traverse(nodes, 0);
  return result;
}
