import React, { useState } from "react";
import { useI18n } from "../hooks/useI18n";
import { useToast } from "../hooks/useToast";
import { ROOM_ID_RE } from "../services/roomSync";

interface LandingProps {
  onJoin: (id: string) => void;
  onCreate: () => void;
}

// Shown on the bare domain (no ?room= param). There is no implicit room, so
// visitors type or paste a room ID here — or open an invite link — before
// the player becomes usable.
const Landing: React.FC<LandingProps> = ({ onJoin, onCreate }) => {
  const { dict } = useI18n();
  const { toast } = useToast();
  const [input, setInput] = useState("");

  const join = () => {
    const id = input.trim();
    if (!ROOM_ID_RE.test(id)) {
      toast.error(dict.room.invalidId);
      return;
    }
    onJoin(id);
  };

  return (
    <div className="flex-1 relative z-30 flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md bg-black/30 backdrop-blur-2xl border border-white/10 rounded-3xl p-6 sm:p-8 text-white shadow-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">
          {dict.landing.title}
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-white/60">
          {dict.landing.desc}
        </p>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={dict.landing.placeholder}
          className="w-full bg-white/10 border border-white/15 rounded-xl px-3 py-2.5 text-sm placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/40 mt-5"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              join();
            }
          }}
        />
        <button
          type="button"
          onClick={join}
          className="mt-3 w-full py-3.5 rounded-2xl text-sm font-semibold bg-white text-black hover:bg-white/90 active:scale-[0.99] transition-all shadow-lg"
        >
          {dict.landing.join}
        </button>
        <button
          type="button"
          onClick={onCreate}
          className="mt-3 w-full py-2.5 rounded-2xl text-sm text-white/70 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
        >
          {dict.landing.action}
        </button>
        <p className="mt-3 text-xs text-white/40">{dict.landing.hint}</p>
      </div>
    </div>
  );
};

export default Landing;
