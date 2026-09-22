import { env } from "cloudflare:workers";
import { auth, clerkClient } from "@clerk/nextjs/server";

export const DB = env.DB!;
export const BUCKET = env.BUCKET!;

export async function currentUser(request: Request) {
  void request;
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
  return user;
}

export async function ensureSeed(user: Awaited<ReturnType<typeof currentUser>>) {
  const found = await DB.prepare("SELECT id FROM projects WHERE created_by=? LIMIT 1").bind(user.userId).first();
  if (found) return;
  const now = new Date().toISOString();
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
  ]);
}

export async function canAccess(projectId:string, userId:string, email:string) {
  const row = await DB.prepare(`SELECT p.id FROM projects p LEFT JOIN project_members m ON m.project_id=p.id
    WHERE p.id=? AND (p.created_by=? OR m.user_id=? OR lower(m.email)=lower(?)) LIMIT 1`).bind(projectId,userId,userId,email).first();
  return Boolean(row);
}

export async function logActivity(projectId:string, user:{userId:string;displayName:string}, action:string, detail:string) {
  await DB.prepare("INSERT INTO activities (id,project_id,actor_id,actor_name,action,detail,created_at) VALUES (?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(),projectId,user.userId,user.displayName,action,detail,new Date().toISOString()).run();
}
