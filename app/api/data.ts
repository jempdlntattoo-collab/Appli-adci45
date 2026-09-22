import { env } from "cloudflare:workers";
import { auth, clerkClient } from "@clerk/nextjs/server";

export const DB = env.DB!;
export const BUCKET = env.BUCKET!;

let schemaReady: Promise<void> | undefined;

/**
 * Cloudflare creates the D1 database separately from the Worker deployment.
 * Initialise the small application schema on first use so a brand-new binding
 * can serve the dashboard without requiring a manual SQL-console step.
 */
export function ensureSchema() {
  if (!schemaReady) {
    schemaReady = DB.batch([
      DB.prepare(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY NOT NULL,
        email TEXT NOT NULL,
        display_name TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`),
      DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email)"),
      DB.prepare(`CREATE TABLE IF NOT EXISTS user_settings (
        user_id TEXT PRIMARY KEY NOT NULL,
        seeded_at TEXT NOT NULL
      )`),
      DB.prepare(`CREATE TABLE IF NOT EXISTS company_members (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT,
        email TEXT,
        display_name TEXT NOT NULL,
        role TEXT DEFAULT 'member' NOT NULL,
        status TEXT DEFAULT 'active' NOT NULL,
        avatar_key TEXT,
        avatar_content_type TEXT,
        created_at TEXT NOT NULL
      )`),
      DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_company_members_email ON company_members (email)"),
      DB.prepare(`CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        address TEXT NOT NULL,
        status TEXT DEFAULT 'active' NOT NULL,
        color TEXT DEFAULT '#3c73c9' NOT NULL,
        due_date TEXT,
        progress INTEGER DEFAULT 0 NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`),
      DB.prepare("CREATE INDEX IF NOT EXISTS idx_projects_status ON projects (status)"),
      DB.prepare(`CREATE TABLE IF NOT EXISTS project_members (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        user_id TEXT,
        email TEXT,
        display_name TEXT NOT NULL,
        role TEXT DEFAULT 'member' NOT NULL,
        status TEXT DEFAULT 'active' NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )`),
      DB.prepare("CREATE INDEX IF NOT EXISTS idx_members_project ON project_members (project_id)"),
      DB.prepare("CREATE INDEX IF NOT EXISTS idx_members_user ON project_members (user_id)"),
      DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_members_project_email ON project_members (project_id, email)"),
      DB.prepare(`CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        starts_at TEXT NOT NULL,
        ends_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )`),
      DB.prepare("CREATE INDEX IF NOT EXISTS idx_events_project_start ON events (project_id, starts_at)"),
      DB.prepare(`CREATE TABLE IF NOT EXISTS event_members (
        event_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        PRIMARY KEY (event_id, member_id),
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        FOREIGN KEY (member_id) REFERENCES project_members(id) ON DELETE CASCADE
      )`),
      DB.prepare("CREATE INDEX IF NOT EXISTS idx_event_members_event ON event_members (event_id)"),
      DB.prepare(`CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        object_key TEXT NOT NULL,
        name TEXT NOT NULL,
        content_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        kind TEXT DEFAULT 'document' NOT NULL,
        uploaded_by TEXT NOT NULL,
        uploaded_by_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )`),
      DB.prepare("CREATE INDEX IF NOT EXISTS idx_files_project_created ON files (project_id, created_at)"),
      DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_files_object_key ON files (object_key)"),
      DB.prepare(`CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        body TEXT NOT NULL,
        done INTEGER DEFAULT 0 NOT NULL,
        author_id TEXT NOT NULL,
        author_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )`),
      DB.prepare("CREATE INDEX IF NOT EXISTS idx_notes_project_created ON notes (project_id, created_at)"),
      DB.prepare(`CREATE TABLE IF NOT EXISTS time_entries (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        user_name TEXT NOT NULL,
        starts_at TEXT NOT NULL,
        ends_at TEXT,
        duration_seconds INTEGER DEFAULT 0 NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )`),
      DB.prepare("CREATE INDEX IF NOT EXISTS idx_time_user_start ON time_entries (user_id, starts_at)"),
      DB.prepare("CREATE INDEX IF NOT EXISTS idx_time_project ON time_entries (project_id)"),
      DB.prepare(`CREATE TABLE IF NOT EXISTS activities (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        actor_name TEXT NOT NULL,
        action TEXT NOT NULL,
        detail TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )`),
      DB.prepare("CREATE INDEX IF NOT EXISTS idx_activity_project_created ON activities (project_id, created_at)"),
    ]).then(() => undefined).catch((error) => {
      schemaReady = undefined;
      throw error;
    });
  }
  return schemaReady;
}

export async function currentUser(request: Request) {
  void request;
  await ensureSchema();
  const { userId } = await auth();
  if (!userId) throw new Response("Non autorisé", { status: 401 });

  const clerkUser = await (await clerkClient()).users.getUser(userId);
  const email = clerkUser.primaryEmailAddress?.emailAddress;
  if (!email) throw new Response("Adresse e-mail requise", { status: 403 });
  const fullName = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || null;
  const user = {
    userId,
    email,
    fullName,
    displayName: fullName ?? email,
  };
  const now = new Date().toISOString();
  await DB.prepare(`INSERT INTO users (id,email,display_name,created_at) VALUES (?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET email=excluded.email, display_name=excluded.display_name`)
    .bind(user.userId, user.email, user.displayName, now).run();
  await DB.prepare(`INSERT INTO company_members (id,user_id,email,display_name,role,status,created_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id, email=excluded.email, display_name=excluded.display_name, status='active'`)
    .bind(`email:${user.email.toLowerCase()}`,user.userId,user.email.toLowerCase(),user.displayName,"member","active",now).run();
  return user;
}

export async function syncCompanyMembers() {
  await DB.prepare(`INSERT OR IGNORE INTO company_members (id,user_id,email,display_name,role,status,created_at)
    SELECT CASE WHEN email IS NOT NULL AND email<>'' THEN 'email:'||lower(email) ELSE 'member:'||id END,
      user_id,lower(email),display_name,role,status,created_at FROM project_members`).run();
  await DB.prepare(`UPDATE company_members SET role='admin' WHERE id IN (
    SELECT CASE WHEN email IS NOT NULL AND email<>'' THEN 'email:'||lower(email) ELSE 'member:'||id END
    FROM project_members WHERE role='admin')`).run();
}

export async function ensureSeed(user: Awaited<ReturnType<typeof currentUser>>) {
  const seeded = await DB.prepare("SELECT user_id FROM user_settings WHERE user_id=? LIMIT 1").bind(user.userId).first();
  if (seeded) return;
  const found = await DB.prepare("SELECT id FROM projects WHERE created_by=? LIMIT 1").bind(user.userId).first();
  const now = new Date().toISOString();
  if (found) {
    await DB.prepare("INSERT OR IGNORE INTO user_settings (user_id,seeded_at) VALUES (?,?)").bind(user.userId,now).run();
    return;
  }
  const p1 = crypto.randomUUID(), p2 = crypto.randomUUID(), p3 = crypto.randomUUID();
  const day = new Date();
  const at = (hour:number, minute=0) => { const d=new Date(day); d.setHours(hour,minute,0,0); return d.toISOString(); };
  await DB.batch([
    DB.prepare("INSERT INTO projects (id,name,address,status,color,due_date,progress,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(p1,"Résidence des Pins","12 rue des Mésanges, Orléans","active","#3c73c9","2026-10-02",68,user.userId,now),
    DB.prepare("INSERT INTO projects (id,name,address,status,color,due_date,progress,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(p2,"Maison Moreau","Saint-Pryvé-Saint-Mesmin","active","#e3a62f","2026-10-12",35,user.userId,now),
    DB.prepare("INSERT INTO projects (id,name,address,status,color,due_date,progress,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(p3,"SCI Besse","Super-Besse, Auvergne","active","#43a36d",null,10,user.userId,now),
    DB.prepare("INSERT INTO project_members (id,project_id,user_id,email,display_name,role,status,created_at) VALUES (?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(),p1,user.userId,user.email,user.displayName,"admin","active",now),
    DB.prepare("INSERT INTO project_members (id,project_id,user_id,email,display_name,role,status,created_at) VALUES (?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(),p2,user.userId,user.email,user.displayName,"admin","active",now),
    DB.prepare("INSERT INTO project_members (id,project_id,user_id,email,display_name,role,status,created_at) VALUES (?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(),p3,user.userId,user.email,user.displayName,"admin","active",now),
    DB.prepare("INSERT INTO project_members (id,project_id,user_id,email,display_name,role,status,created_at) VALUES (?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(),p1,null,null,"Maxime","member","active",now),
    DB.prepare("INSERT INTO project_members (id,project_id,user_id,email,display_name,role,status,created_at) VALUES (?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(),p2,null,null,"Thomas","member","active",now),
    DB.prepare("INSERT INTO events (id,project_id,title,starts_at,ends_at,created_by,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),p1,"Pose cuisine",at(8),at(12),user.userId,now),
    DB.prepare("INSERT INTO events (id,project_id,title,starts_at,ends_at,created_by,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),p2,"Habillage mural chêne",at(13,30),at(16,30),user.userId,now),
    DB.prepare("INSERT INTO events (id,project_id,title,starts_at,ends_at,created_by,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),p3,"Visite et métrés",at(16,45),at(17,30),user.userId,now),
    DB.prepare("INSERT INTO notes (id,project_id,body,done,author_id,author_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(),p1,"Décaler la prise de 8 cm à gauche avant la pose du dosseret.",0,user.userId,user.displayName,now,now),
    DB.prepare("INSERT INTO notes (id,project_id,body,done,author_id,author_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(),p1,"Façades hautes validées en chêne naturel.",1,user.userId,user.displayName,now,now),
    DB.prepare("INSERT INTO user_settings (user_id,seeded_at) VALUES (?,?)").bind(user.userId,now),
  ]);
}

export async function canAccess(projectId:string, userId:string, email:string) {
  const row = await DB.prepare(`SELECT p.id FROM projects p LEFT JOIN project_members m ON m.project_id=p.id
    WHERE p.id=? AND (p.created_by=? OR m.user_id=? OR lower(m.email)=lower(?)) LIMIT 1`).bind(projectId,userId,userId,email).first();
  return Boolean(row);
}

export async function canAdminProject(projectId:string, userId:string, email:string) {
  const row = await DB.prepare(`SELECT p.id FROM projects p LEFT JOIN project_members m ON m.project_id=p.id
    WHERE p.id=? AND (p.created_by=? OR ((m.user_id=? OR lower(m.email)=lower(?)) AND m.role='admin')) LIMIT 1`)
    .bind(projectId,userId,userId,email).first();
  return Boolean(row);
}

export async function canAdminCompany(userId:string, email:string) {
  const row=await DB.prepare(`SELECT p.id FROM projects p LEFT JOIN project_members m ON m.project_id=p.id
    WHERE p.created_by=? OR ((m.user_id=? OR lower(m.email)=lower(?)) AND m.role='admin') LIMIT 1`)
    .bind(userId,userId,email).first();
  return Boolean(row);
}

export async function logActivity(projectId:string, user:{userId:string;displayName:string}, action:string, detail:string) {
  await DB.prepare("INSERT INTO activities (id,project_id,actor_id,actor_name,action,detail,created_at) VALUES (?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(),projectId,user.userId,user.displayName,action,detail,new Date().toISOString()).run();
}
