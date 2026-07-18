import HomeShell from "@/components/home/HomeShell";
import Bio from "@/components/mdx/Bio";
import { getSectionDescriptions } from "@/lib/content";

export default function Home() {
  return <HomeShell descriptions={getSectionDescriptions()} bio={<Bio />} />;
}
