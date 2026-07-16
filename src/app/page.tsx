import HomeShell from "@/components/home/HomeShell";
import { getSectionDescriptions } from "@/lib/content";

export default function Home() {
  return <HomeShell descriptions={getSectionDescriptions()} />;
}
