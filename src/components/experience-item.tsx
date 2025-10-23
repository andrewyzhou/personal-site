import Image from "next/image";

// Define the type for our component props (like function parameters)
type ExperienceItemProps = {
  title: string;           // e.g., "Software Engineer"
  subtitle: string;        // e.g., "iPick.ai • Sept 2024 - Present"
  bullets: string[];       // e.g., ["Built feature X", "Improved Y by 50%"]
  mediaType: "image" | "video";  // What kind of media?
  mediaSrc: string;        // Path to image/video file
  mediaCaption: string;    // Caption below the media
  mediaAlt?: string;       // Alt text for image (optional)
};

export default function ExperienceItem({
  title,
  subtitle,
  bullets,
  mediaType,
  mediaSrc,
  mediaCaption,
  mediaAlt = "Experience media"
}: ExperienceItemProps) {
  return (
    <div className="relative" style={{ marginBottom: '5vh', marginLeft: '2vw' }}>
      {/* Vertical line and content wrapper */}
      <div className="flex gap-6">
        {/* Vertical line - height matches content only */}
        <div className="w-1 bg-[#9c9fc1] flex-shrink-0 absolute left-[-2vw] top-0 bottom-0 rounded-full"></div>
        
        {/* Content wrapper */}
        <div className="flex flex-col md:flex-row gap-8 flex-1 md:items-stretch">
          {/* Left side: Text content (70% width on desktop) */}
          <div className="flex-1 md:max-w-[65%]">
            <h3 className="text-3xl font-helvetica text-[#303030] mb-1">
              {title}
            </h3>
            <p className="text-lg font-helvetica text-gray-600 mb-4">
              {subtitle}
            </p>
            <ul className="list-disc list-outside space-y-2 text-lg text-gray-800 font-helvetica pl-1" style={{ marginLeft: '1.5rem' }}>
              {bullets.map((bullet, index) => (
                <li key={index} dangerouslySetInnerHTML={{ __html: bullet }}></li>
              ))}
            </ul>
          </div>

          {/* Right side: Media + Caption (remaining space) */}
          <div className="flex-shrink-0 w-full md:w-80 flex flex-col justify-center">
            {/* Media container with border */}
            <div className="relative bg-gray-100 rounded-lg overflow-hidden w-full aspect-[3/2] md:aspect-auto md:h-full md:max-h-[213px] border-4 border-[#9c9fc1]">
              {mediaType === "image" ? (
                <Image
                  src={mediaSrc}
                  alt={mediaAlt}
                  fill
                  className="object-cover"
                />
              ) : (
                <video
                  src={mediaSrc}
                  controls
                  className="w-full h-full object-cover"
                />
              )}
            </div>
            
            {/* Caption */}
            {mediaCaption && (
              <p className="text-sm font-helvetica text-gray-600 text-center mt-2">
                {mediaCaption}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

