type ClassValue = string | number | null | false | undefined;

/** Combina clases condicionales sin dependencias externas (clsx-lite). */
export function cn(...classes: ClassValue[]): string {
  return classes.filter(Boolean).join(" ");
}
