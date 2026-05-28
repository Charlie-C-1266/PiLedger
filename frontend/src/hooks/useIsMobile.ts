import { useState, useEffect } from "react";

export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => window.innerWidth < 720);

  useEffect(() => {
    const update = () => setMobile(window.innerWidth < 720);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return mobile;
}
