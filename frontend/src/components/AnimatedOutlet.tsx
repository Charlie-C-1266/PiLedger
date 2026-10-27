import { useState } from "react";
import { useLocation, useOutlet } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";

/**
 * The routed screen as it was when its wrapper mounted. A live <Outlet /> in
 * the leaving wrapper would already show the next route, so that screen would
 * mount once while the old one fades and again when the fade ends, losing
 * anything opened in between.
 */
function FrozenOutlet() {
  const outlet = useOutlet();
  const [frozen] = useState(outlet);
  return frozen;
}

/**
 * The Shell's routed screen, cross-faded on navigation: the leaving screen
 * fades out before the next one mounts, once.
 */
export default function AnimatedOutlet() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <motion.div key={location.pathname} exit={{ opacity: 0, transition: { duration: 0.12 } }}>
        <FrozenOutlet />
      </motion.div>
    </AnimatePresence>
  );
}
