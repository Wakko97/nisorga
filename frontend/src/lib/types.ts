export type Role = "OWNER" | "MEMBER";
export type ItemType = "IDEA" | "TASK";
export type ItemStatus = "INBOX" | "TODO" | "IN_PROGRESS" | "WAITING" | "DONE";
export type ItemSource = "MANUAL" | "EMAIL" | "VOICE";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  createdAt?: string;
}

export interface Item {
  id: string;
  type: ItemType;
  title: string;
  description: string | null;
  status: ItemStatus;
  important: boolean;
  urgent: boolean;
  dueDate: string | null;
  waitingSince: string | null;
  source: ItemSource;
  createdById: string;
  createdBy?: User;
  assignedToId: string | null;
  assignedTo?: User | null;
  googleEventId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WeeklyReview {
  openInboxItems: Item[];
  overdueTasks: Item[];
  staleIdeas: Item[];
}

export interface Comment {
  id: string;
  itemId: string;
  authorId: string;
  author?: User;
  body: string;
  createdAt: string;
}

export interface ApiKeyInfo {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  key?: string;
}

export interface WebhookSubscription {
  id: string;
  url: string;
  events: string[];
  createdAt: string;
}
