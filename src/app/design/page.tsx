import { redirect } from "next/navigation";
import { DEFAULT_BRAND } from "@/design-system/brands";

export default function DesignIndex() {
  redirect(`/design/${DEFAULT_BRAND}`);
}
