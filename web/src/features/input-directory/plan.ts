export const directoryLimits = Object.freeze({files: 128, fileBytes: 8388608, totalBytes: 134217728, folders: 128, pathBytes: 131072, depth: 8, workspaceFolders: 2000});
export interface DirectoryFile {readonly path: string; readonly folders: readonly string[]; readonly name: string; readonly file: File}
export interface DirectoryPlan {readonly files: readonly DirectoryFile[]; readonly bytes: number; readonly folders: number}
export class DirectoryError extends Error {constructor(message: string) {super(message);}}
/** Preview collision key only; backend namespace constraints remain authoritative. */
export const pathKey = (value: string) => value.normalize('NFKC').toLowerCase();
function segment(value: string, maximum: number): void {
  if (!value || value === '.' || value === '..' || value.trim() !== value || value.includes('\\') || [...value].length > maximum
    || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new DirectoryError('A selected path has an unsupported name.');
}
/** Captures only bounded native File references; never reads/prepares their content. */
export function planDirectory(input: ArrayLike<File>): DirectoryPlan {
  if (!Number.isSafeInteger(input.length) || input.length < 1 || input.length > directoryLimits.files) throw new DirectoryError('Choose between 1 and 128 files.');
  const selection = new Selection();
  for (let i = 0; i < input.length; i++) selection.add(input[i]);
  return selection.finish();
}
function selectedFile(file: File | undefined): DirectoryFile {
  if (!(file instanceof File)) throw new DirectoryError('Choose a directory using the file picker.');
  const path = relativePath(file);
  const parts = path.split('/'); const name = parts.pop()!;
  if (path.length > 1024 || !parts.length || parts.length > directoryLimits.depth || name !== file.name) throw new DirectoryError('Selected paths must belong to one directory, within eight folder levels.');
  for (const part of parts) segment(part, 128); segment(name, 200);
  validateSize(file.size);
  return Object.freeze({path, folders: Object.freeze(parts), name, file});
}
class Selection {
  private files: DirectoryFile[] = [];
  private paths = new Map<string, string>();
  private folders = new Map<string, string>();
  private bytes = 0;
  private pathBytes = 0;
  private root: string | undefined;
  add(value: File | undefined): void {
    const entry = selectedFile(value); const {file, path, folders} = entry;
    if (this.root !== undefined && this.root !== folders[0]) throw new DirectoryError('Choose one directory at a time.');
    this.root = folders[0];
    const key = pathKey(path);
    if (this.paths.has(key)) throw new DirectoryError('Selected file paths conflict after namespace name folding.');
    this.paths.set(key, path); this.pathBytes += new TextEncoder().encode(path).length + addFolders(folders, this.folders);
    this.bytes += file.size;
    if (this.bytes > directoryLimits.totalBytes) throw new DirectoryError('The selection must fit 128 MiB.');
    if (this.pathBytes > directoryLimits.pathBytes || this.folders.size > directoryLimits.folders) throw new DirectoryError('Selected directory metadata exceeds its import limit.');
    this.files.push(entry);
  }
  finish(): DirectoryPlan {
    for (const key of this.paths.keys()) if (this.folders.has(key)) throw new DirectoryError('A selected path is both a file and a folder.');
    this.files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    return Object.freeze({files: Object.freeze(this.files), bytes: this.bytes, folders: this.folders.size});
  }
}
function addFolders(parts: readonly string[], folders: Map<string, string>): number {
  let bytes = 0;
  for (let depth = 1; depth <= parts.length; depth++) {
    const path = parts.slice(0, depth).join('/'); const key = pathKey(path); const prior = folders.get(key);
    if (prior !== undefined && prior !== path) throw new DirectoryError('Selected folder names conflict after namespace name folding.');
    if (!prior) {folders.set(key, path); bytes += new TextEncoder().encode(path).length;}
  }
  return bytes;
}

function validateSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0 || size > directoryLimits.fileBytes) throw new DirectoryError('Each file must fit 8 MiB.');
}

function relativePath(file: File): string {
  if ('webkitRelativePath' in file && typeof file.webkitRelativePath === 'string') return file.webkitRelativePath;
  throw new DirectoryError('Choose a directory using the file picker.');
}
