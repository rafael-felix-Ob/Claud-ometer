'use client';

import { useState, useCallback } from 'react';
import useSWR, { mutate } from 'swr';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Download,
  Upload,
  HardDrive,
  Cloud,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FileArchive,
  ArrowRightLeft,
} from 'lucide-react';

const fetcher = (url: string) => fetch(url).then(r => r.json());

interface DataSourceInfo {
  active: 'live' | 'imported';
  hasImportedData: boolean;
  importMeta: {
    importedAt: string;
    exportedAt: string;
    exportedFrom: string;
    projectCount: number;
    sessionCount: number;
    fileCount: number;
    totalSize: number;
  } | null;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

export default function DataPage() {
  const { data: sourceInfo, mutate: mutateSource } = useSWR<DataSourceInfo>('/api/data-source', fetcher);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [dbExporting, setDbExporting] = useState(false);
  const [dbImporting, setDbImporting] = useState(false);
  const [dbMerging, setDbMerging] = useState(false);
  const [zipToDbIngesting, setZipToDbIngesting] = useState(false);
  const [showZipToDbBridge, setShowZipToDbBridge] = useState(false);

  const handleExport = useCallback(async () => {
    setExporting(true);
    setMessage(null);
    try {
      const res = await fetch('/api/export');
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1]
        || `claude-code-data-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setMessage({ type: 'success', text: 'Export downloaded successfully!' });
    } catch {
      setMessage({ type: 'error', text: 'Failed to export data.' });
    } finally {
      setExporting(false);
    }
  }, []);

  const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setMessage(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/import', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      setMessage({
        type: 'success',
        text: `Imported ${data.meta.projectCount} projects, ${data.meta.sessionCount} sessions. Dashboard switched to imported data.`,
      });
      setShowZipToDbBridge(true);
      mutateSource();
      // Revalidate all data
      mutate(() => true);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to import data.' });
    } finally {
      setImporting(false);
      // Reset file input
      e.target.value = '';
    }
  }, [mutateSource]);

  const handleSwitchSource = useCallback(async (source: 'live' | 'imported') => {
    setMessage(null);
    try {
      const res = await fetch('/api/data-source', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source }),
      });
      if (!res.ok) throw new Error('Failed to switch');
      mutateSource();
      mutate(() => true);
      setMessage({ type: 'success', text: `Switched to ${source === 'live' ? 'live (~/.claude/)' : 'imported'} data.` });
    } catch {
      setMessage({ type: 'error', text: 'Failed to switch data source.' });
    }
  }, [mutateSource]);

  const handleClearImport = useCallback(async () => {
    setMessage(null);
    try {
      const res = await fetch('/api/import', { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to clear');
      mutateSource();
      mutate(() => true);
      setMessage({ type: 'success', text: 'Imported data cleared. Switched back to live data.' });
    } catch {
      setMessage({ type: 'error', text: 'Failed to clear imported data.' });
    }
  }, [mutateSource]);

  const handleDbExport = useCallback(async () => {
    setDbExporting(true);
    setMessage(null);
    try {
      const res = await fetch('/api/db-export');
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1]
        || `claud-ometer-${new Date().toISOString().slice(0, 10)}.db`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setMessage({ type: 'success', text: 'Database exported successfully!' });
    } catch {
      setMessage({ type: 'error', text: 'Failed to export database.' });
    } finally {
      setDbExporting(false);
    }
  }, []);

  const handleDbImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!window.confirm('This will replace your current database with the uploaded file. All existing data will be lost. Continue?')) {
      e.target.value = '';
      return;
    }

    setDbImporting(true);
    setMessage(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mode', 'replace');
      const res = await fetch('/api/db-import', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      setMessage({
        type: 'success',
        text: `Database replaced. ${data.sessionCount} sessions loaded.`,
      });
      mutate(() => true);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to import database.' });
    } finally {
      setDbImporting(false);
      e.target.value = '';
    }
  }, []);

  const handleDbMerge = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setDbMerging(true);
    setMessage(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mode', 'merge');
      const res = await fetch('/api/db-import', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Merge failed');
      setMessage({
        type: 'success',
        text: `Merge complete. ${data.sessionCount} total sessions in database.`,
      });
      mutate(() => true);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to merge database.' });
    } finally {
      setDbMerging(false);
      e.target.value = '';
    }
  }, []);

  const handleZipToDbIngest = useCallback(async () => {
    setZipToDbIngesting(true);
    setMessage(null);
    try {
      const res = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'imported' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Database import failed');
      setMessage({
        type: 'success',
        text: `Imported to database successfully. ${data.sessionsIngested ?? ''} sessions processed.`.trim(),
      });
      setShowZipToDbBridge(false);
      mutate(() => true);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to import ZIP data to database.' });
    } finally {
      setZipToDbIngesting(false);
    }
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Data Management</h1>
        <p className="text-sm text-muted-foreground">Export, import, and manage your dashboard data</p>
      </div>

      {/* Status Message */}
      {message && (
        <div className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${
          message.type === 'success'
            ? 'bg-green-50 text-green-700 border border-green-200'
            : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {message.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
          )}
          {message.text}
        </div>
      )}

      {/* ZIP Import to SQLite Bridge */}
      {showZipToDbBridge && (
        <Card className="border-border/50 shadow-sm border-green-500/30 bg-green-50/5">
          <CardContent className="py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-green-600" />
              <span className="text-sm">Also populate the SQLite database from the imported data?</span>
            </div>
            <button
              onClick={handleZipToDbIngest}
              disabled={zipToDbIngesting}
              className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
            >
              {zipToDbIngesting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Importing...
                </>
              ) : (
                'Import to Database'
              )}
            </button>
          </CardContent>
        </Card>
      )}

      {/* Active Data Source */}
      <Card className="border-border/50 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4" />
              Active Data Source
            </CardTitle>
            <Badge variant={sourceInfo?.active === 'live' ? 'default' : 'secondary'}>
              {sourceInfo?.active === 'live' ? 'Live' : 'Imported'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => handleSwitchSource('live')}
              className={`flex items-center gap-3 rounded-lg border-2 p-4 transition-all ${
                sourceInfo?.active === 'live'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
              }`}
            >
              <HardDrive className={`h-5 w-5 ${sourceInfo?.active === 'live' ? 'text-primary' : 'text-muted-foreground'}`} />
              <div className="text-left">
                <p className="text-sm font-medium">Live Data</p>
                <p className="text-xs text-muted-foreground">Read from ~/.claude/ in real-time</p>
              </div>
              {sourceInfo?.active === 'live' && (
                <CheckCircle2 className="h-4 w-4 text-primary ml-auto" />
              )}
            </button>
            <button
              onClick={() => sourceInfo?.hasImportedData && handleSwitchSource('imported')}
              disabled={!sourceInfo?.hasImportedData}
              className={`flex items-center gap-3 rounded-lg border-2 p-4 transition-all ${
                sourceInfo?.active === 'imported'
                  ? 'border-primary bg-primary/5'
                  : sourceInfo?.hasImportedData
                    ? 'border-border hover:border-primary/50'
                    : 'border-border/50 opacity-50 cursor-not-allowed'
              }`}
            >
              <Cloud className={`h-5 w-5 ${sourceInfo?.active === 'imported' ? 'text-primary' : 'text-muted-foreground'}`} />
              <div className="text-left">
                <p className="text-sm font-medium">Imported Data</p>
                <p className="text-xs text-muted-foreground">
                  {sourceInfo?.hasImportedData ? 'View previously imported snapshot' : 'No imported data yet'}
                </p>
              </div>
              {sourceInfo?.active === 'imported' && (
                <CheckCircle2 className="h-4 w-4 text-primary ml-auto" />
              )}
            </button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        {/* Export */}
        <Card className="border-border/50 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Download className="h-4 w-4" />
              Export Data
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Download all your Claude Code data as a ZIP archive. Includes session logs,
              stats, history, plans, and todos. Load it on another machine or keep as a backup.
            </p>
            <div className="rounded-lg bg-accent/50 p-3 space-y-1.5">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Includes</p>
              <div className="grid grid-cols-2 gap-1 text-xs">
                <span>Session JSONL files</span>
                <span>Stats cache</span>
                <span>Prompt history</span>
                <span>Plans & Todos</span>
                <span>Settings</span>
                <span>Export metadata</span>
              </div>
            </div>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {exporting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Preparing export...
                </>
              ) : (
                <>
                  <FileArchive className="h-4 w-4" />
                  Export as ZIP
                </>
              )}
            </button>
          </CardContent>
        </Card>

        {/* Import */}
        <Card className="border-border/50 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Upload className="h-4 w-4" />
              Import Data
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Upload a previously exported ZIP archive to view that data in the dashboard.
              The dashboard will switch to showing the imported data automatically.
            </p>

            {sourceInfo?.importMeta && (
              <div className="rounded-lg border border-border/50 p-3 space-y-2">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  Current Import
                </p>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">From</span>
                    <span className="font-medium">{sourceInfo.importMeta.exportedFrom}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Exported</span>
                    <span className="font-medium">
                      {new Date(sourceInfo.importMeta.exportedAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Projects</span>
                    <span className="font-medium">{sourceInfo.importMeta.projectCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Sessions</span>
                    <span className="font-medium">{sourceInfo.importMeta.sessionCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Size</span>
                    <span className="font-medium">{formatBytes(sourceInfo.importMeta.totalSize)}</span>
                  </div>
                </div>
                <Separator />
                <button
                  onClick={handleClearImport}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="h-3 w-3" />
                  Clear Imported Data
                </button>
              </div>
            )}

            <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border px-4 py-2.5 text-sm font-medium transition-colors hover:border-primary/50 hover:bg-accent/50">
              {importing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  {sourceInfo?.hasImportedData ? 'Replace with new ZIP' : 'Upload ZIP file'}
                </>
              )}
              <input
                type="file"
                accept=".zip"
                onChange={handleImport}
                disabled={importing}
                className="hidden"
              />
            </label>
          </CardContent>
        </Card>
      </div>

      <Separator />

      {/* Database Portability Section */}
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Database</h2>
        <p className="text-sm text-muted-foreground">Export, import, or merge your SQLite database for cross-machine portability</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* DB Export Card */}
        <Card className="border-border/50 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Download className="h-4 w-4" />
              Export Database
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Download your SQLite database as a standalone .db file. Use it on another machine or as a backup.
            </p>
            <button
              onClick={handleDbExport}
              disabled={dbExporting}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {dbExporting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <HardDrive className="h-4 w-4" />
                  Export .db
                </>
              )}
            </button>
          </CardContent>
        </Card>

        {/* DB Replace Card */}
        <Card className="border-border/50 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Upload className="h-4 w-4" />
              Replace Database
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Upload a .db file to replace your current database entirely. Warning: existing data will be overwritten.
            </p>
            <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border px-4 py-2.5 text-sm font-medium transition-colors hover:border-primary/50 hover:bg-accent/50">
              {dbImporting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Replacing...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  Upload .db to replace
                </>
              )}
              <input
                type="file"
                accept=".db"
                onChange={handleDbImport}
                disabled={dbImporting}
                className="hidden"
              />
            </label>
          </CardContent>
        </Card>

        {/* DB Merge Card */}
        <Card className="border-border/50 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4" />
              Merge Database
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Merge a .db file from another machine. Sessions are deduplicated — the version with more messages wins.
            </p>
            <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border px-4 py-2.5 text-sm font-medium transition-colors hover:border-primary/50 hover:bg-accent/50">
              {dbMerging ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Merging...
                </>
              ) : (
                <>
                  <ArrowRightLeft className="h-4 w-4" />
                  Upload .db to merge
                </>
              )}
              <input
                type="file"
                accept=".db"
                onChange={handleDbMerge}
                disabled={dbMerging}
                className="hidden"
              />
            </label>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
