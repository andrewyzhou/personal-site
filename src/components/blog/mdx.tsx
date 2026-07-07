import fs from "fs";
import path from "path";
import type { ComponentProps } from "react";
import Image from "next/image";
import { imageSize } from "image-size";
import { mdxComponents } from "@/components/mdx/components";

interface FigureProps {
  src: string;
  alt?: string;
  caption?: string;
}

// reads real pixel dimensions from the file in /public so next/image can
// optimize and reserve layout space (no CLS) without the author specifying
// width/height. local paths only — external urls fall back to a plain <img>.
function localDimensions(src: string): { width: number; height: number } {
  const file = path.join(process.cwd(), "public", src);
  const buf = fs.readFileSync(file);
  const dim = imageSize(new Uint8Array(buf));
  if (!dim.width || !dim.height) {
    throw new Error(`[blog] could not read dimensions for ${src}`);
  }
  // exif orientations 5-8 store the image rotated 90°, so the encoded
  // width/height are swapped relative to how it displays.
  const rotated = dim.orientation != null && dim.orientation >= 5;
  return rotated
    ? { width: dim.height, height: dim.width }
    : { width: dim.width, height: dim.height };
}

// captioned, optimized image. used directly in mdx (<Figure src=… caption=… />)
// and as the target of plain markdown images (the `img` override below).
export function Figure({ src, alt, caption }: FigureProps) {
  const isLocal = src.startsWith("/");
  const altText = alt ?? caption ?? "";

  // a local path that doesn't exist under /public must never crash a build:
  // covers are free-text frontmatter, and one typo'd path would otherwise fail
  // the prerender of every page that renders it. degrade to a plain <img>.
  let dims: { width: number; height: number } | null = null;
  if (isLocal) {
    try {
      dims = localDimensions(src);
    } catch {
      dims = null;
    }
  }

  return (
    <figure className="blog-figure">
      {isLocal && dims ? (
        <Image
          src={src}
          alt={altText}
          {...dims}
          sizes="(max-width: 720px) 100vw, 720px"
          style={{ width: "100%", height: "auto", borderRadius: 8 }}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={altText} style={{ width: "100%", borderRadius: 8 }} />
      )}
      {caption && (
        <figcaption className="font-sans text-gray text-sm italic text-center" style={{ marginTop: "0.5rem" }}>
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

// responsive grid for 2-3 side-by-side figures: <Gallery><Figure …/>…</Gallery>
export function Gallery(props: ComponentProps<"div">) {
  return <div className="blog-gallery" {...props} />;
}

// shared mdx map + image components. the `img` override routes plain markdown
// images (![caption](/blog/…/x.jpg)) through Figure, using alt as the caption,
// so both authoring styles produce optimized, captioned images.
export const blogMdxComponents = {
  ...mdxComponents,
  Figure,
  Gallery,
  img: (props: ComponentProps<"img">) => (
    <Figure src={props.src as string} alt={props.alt} caption={props.alt} />
  ),
};
