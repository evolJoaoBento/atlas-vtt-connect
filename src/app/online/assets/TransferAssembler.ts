/**
 * Assembles images from the GM's chunks. Only transfers announced with
 * `asset-start` are assembled, never beyond their announced size (at most
 * 64 MB), and at most 16 at once, so a hostile GM or connection cannot make a
 * player hold more. Shared with the web player page.
 */
import { ASSET_LIMITS, type AssetMime } from './assetIds';
import { MAX_HANDLE, type AssetChunk } from './assetProtocol';

interface OpenTransfer {
  id: string;
  mime: AssetMime;
  size: number;
  received: number;
  parts: Uint8Array[];
}

export type ChunkResult = { kind: 'added'; id: string } | { kind: 'overflow'; id: string } | { kind: 'ignored' };

/** A closed transfer: its bytes, or null when fewer arrived than announced. */
export interface EndedTransfer {
  id: string;
  mime: AssetMime;
  bytes: ArrayBuffer | null;
}

export class TransferAssembler {
  private readonly open = new Map<number, OpenTransfer>();

  /** Opens a transfer; false (nothing opened) for a handle or image already open, too many open, or a size over the limit. */
  start(id: string, handle: number, size: number, mime: AssetMime): boolean {
    if (!Number.isInteger(handle) || handle < 1 || handle > MAX_HANDLE) return false;
    if (!Number.isInteger(size) || size < 1 || size > ASSET_LIMITS.fileBytes) return false;
    if (this.open.has(handle) || this.isOpen(id) || this.open.size >= ASSET_LIMITS.openTransfers) return false;
    this.open.set(handle, { id, mime, size, received: 0, parts: [] });
    return true;
  }

  /** Adds a chunk to its transfer; one that would pass the announced size is discarded (`overflow`). */
  chunk(chunk: AssetChunk): ChunkResult {
    const transfer = this.open.get(chunk.handle);
    if (!transfer) return { kind: 'ignored' };
    if (transfer.received + chunk.bytes.byteLength > transfer.size) {
      this.open.delete(chunk.handle);
      return { kind: 'overflow', id: transfer.id };
    }
    transfer.parts.push(chunk.bytes.slice());
    transfer.received += chunk.bytes.byteLength;
    return { kind: 'added', id: transfer.id };
  }

  /** Closes a transfer; null for a handle that is not open. */
  end(handle: number): EndedTransfer | null {
    const transfer = this.open.get(handle);
    if (!transfer) return null;
    this.open.delete(handle);
    if (transfer.received !== transfer.size) return { id: transfer.id, mime: transfer.mime, bytes: null };
    const bytes = new Uint8Array(transfer.size);
    let offset = 0;
    for (const part of transfer.parts) {
      bytes.set(part, offset);
      offset += part.byteLength;
    }
    return { id: transfer.id, mime: transfer.mime, bytes: bytes.buffer };
  }

  /** Discards the transfer of `id`, if one is open. */
  drop(id: string): void {
    for (const [handle, transfer] of this.open) if (transfer.id === id) this.open.delete(handle);
  }

  isOpen(id: string): boolean {
    for (const transfer of this.open.values()) if (transfer.id === id) return true;
    return false;
  }

  /** Bytes received so far for `id`; 0 when no transfer of it is open. */
  received(id: string): number {
    for (const transfer of this.open.values()) if (transfer.id === id) return transfer.received;
    return 0;
  }

  clear(): void {
    this.open.clear();
  }
}
