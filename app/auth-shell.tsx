import type { ReactNode } from "react";
import { CalendarDays, Camera, Clock3, FolderOpen, StickyNote } from "lucide-react";

const features = [
  { icon: CalendarDays, label: "Agenda partagé" },
  { icon: FolderOpen, label: "Dossiers de chantier" },
  { icon: Camera, label: "Photos de suivi" },
  { icon: Clock3, label: "Suivi des temps" },
  { icon: StickyNote, label: "Modifications attribuées" },
];

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <main className="grid min-h-screen bg-[#f3f5f7] lg:grid-cols-[1.05fr_.95fr]">
      <section className="hidden bg-[#123f3b] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-white font-black text-[#165b54]">S</div>
          <div><div className="text-xl font-black">Suivi Chantier</div><div className="text-sm text-emerald-100">Atelier & pose</div></div>
        </div>
        <div>
          <h1 className="max-w-xl text-4xl font-black leading-tight">Tous vos chantiers et votre équipe au même endroit.</h1>
          <div className="mt-8 grid max-w-xl grid-cols-2 gap-3">
            {features.map(({ icon: Icon, label }) => <div key={label} className="flex items-center gap-3 rounded-xl bg-white/10 p-4"><Icon className="h-5 w-5 text-emerald-200"/><span className="font-semibold">{label}</span></div>)}
          </div>
        </div>
        <p className="text-sm text-emerald-100">Seules les personnes que vous autorisez accèdent à vos chantiers.</p>
      </section>
      <section className="flex items-center justify-center p-5 sm:p-10">
        <div className="w-full max-w-md">
          <div className="mb-7 text-center lg:text-left">
            <div className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-xl bg-[#165b54] font-black text-white lg:hidden">S</div>
            <h1 className="text-3xl font-black text-[#18202b]">{title}</h1>
            <p className="mt-2 text-slate-500">{subtitle}</p>
          </div>
          {children}
        </div>
      </section>
    </main>
  );
}
