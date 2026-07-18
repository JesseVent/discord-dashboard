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
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { MessageSquare, Users, ExternalLink, Paperclip, Lock, Archive, Clock, CheckCircle2, CircleDot, AlertCircle } from 'lucide-react';
import type { Issue, DiscordMessage } from '@/lib/discord-types';
import {
  fmtRelative,
  fmtDate,
  fmtDuration,
  tagName,
  tagColor,
  tagColorSoft,
  resolutionBadgeVariant,
  resolutionLabel,
} from '@/lib/dashboard-utils';
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
  const [selected, setSelected] = useState<Issue | null>(null);
  const [page, setPage] = useState(0);
  const pageSize = 20;

  // The page-level FilterBar owns search + every other dimension; we just render.
  const filtered = issues;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  
  // Slice issues for the current page
  const paginatedIssues = filtered.slice(page * pageSize, (page + 1) * pageSize);

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
                  <TableHead className="w-[35%]">Issue</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead className="text-right">Replies</TableHead>
                  <TableHead>Response</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reporter</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedIssues.map((issue) => (
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
                      {issue.replies !== undefined ? (
                        <span className={issue.replies.length > 0 ? 'text-fg' : 'text-muted-foreground'}>
                          {issue.replies.length}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap font-mono">
                      {issue.responseTimeMs !== null && issue.responseTimeMs !== undefined ? (
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3 text-muted-foreground" />
                          {fmtDuration(issue.responseTimeMs)}
                        </span>
                      ) : issue.replies !== undefined ? (
                        <span className="text-muted-foreground">no reply</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {issue.resolutionStatus && issue.resolutionStatus !== 'unknown' ? (
                        <Badge variant={resolutionBadgeVariant(issue.resolutionStatus)} className="text-[10px]">
                          {issue.resolutionStatus === 'likely-resolved' && <CheckCircle2 className="h-3 w-3" />}
                          {issue.resolutionStatus === 'in-progress' && <CircleDot className="h-3 w-3" />}
                          {issue.resolutionStatus === 'unanswered' && <AlertCircle className="h-3 w-3" />}
                          {resolutionLabel(issue.resolutionStatus)}
                        </Badge>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
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
      {filtered.length > 0 && (
        <div className="flex items-center justify-between border-t p-3">
          <div className="text-xs text-muted-foreground">
            Showing {page * pageSize + 1} to {Math.min((page + 1) * pageSize, filtered.length)} of {filtered.length} issues
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              Previous
            </Button>
            <div className="text-xs font-medium px-2">
              Page {page + 1} of {pageCount}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={page === pageCount - 1}
            >
              Next
            </Button>
          </div>
        </div>
      )}

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
          {issue.resolutionStatus && issue.resolutionStatus !== 'unknown' ? (
            <Badge variant={resolutionBadgeVariant(issue.resolutionStatus)} className="text-[11px]">
              {issue.resolutionStatus === 'likely-resolved' && <CheckCircle2 className="h-3 w-3 mr-1" />}
              {issue.resolutionStatus === 'in-progress' && <CircleDot className="h-3 w-3 mr-1" />}
              {issue.resolutionStatus === 'unanswered' && <AlertCircle className="h-3 w-3 mr-1" />}
              {resolutionLabel(issue.resolutionStatus)}
            </Badge>
          ) : null}
          {issue.responseTimeMs !== null && issue.responseTimeMs !== undefined ? (
            <Badge variant="secondary" className="text-[11px]">
              <Clock className="h-3 w-3 mr-1" /> first reply in {fmtDuration(issue.responseTimeMs)}
            </Badge>
          ) : null}
          {issue.hasAttachment ? (
            <Badge variant="secondary" className="text-[11px]">
              <Paperclip className="h-3 w-3 mr-1" /> {issue.attachmentFilenames.length} attachment
              {issue.attachmentFilenames.length === 1 ? '' : 's'}
            </Badge>
          ) : null}
        </div>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-4">
            {/* Original post (first message) */}
            <div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                <span className="agl-eyebrow">Original Post</span>
                <span>·</span>
                <span className="font-medium text-foreground">
                  {issue.ownerGlobalName ?? issue.ownerUsername}
                </span>
                <span className="font-mono">@{issue.ownerUsername}</span>
              </div>
              {issue.firstMessageContent ? (
                <pre className="agl-codeblock whitespace-pre-wrap break-words">
                  {issue.firstMessageContent}
                </pre>
              ) : (
                <p className="text-sm italic text-muted-foreground">
                  No first-message content available.
                </p>
              )}
            </div>

            {/* Replies (conversation thread) */}
            {issue.replies && issue.replies.length > 0 ? (
              <div>
                <div className="agl-eyebrow mb-3">
                  {issue.replies.length} {issue.replies.length === 1 ? 'Reply' : 'Replies'}
                </div>
                <div className="space-y-3">
                  {issue.replies.map((reply, idx) => (
                    <ReplyRow
                      key={reply.id ?? idx}
                      reply={reply}
                      issueOwnerId={issue.ownerId}
                      isFirstReply={idx === 0}
                    />
                  ))}
                </div>
              </div>
            ) : issue.replies !== undefined ? (
              <div className="agl-callout agl-callout-warning">
                <AlertCircle className="h-4 w-4 mt-0.5 text-warning shrink-0" />
                <div>
                  <p className="font-medium text-warning text-sm">No replies yet</p>
                  <p className="text-xs text-fg mt-0.5">
                    This issue has not received a response from the community.
                  </p>
                </div>
              </div>
            ) : (
              <div className="agl-callout agl-callout-note">
                <MessageSquare className="h-4 w-4 mt-0.5 text-accent shrink-0" />
                <div>
                  <p className="font-medium text-accent text-sm">Replies not loaded</p>
                  <p className="text-xs text-fg mt-0.5">
                    Click "Fetch Replies" in the Data Source panel to load the full conversation.
                  </p>
                </div>
              </div>
            )}
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

/**
 * Render a single reply as a chat-style row with avatar, author, timestamp, and content.
 * Issue creator's replies are badged so you can see when the OP chimes back in.
 */
function ReplyRow({
  reply,
  issueOwnerId,
  isFirstReply,
}: {
  reply: DiscordMessage;
  issueOwnerId: string;
  isFirstReply: boolean;
}) {
  const author = reply.author;
  const displayName = author?.global_name ?? author?.username ?? 'unknown';
  const username = author?.username ?? 'unknown';
  const isOp = author?.id === issueOwnerId;
  const initials = displayName.replace(/[^a-zA-Z0-9 ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';

  return (
    <div className={`flex gap-3 rounded-md p-3 ${isFirstReply ? 'bg-accent-soft ring-1 ring-accent/20' : 'bg-surface-2'}`}>
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarFallback className={`text-xs ${isOp ? 'bg-accent text-accent-fg' : 'bg-surface-3'}`}>
          {initials}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="text-sm font-medium">{displayName}</span>
          {isOp ? (
            <span className="rounded-xs bg-accent text-accent-fg px-1.5 py-0.5 text-[9px] font-mono font-medium uppercase tracking-wider">
              OP
            </span>
          ) : null}
          {isFirstReply ? (
            <span className="rounded-xs bg-success-soft text-success px-1.5 py-0.5 text-[9px] font-mono font-medium uppercase tracking-wider">
              First Reply
            </span>
          ) : null}
          <span className="text-[11px] text-muted-foreground font-mono">@{username}</span>
          <span className="text-[11px] text-muted-foreground">·</span>
          <span className="text-[11px] text-muted-foreground font-mono">
            {fmtRelative(reply.timestamp)}
          </span>
        </div>
        {reply.content ? (
          <pre className="whitespace-pre-wrap break-words text-sm font-sans leading-relaxed bg-transparent p-0 m-0">
            {reply.content}
          </pre>
        ) : (
          <p className="text-xs italic text-muted-foreground">(empty message — may be an attachment or embed)</p>
        )}
        {reply.attachments && reply.attachments.length > 0 ? (
          <div className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
            <Paperclip className="h-3 w-3" />
            {reply.attachments.length} attachment{reply.attachments.length === 1 ? '' : 's'}
          </div>
        ) : null}
      </div>
    </div>
  );
}
