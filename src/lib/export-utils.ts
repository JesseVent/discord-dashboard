'use client';

import type { Issue } from '@/lib/discord-types';
import { tagName } from '@/lib/dashboard-utils';
import { fmtDate, fmtDuration } from '@/lib/dashboard-utils';

/**
 * Trigger a browser download of a blob with the given filename.
 */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Export issues as CSV. Includes all flat fields + reply count + sentiment.
 */
export function exportIssuesToCsv(issues: Issue[], filename = 'discord-issues.csv') {
  const headers = [
    'id', 'name', 'createdAt', 'archivedAt', 'archived', 'locked',
    'messageCount', 'memberCount', 'totalMessageSent',
    'appliedTags', 'ownerId', 'ownerUsername', 'ownerGlobalName',
    'firstMessageContent', 'firstMessageCreatedAt',
    'responseTimeMs', 'responderCount', 'isAnswered', 'resolutionStatus',
    'sentiment', 'sentimentScore', 'sentimentSummary',
    'duplicateClusterId',
    'discordUrl',
  ];

  const rows = issues.map((issue) => {
    return [
      issue.id,
      csvEscape(issue.name),
      issue.createdAt,
      issue.archivedAt ?? '',
      issue.archived ? 'true' : 'false',
      issue.locked ? 'true' : 'false',
      issue.messageCount,
      issue.memberCount,
      issue.totalMessageSent,
      csvEscape(issue.appliedTags.map(tagName).join('; ')),
      issue.ownerId,
      csvEscape(issue.ownerUsername),
      csvEscape(issue.ownerGlobalName ?? ''),
      csvEscape((issue.firstMessageContent ?? '').replace(/\n/g, ' ').slice(0, 500)),
      issue.firstMessageCreatedAt ?? '',
      issue.responseTimeMs ?? '',
      issue.responderCount ?? '',
      issue.isAnswered ? 'true' : 'false',
      issue.resolutionStatus ?? 'unknown',
      issue.sentiment ?? '',
      issue.sentimentScore ?? '',
      csvEscape((issue.sentimentSummary ?? '').replace(/\n/g, ' ')),
      issue.duplicateClusterId ?? '',
      `https://discord.com/channels/839993398554656828/${issue.id}`,
    ];
  });

  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename);
}

/**
 * Export issues as JSON — includes replies for full fidelity.
 */
export function exportIssuesToJson(issues: Issue[], filename = 'discord-issues.json') {
  const payload = {
    exportedAt: new Date().toISOString(),
    count: issues.length,
    issues,
  };
  downloadBlob(
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    filename,
  );
}

/**
 * Export a summary report as Markdown — useful for sharing with the team.
 */
export function exportSummaryToMarkdown(opts: {
  issues: Issue[];
  totalResults: number;
  channelId: string;
  themes: Array<{ theme: string; count: number; description: string }>;
  responseRate?: number;
  avgResponseTimeMs?: number | null;
  duplicateClusters?: Array<{ name: string; description: string; issueIds: string[] }>;
}) {
  const { issues, totalResults, channelId, themes, responseRate, avgResponseTimeMs, duplicateClusters } = opts;
  const lines: string[] = [];

  lines.push(`# Discord Issue Tracker — Summary Report`);
  lines.push('');
  lines.push(`**Channel ID:** ${channelId}`);
  lines.push(`**Generated:** ${new Date().toLocaleString()}`);
  lines.push(`**Issues loaded:** ${issues.length} of ${totalResults.toLocaleString()} total`);
  lines.push('');

  lines.push(`## Key Metrics`);
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total Issues (loaded) | ${issues.length} |`);
  lines.push(`| Total Issues (in forum) | ${totalResults.toLocaleString()} |`);
  const uniqueUsers = new Set(issues.map((i) => i.ownerId)).size;
  lines.push(`| Unique Reporters | ${uniqueUsers} |`);
  const totalMessages = issues.reduce((s, i) => s + (i.totalMessageSent || i.messageCount || 0), 0);
  lines.push(`| Total Messages | ${totalMessages.toLocaleString()} |`);
  if (responseRate !== undefined) {
    lines.push(`| Response Rate | ${Math.round(responseRate * 100)}% |`);
  }
  if (avgResponseTimeMs !== null && avgResponseTimeMs !== undefined) {
    lines.push(`| Avg Response Time | ${fmtDuration(avgResponseTimeMs)} |`);
  }
  const frustrated = issues.filter((i) => i.sentiment === 'frustrated').length;
  const resolved = issues.filter((i) => i.sentiment === 'resolved').length;
  if (issues.some((i) => i.sentiment)) {
    lines.push(`| Frustrated Issues | ${frustrated} |`);
    lines.push(`| Resolved Issues | ${resolved} |`);
  }
  lines.push('');

  if (themes.length > 0) {
    lines.push(`## Common Themes`);
    lines.push('');
    lines.push(`| Theme | Count | Description |`);
    lines.push(`|-------|-------|-------------|`);
    for (const t of themes.slice(0, 10)) {
      lines.push(`| ${t.theme} | ${t.count} | ${t.description} |`);
    }
    lines.push('');
  }

  if (duplicateClusters && duplicateClusters.length > 0) {
    lines.push(`## Duplicate Clusters (Recurring Issues)`);
    lines.push('');
    for (const c of duplicateClusters.slice(0, 8)) {
      lines.push(`### ${c.name} (${c.issueIds.length} duplicates)`);
      lines.push(`_${c.description}_`);
      lines.push('');
    }
  }

  lines.push(`## Top Issues by Message Count`);
  lines.push('');
  const top = [...issues].sort((a, b) => b.messageCount - a.messageCount).slice(0, 10);
  for (const issue of top) {
    lines.push(`- **${issue.name}** — ${issue.messageCount} msgs, by @${issue.ownerUsername} (${fmtDate(issue.createdAt)})`);
    lines.push(`  ${`https://discord.com/channels/839993398554656828/${issue.id}`}`);
  }
  lines.push('');

  lines.push(`---`);
  lines.push(`_Generated by Discord Issue Tracker_`);

  const md = lines.join('\n');
  downloadBlob(new Blob([md], { type: 'text/markdown;charset=utf-8' }), 'discord-issues-summary.md');
}

function csvEscape(value: string): string {
  if (value == null) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
