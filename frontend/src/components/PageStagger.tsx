import { motion, type Variants, type HTMLMotionProps } from "motion/react";

const containerVariants: Variants = {
  hidden: { opacity: 1 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.04 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 380, damping: 32 },
  },
};

export function PageStagger(props: HTMLMotionProps<"div">) {
  return (
    <motion.div
      {...props}
      variants={containerVariants}
      initial="hidden"
      animate="show"
    />
  );
}

export function StaggerItem(props: HTMLMotionProps<"div">) {
  return <motion.div {...props} variants={itemVariants} />;
}
