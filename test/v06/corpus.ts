import { createHash } from "node:crypto";

export type ExpectedMatchKind =
  | "exact"
  | "normalized_equal"
  | "strong_related"
  | "related_reordered"
  | "related"
  | "unrelated";

export interface AcceptancePair {
  id: string;
  family: string;
  language: "en" | "es" | "bilingual" | "code" | "config";
  source: string;
  candidate: string;
  expected: ExpectedMatchKind;
  criticalDifference: boolean;
}

interface CorpusTemplate {
  family: string;
  language: AcceptancePair["language"];
  criticalIndex: 0 | 1 | 2;
  first: (id: number) => string;
  second: (id: number) => string;
  third: (id: number) => string;
  critical: (id: number) => string;
  unrelated: (id: number) => string;
}

const TEMPLATES: CorpusTemplate[] = [
  {
    family: "release-policy",
    language: "en",
    criticalIndex: 0,
    first: (id) => `Release ${id} requires two approvals before deployment.`,
    second: (id) => `The migration window for release ${id} begins at 09:30 UTC.`,
    third: (id) => `Keep rollback artifacts for ${id + 7} days after deployment.`,
    critical: (id) => `Release ${id} does not require two approvals before deployment.`,
    unrelated: (id) => `The cafeteria menu rotates every ${id + 2} weekdays.`
  },
  {
    family: "politica-despliegue",
    language: "es",
    criticalIndex: 0,
    first: (id) => `La versión ${id} requiere dos aprobaciones antes del despliegue.`,
    second: (id) => `La ventana de migración ${id} comienza a las 09:30.`,
    third: (id) => `Conserva los respaldos durante ${id + 7} días.`,
    critical: (id) => `La versión ${id} no requiere dos aprobaciones antes del despliegue.`,
    unrelated: (id) => `El jardín recibe agua cada ${id + 2} mañanas.`
  },
  {
    family: "billing-rule",
    language: "en",
    criticalIndex: 0,
    first: (id) => `Invoice ${id} is valid when amount >= ${id * 10}.`,
    second: (id) => `Reject invoice ${id} when status is null or false.`,
    third: (id) => `Notify finance before retry ${id + 1}.`,
    critical: (id) => `Invoice ${id} is valid when amount < ${id * 10}.`,
    unrelated: (id) => `A telescope recorded ${id + 4} bright stars.`
  },
  {
    family: "regla-facturacion",
    language: "es",
    criticalIndex: 0,
    first: (id) => `La factura ${id} es válida cuando el monto >= ${id * 10}.`,
    second: (id) => `Rechaza la factura ${id} si el estado es nulo o falso.`,
    third: (id) => `Avisa a finanzas antes del reintento ${id + 1}.`,
    critical: (id) => `La factura ${id} es válida cuando el monto < ${id * 10}.`,
    unrelated: (id) => `Un telescopio registró ${id + 4} estrellas brillantes.`
  },
  {
    family: "bilingual-incident",
    language: "bilingual",
    criticalIndex: 0,
    first: (id) => `Incident ${id}: preserve evidence / conserva la evidencia.`,
    second: (id) => `Do not delete logs / no borres los registros for case ${id}.`,
    third: (id) => `Escalate at ${10 + (id % 8)}:00 / escala al responsable.`,
    critical: (id) => `Incident ${id}: delete evidence / borra la evidencia.`,
    unrelated: (id) => `Recipe ${id}: mezcla harina y agua lentamente.`
  },
  {
    family: "typescript-guard",
    language: "code",
    criticalIndex: 1,
    first: (id) => `export function allow${id}(count: number): boolean {`,
    second: (id) => `  return count >= ${id} && count !== 0;`,
    third: () => `}`,
    critical: (id) => `  return count < ${id} || count === 0;`,
    unrelated: (id) => `export const color${id} = "blue";`
  },
  {
    family: "python-retry",
    language: "code",
    criticalIndex: 1,
    first: (id) => `def retry_${id}(attempts: int) -> bool:`,
    second: (id) => `    return attempts <= ${id + 2} and attempts != 0`,
    third: () => `# retry only transient failures`,
    critical: (id) => `    return attempts > ${id + 2} or attempts == 0`,
    unrelated: (id) => `def flower_${id}(): return "daisy"`
  },
  {
    family: "json-config",
    language: "config",
    criticalIndex: 1,
    first: (id) => `"service-${id}": { "enabled": true,`,
    second: (id) => `  "maxRetries": ${id + 1}, "timeoutMs": ${id * 1000},`,
    third: () => `  "destructive": false }`,
    critical: (id) => `  "maxRetries": ${id + 1}, "timeoutMs": ${id * 1000}, "destructive": true }`,
    unrelated: (id) => `"palette-${id}": { "primary": "violet" }`
  },
  {
    family: "yaml-config",
    language: "config",
    criticalIndex: 1,
    first: (id) => `service_${id}:`,
    second: (id) => `  enabled: true\n  timeout: ${id + 20}`,
    third: () => `  mode: safe`,
    critical: (id) => `  enabled: false\n  timeout: ${id + 20}`,
    unrelated: (id) => `garden_${id}:\n  flowers: tulips`
  },
  {
    family: "unicode-boundary",
    language: "es",
    criticalIndex: 2,
    first: (id) => `Señal ${id}: el pingüino recibió información útil.`,
    second: (id) => `El café cuesta €${id}, y la clave es 🔐-${id}.`,
    third: (id) => `Confirma la acción número ${id} antes de continuar.`,
    critical: (id) => `No confirmes la acción número ${id} antes de continuar.`,
    unrelated: (id) => `La canción ${id} utiliza guitarra y percusión.`
  }
];

