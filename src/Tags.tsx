// テストケースのタグ。一覧と詳細で同じ見た目にする。
import { Badge } from "@/components/ui/badge";

/** タグの並び。なければ何も出さない。 */
export function TagList({ tags }: { tags?: readonly string[] }) {
  if (!tags?.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="タグ">
      {tags.map((tag) => (
        <li key={tag}>
          <Badge variant="outline" className="font-normal">
            {tag}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
