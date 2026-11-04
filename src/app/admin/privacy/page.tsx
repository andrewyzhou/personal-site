import { COARSEN_OPTIONS } from "@/lib/privacy/settings";
import PrivacyAdmin from "@/components/admin/PrivacyAdmin";

export const dynamic = "force-dynamic";

export default function AdminPrivacyPage() {
  return <PrivacyAdmin coarsenOptions={[...COARSEN_OPTIONS]} />;
}
