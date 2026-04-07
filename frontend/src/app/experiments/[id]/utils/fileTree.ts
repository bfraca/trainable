import { FileTreeNode } from '@/lib/types';

/**
 * Strip infrastructure prefixes from a path to get a clean relative path
 * starting from the stage dir (eda/, prep/, train/).
 *
 * Handles all formats Modal may return:
 *   /sessions/{uuid}/eda/scripts/x.py  →  eda/scripts/x.py
 *   sessions/{uuid}/eda/figures/c.png  →  eda/figures/c.png
 *   eda/figures/chart.png              →  eda/figures/chart.png  (already clean)
 *   figures/chart.png                  →  figures/chart.png      (relative to stage)
 *   report.md                          →  report.md              (file at stage root)
 */
export function stripSessionPrefix(path: string, rootPath: string): string {
  // Normalize leading slashes
  let rel = path.replace(/^\/+/, '');
  const rootNorm = rootPath.replace(/^\/+/, '').replace(/\/$/, '');

  // Strip rootPath prefix (e.g. sessions/{uuid})
  if (rel.startsWith(rootNorm + '/')) {
    rel = rel.slice(rootNorm.length + 1);
  }
  // Strip any remaining sessions/{uuid}/ prefix (may appear multiple times)
  while (/^sessions\/[^/]+\//.test(rel)) {
    rel = rel.replace(/^sessions\/[^/]+\//, '');
  }
  // Strip bare UUID-looking directory prefixes (e.g. {uuid}/eda/...)
  while (/^[0-9a-f]{8}-[0-9a-f]{4}-[^/]*\//.test(rel)) {
    rel = rel.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[^/]*\//, '');
  }
  return rel;
}

/**
 * Ensure a file path is prefixed with the stage dir (eda/, prep/, train/).
 * After stripping session prefixes, if the path doesn't start with a stage name,
 * prepend the stage so it goes into the right folder.
 */
export function ensureStagePath(rawPath: string, stage: string, rootPath: string): string {
  const stages = ['eda', 'prep', 'train'];
  const clean = stripSessionPrefix(rawPath, rootPath);
  const firstSeg = clean.split('/')[0];
  // Already starts with a stage dir — good
  if (stages.includes(firstSeg)) return clean;
  // Doesn't start with a stage — prepend it
  if (stage) return `${stage}/${clean}`;
  return clean;
}

export function buildTreeFromFlatList(
  files: { path: string; type: string; _stage?: string }[],
  rootPath: string,
): FileTreeNode {
  const root: FileTreeNode = { name: 'workspace', path: rootPath, type: 'directory', children: [] };

  for (const file of files) {
    const rel = ensureStagePath(file.path, file._stage || '', rootPath);
    if (!rel) continue;

    const segments = rel.split('/');
    let current = root;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const isLast = i === segments.length - 1;

      if (isLast && file.type === 'file') {
        if (!current.children!.find((c) => c.name === segment && c.type === 'file')) {
          current.children!.push({ name: segment, path: file.path, type: 'file' });
        }
      } else {
        let child = current.children!.find((c) => c.name === segment && c.type === 'directory');
        if (!child) {
          child = {
            name: segment,
            path: segments.slice(0, i + 1).join('/'),
            type: 'directory',
            children: [],
          };
          current.children!.push(child);
        }
        current = child;
      }
    }
  }

  sortTree(root);
  return ensureStageFolders(unwrapTree(root));
}

export function insertNodeIntoTree(
  tree: FileTreeNode,
  node: FileTreeNode,
  rootPath: string,
  stage: string = '',
): FileTreeNode {
  const cloned = JSON.parse(JSON.stringify(tree)) as FileTreeNode;
  const rel = ensureStagePath(node.path, stage, rootPath);
  if (!rel) return cloned;

  const segments = rel.split('/');
  let current = cloned;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const isLast = i === segments.length - 1;

    if (!current.children) current.children = [];

    if (isLast) {
      if (!current.children.find((c) => c.name === segment && c.type === node.type)) {
        current.children.push({ name: segment, path: node.path, type: node.type });
      }
    } else {
      let child = current.children.find((c) => c.name === segment && c.type === 'directory');
      if (!child) {
        child = {
          name: segment,
          path: segments.slice(0, i + 1).join('/'),
          type: 'directory',
          children: [],
        };
        current.children.push(child);
      }
      current = child;
    }
  }

  sortTree(cloned);
  return cloned;
}

export function sortTree(node: FileTreeNode) {
  if (!node.children) return;
  for (const child of node.children) sortTree(child);
  node.children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** Strip infrastructure directories (sessions, UUIDs) from the tree root.
 *  sessions > {uuid} > eda  →  shows eda at top level.
 *  Never unwraps stage dirs (eda, prep, train) even if they're the only child. */
export function unwrapTree(tree: FileTreeNode): FileTreeNode {
  const isInfraName = (name: string) =>
    name === 'sessions' || /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(name);

  while (
    tree.children &&
    tree.children.length === 1 &&
    tree.children[0].type === 'directory' &&
    isInfraName(tree.children[0].name)
  ) {
    const only = tree.children[0];
    tree = { ...tree, children: only.children || [] };
  }
  return tree;
}

export function countFiles(node: FileTreeNode): number {
  if (node.type === 'file') return 1;
  return (node.children || []).reduce((sum, c) => sum + countFiles(c), 0);
}

/** Ensure the tree always has eda, prep, train as top-level folders. */
export function ensureStageFolders(tree: FileTreeNode): FileTreeNode {
  if (!tree.children) tree.children = [];
  for (const stage of ['eda', 'prep', 'train']) {
    if (!tree.children.find((c) => c.name === stage && c.type === 'directory')) {
      tree.children.push({
        name: stage,
        path: `__stage__/${stage}`,
        type: 'directory',
        children: [],
      });
    }
  }
  // Sort so stages appear in order: eda, prep, train (then anything else)
  const stageOrder: Record<string, number> = { eda: 0, prep: 1, train: 2 };
  tree.children.sort((a, b) => {
    const oa = stageOrder[a.name] ?? 99;
    const ob = stageOrder[b.name] ?? 99;
    if (oa !== ob) return oa - ob;
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return tree;
}

export function fileBreadcrumb(path: string): string[] {
  return path.split('/').filter(Boolean);
}
