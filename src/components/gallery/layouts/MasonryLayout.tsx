import type { Gallery } from "@/lib/gallery";
import GalleryCover from "../GalleryCover";

interface Props {
  galleries: Gallery[];
}

// 3 css columns. each cover keeps its natural aspect ratio and stacks
// vertically inside its column. no row alignment between columns.
export default function MasonryLayout({ galleries }: Props) {
  return (
    <div className="gallery-masonry">
      {galleries.map((g) => (
        <div key={g.slug} className="mb-2 break-inside-avoid">
          <GalleryCover
            slug={g.slug}
            title={g.title}
            cover={g.cover}
            sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
          />
        </div>
      ))}
    </div>
  );
}
