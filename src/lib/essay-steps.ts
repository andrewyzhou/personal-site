// pure step machine for the photo essay viewer: flattens blocks into an
// ordered step list so the component stays thin and this logic stays testable.

import type { EssayBlock, EssayImage } from "./photos";

export interface EssayStep {
  blockIndex: number;
  type: "image" | "text";
  image?: EssayImage;
  body?: string;
  galleryPosition?: { index: number; count: number }; // set for gallery members
  durationMs: number;
}

export const IMAGE_STEP_MS = 5000;
export const TEXT_STEP_MS = 8000;

export function flattenBlocks(blocks: EssayBlock[]): EssayStep[] {
  const steps: EssayStep[] = [];
  blocks.forEach((block, blockIndex) => {
    if (block.kind === "text") {
      steps.push({ blockIndex, type: "text", body: block.body, durationMs: TEXT_STEP_MS });
    } else if (block.kind === "image") {
      steps.push({ blockIndex, type: "image", image: block.image, durationMs: IMAGE_STEP_MS });
    } else {
      block.images.forEach((image, i) => {
        steps.push({
          blockIndex,
          type: "image",
          image,
          galleryPosition: { index: i, count: block.images.length },
          durationMs: IMAGE_STEP_MS,
        });
      });
    }
  });
  return steps;
}

// essays with prose start paused: auto-advancing past text someone is reading
// is hostile. pure galleries auto-play like the classic viewer.
export function hasTextContent(blocks: EssayBlock[]): boolean {
  return blocks.some(
    (b) =>
      b.kind === "text" ||
      (b.kind === "image" && !!b.image.text) ||
      (b.kind === "gallery" && b.images.some((i) => !!i.text))
  );
}

export function hasSidebarContent(image: EssayImage | undefined): boolean {
  if (!image) return false;
  return !!image.exif || !!image.gps || !!image.takenAt;
}
