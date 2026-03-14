import * as vscode from "vscode";
import { resolveWorkspacePath } from "../security";
import { log } from "../logger";

interface DirListParams {
  path?: string;
  recursive?: boolean;
  pattern?: string;
}

interface DirEntry {
  name: string;
  type: "file" | "directory" | "symlink" | "unknown";
  size?: number;
}

const MAX_ENTRIES = 1000;

function getEntryType(fileType: vscode.FileType): DirEntry["type"] {
  if ((fileType & vscode.FileType.File) !== 0) return "file";
  if ((fileType & vscode.FileType.Directory) !== 0) return "directory";
  if ((fileType & vscode.FileType.SymbolicLink) !== 0) return "symlink";
  return "unknown";
}

export async function dirList(
  params: DirListParams
): Promise<{ entries: DirEntry[] }> {
  const relPath = params.path || ".";
  const uri = resolveWorkspacePath(relPath);

  if (params.pattern) {
    // Use glob pattern via findFiles
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders?.length) throw new Error("No workspace folder open");

    const basePattern =
      relPath === "." ? params.pattern : `${relPath}/${params.pattern}`;
    const uris = await vscode.workspace.findFiles(
      new vscode.RelativePattern(workspaceFolders[0], basePattern),
      undefined,
      MAX_ENTRIES
    );

    const rootPath = workspaceFolders[0].uri.fsPath;
    const entries: DirEntry[] = uris.map((u) => {
      const relative = u.fsPath.replace(rootPath + "/", "").replace(rootPath + "\\", "");
      return { name: relative, type: "file" as const };
    });

    log(`dir.list: ${relPath} (pattern: ${params.pattern}, ${entries.length} files)`);
    return { entries };
  }

  // Direct directory listing
  if (params.recursive) {
    const entries: DirEntry[] = [];
    const stack: Array<{ uri: vscode.Uri; relativePath: string }> = [{ uri, relativePath: "" }];

    while (stack.length > 0 && entries.length < MAX_ENTRIES) {
      const current = stack.pop()!;
      const items = await vscode.workspace.fs.readDirectory(current.uri);

      for (const [name, fileType] of items) {
        if (entries.length >= MAX_ENTRIES) {
          break;
        }

        const type = getEntryType(fileType);
        const childUri = vscode.Uri.joinPath(current.uri, name);
        const childRelativePath = current.relativePath ? `${current.relativePath}/${name}` : name;
        let size: number | undefined;

        if (type === "file") {
          try {
            size = (await vscode.workspace.fs.stat(childUri)).size;
          } catch {
            // ignore
          }
        } else if (type === "directory") {
          stack.push({ uri: childUri, relativePath: childRelativePath });
        }

        entries.push({ name: childRelativePath, type, size });
      }
    }

    log(`dir.list: ${relPath} (recursive, ${entries.length} entries)`);
    return { entries };
  }

  const items = await vscode.workspace.fs.readDirectory(uri);
  const entries: DirEntry[] = [];

  for (const [name, fileType] of items) {
    const type = getEntryType(fileType);

    let size: number | undefined;
    if (type === "file") {
      try {
        const stat = await vscode.workspace.fs.stat(
          vscode.Uri.joinPath(uri, name)
        );
        size = stat.size;
      } catch {
        // ignore
      }
    }

    entries.push({ name, type, size });
  }

  log(`dir.list: ${relPath} (${entries.length} entries)`);
  return { entries };
}
