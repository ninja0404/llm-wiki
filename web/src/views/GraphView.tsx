import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router';
import Sigma from 'sigma';
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { Network } from 'lucide-react';
import { useWorkspaceStore } from '@/store/workspace';

interface GraphNode {
  id: string;
  title: string;
  slug: string;
  pageType: string;
  linkCount: number;
}

interface GraphLink {
  source: string;
  target: string;
}

const typeColors: Record<string, string> = {
  entity: '#3b82f6',
  concept: '#8b5cf6',
  source_summary: '#10b981',
  comparison: '#f59e0b',
  overview: '#ef4444',
};

export function GraphView() {
  const { currentWorkspace } = useWorkspaceStore();
  const navigate = useNavigate();
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [links, setLinks] = useState<GraphLink[]>([]);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);

  useEffect(() => {
    if (!currentWorkspace) return;
    fetch(`/api/workspaces/${currentWorkspace.id}/wiki/graph`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        setNodes(d.data.nodes);
        setLinks(d.data.links);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [currentWorkspace?.id]);

  useEffect(() => {
    if (!containerRef.current || nodes.length === 0) return;

    if (sigmaRef.current) {
      sigmaRef.current.kill();
      sigmaRef.current = null;
    }

    const graph = new Graph();

    for (const node of nodes) {
      graph.addNode(node.id, {
        label: node.title,
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: Math.max(4, Math.sqrt(node.linkCount + 1) * 3),
        color: typeColors[node.pageType] || '#6b7280',
        slug: node.slug,
        pageType: node.pageType,
      });
    }

    for (const link of links) {
      if (graph.hasNode(link.source) && graph.hasNode(link.target)) {
        try {
          graph.addEdge(link.source, link.target, { color: '#d4d4d8', size: 1 });
        } catch {
          // skip duplicate edges
        }
      }
    }

    forceAtlas2.assign(graph, {
      iterations: nodes.length > 500 ? 50 : 100,
      settings: {
        gravity: 1,
        scalingRatio: nodes.length > 200 ? 5 : 2,
        barnesHutOptimize: nodes.length > 100,
      },
    });

    const renderer = new Sigma(graph, containerRef.current, {
      renderLabels: nodes.length < 300,
      labelSize: 12,
      labelColor: { color: '#3f3f46' },
      defaultEdgeColor: '#d4d4d8',
      defaultEdgeType: 'line',
    });

    renderer.on('clickNode', ({ node }) => {
      const attrs = graph.getNodeAttributes(node);
      if (attrs.slug) navigate(`/wiki/${attrs.slug}`);
    });

    sigmaRef.current = renderer;

    return () => {
      renderer.kill();
      sigmaRef.current = null;
    };
  }, [nodes, links, navigate]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Knowledge Graph</h1>
        {nodes.length > 0 && (
          <div className="flex items-center gap-4 text-xs text-zinc-500">
            <span>{nodes.length} nodes · {links.length} links · WebGL</span>
            <div className="flex gap-2">
              {Object.entries(typeColors).map(([type, color]) => (
                <span key={type} className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                  {type}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
      <div
        ref={containerRef}
        className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
        style={{ height: 'calc(100vh - 180px)' }}
      >
        {nodes.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-zinc-400">
              <Network className="h-12 w-12" />
              <p className="text-sm">Graph visualization will appear when wiki pages are created</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
