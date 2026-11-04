import { COARSEN_OPTIONS } from "@/lib/privacy/settings";
import PrivacyAdmin from "@/components/admin/PrivacyAdmin";
import { isAdminViewer } from "../require-admin";

export const dynamic = "force-dynamic";

export default async function AdminPrivacyPage() {
  if (!(await isAdminViewer())) return null;
  return <PrivacyAdmin coarsenOptions={[...COARSEN_OPTIONS]} />;
}
