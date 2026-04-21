"use client";

import { useEffect, useId, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

type MermaidModule = typeof import("mermaid");

const markdownSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames || []),
    "section",
    "sup",
    "del",
    "input",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
  ],
  attributes: {
    ...defaultSchema.attributes,
    a: [
      ...((defaultSchema.attributes?.a as Array<string | [string, ...string[]]>) || []),
      "aria-describedby",
      "data-footnote-backref",
      "data-footnote-ref",
      "rel",
      "target",
    ],
    code: [
      ...((defaultSchema.attributes?.code as Array<string | [string, ...string[]]>) || []),
      "className",
    ],
    pre: [
      ...((defaultSchema.attributes?.pre as Array<string | [string, ...string[]]>) || []),
      "className",
    ],
    section: [
      ...((defaultSchema.attributes?.section as Array<string | [string, ...string[]]>) || []),
      "className",
      "data-footnotes",
    ],
    input: [
      ...((defaultSchema.attributes?.input as Array<string | [string, ...string[]]>) || []),
      "checked",
      "disabled",
      "type",
    ],
    sup: [
      ...((defaultSchema.attributes?.sup as Array<string | [string, ...string[]]>) || []),
      "id",
    ],
    th: [
      ...((defaultSchema.attributes?.th as Array<string | [string, ...string[]]>) || []),
      "align",
    ],
    td: [
      ...((defaultSchema.attributes?.td as Array<string | [string, ...string[]]>) || []),
      "align",
    ],
  },
};

function MermaidBlock({ chart }: { chart: string }) {
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string>("");
  const rawId = useId();
  const diagramId = useMemo(() => `mermaid-${rawId.replace(/:/g, "-")}`, [rawId]);

  useEffect(() => {
    let cancelled = false;

    async function renderChart() {
      try {
        const mermaidModule = await import("mermaid");
        const mermaid = (mermaidModule as MermaidModule).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "neutral",
        });
        const { svg: rendered } = await mermaid.render(diagramId, chart);
        if (!cancelled) {
          setSvg(rendered);
          setError("");
        }
      } catch (renderError) {
        if (!cancelled) {
          setSvg("");
          setError(renderError instanceof Error ? renderError.message : "Mermaid render failed");
        }
      }
    }

    renderChart();
    return () => {
      cancelled = true;
    };
  }, [chart, diagramId]);

  if (error) {
    return (
      <div className="markdown-mermaid-fallback">
        <p className="markdown-mermaid-error">Mermaid render failed: {error}</p>
        <pre>{chart}</pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="markdown-mermaid-loading">
        Rendering Mermaid diagram...
      </div>
    );
  }

  return (
    <div
      className="markdown-mermaid"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export function MarkdownContent({
  content,
  className = "",
}: {
  content: string | null | undefined;
  className?: string;
}) {
  const markdown = content?.trim() || "";

  if (!markdown) {
    return <div className={`markdown-content ${className}`.trim()}>(empty)</div>;
  }

  return (
    <div className={`markdown-content ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, markdownSchema]]}
        skipHtml
        components={{
          pre: ({ children }) => <>{children}</>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
          code({ className: codeClassName, children, ...props }) {
            const language = codeClassName?.replace("language-", "") || "";
            const value = String(children).replace(/\n$/, "");
            if (!language) {
              return (
                <code className="markdown-inline-code" {...props}>
                  {children}
                </code>
              );
            }
            if (language === "mermaid") {
              return <MermaidBlock chart={value} />;
            }
            return (
              <SyntaxHighlighter
                language={language}
                style={oneDark}
                PreTag="div"
                customStyle={{
                  margin: 0,
                  borderRadius: "0.75rem",
                  padding: "1rem",
                  background: "#0f172a",
                  fontSize: "0.85rem",
                }}
                wrapLongLines
              >
                {value}
              </SyntaxHighlighter>
            );
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
