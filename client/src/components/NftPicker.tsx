import { useState } from "react";
import { NftCatalogItem } from "../api";

function GiftIcon({ imageUrl, icon, name }: { imageUrl: string | null; icon: string; name: string }) {
  const [failed, setFailed] = useState(false);

  if (!imageUrl || failed) {
    return <span className="text-xl leading-none">{icon}</span>;
  }

  return (
    <img
      src={imageUrl}
      alt={name}
      width={28}
      height={28}
      className="w-7 h-7 rounded-full object-cover bg-base-700 shrink-0"
      onError={() => setFailed(true)}
    />
  );
}

export default function NftPicker({
  catalog,
  selected,
  onToggle,
}: {
  catalog: NftCatalogItem[];
  selected: Set<string>;
  onToggle: (identifier: string) => void;
}) {
  if (catalog.length === 0) {
    return (
      <div className="text-slate-500 text-sm py-6 text-center">
        Gift katalogini yuklab bo'lmadi yoki hozircha collectible turlar topilmadi.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {catalog.map((item) => {
        const isSelected = selected.has(item.identifier);
        return (
          <button
            key={item.identifier}
            type="button"
            onClick={() => onToggle(item.identifier)}
            className={`flex items-center gap-2.5 rounded-lg border px-3.5 py-3 text-left transition-all duration-150 ${
              isSelected
                ? "border-accent bg-accent/10"
                : "border-base-600 bg-base-800 hover:border-base-500"
            }`}
          >
            <span className="text-lg">{isSelected ? "☑" : "☐"}</span>
            <GiftIcon imageUrl={item.imageUrl} icon={item.icon} name={item.name} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium truncate">{item.name}</span>
              <span className="block text-xs text-slate-500">⭐ {item.stars}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
