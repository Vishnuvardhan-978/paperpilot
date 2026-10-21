import { progressByLens, type DeckCard, type QuizResult } from "@/lib/learning";

export function ProgressTable({ deck, history }: { deck: DeckCard[]; history: QuizResult[] }) {
  const rows = progressByLens(deck, history);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wider text-[#415570]">
          <tr>
            <th className="py-2 pr-3 font-medium">Lens</th>
            <th className="py-2 pr-3 font-medium">Quizzes</th>
            <th className="py-2 pr-3 font-medium">Score</th>
            <th className="py-2 pr-3 font-medium">Cards</th>
            <th className="py-2 font-medium">Mastered</th>
          </tr>
        </thead>
        <tbody className="text-[#c5d4e6]">
          {rows.map((r) => (
            <tr key={r.lens} className="border-t border-white/[0.06]">
              <td className="py-2 pr-3 capitalize">{r.lens}</td>
              <td className="py-2 pr-3">{r.quizzes}</td>
              <td className="py-2 pr-3">{r.total ? `${Math.round((r.correct / r.total) * 100)}%` : "—"}</td>
              <td className="py-2 pr-3">{r.cards}</td>
              <td className="py-2">{r.mastered}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
