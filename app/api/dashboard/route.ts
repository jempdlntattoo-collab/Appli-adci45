import { BUCKET, canAccess, canAdminCompany, canAdminProject, currentUser, DB, ensureSeed, logActivity, syncCompanyMembers } from "../data";
import { clerkClient } from "@clerk/nextjs/server";

export const dynamic = "force-dynamic";

export async function GET(request:Request) {
  try {
    const user=await currentUser(request); await ensureSeed(user); await syncCompanyMembers();
    const requested=new URL(request.url).searchParams.get("project");
    const projectsResult=await DB.prepare(`SELECT DISTINCT p.* FROM projects p LEFT JOIN project_members m ON m.project_id=p.id
      WHERE p.created_by=? OR m.user_id=? OR lower(m.email)=lower(?) ORDER BY p.created_at`).bind(user.userId,user.userId,user.email).all();
    const projects=projectsResult.results as Record<string,unknown>[];
    const projectId=(requested && projects.some(p=>p.id===requested) ? requested : projects[0]?.id) as string|undefined;
    const isCompanyAdmin=await canAdminCompany(user.userId,user.email);
    const companyMembers=isCompanyAdmin
      ? await DB.prepare("SELECT id,user_id,email,display_name,role,status,avatar_key IS NOT NULL has_avatar,avatar_key avatar_version FROM company_members ORDER BY display_name").all()
      : await DB.prepare(`SELECT DISTINCT cm.id,cm.user_id,cm.email,cm.display_name,cm.role,cm.status,cm.avatar_key IS NOT NULL has_avatar,cm.avatar_key avatar_version
          FROM company_members cm JOIN project_members pm ON (lower(pm.email)=lower(cm.email) OR pm.user_id=cm.user_id OR cm.id='member:'||pm.id)
          WHERE pm.project_id IN (SELECT id FROM projects WHERE created_by=? UNION SELECT project_id FROM project_members WHERE user_id=? OR lower(email)=lower(?))
          ORDER BY cm.display_name`).bind(user.userId,user.userId,user.email).all();
    if(!projectId) return Response.json({user,projects:[],events:[],notes:[],files:[],members:[],allMembers:[],companyMembers:companyMembers.results,activities:[],timer:null,canAdminProject:false,canAdminCompany:isCompanyAdmin});
    const [events,notes,files,members,allMembers,eventMembers,activities,timer]=await Promise.all([
      DB.prepare("SELECT e.*,p.name project_name,p.address,p.color FROM events e JOIN projects p ON p.id=e.project_id WHERE e.project_id IN (SELECT id FROM projects WHERE created_by=? UNION SELECT project_id FROM project_members WHERE user_id=? OR lower(email)=lower(?)) ORDER BY starts_at").bind(user.userId,user.userId,user.email).all(),
      DB.prepare("SELECT * FROM notes WHERE project_id=? ORDER BY created_at DESC").bind(projectId).all(),
      DB.prepare("SELECT id,name,content_type,size,kind,uploaded_by_name,created_at FROM files WHERE project_id=? ORDER BY created_at DESC").bind(projectId).all(),
      DB.prepare("SELECT id,display_name,email,role,status FROM project_members WHERE project_id=? ORDER BY created_at").bind(projectId).all(),
      DB.prepare("SELECT id,project_id,display_name,email,role,status FROM project_members WHERE project_id IN (SELECT id FROM projects WHERE created_by=? UNION SELECT project_id FROM project_members WHERE user_id=? OR lower(email)=lower(?)) ORDER BY display_name").bind(user.userId,user.userId,user.email).all(),
      DB.prepare("SELECT em.event_id,pm.id member_id,pm.display_name FROM event_members em JOIN project_members pm ON pm.id=em.member_id JOIN events e ON e.id=em.event_id WHERE e.project_id IN (SELECT id FROM projects WHERE created_by=? UNION SELECT project_id FROM project_members WHERE user_id=? OR lower(email)=lower(?)) ORDER BY pm.display_name").bind(user.userId,user.userId,user.email).all(),
      DB.prepare("SELECT * FROM activities WHERE project_id=? ORDER BY created_at DESC LIMIT 20").bind(projectId).all(),
      DB.prepare("SELECT * FROM time_entries WHERE user_id=? AND ends_at IS NULL ORDER BY starts_at DESC LIMIT 1").bind(user.userId).first(),
    ]);
    const assignedByEvent=new Map<string,{id:string;display_name:string}[]>();
    for(const row of eventMembers.results as Record<string,unknown>[]){
      const eventId=String(row.event_id); const assigned=assignedByEvent.get(eventId)??[];
      assigned.push({id:String(row.member_id),display_name:String(row.display_name)}); assignedByEvent.set(eventId,assigned);
    }
    const eventsWithMembers=(events.results as Record<string,unknown>[]).map(event=>({...event,assigned_members:assignedByEvent.get(String(event.id))??[]}));
    const isProjectAdmin=await canAdminProject(projectId,user.userId,user.email);
    return Response.json({user,projects,selectedProjectId:projectId,events:eventsWithMembers,notes:notes.results,files:files.results,members:members.results,allMembers:allMembers.results,companyMembers:companyMembers.results,activities:activities.results,timer,canAdminProject:isProjectAdmin,canAdminCompany:isCompanyAdmin});
  } catch(e) { if(e instanceof Response)return e; console.error(e); return Response.json({error:"Données temporairement indisponibles."},{status:500}); }
}

