import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { DEFAULT_DELOAD_AFTER, DEFAULT_INCREMENT, defaultRule, type ProgressionKind, type ProgressionRule, type WeightUnit } from "lift-core";
import { Chip } from "../library/Chip";
import { NumField } from "../library/NumField";
import { useColors } from "../theme";
import { MAX_RULE_INCREMENT, MAX_RULE_REPS, MAX_RULE_SETS, ruleInt, ruleProblem, withRepRange } from "../../lib/programs";

interface Props {
  rule: ProgressionRule | null;
  unit: WeightUnit;
  onChange: (rule: ProgressionRule | null) => void;
}

const KINDS: { kind: ProgressionKind | null; label: string }[] = [
  { kind: null, label: "none" },
  { kind: "linear", label: "linear" },
  { kind: "double", label: "double" },
  { kind: "percent", label: "% e1rm" },
];

const HELP: Record<ProgressionKind, string> = {
  linear: "add weight after every set hits the reps",
  double: "add reps up to the top, then add weight and drop back",
  percent: "sets at a percent of your estimated max",
};

/** rule picker for one template exercise: kind chips, then the kind's numbers */
export function RuleEditor({ rule, unit, onChange }: Props) {
  const c = useColors();
  const patch = (p: Partial<ProgressionRule>) => rule && onChange({ ...rule, ...p } as ProgressionRule);
  // the step is stored with its unit, so a later lb/kg switch doesn't change it
  const incUnit = rule?.unit ?? unit;
  const problem = rule ? ruleProblem(rule) : null;

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {KINDS.map((k) => (
          <Chip
            key={k.label}
            label={k.label}
            selected={(rule?.kind ?? null) === k.kind}
            onPress={() => onChange(k.kind ? (rule?.kind === k.kind ? rule : { ...defaultRule(k.kind), unit }) : null)}
          />
        ))}
      </View>
      {rule ? (
        <>
          <Text style={{ color: c.muted, fontSize: 13 }}>{HELP[rule.kind]}</Text>
          <View style={styles.row}>
            <Field label="sets">
              <NumField
                integer
                value={rule.sets}
                max={MAX_RULE_SETS}
                onChange={(v) => patch({ sets: ruleInt(v, rule.sets, MAX_RULE_SETS) })}
              />
            </Field>
            {rule.kind === "double" ? (
              <>
                <Field label="reps from">
                  <NumField
                    integer
                    value={rule.repsLo}
                    max={MAX_RULE_REPS}
                    onChange={(v) => onChange(withRepRange(rule, v, rule.repsHi))}
                  />
                </Field>
                <Field label="to">
                  <NumField
                    integer
                    value={rule.repsHi}
                    max={MAX_RULE_REPS}
                    onChange={(v) => onChange(withRepRange(rule, rule.repsLo, v))}
                  />
                </Field>
              </>
            ) : (
              <Field label="reps">
                <NumField
                  integer
                  value={rule.reps}
                  max={MAX_RULE_REPS}
                  onChange={(v) => patch({ reps: ruleInt(v, rule.reps, MAX_RULE_REPS) })}
                />
              </Field>
            )}
            {rule.kind === "percent" ? (
              <Field label="% of e1rm">
                <NumField
                  value={rule.percent}
                  max={100}
                  onChange={(v) => patch({ percent: v != null && v > 0 ? v : rule.percent })}
                />
              </Field>
            ) : null}
          </View>
          <View style={styles.row}>
            <Field label={rule.kind === "percent" ? `round to (${incUnit})` : `step (${incUnit})`}>
              <NumField
                value={rule.increment ?? null}
                placeholder={String(DEFAULT_INCREMENT[incUnit])}
                max={MAX_RULE_INCREMENT}
                onChange={(v) => patch(v != null && v > 0 ? { increment: v, unit: incUnit } : { increment: undefined })}
              />
            </Field>
            {rule.kind !== "percent" ? (
              <Field label="deload after misses">
                <NumField
                  integer
                  value={rule.deloadAfter ?? null}
                  placeholder={String(DEFAULT_DELOAD_AFTER)}
                  max={50}
                  onChange={(v) => patch({ deloadAfter: v == null ? undefined : Math.max(0, Math.round(v)) })}
                />
              </Field>
            ) : null}
          </View>
          {problem ? <Text style={{ color: c.danger, fontSize: 13 }}>{problem}</Text> : null}
        </>
      ) : null}
    </View>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  const c = useColors();
  return (
    <View style={styles.field}>
      <Text style={{ color: c.muted, fontSize: 12 }}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "flex-end" },
  field: { gap: 4, minWidth: 72 },
});
