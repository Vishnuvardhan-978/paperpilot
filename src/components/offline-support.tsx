"use client";

import { useEffect, useState } from "react";

/** Registers the service worker (production only; it would fight dev hot reload) and shows an offline banner. */
export function OfflineSupport() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-[90] bg-amber-500/90 px-4 py-1.5 text-center text-xs font-medium text-[#06091a]">
      You&apos;re offline. Saved chats and flashcards work; new answers need a connection.
    </div>
  );
}
