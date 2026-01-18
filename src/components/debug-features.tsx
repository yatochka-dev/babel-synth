import type { FeatureState } from "~/hooks/vision/features";

type Props = {
  features: FeatureState;
};

export function DebugFeatures({ features }: Props) {
  return (
    <div className="fixed top-4 right-4 z-50 rounded bg-black/80 p-3 font-mono text-xs text-white">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-gray-400">
        Features
      </div>
      {Object.entries(features).map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4">
          <span className="text-gray-400">{k}</span>
          <span>{v.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}
