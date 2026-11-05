export type PanelLayout = "files-session" | "files-document" | "all";
const layouts: { value: PanelLayout; label: string; columns: number[] }[] = [
  { value: "files-session", label: "Files and conversation", columns: [0, 1] },
  { value: "files-document", label: "Files and document", columns: [0, 2] },
  { value: "all", label: "Files, conversation and document", columns: [0, 1, 2] },
];
export function PanelLayoutControl({ value, onChange }: { value: PanelLayout | null; onChange: (value: PanelLayout) => void }) {
  return <div className="panel-layout-control segmented-control" role="group" aria-label="Panel layout">
    {layouts.map(layout => <button key={layout.value} type="button" title={layout.label}
      aria-label={layout.label} aria-pressed={value === layout.value} onClick={() => onChange(layout.value)}>
      <svg width="20" height="16" viewBox="0 0 24 18" fill="none" stroke="currentColor" aria-hidden="true">
        <rect x="1" y="1" width="22" height="16" rx="2" />
        {layout.columns.map((column, i) => {
          const width = 20 / layout.columns.length;
          return <rect key={column} x={2 + i * width} y="2" width={width - 1} height="14" stroke="none"
            fill="currentColor" opacity={column === 1 ? .15 : .65} />;
        })}
      </svg>
    </button>)}
  </div>;
}
