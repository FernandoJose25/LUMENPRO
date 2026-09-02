import { ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  selected?: boolean;
  loading?: boolean;
}

const base =
  "inline-flex items-center justify-center gap-2 rounded-control font-medium " +
  "transition-colors duration-100 select-none " +
  "disabled:opacity-40 disabled:cursor-not-allowed " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";

const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-xs",
  md: "h-9 px-3.5 text-sm",
  lg: "h-12 px-5 text-base", // "controles grandes para operaciones durante evento" (sección 1)
};

const variants: Record<Variant, string> = {
  primary:
    "bg-accent text-bg hover:bg-accent/90 active:bg-accent/80 " +
    "aria-[pressed=true]:ring-2 aria-[pressed=true]:ring-accent/50",
  secondary:
    "bg-panel2 text-text-primary border border-border hover:bg-panel2/70 " +
    "active:bg-panel2/50",
  ghost:
    "bg-transparent text-text-secondary hover:bg-panel2 hover:text-text-primary",
  danger:
    "bg-state-danger text-white hover:bg-state-danger/90 active:bg-state-danger/80",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant = "secondary", size = "md", selected, loading, disabled, children, ...props },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        aria-pressed={selected}
        aria-busy={loading}
        className={cn(
          base,
          sizes[size],
          variants[variant],
          selected && "ring-2 ring-accent ring-offset-2 ring-offset-bg",
          className,
        )}
        {...props}
      >
        {loading ? (
          <span
            className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden
          />
        ) : null}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";
