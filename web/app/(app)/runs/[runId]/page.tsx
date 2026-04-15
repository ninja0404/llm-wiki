import { PageFrame } from "@/components/page-frame";
import { apiFetch } from "@/lib/api";

export default async function RunDetailPage({
  params
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const [run, steps] = await Promise.all([
    apiFetch<{ data: { id: string; run_type: string; status: string; input: Record<string, unknown>; output: Record<string, unknown>; error_message?: string | null } | null }>(
      `/v1/runs/${runId}`
    ).catch(() => ({ data: null })),
    apiFetch<{ data: { id: string; step_key: string; status: string; error_message?: string | null; payload: Record<string, unknown> }[] }>(
      `/v1/runs/${runId}/steps`
    ).catch(() => ({ data: [] }))
  ]);

  return (
    <PageFrame title={`Run ${runId}`} description="Detailed run payload and step trace.">
      <div className="card-grid">
        <div className="panel">
          <h2>Run</h2>
          <div className="code-block">{JSON.stringify(run.data, null, 2)}</div>
        </div>
        <div className="panel">
          <h2>Steps</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Step</th>
                <th>Status</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {steps.data.map((step) => (
                <tr key={step.id}>
                  <td>{step.step_key}</td>
                  <td>{step.status}</td>
                  <td>{step.error_message ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </PageFrame>
  );
}