export async function POST(request:Request) {
  try {
    const user=await currentUser(request); const body=await request.json() as Record<string,any>; const now=new Date().toISOString();
    if(body.action==="createProject"){
      const id=crypto.randomUUID();
      await DB.batch([
        DB.prepare("INSERT INTO projects (id,name,address,status,color,due_date,progress,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(id,String(body.name).slice(0,100),String(body.address||"").slice(0,200),"active","#3c73c9",body.dueDate||null,0,user.userId,now),
        DB.prepare("INSERT INTO project_members (id,project_id,user_id,email,display_name,role,status,created_at) VALUES (?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(),id,user.userId,user.email,user.displayName,"admin","active",now),
      ]); await logActivity(id,user,"project_created","Chantier créé"); return Response.json({ok:true,id});
    }
    const projectId=String(body.projectId||""); if(!await canAccess(projectId,user.userId,user.email)) return new Response("Accès refusé",{status:403});
    if(body.action==="deleteProject"){
      if(!await canAdminProject(projectId,user.userId,user.email)) return Response.json({error:"Seul un administrateur peut supprimer ce chantier."},{status:403});
      const files=await DB.prepare("SELECT object_key FROM files WHERE project_id=?").bind(projectId).all<{object_key:string}>();
      await Promise.all(files.results.map(file=>BUCKET.delete(file.object_key)));
      await DB.prepare("DELETE FROM projects WHERE id=?").bind(projectId).run();
      return Response.json({ok:true,deleted:true});
    }
    if(body.action==="setMemberRole"){
      if(!await canAdminProject(projectId,user.userId,user.email)) return Response.json({error:"Seul un administrateur peut modifier les rôles."},{status:403});
      const role=body.role==="admin"?"admin":"member";
      const memberId=String(body.memberId||"");
      const member=await DB.prepare("SELECT id FROM project_members WHERE id=? AND project_id=?").bind(memberId,projectId).first();
      if(!member) return Response.json({error:"Utilisateur introuvable."},{status:404});
      await DB.prepare("UPDATE project_members SET role=? WHERE id=? AND project_id=?").bind(role,memberId,projectId).run();
      await logActivity(projectId,user,"member_role_updated",role==="admin"?"Un administrateur a été nommé":"Un administrateur est devenu membre");
      return Response.json({ok:true});
    }
    if(body.action==="setCompanyMemberRole"){
      if(!await canAdminCompany(user.userId,user.email)) return Response.json({error:"Seul un administrateur peut modifier les autorisations."},{status:403});
      const memberId=String(body.memberId||""); const role=body.role==="admin"?"admin":"member";
      const member=await DB.prepare("SELECT * FROM company_members WHERE id=?").bind(memberId).first<Record<string,any>>();
      if(!member) return Response.json({error:"Membre introuvable."},{status:404});
      if(String(member.email||"").toLowerCase()===user.email.toLowerCase()) return Response.json({error:"Tu ne peux pas modifier les autorisations de ton propre compte."},{status:400});
      await DB.batch([
        DB.prepare("UPDATE company_members SET role=? WHERE id=?").bind(role,memberId),
        DB.prepare(`UPDATE project_members SET role=? WHERE (email IS NOT NULL AND lower(email)=lower(?)) OR (user_id IS NOT NULL AND user_id=?) OR ('member:'||id)=?`).bind(role,member.email||"",member.user_id||"",memberId),
        ...(role==="member"&&member.user_id?[DB.prepare("UPDATE projects SET created_by=? WHERE created_by=?").bind(user.userId,member.user_id)]:[]),
      ]);
      return Response.json({ok:true});
    }
    if(body.action==="deleteCompanyMember"){
      if(!await canAdminCompany(user.userId,user.email)) return Response.json({error:"Seul un administrateur peut supprimer un membre."},{status:403});
      const memberId=String(body.memberId||"");
      const member=await DB.prepare("SELECT * FROM company_members WHERE id=?").bind(memberId).first<Record<string,any>>();
      if(!member) return Response.json({error:"Membre introuvable."},{status:404});
      if(String(member.email||"").toLowerCase()===user.email.toLowerCase()) return Response.json({error:"Tu ne peux pas supprimer ton propre compte."},{status:400});
      if(member.avatar_key) await BUCKET.delete(String(member.avatar_key));
      await DB.batch([
        ...(member.user_id?[DB.prepare("UPDATE projects SET created_by=? WHERE created_by=?").bind(user.userId,member.user_id)]:[]),
        DB.prepare(`DELETE FROM project_members WHERE (email IS NOT NULL AND lower(email)=lower(?)) OR (user_id IS NOT NULL AND user_id=?) OR ('member:'||id)=?`).bind(member.email||"",member.user_id||"",memberId),
        DB.prepare("DELETE FROM company_members WHERE id=?").bind(memberId),
      ]);
      return Response.json({ok:true});
    }
    if(body.action==="addNote"){
      const id=crypto.randomUUID(); await DB.prepare("INSERT INTO notes (id,project_id,body,done,author_id,author_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").bind(id,projectId,String(body.body).slice(0,1000),0,user.userId,user.displayName,now,now).run();
      await logActivity(projectId,user,"note_added","Modification ajoutée"); return Response.json({ok:true,id});
    }
    if(body.action==="toggleNote"){
      await DB.prepare("UPDATE notes SET done=CASE done WHEN 1 THEN 0 ELSE 1 END, updated_at=? WHERE id=? AND project_id=?").bind(now,String(body.id),projectId).run();
      await logActivity(projectId,user,"note_updated","Statut d’une modification changé"); return Response.json({ok:true});
    }
    if(body.action==="timer"){
      const running=await DB.prepare("SELECT * FROM time_entries WHERE user_id=? AND ends_at IS NULL LIMIT 1").bind(user.userId).first<Record<string,any>>();
      if(running){ const seconds=Math.max(0,Math.floor((Date.now()-Date.parse(running.starts_at))/1000)); await DB.prepare("UPDATE time_entries SET ends_at=?,duration_seconds=? WHERE id=?").bind(now,seconds,running.id).run(); await logActivity(String(running.project_id),user,"timer_stopped",`Pointage arrêté · ${Math.floor(seconds/60)} min`); }
      else { await DB.prepare("INSERT INTO time_entries (id,project_id,user_id,user_name,starts_at,ends_at,duration_seconds,created_at) VALUES (?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(),projectId,user.userId,user.displayName,now,null,0,now).run(); await logActivity(projectId,user,"timer_started","Pointage démarré"); }
      return Response.json({ok:true});
    }
    if(body.action==="invite"){
      if(!await canAdminProject(projectId,user.userId,user.email)) return Response.json({error:"Seul un administrateur peut inviter et choisir les rôles."},{status:403});
      const email=String(body.email||"").trim().toLowerCase(); if(!email.includes("@")) return Response.json({error:"Adresse e-mail invalide"},{status:400});
      const displayName=String(body.name||email.split("@")[0]).slice(0,80); const role=body.role==="admin"?"admin":"member";
      try {
        const client=await clerkClient();
        await client.invitations.createInvitation({
          emailAddress:email,
          notify:true,
          ignoreExisting:true,
          redirectUrl:new URL("/sign-up",request.url).toString(),
          publicMetadata:{displayName,role},
        });
      } catch(error) {
        console.error("[dashboard/invite] Clerk invitation failed",{email,error:String(error)});
        return Response.json({error:"L’e-mail d’invitation n’a pas pu être envoyé. Vérifie l’adresse puis réessaie."},{status:502});
      }
      await DB.batch([
        DB.prepare("INSERT INTO project_members (id,project_id,user_id,email,display_name,role,status,created_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(project_id,email) DO UPDATE SET status='invited', role=excluded.role").bind(crypto.randomUUID(),projectId,null,email,displayName,role,"invited",now),
        DB.prepare(`INSERT INTO company_members (id,user_id,email,display_name,role,status,created_at) VALUES (?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,role=excluded.role,status=excluded.status`).bind(`email:${email}`,null,email,displayName,role,"invited",now),
      ]);
      await logActivity(projectId,user,"member_invited",`Invitation envoyée à ${email}`); return Response.json({ok:true});
    }
    if(body.action==="addExistingMembers"){
      if(!await canAdminProject(projectId,user.userId,user.email)) return Response.json({error:"Seul un administrateur peut ajouter des membres."},{status:403});
      const requestedIds=Array.isArray(body.memberIds)?[...new Set(body.memberIds.map(String))]:[];
      if(!requestedIds.length) return Response.json({error:"Sélectionne au moins une personne."},{status:400});
      const inserts=[];
      for(const memberId of requestedIds){
        const member=await DB.prepare("SELECT * FROM company_members WHERE id=?").bind(memberId).first<Record<string,any>>();
        if(!member)continue;
        const exists=await DB.prepare(`SELECT id FROM project_members WHERE project_id=? AND ((email IS NOT NULL AND lower(email)=lower(?)) OR (user_id IS NOT NULL AND user_id=?) OR ('member:'||id)=?) LIMIT 1`).bind(projectId,member.email||"",member.user_id||"",memberId).first();
        if(!exists)inserts.push(DB.prepare("INSERT INTO project_members (id,project_id,user_id,email,display_name,role,status,created_at) VALUES (?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(),projectId,member.user_id||null,member.email||null,member.display_name,member.role,member.status,now));
      }
      if(inserts.length)await DB.batch(inserts);
      await logActivity(projectId,user,"members_added",`${inserts.length} membre${inserts.length>1?"s":""} ajouté${inserts.length>1?"s":""} au chantier`); return Response.json({ok:true});
    }
    if(body.action==="addEvent"){
      const id=crypto.randomUUID();
      const requestedIds=Array.isArray(body.memberIds)?body.memberIds.map(String):[];
      const validMembers=await DB.prepare("SELECT id FROM project_members WHERE project_id=?").bind(projectId).all<{id:string}>();
      const allowed=new Set(validMembers.results.map(member=>member.id)); const memberIds=[...new Set(requestedIds.filter(id=>allowed.has(id)))];
      await DB.batch([
        DB.prepare("INSERT INTO events (id,project_id,title,starts_at,ends_at,created_by,created_at) VALUES (?,?,?,?,?,?,?)").bind(id,projectId,String(body.title).slice(0,120),body.startsAt,body.endsAt,user.userId,now),
        ...memberIds.map(memberId=>DB.prepare("INSERT INTO event_members (event_id,member_id) VALUES (?,?)").bind(id,memberId)),
      ]);
      await logActivity(projectId,user,"event_added",String(body.title).slice(0,120)); return Response.json({ok:true,id});
    }
    if(body.action==="updateEventMembers"){
      const eventId=String(body.eventId||"");
      const event=await DB.prepare("SELECT id FROM events WHERE id=? AND project_id=?").bind(eventId,projectId).first();
      if(!event) return Response.json({error:"Intervention introuvable."},{status:404});
      const requestedIds=Array.isArray(body.memberIds)?body.memberIds.map(String):[];
      const validMembers=await DB.prepare("SELECT id FROM project_members WHERE project_id=?").bind(projectId).all<{id:string}>();
      const allowed=new Set(validMembers.results.map(member=>member.id)); const memberIds=[...new Set(requestedIds.filter(id=>allowed.has(id)))];
      await DB.batch([
        DB.prepare("DELETE FROM event_members WHERE event_id=?").bind(eventId),
        ...memberIds.map(memberId=>DB.prepare("INSERT INTO event_members (event_id,member_id) VALUES (?,?)").bind(eventId,memberId)),
      ]);
      await logActivity(projectId,user,"event_members_updated","Équipe de l’intervention modifiée"); return Response.json({ok:true});
    }
    if(body.action==="updateEvent"){
      const eventId=String(body.eventId||"");
      const event=await DB.prepare("SELECT id FROM events WHERE id=? AND project_id=?").bind(eventId,projectId).first();
      if(!event) return Response.json({error:"Intervention introuvable."},{status:404});
      const title=String(body.title||"").trim().slice(0,120); const startsAt=String(body.startsAt||""); const endsAt=String(body.endsAt||"");
      if(!title||!Number.isFinite(Date.parse(startsAt))||!Number.isFinite(Date.parse(endsAt))||Date.parse(endsAt)<=Date.parse(startsAt)) return Response.json({error:"Vérifie la date et les horaires."},{status:400});
      const requestedIds=Array.isArray(body.memberIds)?body.memberIds.map(String):[];
      const validMembers=await DB.prepare("SELECT id FROM project_members WHERE project_id=?").bind(projectId).all<{id:string}>();
      const allowed=new Set(validMembers.results.map(member=>member.id)); const memberIds=[...new Set(requestedIds.filter(id=>allowed.has(id)))];
      await DB.batch([
        DB.prepare("UPDATE events SET title=?,starts_at=?,ends_at=? WHERE id=? AND project_id=?").bind(title,startsAt,endsAt,eventId,projectId),
        DB.prepare("DELETE FROM event_members WHERE event_id=?").bind(eventId),
        ...memberIds.map(memberId=>DB.prepare("INSERT INTO event_members (event_id,member_id) VALUES (?,?)").bind(eventId,memberId)),
      ]);
      await logActivity(projectId,user,"event_updated",`Intervention modifiée · ${title}`); return Response.json({ok:true});
    }
    if(body.action==="deleteEvent"){
      const eventId=String(body.eventId||"");
      const event=await DB.prepare("SELECT title FROM events WHERE id=? AND project_id=?").bind(eventId,projectId).first<{title:string}>();
      if(!event) return Response.json({error:"Intervention introuvable."},{status:404});
      await DB.prepare("DELETE FROM events WHERE id=? AND project_id=?").bind(eventId,projectId).run();
      await logActivity(projectId,user,"event_deleted",`Intervention supprimée · ${event.title}`); return Response.json({ok:true});
    }
    return Response.json({error:"Action inconnue"},{status:400});
  } catch(e) { if(e instanceof Response)return e; console.error(e); return Response.json({error:"Enregistrement impossible. Réessayez."},{status:500}); }
}
