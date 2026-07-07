import Link from "next/link";
import ContentEditorLoader from "@/components/admin/ContentEditorLoader";

export default async function EditContentPage({ params }: { params: Promise<{ type: string; slug: string }> }) {
  const { type, slug } = await params;
  return (
    <div>
      <p style={{ marginBottom: "1rem" }}>
        <Link href="/admin/content" className="font-sans text-gray text-sm link-highlight">
          ← content
        </Link>
      </p>
      <ContentEditorLoader typeId={type} slug={slug} />
    </div>
  );
}
