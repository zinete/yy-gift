import { Button } from "@/components/ui/button";
import { CATEGORIES } from "@/lib/supabase";

interface CategoryFilterProps {
  selected: string;
  onSelect: (category: string) => void;
}

export function CategoryFilter({ selected, onSelect }: CategoryFilterProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {CATEGORIES.map((cat) => (
        <Button
          key={cat.value}
          variant={selected === cat.value ? "default" : "outline"}
          size="sm"
          onClick={() => onSelect(cat.value)}
          className="rounded-full"
        >
          {cat.label}
        </Button>
      ))}
    </div>
  );
}
