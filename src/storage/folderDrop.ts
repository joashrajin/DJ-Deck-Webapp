/**
 * Extracts all File objects from a browser DragEvent's DataTransfer,
 * recursively traversing dropped folders via webkitGetAsEntry when supported.
 */

interface FileSystemEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  file?: (success: (file: File) => void, error?: (err: unknown) => void) => void;
  createReader?: () => {
    readEntries: (
      success: (entries: FileSystemEntryLike[]) => void,
      error?: (err: unknown) => void
    ) => void;
  };
}

async function readEntryRecursive(entry: FileSystemEntryLike): Promise<File[]> {
  if (entry.isFile && entry.file) {
    return new Promise((resolve) => {
      entry.file!(
        (file) => resolve([file]),
        () => resolve([])
      );
    });
  }

  if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    const collected: File[] = [];

    const readBatch = (): Promise<FileSystemEntryLike[]> =>
      new Promise((resolve) => {
        reader.readEntries(
          (entries) => resolve(entries),
          () => resolve([])
        );
      });

    let batch = await readBatch();
    while (batch.length > 0) {
      for (const child of batch) {
        const nested = await readEntryRecursive(child);
        collected.push(...nested);
      }
      batch = await readBatch();
    }
    return collected;
  }

  return [];
}

export async function extractFilesFromDataTransfer(
  dataTransfer: DataTransfer
): Promise<File[]> {
  const items = dataTransfer.items;
  if (items && items.length > 0) {
    const entries: FileSystemEntryLike[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i] as DataTransferItem & {
        webkitGetAsEntry?: () => FileSystemEntryLike | null;
      };
      if (typeof item.webkitGetAsEntry === 'function') {
        const entry = item.webkitGetAsEntry();
        if (entry) entries.push(entry);
      }
    }
    if (entries.length > 0) {
      const nested = await Promise.all(entries.map((e) => readEntryRecursive(e)));
      return nested.flat();
    }
  }

  return dataTransfer.files ? Array.from(dataTransfer.files) : [];
}
