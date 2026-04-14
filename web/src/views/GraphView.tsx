import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router';
import ForceGraph2D from 'react-force-graph-2d';
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
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

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
    function updateSize() {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight,
        });
      }
    }
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const handleNodeClick = useCallback(
    (node: { slug?: string }) => {
      if (node.slug) navigate(`/wiki/${node.slug}`);
    },
    [navigate],
  );

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
            <span>{nodes.length} nodes · {links.length} links</span>
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
        {nodes.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-zinc-400">
              <Network className="h-12 w-12" />
              <p className="text-sm">Graph visualization will appear when wiki pages are created</p>
            </div>
          </div>
        ) : (
          <ForceGraph2D
            width={dimensions.width}
            height={dimensions.height - 2}
            graphData={{ nodes, links }}
            nodeLabel="title"
            nodeColor={(node: GraphNode) => typeColors[node.pageType] || '#6b7280'}
            nodeRelSize={5}
            nodeVal={(node: GraphNode) => Math.max(2, Math.sqrt(node.linkCount + 1) * 2)}
            linkColor={() => '#d4d4d8'}
            linkWidth={1}
            linkDirectionalParticles={0}
            onNodeClick={handleNodeClick as (node: object) => void}
            cooldownTicks={nodes.length > 500 ? 50 : 100}
            d3AlphaDecay={nodes.length > 500 ? 0.05 : 0.0228}
            d3VelocityDecay={nodes.length > 500 ? 0.5 : 0.4}
            warmupTicks={nodes.length > 500 ? 100 : 0}
            nodeCanvasObjectMode={() => 'after'}
            nodeCanvasObject={(node: { x?: number; y?: number; title?: string }, ctx: CanvasRenderingContext2D) => {
              if (node.x == null || node.y == null) return;
              const fontSize = nodes.length > 200 ? 2.5 : 3.5;
              ctx.font = `${fontSize}px sans-serif`;
              ctx.textAlign = 'center';
              ctx.fillStyle = '#3f3f46';
              ctx.fillText(node.title || '', node.x, node.y + 8);
            }}
          />
        )}
      </div>
    </div>
  );
}
