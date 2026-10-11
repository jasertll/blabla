"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import type { GoldDecisionOutput } from "@/lib/gold/types";
import { unlockAlertAudio, playAlertChime } from "@/lib/gold/alertSound";

const STORAGE_KEY = "jaser:gold:alertsEnabled:v1";

/**
 * Fires a browser Notification + a short chime the moment the live
 * decision transitions from wait to buy/sell — for someone actively
 * scalping who doesn't want to keep clicking "افحص الآن" manually. This
 * is NOT real push: it only works while this tab stays open in a running
 * browser (the Notification API has no server-side delivery here, no
 * service worker, no VAPID subscription) — closing the tab or the
 * browser means no alert, and that's disclosed plainly below rather than
 * implied to be more than it is.
 */
export default function GoldAlerts({ decision }: { decision: GoldDecisionOutput | null }) {
  const [enabled, setEnabled] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const prevDecisionRef = useRef<GoldDecisionOutput["decision"] | null>(null);
  const primedRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setEnabled(window.localStorage.getItem(STORAGE_KEY) === "1");
    setPermission("Notification" in window ? Notification.permission : "unsupported");
  }, []);

  useEffect(() => {
    if (!decision) return;
    // First observed decision after mount/reload just establishes the
    // baseline — it's not a "transition" the user should be alerted to,
    // since they may well already be looking at exactly this result.
    if (!primedRef.current) {
      primedRef.current = true;
      prevDecisionRef.current = decision.decision;
      return;
    }
    const prev = prevDecisionRef.current;
    prevDecisionRef.current = decision.decision;
    if (!enabled) return;
    if (prev === "wait" && decision.decision !== "wait") {
      const directionWord = decision.decision === "buy" ? "شراء" : "بيع";
      playAlertChime(decision.decision);
      if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
        new Notification(`Jaser — إشارة ${directionWord} على XAU/USD`, {
          body: `فريم ${decision.primaryTimeframe} · جودة ${decision.quality} · السعر ${decision.price?.toFixed(2) ?? "—"}`,
          tag: "jaser-gold-alert",
        });
      }
    }
  }, [decision, enabled]);

  function toggle() {
    if (enabled) {
      setEnabled(false);
      window.localStorage.setItem(STORAGE_KEY, "0");
      return;
    }
    // Flip on immediately — don't gate the toggle on the permission
    // prompt or the audio unlock settling first. requestPermission()'s
    // promise can sit pending indefinitely in some sandboxed/automated
    // contexts with no dialog available to resolve it (no rejection to
    // catch, just a permanently unresolved await), which would silently
    // wedge the whole toggle if it sat in the critical path. The chime
    // and the OS notification are two independent, optional channels —
    // each is requested best-effort in the background and neither one
    // blocks "enabled" from becoming true.
    setEnabled(true);
    window.localStorage.setItem(STORAGE_KEY, "1");
    try {
      unlockAlertAudio();
    } catch {
      /* chime just won't play — notification can still fire */
    }
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission()
        .then((result) => setPermission(result))
        .catch(() => {
          /* notification just won't fire — chime can still play */
        });
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={toggle}
        className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md border transition-colors ${
          enabled ? "bg-accent/20 border-accent/50 text-accent-glow" : "border-border/60 text-slate-500 hover:text-slate-300"
        }`}
        title="تنبيه إشعار المتصفح + صوت لما يطلع قرار شراء/بيع جديد — يشتغل بس إذا هالتبويب مفتوح"
      >
        {enabled ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
        {enabled ? "التنبيهات مفعّلة" : "فعّل التنبيهات"}
      </button>
      {enabled && permission === "denied" && (
        <span className="text-[10px] text-amber-400">رفض المتصفح إذن الإشعارات — الصوت رح يشتغل بس، بدون إشعار مرئي.</span>
      )}
    </div>
  );
}
