/**
 * readGsdProgress — reads .planning/STATE.md from a project path and returns
 * structured GSD build progress data.
 *
 * Three-tier response shape:
 *   Tier 1: null          — no .planning/ directory (non-GSD project)
 *   Tier 2: GSD_UNREADABLE — .planning/ exists but STATE.md missing or malformed
 *   Tier 3: GsdProgress   — full object when valid STATE.md parsed successfully
 *
 * Assumption: STATE.md is always small (<5KB), sync read is fine.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { GsdProgress } from './types';

// Tier 2 constant — returned when .planning/ exists but STATE.md is unreadable
const GSD_UNREADABLE: GsdProgress = {
  isGsd: true,
  phaseName: null,
  phaseNumber: null,
  phaseStatus: null,
  nextAction: null,
  totalPhases: null,
  completedPhases: null,
  percent: null,
};

export function readGsdProgress(projectPath: string): GsdProgress | null {
  // Guard: empty projectPath would resolve to process cwd — never valid
  if (!projectPath) return null;

  const planningDir = path.join(projectPath, '.planning');
  // Tier 1: no .planning/ directory — non-GSD project
  if (!fs.existsSync(planningDir)) return null;

  const stateMdPath = path.join(planningDir, 'STATE.md');
  // Tier 2: .planning/ exists but STATE.md absent
  if (!fs.existsSync(stateMdPath)) return GSD_UNREADABLE;

  let content: string;
  try {
    // STATE.md is always small (<5KB), sync read is fine
    content = fs.readFileSync(stateMdPath, 'utf-8');
  } catch {
    // Tier 2: unreadable STATE.md (permissions, etc.)
    return GSD_UNREADABLE;
  }

  try {
    // 1. Parse YAML frontmatter
    const fm = parseFrontmatter(content);
    const progress = fm.progress as Record<string, number> | undefined;
    const totalPhases = progress?.total_phases ?? null;
    const completedPhases = progress?.completed_phases ?? null;
    const percent = progress?.percent ?? null;

    // 2. Extract phase number and name from "Phase: N of M (Name)" prose line
    const phaseMatch = content.match(/^Phase:\s*(\d+)\s+of\s+\d+\s*\(([^)]+)\)/m);
    if (!phaseMatch) {
      // Frontmatter parsed but no phase line — return Tier 2 with numeric fields
      return { ...GSD_UNREADABLE, totalPhases, completedPhases, percent };
    }

    const phaseNumber = parseInt(phaseMatch[1], 10);
    const phaseName = phaseMatch[2].trim();

    // 3. Extract phase status verbatim from "Status: ..." prose line
    //    Note: frontmatter `status` is milestone-level, not phase-level — use prose line
    const statusMatch = content.match(/^Status:\s*(.+)$/m);
    const phaseStatus = statusMatch ? statusMatch[1].trim() : null;

    // 4. Derive next action from phase number
    const nextAction = `/gsd:execute-phase ${phaseNumber}`;

    return {
      isGsd: true,
      phaseName,
      phaseNumber,
      phaseStatus,
      nextAction,
      totalPhases,
      completedPhases,
      percent,
    };
  } catch {
    // Tier 2: any parse error — never propagate
    return GSD_UNREADABLE;
  }
}

/**
 * Regex-based YAML frontmatter parser.
 * Handles flat key-value pairs and one-level-deep nested blocks (e.g., progress:).
 * Does NOT require any external YAML library — STATE.md uses only this subset.
 */
function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]+?)\n---/);
  if (!match) return {};

  const result: Record<string, unknown> = {};
  let currentNested: Record<string, unknown> | null = null;

  for (const line of match[1].split('\n')) {
    if (line.trim() === '') continue;

    // Nested key — 2-space indent (e.g., "  total_phases: 3")
    const nestedMatch = line.match(/^\s{2}([a-z_]+):\s*(.*)/);
    if (nestedMatch && currentNested) {
      const val = nestedMatch[2].trim().replace(/^["']|["']$/g, '');
      currentNested[nestedMatch[1]] = val === '' || isNaN(Number(val)) ? val : Number(val);
      continue;
    }

    // Top-level key
    const keyMatch = line.match(/^([a-z_]+):\s*(.*)/);
    if (keyMatch) {
      const val = keyMatch[2].trim().replace(/^["']|["']$/g, '');
      if (val === '') {
        // Start of nested block (e.g., "progress:")
        currentNested = {};
        result[keyMatch[1]] = currentNested;
      } else {
        currentNested = null;
        result[keyMatch[1]] = isNaN(Number(val)) ? val : Number(val);
      }
    }
  }

  return result;
}
