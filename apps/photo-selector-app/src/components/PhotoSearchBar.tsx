import { useRef, useState } from "react";

interface PhotoSearchBarProps {
  value: string;
  onChange: (query: string) => void;
  resultCount: number;
  totalCount: number;
}

export function PhotoSearchBar({ value, onChange, resultCount, totalCount }: PhotoSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);

  return (
    <div className={`photo-search ${focused ? "photo-search--focused" : ""}`}>
      <span className="photo-search__icon" aria-hidden>🔍</span>
      <input
        ref={inputRef}
        type="text"
        className="photo-search__input"
        placeholder="Cerca per nome file…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        aria-label="Cerca foto per nome file"
      />
      {value ? (
        <>
          <span className="photo-search__count">
            {resultCount}/{totalCount}
          </span>
          <button
            type="button"
            className="photo-search__clear"
            onClick={() => { onChange(""); inputRef.current?.focus(); }}
            aria-label="Cancella ricerca"
            title="Cancella ricerca"
          >
            ✕
          </button>
        </>
      ) : null}
    </div>
  );
}
