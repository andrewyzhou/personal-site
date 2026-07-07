import Link from "next/link";
import UploadFlow from "@/components/admin/UploadFlow";

export default function AdminUploadPage() {
  return (
    <div>
      <p style={{ marginBottom: "1rem" }}>
        <Link href="/admin" className="font-sans text-gray text-sm link-highlight">
          ← dashboard
        </Link>
      </p>
      <UploadFlow />
    </div>
  );
}
