"use client";

import type { NodeParameterField } from "@iterastudio/shared";

interface SchemaFieldProps {
  field: NodeParameterField;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  error?: string;
  /** Optional widget override from UISchema */
  widget?: "slider" | "color" | "textarea" | "toggle" | "dropdown" | "upload";
}

/**
 * Renders a single form field from a NodeParameterField definition.
 * Zero knowledge of specific models — purely schema-driven.
 */
export function SchemaField({ field, value, onChange, error, widget }: SchemaFieldProps) {
  const resolvedWidget = widget ?? inferWidget(field);

  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={`field-${field.key}`}
        className="text-xs font-medium text-neutral-300"
      >
        {field.label}
        {field.required && <span className="text-red-400 ml-0.5">*</span>}
      </label>

      {renderWidget(resolvedWidget, field, value, onChange)}

      {field.description && !error && (
        <p className="text-[11px] text-neutral-500">{field.description}</p>
      )}
      {error && (
        <p className="text-[11px] text-red-400">{error}</p>
      )}
    </div>
  );
}

// ── Widget inference ──

type WidgetType = "text" | "textarea" | "number" | "slider" | "toggle" | "dropdown" | "upload" | "json" | "color";

function inferWidget(field: NodeParameterField): WidgetType {
  switch (field.type) {
    case "string":
      return field.multiline ? "textarea" : "text";
    case "number":
      return field.min !== undefined && field.max !== undefined ? "slider" : "number";
    case "boolean":
      return "toggle";
    case "enum":
      return "dropdown";
    case "image":
      return "upload";
    case "json":
      return "json";
    default:
      return "text";
  }
}

// ── Widget renderers ──

function renderWidget(
  widgetType: WidgetType,
  field: NodeParameterField,
  value: unknown,
  onChange: (key: string, value: unknown) => void,
) {
  const id = `field-${field.key}`;

  switch (widgetType) {
    case "text":
      return (
        <input
          id={id}
          type="text"
          value={asString(value, field)}
          placeholder={field.placeholder}
          onChange={(e) => onChange(field.key, e.target.value)}
          className="w-full rounded border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-blue-500 focus:outline-none"
        />
      );

    case "textarea":
      return (
        <textarea
          id={id}
          value={asString(value, field)}
          placeholder={field.placeholder}
          rows={4}
          onChange={(e) => onChange(field.key, e.target.value)}
          className="w-full rounded border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-blue-500 focus:outline-none resize-y min-h-[60px]"
        />
      );

    case "number":
      return (
        <input
          id={id}
          type="number"
          value={asNumber(value, field)}
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          onChange={(e) => onChange(field.key, parseFloat(e.target.value) || 0)}
          className="w-full rounded border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-sm text-neutral-100 focus:border-blue-500 focus:outline-none"
        />
      );

    case "slider":
      return (
        <div className="flex items-center gap-2">
          <input
            id={id}
            type="range"
            value={asNumber(value, field)}
            min={field.min ?? 0}
            max={field.max ?? 100}
            step={field.step ?? 1}
            onChange={(e) => onChange(field.key, parseFloat(e.target.value))}
            className="flex-1 accent-blue-500"
          />
          <span className="text-xs text-neutral-400 tabular-nums w-12 text-right">
            {asNumber(value, field)}
          </span>
        </div>
      );

    case "toggle":
      return (
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={!!value}
          onClick={() => onChange(field.key, !value)}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
            value ? "bg-blue-500" : "bg-neutral-700"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              value ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </button>
      );

    case "dropdown":
      return (
        <select
          id={id}
          value={asString(value, field)}
          onChange={(e) => onChange(field.key, e.target.value)}
          className="w-full rounded border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-sm text-neutral-100 focus:border-blue-500 focus:outline-none"
        >
          {!value && <option value="">Select...</option>}
          {(field.options ?? []).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );

    case "upload":
      return (
        <div className="flex flex-col gap-1">
          {value != null && value !== "" && (
            <p className="text-xs text-neutral-400 truncate">{String(value)}</p>
          )}
          <label
            htmlFor={id}
            className="cursor-pointer inline-flex items-center justify-center rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700"
          >
            {value ? "Change file" : "Upload file"}
          </label>
          <input
            id={id}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onChange(field.key, file.name);
            }}
          />
        </div>
      );

    case "json":
      return (
        <textarea
          id={id}
          value={typeof value === "string" ? value : JSON.stringify(value ?? "", null, 2)}
          rows={4}
          onChange={(e) => {
            try {
              onChange(field.key, JSON.parse(e.target.value));
            } catch {
              // Keep raw string while user is editing
              onChange(field.key, e.target.value);
            }
          }}
          className="w-full rounded border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-sm text-neutral-100 font-mono focus:border-blue-500 focus:outline-none resize-y min-h-[60px]"
        />
      );

    case "color":
      return (
        <div className="flex items-center gap-2">
          <input
            id={id}
            type="color"
            value={asString(value, field) || "#000000"}
            onChange={(e) => onChange(field.key, e.target.value)}
            className="h-8 w-8 cursor-pointer rounded border border-neutral-700 bg-neutral-900 p-0.5"
          />
          <span className="text-xs text-neutral-400 font-mono">
            {asString(value, field) || "#000000"}
          </span>
        </div>
      );

    default:
      return (
        <input
          id={id}
          type="text"
          value={String(value ?? "")}
          onChange={(e) => onChange(field.key, e.target.value)}
          className="w-full rounded border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-sm text-neutral-100 focus:border-blue-500 focus:outline-none"
        />
      );
  }
}

// ── Value coercion helpers ──

function asString(value: unknown, field: NodeParameterField): string {
  if (value === undefined || value === null) return String(field.defaultValue ?? "");
  return String(value);
}

function asNumber(value: unknown, field: NodeParameterField): number {
  if (typeof value === "number") return value;
  const parsed = parseFloat(String(value));
  if (!isNaN(parsed)) return parsed;
  if (typeof field.defaultValue === "number") return field.defaultValue;
  return field.min ?? 0;
}
