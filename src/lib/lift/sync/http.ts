export class BodyTooLarge extends Error {}

// reads at most `limit` bytes so a missing/lying content-length can't make us buffer more
export async function readCapped(request: Request, limit: number): Promise<string> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw new BodyTooLarge();
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new BodyTooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
