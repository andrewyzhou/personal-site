import GoldenLogo from "@/components/home/GoldenLogo";

export const metadata = { title: "logo preview" };

// dev tuning page: both logo layouts side by side. letter positions live in
// the LETTERS constant at the top of src/components/home/GoldenLogo.tsx.
export default function LogoPreview() {
  return (
    <main
      className="min-h-dvh flex flex-wrap items-center justify-center"
      style={{ padding: "3rem", gap: "5rem" }}
    >
      <div className="flex flex-col items-center" style={{ gap: "1.25rem", width: "36rem", maxWidth: "90vw" }}>
        <GoldenLogo layout="horizontal" className="w-full" />
        <p className="text-gray text-sm">horizontal — curve starts bottom right</p>
      </div>
      <div className="flex flex-col items-center" style={{ gap: "1.25rem", width: "21rem", maxWidth: "70vw" }}>
        <GoldenLogo layout="vertical" className="w-full" />
        <p className="text-gray text-sm">vertical — curve starts top left</p>
      </div>
    </main>
  );
}
