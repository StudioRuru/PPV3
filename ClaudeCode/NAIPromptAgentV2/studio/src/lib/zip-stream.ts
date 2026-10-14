import { Zip, ZipPassThrough } from "fflate";

/**
 * A stored (uncompressed) zip built entry by entry as the reader pulls: only one file is in memory at a
 * time and nothing blocks the server for long. PNGs are already compressed, so storing keeps them byte-exact.
 */
export function zipStream(entries: AsyncIterable<{ name: string; data: Uint8Array }>): ReadableStream<Uint8Array> {
  const it = entries[Symbol.asyncIterator]();
  let zip: Zip;
  return new ReadableStream({
    start(ctrl) {
      zip = new Zip((err, chunk, final) => {
        if (err) return ctrl.error(err);
        ctrl.enqueue(chunk);
        if (final) ctrl.close();
      });
    },
    async pull() {
      const next = await it.next();
      if (next.done) { zip.end(); return; }
      const f = new ZipPassThrough(next.value.name);
      zip.add(f);
      f.push(next.value.data, true);
    },
  });
}
