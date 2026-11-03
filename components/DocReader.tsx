'use client';

import { useEffect, useState, isValidElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import mermaid from 'mermaid';

interface Props {
  cloudinaryUrl: string;
}

mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'loose',
  themeVariables: {
    primaryColor: '#6366f1',
    primaryBorderColor: '#4f46e5',
    primaryTextColor: '#f1f5f9',
    background: '#16162a',
    mainBkg: '#1e1e38',
    nodeBorder: '#4f46e5',
    clusterBkg: '#1e1e38',
    titleColor: '#f1f5f9',
    edgeLabelBackground: '#16162a',
    lineColor: '#818cf8',
    fontFamily: 'Inter, system-ui, sans-serif',
  },
});

let mermaidCounter = 0;

function MermaidDiagram({ chart }: { chart: string }) {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState('');

  useEffect(() => {
    const id = `mermaid-${++mermaidCounter}`;
    mermaid
      .render(id, chart)
      .then(({ svg: renderedSvg }) => setSvg(renderedSvg))
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : 'Diagram error';
        setError(msg);
      });
  }, [chart]);

  if (error) {
    return (
      <div className="bg-red-900/20 border border-red-500/30 rounded-xl p-4 text-xs text-red-400">
        <p className="font-medium mb-1">Diagram render error</p>
        <pre className="whitespace-pre-wrap opacity-70">{error}</pre>
        <pre className="mt-2 text-slate-500 whitespace-pre-wrap">{chart}</pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="flex items-center justify-center h-40 bg-[#1e1e38] rounded-xl border border-[#2a2a48]">
        <span className="text-slate-500 text-sm animate-pulse">Rendering diagram…</span>
      </div>
    );
  }

  return (
    <div
      className="mermaid-container"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export default function DocReader({ cloudinaryUrl }: Props) {
  const [markdown, setMarkdown] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(cloudinaryUrl, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => {
        // Aggressive table fixer: ensures double newlines and removes trailing spaces
        const fixed = text
          .replace(/([^\n])\r?\n\|/g, '$1\n\n|')
          .replace(/\|\r?\n([^\n])/g, '|\n\n$1')
          .replace(/\|\s+\r?\n/g, '|\n');
        setMarkdown(fixed);
        setLoading(false);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load documentation');
        setLoading(false);
      });
  }, [cloudinaryUrl]);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="h-4 bg-[#1e1e38] rounded"
            style={{ width: `${70 + (i % 3) * 10}%` }}
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass rounded-xl p-8 text-center">
        <p className="text-red-400 text-sm">⚠ {error}</p>
      </div>
    );
  }

  return (
    <article className="prose-dark">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Custom table wrapper for responsive horizontal scrolling
          table({ children, ...props }) {
            return (
              <div className="w-full overflow-x-auto mb-6 rounded-lg border border-[#2a2a48]">
                <table className="w-full text-sm text-left min-w-[600px] md:min-w-full" {...props}>
                  {children}
                </table>
              </div>
            );
          },
          // Render ```mermaid blocks with the MermaidDiagram component
          code({ className, children, ...props }) {
            const lang = className?.replace('language-', '') ?? '';
            const content = String(children).trim();

            if (lang === 'mermaid') {
              return <MermaidDiagram chart={content} />;
            }

            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
          // Override pre to avoid double-wrapping mermaid blocks
          pre({ children, ...props }) {
            const className = isValidElement(children)
              ? (children.props as { className?: string }).className
              : undefined;
            const isMermaid = typeof className === 'string' && className.includes('language-mermaid');
            if (isMermaid) return <>{children}</>;
            return <pre {...props}>{children}</pre>;
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </article>
  );
}