function joinParts(parts: string[], eol = "\n"): string {
  return parts.join(eol);
}

function typoVariant(text: string): string {
  const words = text.split(" ");
  const index = words.findIndex((word) => /^\p{L}{8,}[.,:]?$/u.test(word));
  if (index >= 0) {
    const word = words[index]!;
    words[index] = `${word.slice(0, -2)}${word.at(-1)}${word.at(-2)}`;
  }
  return words.join(" ");
}

function contextSuffix(
  language: AcceptancePair["language"],
  segment: number,
  id: number
): string {
  const index = segment - 1;
  if (language === "es") {
    return [
      `El registro alfa ${id} conserva propietario, motivo y evidencia para auditoría posterior.`,
      `La sección beta ${id} documenta revisión, responsable y recuperación durante incidentes operativos.`,
      `El bloque gamma ${id} mantiene procedencia, historial y criterios claros para aprobación.`
    ][index]!;
  }
  if (language === "bilingual") {
    return [
      `Alpha record ${id} preserves ownership and evidence / conserva motivo y auditoría.`,
      `Beta section ${id} documents review and recovery / registra responsable e incidentes.`,
      `Gamma block ${id} maintains provenance and history / mantiene criterios y aprobación.`
    ][index]!;
  }
  if (language === "code") {
    return [
      `// Alpha ${id} preserves ownership rationale and evidence for later audit review.`,
      `// Beta ${id} documents responsible operators and recovery during production incidents.`,
      `// Gamma ${id} maintains provenance history and clear approval criteria.`
    ][index]!;
  }
  if (language === "config") {
    return [
      `# alpha ${id}: ownership rationale evidence and later audit review`,
      `# beta ${id}: responsible operators recovery and production incidents`,
      `# gamma ${id}: provenance history and clear approval criteria`
    ][index]!;
  }
  return [
    `Alpha record ${id} preserves ownership, rationale, and evidence for later audit review.`,
    `Beta section ${id} documents responsible operators and recovery during production incidents.`,
    `Gamma block ${id} maintains provenance, history, and clear approval criteria.`
  ][index]!;
}

function buildTemplatePairs(template: CorpusTemplate, id: number): AcceptancePair[] {
  const sourceParts: [string, string, string] = [
    `${template.first(id)} ${contextSuffix(template.language, 1, id)}`,
    `${template.second(id)} ${contextSuffix(template.language, 2, id)}`,
    `${template.third(id)} ${contextSuffix(template.language, 3, id)}`
  ];
  const criticalParts: [string, string, string] = [...sourceParts];
  criticalParts[template.criticalIndex] = (
    `${template.critical(id)} ${contextSuffix(template.language, template.criticalIndex + 1, id)}`
  );
  const source = joinParts(sourceParts);
  const prefix = `${template.family}-${String(id).padStart(2, "0")}`;

  return [
    {
      id: `${prefix}-exact`,
      family: template.family,
      language: template.language,
      source,
      candidate: source,
      expected: "exact",
      criticalDifference: false
    },
    {
      id: `${prefix}-normalized`,
      family: template.family,
      language: template.language,
      source,
      candidate: joinParts(sourceParts, "\r\n").normalize("NFD"),
      expected: "normalized_equal",
      criticalDifference: false
    },
    {
      id: `${prefix}-related`,
      family: template.family,
      language: template.language,
      source,
      candidate: typoVariant(source),
      expected: "strong_related",
      criticalDifference: false
    },
    {
      id: `${prefix}-reordered`,
      family: template.family,
      language: template.language,
      source,
      candidate: joinParts([sourceParts[2], sourceParts[0], sourceParts[1]]),
      expected: "related_reordered",
      criticalDifference: false
    },
    {
      id: `${prefix}-critical`,
      family: template.family,
      language: template.language,
      source,
      candidate: joinParts(criticalParts),
      expected: "related",
      criticalDifference: true
    },
    {
      id: `${prefix}-unrelated`,
      family: template.family,
      language: template.language,
      source,
      candidate: template.unrelated(id),
      expected: "unrelated",
      criticalDifference: false
    }
  ];
}

export function createAcceptanceCorpus(): AcceptancePair[] {
  const pairs: AcceptancePair[] = [];

  for (const template of TEMPLATES) {
    for (let id = 1; id <= 6; id += 1) {
      pairs.push(...buildTemplatePairs(template, id));
    }
  }

  return pairs;
}

export function acceptanceCorpusDigest(corpus = createAcceptanceCorpus()): string {
  return createHash("sha256").update(JSON.stringify(corpus), "utf8").digest("hex");
}
