/** Promise-based client for the WebVTT worker. */
import type { ExportOptions, FileType, VttDocument } from '@microvtt/core';
import type {
  ExportedFile,
  ImportedFile,
  ItemDiagnostic,
  WorkerRequest,
  WorkerResponse,
} from './protocol.ts';

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

/** Distributes `Omit` over a union, so each request type keeps its own fields. */
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

export class VttWorker {
  private readonly worker: Worker;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;

  constructor() {
    this.worker = new Worker(new URL('./vtt.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      if (response.ok) pending.resolve(response.result);
      else pending.reject(new Error(response.error));
    };
  }

  private request<T>(message: WithoutId<WorkerRequest>, transfer: Transferable[] = []): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.worker.postMessage({ ...message, id }, transfer);
    });
  }

  /** Transfers `bytes` to the worker (the caller's buffer becomes unusable). */
  import(bytes: ArrayBuffer): Promise<ImportedFile> {
    return this.request({ type: 'import', bytes }, [bytes]);
  }

  validate(document: VttDocument, fileType: FileType): Promise<ItemDiagnostic[]> {
    return this.request({ type: 'validate', document, fileType });
  }

  export(document: VttDocument, options: ExportOptions): Promise<ExportedFile> {
    return this.request({ type: 'export', document, options });
  }
}
