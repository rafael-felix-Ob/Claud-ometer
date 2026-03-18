# Testing Patterns

**Analysis Date:** 2026-03-17

## Test Framework Status

**No testing framework configured** — the codebase does not use Jest, Vitest, or any other test runner.

- No test files found in the repository
- No testing dependencies in `package.json`
- `package-lock.json` does not contain testing libraries
- `.gitignore` tracks `/coverage` and `/test-results` directories but they are empty
- No `jest.config.*`, `vitest.config.*`, or similar configuration files

## Current Testing Approach

**Manual Testing Only:**
- Developers test features locally using `npm run dev` (Next.js dev server)
- No automated test suite for unit, integration, or E2E testing
- Quality assurance relies on manual verification of the dashboard

## Gaps & Recommendations

**Critical Missing Tests:**
1. **API Route Tests** (`src/app/api/*/route.ts`)
   - GET /api/stats returns valid DashboardStats
   - GET /api/projects returns array of ProjectInfo[]
   - GET /api/sessions?q= filters by query term
   - GET /api/sessions/[id] returns SessionDetail or 404
   - Error handling returns 500 with error message

2. **Data Reader Tests** (`src/lib/claude-data/reader.ts`)
   - `getProjects()` correctly parses JSONL session files
   - `getSessions()` respects limit/offset pagination
   - `getSessionDetail()` extracts and formats messages
   - Malformed JSONL lines are skipped silently
   - Missing files/directories return empty arrays

3. **Format Utility Tests** (`src/lib/format.ts`)
   - `formatTokens()` converts 1M to "1.0M", 1B to "1.0B"
   - `formatCost()` handles edge cases: <$0.01, $1+, $1000+
   - `formatDuration()` converts milliseconds to "1h 30m", "5m 2s"
   - `timeAgo()` returns "just now", "5m ago", "2d ago" correctly

4. **Component Tests** (Recharts charts, stat cards, sidebar)
   - Charts render with correct data
   - Sidebar nav highlights active route
   - Search input debounces and updates URL params
   - StatCard displays icon, title, value, subtitle

5. **Data Source Toggle Tests** (`src/lib/claude-data/data-source.ts`)
   - `setDataSource()` correctly creates/removes `.use-imported` flag
   - `getActiveDataSource()` returns 'live' by default, 'imported' when flag exists
   - `clearImportedData()` removes entire `.dashboard-data/` directory

## Test Data & Fixtures

**Recommended Setup:**

Create `src/__tests__/fixtures/` directory with sample data:

```typescript
// src/__tests__/fixtures/sample-sessions.ts
export const sampleSessionMessage = {
  type: 'user',
  sessionId: 'test-session-1',
  timestamp: '2026-03-17T10:00:00Z',
  uuid: 'uuid-1',
  parentUuid: null,
  cwd: '/home/user/project',
  version: '1.0',
  gitBranch: 'main',
  message: {
    role: 'user',
    content: 'test message',
  },
};

export const sampleAssistantMessage = {
  type: 'assistant',
  sessionId: 'test-session-1',
  timestamp: '2026-03-17T10:00:01Z',
  uuid: 'uuid-2',
  parentUuid: 'uuid-1',
  cwd: '/home/user/project',
  version: '1.0',
  gitBranch: 'main',
  message: {
    role: 'assistant',
    model: 'claude-opus-4-6',
    content: 'response',
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  },
};
```

## Suggested Test Structure

**Test Organization:**
- Co-locate tests with source: `src/lib/__tests__/format.test.ts` next to `src/lib/format.ts`
- API tests: `src/app/api/__tests__/stats.test.ts`
- Component tests: `src/components/__tests__/stat-card.test.tsx`
- Integration tests: `src/__tests__/integration/` for multi-module scenarios

**Test File Naming:**
- `*.test.ts` for unit tests (functions, utilities)
- `*.test.tsx` for component tests
- `*.integration.test.ts` for multi-module tests

## Mock Patterns (For Future Implementation)

**What to Mock:**
- File system operations: `fs.readFileSync()`, `fs.existsSync()` — use `jest.mock('fs')`
- Fetch calls: `/api/stats`, `/api/sessions` — use `jest.mock('fetch')` or MSW (Mock Service Worker)
- Date/time: `new Date()` — use `jest.useFakeTimers()`

