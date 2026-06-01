import type { Gallery } from "@/lib/gallery";
import GalleryCover from "../GalleryCover";

interface Props {
  galleries: Gallery[];
}

// 3 columns of square cells. covers cropped to 1:1 via object-cover.
// instagram profile feel.
export default function FixedGridLayout({ galleries }: Props) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
      {galleries.map((g) => (
        <div key={g.slug} className="relative aspect-square">
          <GalleryCover
            slug={g.slug}
            title={g.title}
            cover={g.cover}
            sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
            fill
          />
        </div>
      ))}
    </div>
  );
}
