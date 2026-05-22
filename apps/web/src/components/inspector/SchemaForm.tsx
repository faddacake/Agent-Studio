"use client";

import { useState, useCallback, useMemo } from "react";
import type { NodeParameterSchema, UISchema, NodeParameterField } from "@iterastudio/shared";
import { SchemaField } from "./SchemaField";

interface SchemaFormProps {
  /** Parameter schema from NodeDefinition */
  parameterSchema: NodeParameterSchema;
  /** Optional UI hints from NodeDefinition */
  uiSchema?: UISchema;
  /** Current parameter values */
  values: Record<string, unknown>;
  /** Called when any field changes */
  onChange: (key: string, value: unknown) => void;
  /** Validation errors keyed by field key */
  errors?: Record<string, string>;
}

/**
 * Renders a complete parameter form from a NodeDefinition's schema.
 * Supports UISchema groups (collapsible sections) and widget overrides.
 * Zero knowledge of specific node types — purely schema-driven.
 */
export function SchemaForm({
  parameterSchema,
  uiSchema,
  values,
  onChange,
  errors,
}: SchemaFormProps) {
  if (parameterSchema.length === 0) {
    return (
      <p className="text-xs text-neutral-500 italic py-2">
        No configurable parameters.
      </p>
    );
  }

  // If UISchema defines groups, render grouped + any ungrouped remainder
  if (uiSchema?.groups && uiSchema.groups.length > 0) {
    return (
      <GroupedForm
        parameterSchema={parameterSchema}
        uiSchema={uiSchema}
        values={values}
        onChange={onChange}
        errors={errors}
      />
    );
  }

  // No groups — render fields in order, filtering hidden
  const hiddenSet = new Set(uiSchema?.hidden ?? []);
  const visibleFields = parameterSchema.filter((f) => !hiddenSet.has(f.key));

  return (
    <div className="flex flex-col gap-3">
      {visibleFields.map((field) => (
        <SchemaField
          key={field.key}
          field={field}
          value={values[field.key]}
          onChange={onChange}
          error={errors?.[field.key]}
          widget={uiSchema?.widgets?.[field.key]}
        />
      ))}
    </div>
  );
}

// ── Grouped form with collapsible sections ──

function GroupedForm({
  parameterSchema,
  uiSchema,
  values,
  onChange,
  errors,
}: SchemaFormProps & { uiSchema: UISchema }) {
  const groups = uiSchema.groups!;
  const hiddenSet = new Set(uiSchema.hidden ?? []);

  // Track which groups are collapsed
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const group of groups) {
      initial[group.label] = group.collapsed ?? false;
    }
    return initial;
  });

  const toggleGroup = useCallback((label: string) => {
    setCollapsed((prev) => ({ ...prev, [label]: !prev[label] }));
  }, []);

  // Build a lookup from field key to field definition
  const fieldMap = useMemo(() => {
    const map = new Map<string, NodeParameterField>();
    for (const f of parameterSchema) map.set(f.key, f);
    return map;
  }, [parameterSchema]);

  // Find fields not in any group (remainder)
  const groupedKeys = new Set(groups.flatMap((g) => g.fields));
  const ungroupedFields = parameterSchema.filter(
    (f) => !groupedKeys.has(f.key) && !hiddenSet.has(f.key),
  );

  return (
    <div className="flex flex-col gap-1">
      {groups.map((group) => {
        const fields = group.fields
          .map((key) => fieldMap.get(key))
          .filter((f): f is NodeParameterField => f !== undefined && !hiddenSet.has(f.key));

        if (fields.length === 0) return null;

        const isCollapsed = collapsed[group.label];

        return (
          <div key={group.label} className="border-b border-neutral-800 last:border-b-0">
            <button
              type="button"
              onClick={() => toggleGroup(group.label)}
              className="flex w-full items-center justify-between py-2 text-xs font-medium text-neutral-400 hover:text-neutral-200"
            >
              <span>{group.label}</span>
              <svg
                className={`h-3.5 w-3.5 transition-transform ${isCollapsed ? "" : "rotate-180"}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {!isCollapsed && (
              <div className="flex flex-col gap-3 pb-3">
                {fields.map((field) => (
                  <SchemaField
                    key={field.key}
                    field={field}
                    value={values[field.key]}
                    onChange={onChange}
                    error={errors?.[field.key]}
                    widget={uiSchema?.widgets?.[field.key]}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Ungrouped fields rendered after all groups */}
      {ungroupedFields.length > 0 && (
        <div className="flex flex-col gap-3 pt-2">
          {ungroupedFields.map((field) => (
            <SchemaField
              key={field.key}
              field={field}
              value={values[field.key]}
              onChange={onChange}
              error={errors?.[field.key]}
              widget={uiSchema?.widgets?.[field.key]}
            />
          ))}
        </div>
      )}
    </div>
  );
}