**What NOT to Mock:**
- Type definitions and interfaces
- Utility functions like `formatTokens()`, `formatCost()` — test as-is
- Tailwind CSS classes — test component renders, not CSS output

## Example Test Patterns

**Format Function Test (Unit):**
```typescript
import { formatTokens, formatCost, formatDuration } from '@/lib/format';

describe('Format Utilities', () => {
  describe('formatTokens', () => {
    it('should format billions', () => {
      expect(formatTokens(1_000_000_000)).toBe('1.0B');
      expect(formatTokens(5_500_000_000)).toBe('5.5B');
    });

    it('should format millions', () => {
      expect(formatTokens(1_000_000)).toBe('1.0M');
    });

    it('should format thousands', () => {
      expect(formatTokens(1_000)).toBe('1.0K');
    });

    it('should return raw number below 1K', () => {
      expect(formatTokens(500)).toBe('500');
    });
  });

  describe('formatCost', () => {
    it('should format sub-penny costs', () => {
      expect(formatCost(0.001)).toBe('$0.0010');
    });

    it('should format dollar costs', () => {
      expect(formatCost(5.50)).toBe('$5.50');
    });

    it('should format kilobucks', () => {
      expect(formatCost(5000)).toBe('$5.0K');
    });
  });

  describe('formatDuration', () => {
    it('should format hours and minutes', () => {
      expect(formatDuration(5400000)).toBe('1h 30m'); // 1.5 hours in ms
    });

    it('should format minutes and seconds', () => {
      expect(formatDuration(302000)).toBe('5m 2s');
    });

    it('should format seconds only', () => {
      expect(formatDuration(45000)).toBe('45s');
    });
  });
});
```

**API Route Test (Integration):**
```typescript
import { GET } from '@/app/api/stats/route';
import { getDashboardStats } from '@/lib/claude-data/reader';

jest.mock('@/lib/claude-data/reader');

describe('GET /api/stats', () => {
  it('should return stats on success', async () => {
    const mockStats = {
      totalSessions: 100,
      totalMessages: 5000,
      totalTokens: 1_000_000,
      estimatedCost: 45.50,
      // ... other required fields
    };

    (getDashboardStats as jest.Mock).mockResolvedValue(mockStats);

    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual(mockStats);
  });

  it('should return 500 on error', async () => {
    (getDashboardStats as jest.Mock).mockRejectedValue(new Error('FS error'));

    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json).toEqual({ error: 'Failed to fetch stats' });
  });
});
```

**Component Test (Unit):**
```typescript
import { render, screen } from '@testing-library/react';
import { StatCard } from '@/components/cards/stat-card';
import { MessageSquare } from 'lucide-react';

describe('StatCard', () => {
  it('should render title and value', () => {
    render(
      <StatCard
        title="Total Messages"
        value="5,000"
        icon={MessageSquare}
      />
    );

    expect(screen.getByText('Total Messages')).toBeInTheDocument();
    expect(screen.getByText('5,000')).toBeInTheDocument();
  });

  it('should render optional subtitle', () => {
    render(
      <StatCard
        title="Total Sessions"
        value="100"
        subtitle="across 10 projects"
        icon={MessageSquare}
      />
    );

    expect(screen.getByText('across 10 projects')).toBeInTheDocument();
  });

  it('should render icon', () => {
    const { container } = render(
      <StatCard
        title="Test"
        value="123"
        icon={MessageSquare}
      />
    );

    // Check that icon SVG is rendered
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});
```

## Recommended Testing Setup

**Installation (when ready):**
```bash
npm install --save-dev jest @testing-library/react @testing-library/jest-dom @types/jest ts-jest jest-environment-jsdom
```

**jest.config.js:**
```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
};
```

**package.json scripts (to add):**
```json
{
  "test": "jest",
  "test:watch": "jest --watch",
  "test:coverage": "jest --coverage"
}
```

## Coverage Goals (Recommended)

- Statements: 80%+
- Branches: 75%+
- Functions: 80%+
- Lines: 80%+

Critical paths (reader.ts, format.ts, pricing.ts) should aim for 90%+.

---

*Testing analysis: 2026-03-17*
