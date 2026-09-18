export default function StatCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number | string;
  tone?: "default" | "success" | "danger" | "warning";
}) {
  const toneClass = {
    default: "text-slate-100",
    success: "text-success",
    danger: "text-danger",
    warning: "text-warning",
  }[tone];

  return (
    <div className="card !p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${toneClass}`}>{value}</div>
    </div>
  );
}
