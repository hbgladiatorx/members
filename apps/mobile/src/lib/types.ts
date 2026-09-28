export type Role = 'instructor' | 'assistant' | 'student';
export interface User { id: string; email: string; displayName: string; avatarUrl: string | null }
export interface Person { id: string; displayName: string; role?: Role }

export interface ClassSummary {
  id: string;
  title: string;
  description: string;
  startsOn: string | null;
  endsOn: string | null;
  joinOpen: boolean;
  archivedAt: string | null;
  role: Role;
  memberCount: number;
  joinCode?: string;
  channelId?: string;
}

export interface Member extends Person { role: Role; joinedAt: string }

export interface SyllabusItem {
  id: string; position: number; title: string; body: string; dueOn: string | null; published: boolean;
}
export interface Announcement { id: string; title: string; body: string; pinned: boolean; createdAt: string; author: Person }

export interface QuestionSummary {
  id: string; title: string; excerpt: string; createdAt: string; resolved: boolean; author: Person; score: number; answerCount: number;
}
export interface Answer { id: string; body: string; createdAt: string; author: Person; score: number; myVote: number | null; accepted: boolean }
export interface Question {
  id: string; classId: string; title: string; body: string; createdAt: string; acceptedAnswerId: string | null;
  author: Person; score: number; myVote: number | null; answers: Answer[];
}

export interface TopicSummary {
  id: string; title: string; excerpt: string; pinned: boolean; locked: boolean; createdAt: string;
  lastActivityAt: string; author: Person; replyCount: number;
}
export interface Post { id: string; parentId: string | null; body: string; createdAt: string; editedAt: string | null; deleted: boolean; author: Person | null }
export interface Topic {
  id: string; classId: string; title: string; body: string; pinned: boolean; locked: boolean; createdAt: string; author: Person; posts: Post[];
}

export interface Channel {
  id: string; kind: 'class' | 'group' | 'dm'; classId: string | null; classTitle: string | null; name: string;
  otherUserId: string | null; lastBody: string | null; lastAt: string | null; lastAuthor: string | null; unread: number;
}
export interface Message {
  id: string; seq: number; channelId: string; replyToId: string | null; createdAt: string; editedAt: string | null;
  deleted: boolean; body: string; author: Person & { avatarUrl?: string | null };
}

export const isStaffRole = (r?: Role) => r === 'instructor' || r === 'assistant';
