import { Button } from "@/components/ui/button";
import type { TagOption } from "@/lib/supabase";

interface CategoryFilterProps {
  selected: string;
  onSelect: (tag: string) => void;
  categories: TagOption[];
}

export function CategoryFilter({
  selected,
  onSelect,
  categories,
}: CategoryFilterProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {categories.map((cat) => (
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
