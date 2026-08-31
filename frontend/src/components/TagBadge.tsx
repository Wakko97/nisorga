import { Tag } from "../lib/types";

/** Renders a tag as a small colored pill; color comes from the tag's own hex value. */
export default function TagBadge({ tag, onRemove }: { tag: Tag; onRemove?: () => void }) {
  return (
    <span
      className="badge"
      style={{ backgroundColor: `${tag.color}1a`, color: tag.color }}
    >
      {tag.name}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Tag ${tag.name} entfernen`}
          className="hover:opacity-70 leading-none"
        >
          ×
        </button>
      )}
    </span>
  );
}
