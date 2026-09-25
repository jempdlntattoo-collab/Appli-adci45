import { integer, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(), email: text("email").notNull(), displayName: text("display_name").notNull(), createdAt: text("created_at").notNull(),
}, (t) => [uniqueIndex("idx_users_email").on(t.email)]);

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(), name: text("name").notNull(), address: text("address").notNull(),
  status: text("status").notNull().default("active"), color: text("color").notNull().default("#3c73c9"),
  dueDate: text("due_date"), progress: integer("progress").notNull().default(0),
  createdBy: text("created_by").notNull(), createdAt: text("created_at").notNull(),
}, (t) => [index("idx_projects_status").on(t.status)]);

export const projectMembers = sqliteTable("project_members", {
  id: text("id").primaryKey(), projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: text("user_id"), email: text("email"), displayName: text("display_name").notNull(),
  role: text("role").notNull().default("member"), status: text("status").notNull().default("active"), createdAt: text("created_at").notNull(),
}, (t) => [index("idx_members_project").on(t.projectId), index("idx_members_user").on(t.userId), uniqueIndex("idx_members_project_email").on(t.projectId, t.email)]);

export const events = sqliteTable("events", {
  id: text("id").primaryKey(), projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(), startsAt: text("starts_at").notNull(), endsAt: text("ends_at").notNull(),
  createdBy: text("created_by").notNull(), createdAt: text("created_at").notNull(),
  shareToGoogle: integer("share_to_google", { mode: "boolean" }).notNull().default(false),
  googleEventId: text("google_event_id"), googleOrganizerUserId: text("google_organizer_user_id"),
}, (t) => [index("idx_events_project_start").on(t.projectId, t.startsAt)]);

export const notes = sqliteTable("notes", {
  id: text("id").primaryKey(), projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  body: text("body").notNull(), done: integer("done", { mode: "boolean" }).notNull().default(false),
  authorId: text("author_id").notNull(), authorName: text("author_name").notNull(),
  createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (t) => [index("idx_notes_project_created").on(t.projectId, t.createdAt)]);

export const timeEntries = sqliteTable("time_entries", {
  id: text("id").primaryKey(), projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(), userName: text("user_name").notNull(), startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at"), durationSeconds: integer("duration_seconds").notNull().default(0), createdAt: text("created_at").notNull(),
}, (t) => [index("idx_time_user_start").on(t.userId, t.startsAt), index("idx_time_project").on(t.projectId)]);

export const files = sqliteTable("files", {
  id: text("id").primaryKey(), projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  objectKey: text("object_key").notNull(), name: text("name").notNull(), contentType: text("content_type").notNull(),
  size: integer("size").notNull(), kind: text("kind").notNull().default("document"), uploadedBy: text("uploaded_by").notNull(),
  uploadedByName: text("uploaded_by_name").notNull(), createdAt: text("created_at").notNull(),
}, (t) => [index("idx_files_project_created").on(t.projectId, t.createdAt), uniqueIndex("idx_files_object_key").on(t.objectKey)]);

export const activities = sqliteTable("activities", {
  id: text("id").primaryKey(), projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  actorId: text("actor_id").notNull(), actorName: text("actor_name").notNull(), action: text("action").notNull(),
  detail: text("detail").notNull(), createdAt: text("created_at").notNull(),
}, (t) => [index("idx_activity_project_created").on(t.projectId, t.createdAt)]);
