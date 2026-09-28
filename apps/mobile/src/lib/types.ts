export type Role = 'instructor' | 'assistant' | 'student' | 'observer';

/** What each role is called in the app. The API keeps the original names. */
export const ROLE_LABELS: Record<Role | 'admin', string> = {
  admin: 'Administrator',
  instructor: 'Teacher',
  assistant: 'Teacher Assistant',
  student: 'Student',
  observer: 'Observer',
};
export interface User {
  id: string; email: string; displayName: string; avatarUrl: string | null;
  bio?: string; city?: string; languages?: string[]; helpWith?: string; showEmail?: boolean; allowDms?: boolean;
  isAdmin?: boolean;
  country?: string; // ISO code, '' when not set
  postalCode?: string;
  /** Set on accounts an administrator created or reset; the app asks for a new password first. */
  mustChangePassword?: boolean;
}
export interface Person { id: string; displayName: string; avatarUrl?: string | null; role?: Role }

export interface Profile {
  id: string; displayName: string; avatarUrl: string | null; bio: string; city: string; languages: string[];
  helpWith: string; country: string; countryName: string | null; postalCode: string | null; email: string | null; showEmail?: boolean; memberSince: string; isSelf: boolean; canMessage: boolean;
  sharedClasses: { id: string; title: string; role: Role; viewerRole: Role }[];
  stats: { questionsAsked: number; answersGiven: number; answersAccepted: number; topicsStarted: number };
}

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

export interface Member extends Person { role: Role; joinedAt: string; avatarUrl: string | null }

/** A file or link on an announcement or syllabus item. Files have no address until opened. */
export interface Attachment {
  id: string; kind: 'file' | 'link'; title: string; url: string | null; contentType: string | null; sizeBytes: number | null; createdAt: string;
}
export type AttachmentTarget = { targetKind: 'announcement' | 'syllabus_item'; targetId: string };

export interface SyllabusItem {
  id: string; position: number; title: string; body: string; dueOn: string | null; published: boolean; attachments?: Attachment[];
}
export interface Announcement { id: string; title: string; body: string; pinned: boolean; createdAt: string; author: Person; attachments?: Attachment[] }

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
  otherUserId: string | null; avatarUrl?: string | null; lastBody: string | null; lastAt: string | null; lastAuthor: string | null; unread: number;
}
export interface Message {
  id: string; seq: number; channelId: string; replyToId: string | null; createdAt: string; editedAt: string | null;
  deleted: boolean; body: string; author: Person & { avatarUrl?: string | null };
}

export const isStaffRole = (r?: Role) => r === 'instructor' || r === 'assistant';
/** Observers can read a class but not post, answer, vote or chat. */
export const canParticipate = (r?: Role) => !!r && r !== 'observer';

export interface AdminUser {
  id: string; displayName: string; email: string; avatarUrl: string | null; createdAt: string; isAdmin: boolean; mustChangePassword: boolean;
}
