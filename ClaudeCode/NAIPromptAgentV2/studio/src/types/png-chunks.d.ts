declare module "png-chunks-extract" {
  interface PngChunk {
    name: string;
    data: Uint8Array;
  }
  export default function extractChunks(data: Uint8Array): PngChunk[];
}

declare module "png-chunk-text" {
  export function decode(chunk: { name: string; data: Uint8Array } | Uint8Array): {
    keyword: string;
    text: string;
  };
  export function encode(keyword: string, text: string): { name: string; data: Uint8Array };
}

declare module "png-chunks-encode" {
  export default function encodeChunks(chunks: { name: string; data: Uint8Array }[]): Uint8Array;
}
