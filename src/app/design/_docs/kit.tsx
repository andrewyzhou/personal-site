import type { ReactNode } from "react";
import { BrandRoot, Heading, Table, Text, type Brand } from "@/design-system";

// building blocks for doc pages

export function DocHeader({ eyebrow, title, lead }: { eyebrow: string; title: string; lead: string }) {
  return (
    <header>
      <Text size="sm" tone="subtle">
        {eyebrow}
      </Text>
      <Heading level={1} size="3xl">
        {title}
      </Heading>
      <p className="docs-lead">{lead}</p>
    </header>
  );
}

export function Block({ title, intro, children }: { title: string; intro?: ReactNode; children?: ReactNode }) {
  return (
    <section className="ds-stack" data-gap="4">
      <Heading level={2} size="xl">
        {title}
      </Heading>
      {intro ? <div className="docs-prose">{typeof intro === "string" ? <p style={{ margin: 0 }}>{intro}</p> : intro}</div> : null}
      {children}
    </section>
  );
}

// the live thing, in the current brand, light and dark side by side
export function Example({ brand, code, children, stack }: { brand: Brand; code?: string; children: ReactNode; stack?: boolean }) {
  return (
    <div className="docs-example">
      <div className="docs-example-panes">
        {(["light", "dark"] as const).map((t) => (
          <BrandRoot key={t} brand={brand} theme={t} className="docs-pane">
            <span className="docs-pane-label">{t}</span>
            <div className={stack ? "ds-stack" : "ds-cluster"} data-gap={stack ? "4" : "3"}>
              {children}
            </div>
          </BrandRoot>
        ))}
      </div>
      {code ? (
        <pre className="docs-code">
          <code>{code.trim()}</code>
        </pre>
      ) : null}
    </div>
  );
}

export function DoDont({ doText, dontText, doEx, dontEx }: { doText: string; dontText: string; doEx?: ReactNode; dontEx?: ReactNode }) {
  return (
    <div className="docs-dodont">
      <div className="docs-dd" data-kind="do">
        <span className="docs-dd-label">do</span>
        {doEx}
        <Text size="sm" tone="muted">
          {doText}
        </Text>
      </div>
      <div className="docs-dd" data-kind="dont">
        <span className="docs-dd-label">don&apos;t</span>
        {dontEx}
        <Text size="sm" tone="muted">
          {dontText}
        </Text>
      </div>
    </div>
  );
}

export interface PropRow {
  name: string;
  type: string;
  def?: string;
  note: string;
}

export function Props({ rows }: { rows: PropRow[] }) {
  return (
    <div className="docs-table-wrap">
      <Table
        rowKey={(r) => r.name}
        rows={rows}
        columns={[
          { key: "n", header: "prop", cell: (r) => <code className="docs-inline-code">{r.name}</code> },
          { key: "t", header: "type", cell: (r) => <code className="docs-inline-code">{r.type}</code> },
          { key: "d", header: "default", cell: (r) => r.def ?? "—" },
          { key: "x", header: "what it does", cell: (r) => r.note },
        ]}
      />
    </div>
  );
}

export function TokenTable({ rows }: { rows: { token: string; value: ReactNode; use: string }[] }) {
  return (
    <div className="docs-table-wrap">
      <Table
        rowKey={(r) => r.token}
        rows={rows}
        columns={[
          { key: "t", header: "token", cell: (r) => <code className="docs-inline-code">{r.token}</code> },
          { key: "v", header: "value", cell: (r) => r.value },
          { key: "u", header: "use", cell: (r) => r.use },
        ]}
      />
    </div>
  );
}

export function Prose({ children }: { children: ReactNode }) {
  return <div className="docs-prose">{children}</div>;
}
