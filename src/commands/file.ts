import * as vscode from "vscode";
import { ensureMutationAllowed, resolveWorkspacePath } from "../security";
import { log, logWarn } from "../logger";

// --- vscode.file.read ---

interface FileReadParams {
  path: string;
  offset?: number;
  limit?: number;
}

export async function fileRead(params: FileReadParams): Promise<{ content: string; totalLines: number; language: string }> {
  const uri = resolveWorkspacePath(params.path);
  const doc = await vscode.workspace.openTextDocument(uri);
  const totalLines = doc.lineCount;
  const language = doc.languageId;

  const offset = Math.max(0, Math.floor(params.offset ?? 0));
  const limit = Math.max(0, Math.floor(params.limit ?? totalLines));
  const startLine = Math.min(offset, totalLines);
  const endLine = Math.min(startLine + limit, totalLines);
  const fullTextLength = doc.getText().length;
  const startOffset = startLine >= totalLines
    ? fullTextLength
    : doc.offsetAt(new vscode.Position(startLine, 0));
  const endOffset = endLine >= totalLines
    ? fullTextLength
    : doc.offsetAt(new vscode.Position(endLine, 0));
  const content = doc.getText(
    new vscode.Range(doc.positionAt(startOffset), doc.positionAt(endOffset))
  );

  log(`file.read: ${params.path} (lines ${startLine}-${endLine}/${totalLines})`);
  return { content, totalLines, language };
}

// --- vscode.file.write ---

interface FileWriteParams {
  path: string;
  content: string;
}

export async function fileWrite(params: FileWriteParams): Promise<{ ok: boolean; created: boolean }> {
  const uri = resolveWorkspacePath(params.path);
  await ensureMutationAllowed("write to a file", params.path);

  let created = false;
  try {
    await vscode.workspace.fs.stat(uri);
  } catch {
    created = true;
  }

  const encoder = new TextEncoder();
  await vscode.workspace.fs.writeFile(uri, encoder.encode(params.content));

  log(`file.write: ${params.path} (${created ? "created" : "updated"}, ${params.content.length} chars)`);
  return { ok: true, created };
}

// --- vscode.file.edit ---

interface FileEditParams {
  path: string;
  oldText: string;
  newText: string;
}

export async function fileEdit(params: FileEditParams): Promise<{ ok: boolean; replacements: number }> {
  await ensureMutationAllowed("edit a file", params.path);
  if (!params.oldText) {
    throw new Error("oldText must be non-empty");
  }

  const uri = resolveWorkspacePath(params.path);
  const doc = await vscode.workspace.openTextDocument(uri);
  const fullText = doc.getText();

  // Find all occurrences
  const ranges: vscode.Range[] = [];
  let searchStart = 0;
  while (true) {
    const idx = fullText.indexOf(params.oldText, searchStart);
    if (idx === -1) {
      break;
    }
    const startPos = doc.positionAt(idx);
    const endPos = doc.positionAt(idx + params.oldText.length);
    ranges.push(new vscode.Range(startPos, endPos));
    searchStart = idx + params.oldText.length;
  }

  if (ranges.length === 0) {
    throw new Error(`oldText not found in ${params.path}`);
  }

  const edit = new vscode.WorkspaceEdit();
  for (const range of ranges) {
    edit.replace(uri, range, params.newText);
  }
  const success = await vscode.workspace.applyEdit(edit);

  if (success) {
    // Save the document
    const edited = await vscode.workspace.openTextDocument(uri);
    await edited.save();
  }

  log(`file.edit: ${params.path} (${ranges.length} replacements)`);
  return { ok: success, replacements: ranges.length };
}

// --- vscode.file.delete ---

interface FileDeleteParams {
  path: string;
  useTrash?: boolean;
}

export async function fileDelete(params: FileDeleteParams): Promise<{ ok: boolean }> {
  await ensureMutationAllowed("delete a file", params.path);

  const uri = resolveWorkspacePath(params.path);
  const useTrash = params.useTrash !== false; // default true

  await vscode.workspace.fs.delete(uri, { useTrash });

  logWarn(`file.delete: ${params.path} (trash: ${useTrash})`);
  return { ok: true };
}
