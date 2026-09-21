import React from "react";
import { useI18n } from "../hooks/useI18n";
import type { RoomPermissions } from "../services/roomSync";

interface PermissionEditorProps {
  perms: RoomPermissions;
  onChange: (perms: RoomPermissions) => void;
}

const PermissionEditor: React.FC<PermissionEditorProps> = ({ perms, onChange }) => {
  const { dict } = useI18n();
  const rows: { role: "guest" | "member"; label: string }[] = [
    { role: "guest", label: dict.room.permGuest },
    { role: "member", label: dict.room.permMember },
  ];

  return (
    <div className="mb-4">
      <div className="text-[11px] uppercase tracking-widest text-white/40 mb-2">
        {dict.room.permTitle}
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden">
        {rows.map((row, i) => (
          <div
            key={row.role}
            className={`px-4 py-3 ${i > 0 ? "border-t border-white/10" : ""}`}
          >
            <div className="text-sm text-white/85 mb-2">{row.label}</div>
            <div className="flex gap-2">
              {(["control", "edit"] as const).map((category) => {
                const on = perms[row.role][category];
                return (
                  <button
                    key={category}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      onChange({
                        ...perms,
                        [row.role]: { ...perms[row.role], [category]: !on },
                      })
                    }
                    className={`flex-1 px-3 py-1.5 rounded-xl text-xs border transition-colors ${
                      on
                        ? "bg-white/15 text-white border-white/20"
                        : "bg-transparent text-white/40 border-white/10"
                    }`}
                  >
                    {category === "control" ? dict.room.permControl : dict.room.permEdit}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PermissionEditor;
