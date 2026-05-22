"use client";

/**
 * ResultsGrid — renders a grid of generated image candidates.
 *
 * Each item's value is expected to be an ArtifactRef (local-file).
 * Images are served via GET /api/artifacts?path=<encoded-path>.
 * Rank, CLIP score, and dimensions are shown when available.
 */
import { isArtifactRef } from "@iterastudio/shared";
import type { ArtifactRef } from "@iterastudio/shared";
import type { CandidateItem } from "@iterastudio/shared";

export interface ResultsGridProps {
  items: CandidateItem[];
  /** Section heading. Pass null to suppress the heading entirely. */
  title?: string | null;
}

export function ResultsGrid({ items, title = "Selected Results" }: ResultsGridProps) {
  const imageItems = items.filter(
    (item) => item.type === "image" && isArtifactRef(item.value),
  );

  if (imageItems.length === 0) return null;

  return (
    <div style={{ marginBottom: 24 }}>
      {title != null && (
        <h2
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: "var(--color-text-primary)",
            marginBottom: 12,
            letterSpacing: "-0.01em",
          }}
        >
          {title}
          <span
            style={{
              marginLeft: 8,
              fontSize: 12,
              fontWeight: 500,
              color: "var(--color-text-muted)",
            }}
          >
            {imageItems.length} image{imageItems.length !== 1 ? "s" : ""}
          </span>
        </h2>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
          gap: 12,
        }}
      >
        {imageItems.map((item) => {
          const ref = item.value as ArtifactRef;
          const src = `/api/artifacts?path=${encodeURIComponent(ref.path)}`;
          const topScore = item.scores?.[0];

          return (
            <div
              key={item.id}
              style={{
                borderRadius: 10,
                overflow: "hidden",
                border: "1px solid var(--color-border)",
                backgroundColor: "var(--color-surface)",
              }}
            >
              {/* Image */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={item.prompt ?? "Generated image"}
                style={{
                  width: "100%",
                  aspectRatio: "1 / 1",
                  objectFit: "cover",
                  display: "block",
                  backgroundColor: "var(--color-surface-hover)",
                }}
              />

              {/* Meta bar */}
              <div
                style={{
                  padding: "6px 10px",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  flexWrap: "wrap",
                }}
              >
                {item.rank !== undefined && (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "var(--color-text-secondary)",
                      backgroundColor: "var(--color-surface-hover)",
                      borderRadius: 4,
                      padding: "1px 5px",
                    }}
                  >
                    #{item.rank}
                  </span>
                )}

                {topScore !== undefined && (
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--color-text-muted)",
                    }}
                  >
                    {topScore.metric}:{" "}
                    <span style={{ color: "var(--color-text-secondary)" }}>
                      {topScore.normalized !== undefined
                        ? topScore.normalized.toFixed(0)
                        : topScore.value.toFixed(2)}
                    </span>
                  </span>
                )}

                {ref.width !== undefined && ref.height !== undefined && (
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: 10,
                      color: "var(--color-text-muted)",
                    }}
                  >
                    {ref.width}×{ref.height}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
