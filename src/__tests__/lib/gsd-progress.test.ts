/**
 * Unit tests for readGsdProgress() — Phase 3, Plan 01 (TDD RED phase)
 *
 * Tests the three-tier response shape:
 *   Tier 1: null   — no .planning/ directory (non-GSD project)
 *   Tier 2: GSD_UNREADABLE — .planning/ exists but STATE.md missing or malformed
 *   Tier 3: full GsdProgress — valid STATE.md parsed successfully
 */

import * as fs from 'fs';
import { readGsdProgress } from '@/lib/claude-data/gsd-progress';

jest.mock('fs');

const mockedFs = fs as jest.Mocked<typeof fs>;

// ---------------------------------------------------------------------------
// Fixture: minimal valid STATE.md content (matches real .planning/STATE.md format)
// ---------------------------------------------------------------------------

const VALID_STATE_MD = `---
gsd_state_version: 1.0
milestone: v1.0
status: completed
stopped_at: Phase 3 context gathered
progress:
  total_phases: 3
  completed_phases: 2
  percent: 50
---

# Project State

## Current Position

Phase: 2 of 3 (Active Sessions Page)
Plan: 3 of 3 in current phase
Status: Phase 2 complete — ready for Phase 3
`;

// ---------------------------------------------------------------------------
// Tier 1: Non-GSD — return null
// ---------------------------------------------------------------------------

describe('Tier 1: non-GSD project', () => {
  test('returns null when projectPath is empty string', () => {
    const result = readGsdProgress('');
    expect(result).toBeNull();
  });

  test('returns null when .planning/ directory does not exist', () => {
    mockedFs.existsSync.mockReturnValue(false);

    const result = readGsdProgress('/some/nonexistent/path');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tier 2: GSD project, unreadable STATE.md — return GSD_UNREADABLE shape
// ---------------------------------------------------------------------------

describe('Tier 2: GSD project, unreadable state', () => {
  test('returns GSD_UNREADABLE when .planning/ exists but STATE.md is absent', () => {
    // First call (planningDir) returns true, second call (stateMdPath) returns false
    mockedFs.existsSync
      .mockReturnValueOnce(true)   // .planning/ exists
      .mockReturnValueOnce(false); // STATE.md does not exist

    const result = readGsdProgress('/some/gsd/project');

    expect(result).not.toBeNull();
    expect(result!.isGsd).toBe(true);
    expect(result!.phaseName).toBeNull();
    expect(result!.phaseNumber).toBeNull();
    expect(result!.phaseStatus).toBeNull();
    expect(result!.nextAction).toBeNull();
    expect(result!.totalPhases).toBeNull();
    expect(result!.completedPhases).toBeNull();
    expect(result!.percent).toBeNull();
  });

  test('returns GSD_UNREADABLE when STATE.md has empty content', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue('');

    const result = readGsdProgress('/some/gsd/project');

    expect(result).not.toBeNull();
    expect(result!.isGsd).toBe(true);
    expect(result!.phaseName).toBeNull();
    expect(result!.phaseNumber).toBeNull();
  });

  test('returns GSD_UNREADABLE (not throws) when readFileSync throws', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockImplementation(() => {
      throw new Error('Permission denied');
    });

    expect(() => readGsdProgress('/some/gsd/project')).not.toThrow();
    const result = readGsdProgress('/some/gsd/project');

    expect(result).not.toBeNull();
    expect(result!.isGsd).toBe(true);
    expect(result!.phaseName).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tier 3: Full GsdProgress — valid STATE.md parsed successfully
// ---------------------------------------------------------------------------

describe('Tier 3: valid STATE.md — full GsdProgress', () => {
  beforeEach(() => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(VALID_STATE_MD);
  });

  test('parses phaseName from "Phase: N of M (Name)" prose line', () => {
    const result = readGsdProgress('/some/gsd/project');
    expect(result!.phaseName).toBe('Active Sessions Page');
  });

  test('parses phaseNumber as integer from prose line', () => {
    const result = readGsdProgress('/some/gsd/project');
    expect(result!.phaseNumber).toBe(2);
  });

  test('parses phaseStatus verbatim from "Status: ..." prose line', () => {
    const result = readGsdProgress('/some/gsd/project');
    expect(result!.phaseStatus).toBe('Phase 2 complete — ready for Phase 3');
  });

  test('derives nextAction as "/gsd:execute-phase {N}"', () => {
    const result = readGsdProgress('/some/gsd/project');
    expect(result!.nextAction).toBe('/gsd:execute-phase 2');
  });

  test('parses totalPhases from frontmatter progress block', () => {
    const result = readGsdProgress('/some/gsd/project');
    expect(result!.totalPhases).toBe(3);
  });

  test('parses completedPhases from frontmatter progress block', () => {
    const result = readGsdProgress('/some/gsd/project');
    expect(result!.completedPhases).toBe(2);
  });

  test('parses percent from frontmatter progress block', () => {
    const result = readGsdProgress('/some/gsd/project');
    expect(result!.percent).toBe(50);
  });

  test('returns full GsdProgress with isGsd: true', () => {
    const result = readGsdProgress('/some/gsd/project');

    expect(result).toEqual({
      isGsd: true,
      phaseName: 'Active Sessions Page',
      phaseNumber: 2,
      phaseStatus: 'Phase 2 complete — ready for Phase 3',
      nextAction: '/gsd:execute-phase 2',
      totalPhases: 3,
      completedPhases: 2,
      percent: 50,
    });
  });
});
