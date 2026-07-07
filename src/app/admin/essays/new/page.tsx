import Link from "next/link";
import EssayBuilder from "@/components/admin/EssayBuilder";

export default function NewEssayPage() {
  return (
    <div>
      <p style={{ marginBottom: "1rem" }}>
        <Link href="/admin" className="font-sans text-gray text-sm link-highlight">
          ← dashboard
        </Link>
      </p>
      <EssayBuilder />
    </div>
  );
}
