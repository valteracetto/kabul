declare module "subset-font" {
  export default function subsetFont(
    font: Buffer | Uint8Array,
    text: string,
    options?: { targetFormat?: "woff2" | "woff" | "truetype" | "sfnt" },
  ): Promise<Buffer>;
}
