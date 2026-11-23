/** Read up to the wire limit before allocating the contiguous result. */
export async function collectResponseBytes(
  read: () => Promise<ReadableStreamReadResult<Uint8Array>>,
  limit: number,
  tooLarge: () => Error,
): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) throw tooLarge();
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readBoundedBody(
  stream: ReadableStream<Uint8Array>,
  limit: number,
  tooLarge: () => Error,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  try {
    return await collectResponseBytes(() => reader.read(), limit, tooLarge);
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}
