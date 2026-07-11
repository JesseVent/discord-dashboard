'use client';

import { useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageSquare, Users, ExternalLink, Paperclip, Lock, Archive } from 'lucide-react';
import type { Issue } from '@/lib/discord-types';
import { fmtRelative, fmtDate, tagName, tagColor, tagColorSoft } from '@/lib/dashboard-utils';
import { threadUrl } from '@/lib/discord-api';

interface IssuesTableProps {
  issues: Issue[];
  guildId?: string;
  channelId?: string;
  selectedTheme?: string | null;
  onClearTheme?: () => void;
}

export function IssuesTable({
  issues,
  guildId = '839993398554656828',
  channelId,
  selectedTheme,
  onClearTheme,
}: IssuesTableProps) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Issue | null>(null);

  const filtered = search
    ? issues.filter((i) => {
        const q = search.toLowerCase();
        return (
          i.name.toLowerCase().includes(q) ||
          i.ownerUsername.toLowerCase().includes(q) ||
          (i.ownerGlobalName ?? '').toLowerCase().includes(q) ||
          i.firstMessageContent.toLowerCase().includes(q)
        );
      })
    : issues;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              Issues
              <Badge variant="secondary" className="text-xs">
                {filtered.length}
              </Badge>
              {selectedTheme ? (
                <Badge variant="outline" className="text-xs">
                  theme: {selectedTheme}
                  <button
                    type="button"
                    onClick={onClearTheme}
                    className="ml-1 text-muted-foreground hover:text-foreground"
                    aria-label="Clear theme filter"
                  >
                    ×
                  </button>
                </Badge>
              ) : null}
            </CardTitle>
            <CardDescription>Click any row to see the full issue content</CardDescription>
          </div>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search issues, users, content…"
            className="sm:w-72"
          />
        </div>
      </CardHeader>
      <CardContent>
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No issues match the current filters.
          </div>
        ) : (
          <ScrollArea className="h-[520px] rounded-md">
            <Table>
              <TableHeader className="sticky top-0 bg-surface-2 z-10">
                <TableRow>
                  <TableHead className="w-[40%]">Issue</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead className="text-right">Msgs</TableHead>
                  <TableHead className="text-right">Members</TableHead>
                  <TableHead>Reporter</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((issue) => (
                  <TableRow
                    key={issue.id}
                    onClick={() => setSelected(issue)}
                    className="cursor-pointer"
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-start gap-1.5">
                        <div className="min-w-0">
                          <p className="truncate max-w-[460px]">{issue.name}</p>
                          {issue.firstMessageContent ? (
                            <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1 max-w-[460px]">
                              {issue.firstMessageContent.replace(/```[\s\S]*?```/g, '[code]')}
                            </p>
                          ) : (
                            <p className="mt-0.5 text-xs italic text-muted-foreground">
                              (no message body)
                            </p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {issue.appliedTags.slice(0, 2).map((t) => (
                          <span
                            key={t}
                            className="inline-flex items-center rounded-xs px-1.5 py-0.5 text-[10px] font-mono font-medium uppercase tracking-wider"
                            style={{
                              backgroundColor: tagColorSoft(t),
                              color: tagColor(t),
                            }}
                          >
                            {tagName(t)}
                          </span>
                        ))}
                        {issue.appliedTags.length > 2 ? (
                          <span className="text-[10px] text-muted-foreground">
                            +{issue.appliedTags.length - 2}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-sm">
                      {issue.messageCount}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-sm">
                      {issue.memberCount}
                    </TableCell>
                    <TableCell className="text-sm">
                      {issue.ownerGlobalName ?? issue.ownerUsername}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap font-mono">
                      {fmtRelative(issue.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </CardContent>

      <IssueDetailDialog
        issue={selected}
        guildId={guildId}
        channelId={channelId}
        onClose={() => setSelected(null)}
      />
    </Card>
  );
}

function IssueDetailDialog({
  issue,
  guildId,
  channelId,
  onClose,
}: {
  issue: Issue | null;
  guildId: string;
  channelId?: string;
  onClose: () => void;
}) {
  if (!issue) return null;
  const link =
    channelId ?
      threadUrl({ guildId, channelId, threadId: issue.id })
    : `https://discord.com/channels/${guildId}`;

  return (
    <Dialog open={!!issue} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="pr-8 text-lg leading-snug">{issue.name}</DialogTitle>
          <DialogDescription>
            Created {fmtDate(issue.createdAt)} · {fmtRelative(issue.createdAt)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 pb-3 border-b">
          {issue.appliedTags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center rounded-xs px-2 py-0.5 text-[11px] font-mono font-medium uppercase tracking-wider"
              style={{
                backgroundColor: tagColorSoft(t),
                color: tagColor(t),
              }}
            >
              {tagName(t)}
            </span>
          ))}
          {issue.archived ? (
            <Badge variant="outline" className="text-[11px]">
              <Archive className="h-3 w-3 mr-1" /> Archived
            </Badge>
          ) : null}
          {issue.locked ? (
            <Badge variant="outline" className="text-[11px]">
              <Lock className="h-3 w-3 mr-1" /> Locked
            </Badge>
          ) : null}
          <Badge variant="secondary" className="text-[11px]">
            <MessageSquare className="h-3 w-3 mr-1" /> {issue.messageCount} messages
          </Badge>
          <Badge variant="secondary" className="text-[11px]">
            <Users className="h-3 w-3 mr-1" /> {issue.memberCount} members
          </Badge>
          {issue.hasAttachment ? (
            <Badge variant="secondary" className="text-[11px]">
              <Paperclip className="h-3 w-3 mr-1" /> {issue.attachmentFilenames.length} attachment
              {issue.attachmentFilenames.length === 1 ? '' : 's'}
            </Badge>
          ) : null}
        </div>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Reported by</span>
              <span className="font-medium text-foreground">
                {issue.ownerGlobalName ?? issue.ownerUsername}
              </span>
              <span>·</span>
              <span className="font-mono">@{issue.ownerUsername}</span>
              <span>·</span>
              <span className="font-mono text-[10px]">{issue.ownerId}</span>
            </div>

            {issue.firstMessageContent ? (
              <pre className="agl-codeblock whitespace-pre-wrap break-words">
                {issue.firstMessageContent}
              </pre>
            ) : (
              <p className="text-sm italic text-muted-foreground">
                No first-message content available. Use “Fetch Details” to retrieve it.
              </p>
            )}

            {issue.attachmentFilenames.length > 0 ? (
              <div className="text-xs text-muted-foreground">
                Attachments: {issue.attachmentFilenames.join(', ')}
              </div>
            ) : null}
          </div>
        </ScrollArea>

        <DialogFooter className="mt-2">
          <Button asChild variant="default" size="sm">
            <a href={link} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4 mr-1.5" /> Open in Discord
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
