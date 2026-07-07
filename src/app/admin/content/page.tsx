import Link from "next/link";
import ContentBrowser from "@/components/admin/ContentBrowser";

export default function AdminContentPage() {
  return (
    <div>
      <p style={{ marginBottom: "1rem" }}>
        <Link href="/admin" className="font-sans text-gray text-sm link-highlight">
          ← dashboard
        </Link>
      </p>
      <ContentBrowser />
    </div>
  );
}
