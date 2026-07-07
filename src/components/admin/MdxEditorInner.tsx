"use client";

import {
  MDXEditor,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  linkPlugin,
  linkDialogPlugin,
  imagePlugin,
  tablePlugin,
  codeBlockPlugin,
  codeMirrorPlugin,
  markdownShortcutPlugin,
  jsxPlugin,
  diffSourcePlugin,
  toolbarPlugin,
  GenericJsxEditor,
  UndoRedo,
  BoldItalicUnderlineToggles,
  BlockTypeSelect,
  ListsToggle,
  CreateLink,
  InsertImage,
  InsertCodeBlock,
  DiffSourceToggleWrapper,
  type JsxComponentDescriptor,
  type MDXEditorMethods,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";
import { forwardRef } from "react";
import { prepareImage } from "@/lib/client/image";

// jsx used in existing content must round-trip: Figure/Gallery from blog mdx,
// plus bio's inline spans handled by the generic editor fallback.
const jsxComponentDescriptors: JsxComponentDescriptor[] = [
  {
    name: "Figure",
    kind: "flow",
    props: [
      { name: "src", type: "string" },
      { name: "alt", type: "string" },
      { name: "caption", type: "string" },
      { name: "width", type: "number" },
      { name: "height", type: "number" },
    ],
    hasChildren: false,
    Editor: GenericJsxEditor,
  },
  {
    name: "Gallery",
    kind: "flow",
    props: [],
    hasChildren: true,
    Editor: GenericJsxEditor,
  },
  {
    name: "span",
    kind: "text",
    props: [{ name: "className", type: "string" }],
    hasChildren: true,
    Editor: GenericJsxEditor,
  },
];

interface Props {
  markdown: string;
  onChange: (markdown: string) => void;
  uploadPrefix: string; // content/<type>/<slug>
}

const MdxEditorInner = forwardRef<MDXEditorMethods, Props>(function MdxEditorInner(
  { markdown, onChange, uploadPrefix },
  ref
) {
  async function imageUploadHandler(image: File): Promise<string> {
    const prepared = await prepareImage(image);
    const form = new FormData();
    form.append("file", prepared.blob, "image.jpg");
    form.append("prefix", uploadPrefix);
    form.append("width", String(prepared.width));
    form.append("height", String(prepared.height));
    const res = await fetch("/api/admin/upload", { method: "POST", body: form });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.data?.url) {
      throw new Error(body?.error?.message ?? "image upload failed — nothing inserted");
    }
    return body.data.url;
  }

  return (
    <MDXEditor
      ref={ref}
      markdown={markdown}
      onChange={onChange}
      plugins={[
        headingsPlugin({ allowedHeadingLevels: [2, 3] }),
        listsPlugin(),
        quotePlugin(),
        thematicBreakPlugin(),
        linkPlugin(),
        linkDialogPlugin(),
        imagePlugin({ imageUploadHandler }),
        tablePlugin(),
        codeBlockPlugin({ defaultCodeBlockLanguage: "" }),
        codeMirrorPlugin({
          codeBlockLanguages: { "": "plain", py: "python", ts: "typescript", js: "javascript", css: "css", bash: "bash" },
        }),
        jsxPlugin({ jsxComponentDescriptors }),
        markdownShortcutPlugin(),
        diffSourcePlugin({ viewMode: "rich-text" }),
        toolbarPlugin({
          toolbarContents: () => (
            <DiffSourceToggleWrapper>
              <UndoRedo />
              <BoldItalicUnderlineToggles />
              <BlockTypeSelect />
              <ListsToggle />
              <CreateLink />
              <InsertImage />
              <InsertCodeBlock />
            </DiffSourceToggleWrapper>
          ),
        }),
      ]}
    />
  );
});

export default MdxEditorInner;
