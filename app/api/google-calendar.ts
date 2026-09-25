import { clerkClient } from "@clerk/nextjs/server";

const scope = "https://www.googleapis.com/auth/calendar.events";
const api = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

export type CalendarIntervention = {
  title: string;
  startsAt: string;
  endsAt: string;
  projectName: string;
  address: string;
  attendeeEmails: string[];
};

export class CalendarError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

async function googleToken(userId: string): Promise<string> {
  const response = await (await clerkClient()).users.getUserOauthAccessToken(userId, "oauth_google");
  const grant = response.data.find(item => item.scopes?.some(value => value === scope || value === "https://www.googleapis.com/auth/calendar"));
  if (!grant) throw new CalendarError("Connectez votre compte Google et autorisez l'accès aux événements de votre agenda avant d'envoyer cette intervention.", 409);
  return grant.token;
}

async function calendarRequest(userId: string, method: string, url: string, body?: unknown) {
  const token = await googleToken(userId);
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new CalendarError("L'accès à Google Agenda a expiré ou n'est pas autorisé. Reconnectez votre compte Google.", 409);
    throw new CalendarError("Google Agenda n'a pas confirmé l'envoi. L'intervention n'a pas été modifiée.", 502);
  }
  return response.status === 204 ? null : response.json() as Promise<{ id: string }>;
}

function payload(event: CalendarIntervention) {
  return {
    summary: `ADCI · ${event.title}`,
    start: { dateTime: event.startsAt },
    end: { dateTime: event.endsAt },
    location: event.address,
    description: `Chantier : ${event.projectName}\nIntervention organisée dans l'application ADCI.`,
    attendees: event.attendeeEmails.map(email => ({ email })),
    guestsCanInviteOthers: false,
  };
}

export async function createCalendarEvent(userId: string, event: CalendarIntervention) {
  const result = await calendarRequest(userId, "POST", `${api}?sendUpdates=all`, payload(event));
  if (!result?.id) throw new CalendarError("Google Agenda n'a pas confirmé la création de l'événement.", 502);
  return result.id;
}

export async function updateCalendarEvent(userId: string, id: string, event: CalendarIntervention) {
  await calendarRequest(userId, "PUT", `${api}/${encodeURIComponent(id)}?sendUpdates=all`, payload(event));
}

export async function deleteCalendarEvent(userId: string, id: string) {
  await calendarRequest(userId, "DELETE", `${api}/${encodeURIComponent(id)}?sendUpdates=all`);
}
