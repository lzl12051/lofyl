function readUInt32BE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] << 24)
    | (bytes[offset + 1] << 16)
    | (bytes[offset + 2] << 8)
    | bytes[offset + 3]
  ) >>> 0;
}

function readSyncSafeInt(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] & 0x7f) << 21)
    | ((bytes[offset + 1] & 0x7f) << 14)
    | ((bytes[offset + 2] & 0x7f) << 7)
    | (bytes[offset + 3] & 0x7f)
  ) >>> 0;
}

function bytesToAscii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function buildCoverUrl(imageData: Uint8Array, mimeType: string): string | undefined {
  if (!imageData.length || !mimeType) return undefined;
  return `data:${mimeType};base64,${bytesToBase64(imageData)}`;
}

function findZeroTerminator(bytes: Uint8Array, start: number, encoding: number): number {
  if (encoding === 1 || encoding === 2) {
    for (let i = start; i + 1 < bytes.length; i += 2) {
      if (bytes[i] === 0 && bytes[i + 1] === 0) return i;
    }
    return bytes.length;
  }

  for (let i = start; i < bytes.length; i++) {
    if (bytes[i] === 0) return i;
  }
  return bytes.length;
}

function extractId3Cover(bytes: Uint8Array): string | undefined {
  if (bytesToAscii(bytes, 0, 3) !== 'ID3') return undefined;

  const version = bytes[3];
  const tagSize = readSyncSafeInt(bytes, 6);
  let offset = 10;
  const end = Math.min(bytes.length, 10 + tagSize);

  while (offset + 10 <= end) {
    const frameId = bytesToAscii(bytes, offset, 4);
    const frameSize = version === 4 ? readSyncSafeInt(bytes, offset + 4) : readUInt32BE(bytes, offset + 4);
    if (!frameId.trim() || frameSize <= 0) break;

    const frameStart = offset + 10;
    const frameEnd = frameStart + frameSize;
    if (frameEnd > end) break;

    if (frameId === 'APIC') {
      const frame = bytes.slice(frameStart, frameEnd);
      const encoding = frame[0];
      let cursor = 1;
      const mimeEnd = findZeroTerminator(frame, cursor, 0);
      const mimeType = bytesToAscii(frame, cursor, mimeEnd - cursor) || 'image/jpeg';
      cursor = mimeEnd + 1;
      cursor += 1;
      const descriptionEnd = findZeroTerminator(frame, cursor, encoding);
      cursor = descriptionEnd + (encoding === 1 || encoding === 2 ? 2 : 1);
      return buildCoverUrl(frame.slice(cursor), mimeType);
    }

    offset = frameEnd;
  }

  return undefined;
}

function extractFlacCover(bytes: Uint8Array): string | undefined {
  if (bytesToAscii(bytes, 0, 4) !== 'fLaC') return undefined;

  let offset = 4;
  while (offset + 4 <= bytes.length) {
    const header = bytes[offset];
    const isLast = (header & 0x80) !== 0;
    const blockType = header & 0x7f;
    const blockLength = (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
    const blockStart = offset + 4;

    if (blockType === 6 && blockStart + blockLength <= bytes.length) {
      let cursor = blockStart;
      cursor += 4;
      const mimeLength = readUInt32BE(bytes, cursor);
      cursor += 4;
      const mimeType = bytesToAscii(bytes, cursor, mimeLength);
      cursor += mimeLength;
      const descLength = readUInt32BE(bytes, cursor);
      cursor += 4 + descLength;
      cursor += 16;
      const imageLength = readUInt32BE(bytes, cursor);
      cursor += 4;
      return buildCoverUrl(bytes.slice(cursor, cursor + imageLength), mimeType);
    }

    offset = blockStart + blockLength;
    if (isLast) break;
  }

  return undefined;
}

function findAtom(
  bytes: Uint8Array,
  start: number,
  end: number,
  path: string[]
): { start: number; size: number } | undefined {
  let offset = start;

  while (offset + 8 <= end) {
    let size = readUInt32BE(bytes, offset);
    const type = bytesToAscii(bytes, offset + 4, 4);
    let headerSize = 8;

    if (size === 1) {
      if (offset + 16 > end) return undefined;
      size = Number((BigInt(readUInt32BE(bytes, offset + 8)) << 32n) | BigInt(readUInt32BE(bytes, offset + 12)));
      headerSize = 16;
    }

    if (!size) break;
    const atomEnd = Math.min(end, offset + size);

    if (type === path[0]) {
      if (path.length === 1) return { start: offset, size };
      const childStart = type === 'meta' ? offset + headerSize + 4 : offset + headerSize;
      const found = findAtom(bytes, childStart, atomEnd, path.slice(1));
      if (found) return found;
    }

    offset += size;
  }

  return undefined;
}

function extractMp4Cover(bytes: Uint8Array): string | undefined {
  const covrAtom =
    findAtom(bytes, 0, bytes.length, ['moov', 'udta', 'meta', 'ilst', 'covr'])
    ?? findAtom(bytes, 0, bytes.length, ['moov', 'meta', 'ilst', 'covr']);

  if (!covrAtom) return undefined;

  const dataAtom = findAtom(bytes, covrAtom.start + 8, covrAtom.start + covrAtom.size, ['data']);
  if (!dataAtom || dataAtom.size <= 16) return undefined;

  const payloadStart = dataAtom.start + 16;
  const format = readUInt32BE(bytes, dataAtom.start + 8);
  const mimeType = format === 14 ? 'image/png' : 'image/jpeg';
  return buildCoverUrl(bytes.slice(payloadStart, dataAtom.start + dataAtom.size), mimeType);
}

export function extractEmbeddedCover(data: ArrayBuffer, mimeType?: string): string | undefined {
  const bytes = new Uint8Array(data);

  if (bytesToAscii(bytes, 0, 3) === 'ID3' || mimeType === 'audio/mpeg') {
    return extractId3Cover(bytes);
  }

  if (bytesToAscii(bytes, 0, 4) === 'fLaC' || mimeType === 'audio/flac') {
    return extractFlacCover(bytes);
  }

  if (bytesToAscii(bytes, 4, 4) === 'ftyp' || mimeType === 'audio/mp4' || mimeType === 'audio/x-m4a') {
    return extractMp4Cover(bytes);
  }

  return undefined;
}
